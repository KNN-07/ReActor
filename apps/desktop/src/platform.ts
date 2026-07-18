import type { DesktopCommand, DesktopFrame, DesktopSnapshot, DesktopSessionSummary } from "@reactor/wire";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import { openPath as openNativePath } from "@tauri-apps/plugin-opener";

export interface DesktopPlatform {
	start(): Promise<void>;
	send(command: DesktopCommand): Promise<void>;
	subscribe(listener: (frame: DesktopFrame) => void): () => void;
	chooseDirectory(): Promise<string | null>;
	chooseAttachments(root?: string): Promise<Array<{ name: string; mimeType: string; data: string }>>;
	openPath(path: string): Promise<void>;
	notify(message: string): Promise<void>;
}

export class TauriDesktopPlatform implements DesktopPlatform {
	#listeners = new Set<(frame: DesktopFrame) => void>();
	#stopListening: Array<() => void> = [];
	#restarted = false;
	async start(): Promise<void> {
		this.#stopListening.push(await listen<unknown>("desktop-frame", event => {
			try { this.#emit(JSON.parse(String(event.payload)) as DesktopFrame); } catch { /* malformed future frames are ignored */ }
		}));
		this.#stopListening.push(await listen<{ state?: string }>("desktop-lifecycle", event => {
			const lifecycle = event.payload;
			if (lifecycle.state === "disconnected") this.#emit({ version: 1, type: "notice", level: "error", message: "ReActor backend disconnected. Restarting once..." });
			if (lifecycle.state === "disconnected" && !this.#restarted) {
				this.#restarted = true;
				void invoke("start_host").then(() => { this.#restarted = false; }).catch(error => {
					this.#emit({ version: 1, type: "notice", level: "error", message: `ReActor backend restart failed: ${String(error)}` });
				});
			}
		}));
		await invoke("start_host");
	}
	async send(command: DesktopCommand): Promise<void> { await invoke("send_frame", { frame: JSON.stringify(command) }); }
	subscribe(listener: (frame: DesktopFrame) => void): () => void { this.#listeners.add(listener); return () => this.#listeners.delete(listener); }
	async chooseDirectory(): Promise<string | null> {
		const selected = await open({ directory: true, multiple: false, title: "Open a ReActor workspace" });
		return typeof selected === "string" ? selected : null;
	}
	async chooseAttachments(root?: string): Promise<Array<{ name: string; mimeType: string; data: string }>> {
		const selected = await open({ multiple: true, title: "Attach files", filters: [{ name: "Images and text", extensions: ["png", "jpg", "jpeg", "gif", "webp", "txt", "md", "json", "ts", "tsx", "js", "css", "html"] }] });
		const paths = Array.isArray(selected) ? selected : typeof selected === "string" ? [selected] : [];
		const attachments: Array<{ name: string; mimeType: string; data: string }> = [];
		for (const path of paths) {
			const bytes = new Uint8Array(await invoke<number[]>("read_file", { path, root }));
			let binary = "";
			for (const byte of bytes) binary += String.fromCharCode(byte);
			const name = path.split(/[\\/]/).pop() ?? path;
			const extension = name.split(".").pop()?.toLowerCase();
			const mimeType = extension === "png" ? "image/png" : extension === "jpg" || extension === "jpeg" ? "image/jpeg" : extension === "gif" ? "image/gif" : extension === "webp" ? "image/webp" : "text/plain";
			if (mimeType.startsWith("image/")) attachments.push({ name, mimeType, data: btoa(binary) });
		}
		return attachments;
	}
	async openPath(path: string): Promise<void> { await openNativePath(path); }
	async notify(message: string): Promise<void> {
		let granted = await isPermissionGranted();
		if (!granted) granted = await requestPermission() === "granted";
		if (granted) sendNotification({ title: "ReActor", body: message });
	}
	dispose(): void { for (const stop of this.#stopListening) stop(); this.#stopListening = []; }
	#emit(frame: DesktopFrame): void { for (const listener of this.#listeners) listener(frame); }
}

export function createDesktopPlatform(): DesktopPlatform {
	return isTauri() ? new TauriDesktopPlatform() : new BrowserDesktopPlatform();
}

export class BrowserDesktopPlatform implements DesktopPlatform {
	#listeners = new Set<(frame: DesktopFrame) => void>();
	#sessions = new Map<string, { cwd: string; title: string; status: "idle" | "running"; archived?: boolean }>([
		["preview-1", { cwd: "/workspace/gomoku-ai", title: "Create an intelligent Gomoku", status: "running" }],
		["preview-2", { cwd: "/workspace/gomoku-ai", title: "Refine start prompts, tune rules", status: "idle" }],
		["preview-3", { cwd: "/workspace/gomoku-ai", title: "Wire in heuristic AI turn logic", status: "idle" }],
		["preview-4", { cwd: "/workspace/gomoku-ai", title: "Adapt board scaling and layout", status: "idle" }],
		["preview-5", { cwd: "/workspace/zcode-website", title: "Fix bottom pinning when scrolling", status: "idle" }],
		["preview-6", { cwd: "/workspace/zcode-website", title: "Refresh hero visual wording", status: "idle" }],
		["preview-7", { cwd: "/workspace/zcode-website", title: "Tighten homepage spacing", status: "idle" }],
		["preview-8", { cwd: "/workspace/zcode-desktop", title: "Improve inspector hierarchy", status: "idle" }],
	]);

	async start(): Promise<void> {
		this.#emit({ version: 1, type: "ready", reactorVersion: "browser-preview", profile: "default" });
	}
	async send(command: DesktopCommand): Promise<void> {
		if (command.type === "handshake") this.#emit({ version: 1, type: "response", id: command.id, ok: true, data: { protocolVersion: 1 } });
		if (command.type === "list_models") this.#emit({ version: 1, type: "response", id: command.id, ok: true, data: { kind: "models", models: [{ provider: "openai", id: "gpt-5", name: "GPT-5" }, { provider: "anthropic", id: "claude-sonnet", name: "Claude Sonnet" }] } });
		if (command.type === "list_commands") this.#emit({ version: 1, type: "response", id: command.id, ok: true, data: { kind: "commands", commands: ["settings", "model", "plan", "todo", "compact", "export", "share", "retry", "help"].map(name => ({ name, description: `Run /${name}` })) } });
		if (command.type === "list_sessions") this.#emit({ version: 1, type: "response", id: command.id, ok: true, data: [...this.#sessions].map(([sessionId, session]) => ({ sessionId, ...session, createdAt: "2026-07-18T10:00:00.000Z", updatedAt: "2026-07-18T10:28:00.000Z" } satisfies DesktopSessionSummary)) });
		if (command.type === "create_session") {
			const sessionId = `preview-${this.#sessions.size + 1}`;
			this.#sessions.set(sessionId, { cwd: command.cwd, title: "New task", status: "idle" });
			this.#emit({ version: 1, type: "response", id: command.id, ok: true, data: { sessionId } });
			this.#emit({ version: 1, type: "session_snapshot", sessionId, snapshot: this.#snapshot(sessionId) });
		}
		if (command.type === "set_model") this.#emit({ version: 1, type: "response", id: command.id, ok: true, data: { model: { provider: command.provider, id: command.modelId, name: command.modelId } } });
		if (command.type === "execute_command") {
			this.#emit({ version: 1, type: "command_output", sessionId: command.sessionId, text: `Preview command executed: ${command.text}` });
			this.#emit({ version: 1, type: "response", id: command.id, ok: true, data: { consumed: true } });
		}
		if (command.type === "rename_session") {
			const session = this.#sessions.get(command.sessionId);
			if (session) session.title = command.title;
			this.#emit({ version: 1, type: "response", id: command.id, ok: true });
		}
		if (command.type === "archive_session" || command.type === "unarchive_session") {
			const session = this.#sessions.get(command.sessionId);
			if (session) session.archived = command.type === "archive_session";
			this.#emit({ version: 1, type: "response", id: command.id, ok: true });
		}
		if (command.type === "autonomy_start") this.#emit({ version: 1, type: "autonomy_state", sessionId: command.sessionId, state: { version: 1, goalId: "preview-goal", objective: command.objective, phase: "planning", status: "running", options: {}, usage: { continuations: 0, activeMilliseconds: 0, tokensUsed: 0, consecutiveFailures: 0 }, todoSummary: { total: 4, terminal: 0, pending: 4 }, verificationEvidence: [], startedAt: Date.now(), updatedAt: Date.now() } });
		if (command.type === "autonomy_pause" || command.type === "autonomy_resume" || command.type === "autonomy_stop") this.#emit({ version: 1, type: "response", id: command.id, ok: true });
		if (command.type === "set_thinking_level" || command.type === "set_follow_up_mode") this.#emit({ version: 1, type: "response", id: command.id, ok: true });
		if (command.type === "snapshot" || command.type === "open_session") this.#emit({ version: 1, type: "session_snapshot", sessionId: command.sessionId, snapshot: this.#snapshot(command.sessionId) });
		if (command.type === "git_status") this.#emit({ version: 1, type: "git_state", cwd: command.cwd, state: { cwd: command.cwd, status: " M app.js\n M index.html\n M styles.css", diff: "diff --git a/app.js b/app.js\n--- a/app.js\n+++ b/app.js\n+const board = createBoard();\n+startGame(board);\ndiff --git a/index.html b/index.html\n--- a/index.html\n+++ b/index.html\n+<main id=\"game\"></main>\ndiff --git a/styles.css b/styles.css\n--- a/styles.css\n+++ b/styles.css\n+.board { display: grid; }", branch: "feat/gomoku-ai", sharedWorktree: false } });
		if (command.type === "git_diff") this.#emit({ version: 1, type: "response", id: command.id, ok: true, data: "diff --git a/app.js b/app.js\n+const board = createBoard();\n+startGame(board);" });
		if (command.type === "git_stage" || command.type === "git_unstage" || command.type === "git_discard" || command.type === "git_commit") this.#emit({ version: 1, type: "response", id: command.id, ok: true });
	}
	subscribe(listener: (frame: DesktopFrame) => void): () => void { this.#listeners.add(listener); return () => this.#listeners.delete(listener); }
	async chooseDirectory(): Promise<string | null> { return "/workspace/new-project"; }
	async chooseAttachments(_root?: string): Promise<Array<{ name: string; mimeType: string; data: string }>> {
		return [{ name: "preview.png", mimeType: "image/png", data: "" }];
	}
	async openPath(path: string): Promise<void> { await this.notify(`Path ready: ${path}`); }
	async notify(message: string): Promise<void> { globalThis.console?.info(message); }
	#emit(frame: DesktopFrame): void { for (const listener of this.#listeners) listener(frame); }
	#snapshot(sessionId: string): DesktopSnapshot {
		return { sessionId, status: "running", header: {}, model: { provider: "openai", id: "gpt-5", name: "GPT-5" }, entries: [
			{ type: "message", message: { role: "assistant", content: [{ type: "text", text: "I found one avoidable dependency: the page was pulling a web font. I’m removing that so the game stays fully local and works by opening index.html with no network requirement." }], timestamp: Date.now() - 90000, model: "preview", usage: {}, stopReason: "toolUse" } },
			{ type: "message", message: { role: "assistant", content: [{ type: "text", text: "Built a standalone browser Gomoku game in index.html, styles.css, and app.js. It renders a 15×15 board, lets the player place black stones, detects wins in all four directions, highlights the winning line, tracks turns and move count, and supports restarting the match.\n\nThe AI is heuristic rather than random. It searches nearby candidate moves, scores offensive patterns for itself, scores defensive blocks against the player, adds center preference, and chooses the strongest move. There’s also an optional AI focus-area overlay so you can see the strongest candidate points it considered.\n\nVerification: node --check app.js passed. The remaining step is to open index.html in a browser and play." }], timestamp: Date.now() - 30000, model: "preview", usage: {}, stopReason: "stop" } },
		] };
	}
}
