import * as path from "node:path";
import * as readline from "node:readline";
import { getActiveProfile, getAgentDir, VERSION } from "@reactor/utils";
import {
	DESKTOP_PROTOCOL_VERSION,
	type DesktopCommand,
	type DesktopFrame,
	type DesktopModelSummary,
	type DesktopSessionStatus,
	type DesktopSnapshot,
} from "@reactor/wire";
import { AutonomySessionRuntime } from "../../autonomy/session-runtime";
import { ModelRegistry } from "../../config/model-registry";
import type { ExtensionUIContext } from "../../extensibility/extensions";
import { loadSlashCommands } from "../../extensibility/slash-commands";
import { type CreateAgentSessionResult, createAgentSession, discoverAuthStorage } from "../../sdk";
import type { AgentSession } from "../../session/agent-session";
import type { AuthStorage } from "../../session/auth-storage";
import { listAllSessions } from "../../session/session-listing";
import { SessionManager } from "../../session/session-manager";
import { executeAcpBuiltinSlashCommand } from "../../slash-commands/acp-builtins";
import { buildAvailableSlashCommands } from "../../slash-commands/available-commands";
import type { ConfiguredThinkingLevel } from "../../thinking";
import { commit, diff, head, repo, restore, stage, status } from "../../utils/git";

type ManagedDesktopSession = {
	result: CreateAgentSessionResult;
	session: AgentSession;
	status: DesktopSessionStatus;
	unsubscribe: () => void;
	autonomy: AutonomySessionRuntime;
};

type DesktopState = { archived: Record<string, { archivedAt: string }> };
type PendingUiRequest = { resolve: (value: unknown) => void; reject: (error: Error) => void };

function writeFrame(frame: DesktopFrame): void {
	process.stdout.write(`${JSON.stringify(frame)}\n`);
}

function response(id: string, data?: unknown): DesktopFrame {
	return { version: DESKTOP_PROTOCOL_VERSION, type: "response", id, ok: true, data };
}

function errorResponse(id: string, error: unknown): DesktopFrame {
	return {
		version: DESKTOP_PROTOCOL_VERSION,
		type: "response",
		id,
		ok: false,
		error: error instanceof Error ? error.message : String(error),
	};
}

function assertCommand(value: unknown): DesktopCommand {
	if (value === null || typeof value !== "object") throw new Error("Desktop command must be an object");
	const command = value as Partial<DesktopCommand>;
	if (command.version !== DESKTOP_PROTOCOL_VERSION || typeof command.type !== "string") {
		throw new Error(`Unsupported desktop protocol version (expected ${DESKTOP_PROTOCOL_VERSION})`);
	}
	if (typeof command.id !== "string" || command.id.length === 0) throw new Error("Desktop command id is required");
	return command as DesktopCommand;
}

export class ManagedAgentSessionHost {
	#sessions = new Map<string, ManagedDesktopSession>();
	#authStorage: AuthStorage | undefined;
	#modelRegistry: ModelRegistry | undefined;
	#shuttingDown = false;
	#pendingUi = new Map<string, PendingUiRequest>();

