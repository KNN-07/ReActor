import * as readline from "node:readline";
import { getActiveProfile, getAgentDir, VERSION } from "@reactor/utils";
import {
	DESKTOP_PROTOCOL_VERSION,
	type DesktopCommand,
	type DesktopFrame,
	type DesktopSessionStatus,
	type DesktopSnapshot,
} from "@reactor/wire";
import { ModelRegistry } from "../../config/model-registry";
import { type CreateAgentSessionResult, createAgentSession, discoverAuthStorage } from "../../sdk";
import type { AgentSession } from "../../session/agent-session";
import type { AuthStorage } from "../../session/auth-storage";
import { listAllSessions } from "../../session/session-listing";
import { SessionManager } from "../../session/session-manager";

type ManagedDesktopSession = {
	result: CreateAgentSessionResult;
	session: AgentSession;
	status: DesktopSessionStatus;
	unsubscribe: () => void;
};

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

	async #services(): Promise<{ authStorage: AuthStorage; modelRegistry: ModelRegistry }> {
		if (!this.#authStorage) this.#authStorage = await discoverAuthStorage(getAgentDir());
		if (!this.#modelRegistry) this.#modelRegistry = new ModelRegistry(this.#authStorage);
		return { authStorage: this.#authStorage, modelRegistry: this.#modelRegistry };
	}

	async #create(cwd: string, sessionManager?: SessionManager): Promise<ManagedDesktopSession> {
		if (!cwd.startsWith("/")) throw new Error("Desktop sessions require an absolute cwd");
		const services = await this.#services();
		const result = await createAgentSession({
			cwd,
			authStorage: services.authStorage,
			modelRegistry: services.modelRegistry,
			sessionManager: sessionManager ?? SessionManager.create(cwd, `${getAgentDir()}/sessions`),
			hasUI: true,
		});
		const record: ManagedDesktopSession = { result, session: result.session, status: "idle", unsubscribe: () => {} };
		record.unsubscribe = record.session.subscribe(event => {
			if (event.type === "agent_start") record.status = "running";
			if (event.type === "agent_end") record.status = "idle";
			writeFrame({
				version: DESKTOP_PROTOCOL_VERSION,
				type: "session_event",
				sessionId: record.session.sessionId,
				event,
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
			case "list_sessions": {
				const active = [...this.#sessions.values()].map(record => {
					const header = record.session.sessionManager.getHeader();
					return {
						sessionId: record.session.sessionId,
						title: header?.title,
						cwd: record.session.sessionManager.getCwd(),
						createdAt: header?.timestamp,
						updatedAt: header?.timestamp,
						status: record.status,
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
				writeFrame(response(command.id, this.#snapshot(record)));
				return true;
			}
			case "prompt":
			case "steer":
			case "follow_up": {
				const record = this.#record(command.sessionId);
				if (command.type === "prompt") await record.session.prompt(command.text);
				else if (command.type === "steer") await record.session.steer(command.text);
				else await record.session.followUp(command.text);
				writeFrame(response(command.id));
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