	#uiContext(sessionId: string): ExtensionUIContext {
		const request = (
			method: "select" | "confirm" | "input",
			title: string,
			payload: Record<string, unknown>,
		): Promise<unknown> => {
			const requestId = crypto.randomUUID();
			const { promise, resolve, reject } = Promise.withResolvers<unknown>();
			this.#pendingUi.set(requestId, { resolve, reject });
			writeFrame({
				version: DESKTOP_PROTOCOL_VERSION,
				type: "ui_request",
				sessionId,
				requestId,
				method,
				title,
				...payload,
			});
			return promise.finally(() => this.#pendingUi.delete(requestId));
		};
		const partial = {
			select: async (title: string, options: Array<{ label: string }>) =>
				(await request("select", title, { options: options.map(option => option.label) })) as string | undefined,
			confirm: async (title: string, message: string) => (await request("confirm", title, { message })) === true,
			input: async (title: string, placeholder?: string) =>
				(await request("input", title, { placeholder })) as string | undefined,
			notify: (message: string, type?: "info" | "warning" | "error") =>
				writeFrame({ version: DESKTOP_PROTOCOL_VERSION, type: "notice", level: type ?? "info", message }),
			onTerminalInput: () => () => {},
			setStatus: () => {},
			setWorkingMessage: () => {},
			setWidget: () => {},
			setFooter: () => {},
			setHeader: () => {},
			setTitle: () => {},
			setEditorText: () => {},
			pasteToEditor: () => {},
			getEditorText: () => "",
			addAutocompleteProvider: () => {},
			setEditorComponent: () => {},
			getAllThemes: async () => [],
			getTheme: async () => undefined,
			setTheme: async () => ({ success: false, error: "Themes are controlled by the desktop shell" }),
			getToolsExpanded: () => false,
			setToolsExpanded: () => {},
			editor: async () => undefined,
			custom: async () => undefined,
			get theme() {
				return undefined;
			},
		};
		return partial as unknown as ExtensionUIContext;
	}

	async #desktopState(): Promise<DesktopState> {
		try {
			const parsed = (await Bun.file(
				path.join(getAgentDir(), "desktop", "state.json"),
			).json()) as Partial<DesktopState>;
			return { archived: parsed.archived ?? {} };
		} catch {
			return { archived: {} };
		}
	}

	async #writeDesktopState(state: DesktopState): Promise<void> {
		await Bun.write(path.join(getAgentDir(), "desktop", "state.json"), `${JSON.stringify(state, null, 2)}\n`);
	}

	async #gitState(cwd: string): Promise<DesktopFrame> {
		const [gitStatus, gitDiff, gitHead, repoRoot] = await Promise.all([
			status(cwd, { porcelainV1: true, untrackedFiles: "all" }).catch(() => ""),
			diff(cwd, { allowFailure: true }).catch(() => ""),
			head.resolve(cwd).catch(() => null),
			repo.root(cwd).catch(() => null),
		]);
		const openRoots = await Promise.all(
			[...this.#sessions.values()].map(record =>
				repo.root(record.session.sessionManager.getCwd()).catch(() => null),
			),
		);
		return {
			version: DESKTOP_PROTOCOL_VERSION,
			type: "git_state",
			cwd,
			state: {
				cwd,
				status: gitStatus,
				diff: gitDiff,
				branch: gitHead?.kind === "ref" ? gitHead.branchName : null,
				sharedWorktree: repoRoot !== null && openRoots.filter(openRoot => openRoot === repoRoot).length > 1,
			},
		};
	}

	async #services(): Promise<{ authStorage: AuthStorage; modelRegistry: ModelRegistry }> {
		if (!this.#authStorage) this.#authStorage = await discoverAuthStorage(getAgentDir());
		if (!this.#modelRegistry) this.#modelRegistry = new ModelRegistry(this.#authStorage);
		return { authStorage: this.#authStorage, modelRegistry: this.#modelRegistry };
	}

	async #create(cwd: string, sessionManager?: SessionManager): Promise<ManagedDesktopSession> {
		if (!path.isAbsolute(cwd)) throw new Error("Desktop sessions require an absolute cwd");
		const services = await this.#services();
		const result = await createAgentSession({
			cwd,
			authStorage: services.authStorage,
			modelRegistry: services.modelRegistry,
			sessionManager: sessionManager ?? SessionManager.create(cwd, `${getAgentDir()}/sessions`),
			hasUI: true,
		});
		const record: ManagedDesktopSession = {
			result,
			session: result.session,
			status: "idle",
			unsubscribe: () => {},
			autonomy: AutonomySessionRuntime.forSession(result.session),
		};
		result.setToolUIContext(this.#uiContext(result.session.sessionId), true);
		await record.autonomy.recover();
		record.unsubscribe = record.session.subscribe(event => {
			if (event.type === "agent_start") record.status = "running";
			if (event.type === "agent_end") {
				record.status = "idle";
				void this.#gitState(record.session.sessionManager.getCwd())
					.then(writeFrame)
					.catch(error => {
						writeFrame({
							version: DESKTOP_PROTOCOL_VERSION,
							type: "notice",
							level: "warning",
							message: `Unable to refresh Git status: ${error instanceof Error ? error.message : String(error)}`,
						});
					});
			}
			writeFrame({
				version: DESKTOP_PROTOCOL_VERSION,
				type: "session_event",
				sessionId: record.session.sessionId,
				event,
			});
			writeFrame({
				version: DESKTOP_PROTOCOL_VERSION,
				type: "autonomy_state",
				sessionId: record.session.sessionId,
				state: record.autonomy.controller.state,
			});
			writeFrame({
				version: DESKTOP_PROTOCOL_VERSION,
				type: "session_status",
				sessionId: record.session.sessionId,
				status: record.status,
			});
		});
		this.#sessions.set(record.session.sessionId, record);
		return record;
	}

	#record(sessionId: string): ManagedDesktopSession {
		const record = this.#sessions.get(sessionId);
		if (!record) throw new Error(`Unknown desktop session: ${sessionId}`);
		return record;
	}

	#snapshot(record: ManagedDesktopSession): DesktopSnapshot {
		const manager = record.session.sessionManager;
		return {
			sessionId: record.session.sessionId,
			header: manager.getHeader(),
			entries: manager.getEntries(),
			status: record.status,
			model: record.session.model
				? { provider: record.session.model.provider, id: record.session.model.id, name: record.session.model.name }
				: undefined,
			thinkingLevel: record.session.configuredThinkingLevel(),
			queuedMessageCount: record.session.queuedMessageCount,
			todoPhases: record.session.getTodoPhases(),
		};
	}

	async handle(command: DesktopCommand): Promise<boolean> {
		if (this.#shuttingDown && command.type !== "shutdown") throw new Error("Desktop host is shutting down");
		switch (command.type) {
			case "handshake":
				if (command.version !== DESKTOP_PROTOCOL_VERSION) throw new Error("Desktop protocol version mismatch");
				writeFrame({
					version: DESKTOP_PROTOCOL_VERSION,
					type: "ready",
					reactorVersion: VERSION,
					profile: getActiveProfile() ?? "default",
				});
				writeFrame(response(command.id, { protocolVersion: DESKTOP_PROTOCOL_VERSION, reactorVersion: VERSION }));
				return true;
			case "health":
				writeFrame(response(command.id, { ready: !this.#shuttingDown, sessions: this.#sessions.size }));
				return true;
			case "list_models": {
				const models: DesktopModelSummary[] = (await this.#services()).modelRegistry.getAvailable().map(model => ({
					provider: model.provider,
					id: model.id,
					name: model.name,
				}));
				writeFrame(response(command.id, { kind: "models", models }));
				return true;
			}
			case "list_commands": {
				const record = this.#record(command.sessionId);
				const commands = await buildAvailableSlashCommands(
					{
						extensionRunner: record.session.extensionRunner,
						customCommands: record.session.customCommands,
						mcpPromptCommands: record.session.mcpPromptCommands,
						skills: [...record.session.skills],
						skillsSettings: record.session.skillsSettings,
						setSlashCommands: slashCommands => record.session.setSlashCommands(slashCommands),
						sessionManager: record.session.sessionManager,
					},
					cwd => loadSlashCommands({ cwd }),
				);
				writeFrame(response(command.id, { kind: "commands", commands }));
				return true;
			}
			case "execute_command": {
				const record = this.#record(command.sessionId);
				const result = await executeAcpBuiltinSlashCommand(command.text, {
					session: record.session,
					sessionManager: record.session.sessionManager,
					settings: record.session.settings,
					cwd: record.session.sessionManager.getCwd(),
					output: text =>
						writeFrame({
							version: DESKTOP_PROTOCOL_VERSION,
							type: "command_output",
							sessionId: record.session.sessionId,
							text,
						}),
					refreshCommands: () => {},
					reloadPlugins: async () => {},
				});
				if (result === false) throw new Error("Unsupported desktop command");
				if ("prompt" in result) await record.session.prompt(result.prompt);
				writeFrame(response(command.id, result));
				return true;
			}
			case "list_sessions": {
				const desktopState = await this.#desktopState();
				const active = [...this.#sessions.values()].map(record => {
					const header = record.session.sessionManager.getHeader();
					return {
						sessionId: record.session.sessionId,
						title: header?.title,
						cwd: record.session.sessionManager.getCwd(),
						createdAt: header?.timestamp,
						updatedAt: header?.timestamp,
						status: record.status,
						archived: desktopState.archived[record.session.sessionId] !== undefined,
					};
				});
				const known = new Set(active.map(session => session.sessionId));
				const persisted = await listAllSessions();
				writeFrame(
					response(command.id, [
						...active,
						...persisted
							.filter(info => !known.has(info.id))
							.filter(info => !command.cwd || info.cwd === command.cwd)
							.map(info => ({
								sessionId: info.id,
								title: info.title,
								cwd: info.cwd,
								createdAt: info.created.toISOString(),
								updatedAt: info.modified.toISOString(),
								status: info.status === "pending" ? "paused" : info.status === "error" ? "error" : "idle",
								archived: desktopState.archived[info.id] !== undefined,
							})),
					]),
				);
				return true;
			}
			case "create_session": {
				const record = await this.#create(command.cwd);
				writeFrame(response(command.id, { sessionId: record.session.sessionId }));
				writeFrame({
					version: DESKTOP_PROTOCOL_VERSION,
					type: "session_snapshot",
					sessionId: record.session.sessionId,
					snapshot: this.#snapshot(record),
				});
				return true;
			}
			case "open_session": {
				const existing = this.#sessions.get(command.sessionId);
				if (existing) {
					writeFrame(response(command.id, { sessionId: existing.session.sessionId }));
					writeFrame({
						version: DESKTOP_PROTOCOL_VERSION,
						type: "session_snapshot",
						sessionId: existing.session.sessionId,
						snapshot: this.#snapshot(existing),
					});
					return true;
				}
				const info = (await listAllSessions()).find(candidate => candidate.id === command.sessionId);
				if (!info) throw new Error(`Persisted session not found: ${command.sessionId}`);
				const manager = await SessionManager.open(info.path, `${getAgentDir()}/sessions`, undefined, {
					initialCwd: command.cwd,
					suppressBreadcrumb: true,
				});
				const record = await this.#create(manager.getCwd(), manager);
				writeFrame(response(command.id, { sessionId: record.session.sessionId }));
				writeFrame({
					version: DESKTOP_PROTOCOL_VERSION,
					type: "session_snapshot",
					sessionId: record.session.sessionId,
					snapshot: this.#snapshot(record),
				});
				return true;
			}
			case "snapshot": {
				const record = this.#record(command.sessionId);
				const snapshot = this.#snapshot(record);
				writeFrame({
					version: DESKTOP_PROTOCOL_VERSION,
					type: "session_snapshot",
					sessionId: record.session.sessionId,
					snapshot,
				});
				writeFrame(response(command.id, snapshot));
				return true;
			}
			case "set_model": {
				const record = this.#record(command.sessionId);
				const model = record.session.modelRegistry.find(command.provider, command.modelId);
				if (!model) throw new Error(`Unknown model: ${command.provider}/${command.modelId}`);
				await record.session.setModel(model);
				writeFrame(response(command.id, { model: { provider: model.provider, id: model.id, name: model.name } }));
				writeFrame({
					version: DESKTOP_PROTOCOL_VERSION,
					type: "session_snapshot",
					sessionId: record.session.sessionId,
					snapshot: this.#snapshot(record),
				});
				return true;
			}
			case "rename_session": {
				const record = this.#record(command.sessionId);
				if (command.title.trim().length === 0) throw new Error("Session title cannot be empty");
				await record.session.sessionManager.setSessionName(command.title, "user");
				writeFrame(response(command.id, { title: record.session.sessionManager.getHeader()?.title }));
				return true;
			}
			case "archive_session": {
				const record = this.#sessions.get(command.sessionId);
				if (record && record.status === "running" && !command.stopAndArchive)
					throw new Error("Running sessions require stopAndArchive");
				if (record && command.stopAndArchive) await record.session.abort({ reason: "Archived by user" });
				const state = await this.#desktopState();
				state.archived[command.sessionId] = { archivedAt: new Date().toISOString() };
				await this.#writeDesktopState(state);
				writeFrame(response(command.id));
				return true;
			}
			case "unarchive_session": {
				const state = await this.#desktopState();
				delete state.archived[command.sessionId];
				await this.#writeDesktopState(state);
				writeFrame(response(command.id));
				return true;
			}
			case "git_status":
				writeFrame(await this.#gitState(command.cwd));
				writeFrame(response(command.id));
				return true;
			case "git_diff":
				writeFrame(response(command.id, await diff(command.cwd, { cached: command.cached, files: command.files })));
				return true;
			case "git_stage":
				await stage.files(command.cwd, command.files);
				writeFrame(await this.#gitState(command.cwd));
				writeFrame(response(command.id));
				return true;
			case "git_unstage":
				await stage.reset(command.cwd, command.files);
				writeFrame(await this.#gitState(command.cwd));
				writeFrame(response(command.id));
				return true;
			case "git_discard":
				if (!command.confirmed) throw new Error("Discard requires explicit confirmation");
				await restore(command.cwd, { files: command.files, worktree: true });
				writeFrame(await this.#gitState(command.cwd));
				writeFrame(response(command.id));
				return true;
			case "git_commit":
				if (command.message.trim().length === 0) throw new Error("Commit message cannot be empty");
				writeFrame(response(command.id, await commit(command.cwd, command.message)));
				writeFrame(await this.#gitState(command.cwd));
				return true;
			case "autonomy_start": {
				const record = this.#record(command.sessionId);
				await record.autonomy.start({ objective: command.objective });
				const state = record.autonomy.controller.state;
				await record.session.goalRuntime.createGoal({ objective: command.objective });
				writeFrame({
					version: DESKTOP_PROTOCOL_VERSION,
					type: "autonomy_state",
					sessionId: command.sessionId,
					state,
				});
				writeFrame(response(command.id, state));
				return true;
			}
			case "autonomy_pause": {
				const record = this.#record(command.sessionId);
				const state = await record.autonomy.controller.pause();
				await record.session.goalRuntime.pauseGoal();
				writeFrame({
					version: DESKTOP_PROTOCOL_VERSION,
					type: "autonomy_state",
					sessionId: command.sessionId,
					state,
				});
				writeFrame(response(command.id, state));
				return true;
			}
			case "autonomy_resume": {
				const record = this.#record(command.sessionId);
				const state = await record.autonomy.controller.resume();
				await record.session.goalRuntime.resumeGoal();
				writeFrame({
					version: DESKTOP_PROTOCOL_VERSION,
					type: "autonomy_state",
					sessionId: command.sessionId,
					state,
				});
				writeFrame(response(command.id, state));
				return true;
			}
			case "autonomy_stop": {
				const record = this.#record(command.sessionId);
				const state = await record.autonomy.controller.stop();
				await record.session.goalRuntime.dropGoal();
				writeFrame({
					version: DESKTOP_PROTOCOL_VERSION,
					type: "autonomy_state",
					sessionId: command.sessionId,
					state,
				});
				writeFrame(response(command.id, state));
				return true;
			}
			case "set_thinking_level": {
				const record = this.#record(command.sessionId);
				record.session.setThinkingLevel(command.level as ConfiguredThinkingLevel);
				writeFrame(response(command.id, { thinkingLevel: record.session.configuredThinkingLevel() }));
				return true;
			}
			case "set_follow_up_mode": {
				const record = this.#record(command.sessionId);
				record.session.setFollowUpMode(command.mode);
				writeFrame(response(command.id, { followUpMode: record.session.followUpMode }));
				return true;
			}
			case "ui_response": {
				const pending = this.#pendingUi.get(command.requestId);
				if (!pending) throw new Error(`Unknown UI request: ${command.requestId}`);
				if (command.cancelled) pending.resolve(undefined);
				else if (command.confirmed !== undefined) pending.resolve(command.confirmed);
				else pending.resolve(command.value);
				writeFrame(response(command.id));
				return true;
			}
			case "prompt":
			case "steer":
			case "follow_up": {
				const record = this.#record(command.sessionId);
				const images = command.attachments?.map(attachment => ({
					type: "image" as const,
					data: attachment.data,
					mimeType: attachment.mimeType,
				}));
				const operation = (async (): Promise<boolean> => {
					if (command.type === "prompt") {
						const result = await executeAcpBuiltinSlashCommand(command.text, {
							session: record.session,
							sessionManager: record.session.sessionManager,
							settings: record.session.settings,
							cwd: record.session.sessionManager.getCwd(),
							output: text =>
								writeFrame({
									version: DESKTOP_PROTOCOL_VERSION,
									type: "command_output",
									sessionId: record.session.sessionId,
									text,
								}),
							refreshCommands: () => {},
							reloadPlugins: async () => {},
						});
						if (result !== false) {
							if ("prompt" in result)
								return record.session.prompt(result.prompt, images ? { images } : undefined);
							return false;
						}
						return record.session.prompt(command.text, images ? { images } : undefined);
					}
					if (command.type === "steer") await record.session.steer(command.text, images);
					else await record.session.followUp(command.text, images);
					return false;
				})();
				void operation
					.then(() => writeFrame(response(command.id)))
					.catch(error => {
						writeFrame(errorResponse(command.id, error));
					});
				return true;
			}
			case "abort":
				await this.#record(command.sessionId).session.abort({ reason: "User interrupt" });
				writeFrame(response(command.id));
				return true;
			case "close_session":
				await this.close(command.sessionId);
				writeFrame(response(command.id));
				return true;
			case "shutdown":
				await this.closeAll();
				writeFrame(response(command.id));
				return false;
		}
	}

	async close(sessionId: string): Promise<void> {
		const record = this.#sessions.get(sessionId);
		if (!record) return;
		record.unsubscribe();
		await record.session.dispose();
		this.#sessions.delete(sessionId);
	}

	async closeAll(): Promise<void> {
		this.#shuttingDown = true;
		for (const pending of this.#pendingUi.values()) pending.reject(new Error("Desktop host is shutting down"));
		this.#pendingUi.clear();
		await Promise.all([...this.#sessions.keys()].map(sessionId => this.close(sessionId)));
	}
}

export async function runDesktopRpcMode(): Promise<void> {
	process.env.REACTOR_NOTIFICATIONS = "off";
	const host = new ManagedAgentSessionHost();
	const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
	try {
		for await (const line of input) {
			if (line.trim().length === 0) continue;
			let command: DesktopCommand;
			try {
				command = assertCommand(JSON.parse(line));
				if (!(await host.handle(command))) break;
			} catch (error) {
				const id = (() => {
					try {
						const value = JSON.parse(line) as { id?: unknown };
						return typeof value.id === "string" ? value.id : "unknown";
					} catch {
						return "unknown";
					}
				})();
				writeFrame(errorResponse(id, error));
			}
		}
	} finally {
		await host.closeAll();
		input.close();
	}
}
