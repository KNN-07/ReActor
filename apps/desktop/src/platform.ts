import type { DesktopCommand, DesktopFrame } from "@reactor/wire";

export interface DesktopPlatform {
	start(): Promise<void>;
	send(command: DesktopCommand): Promise<void>;
	subscribe(listener: (frame: DesktopFrame) => void): () => void;
	openPath(path: string): Promise<void>;
	notify(message: string): Promise<void>;
}

interface TauriBridge {
	invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>;
	listen(event: string, handler: (event: { payload: unknown }) => void): Promise<() => void>;
}

function tauriBridge(): TauriBridge | undefined {
	const candidate = (globalThis as { __TAURI__?: { core?: TauriBridge } }).__TAURI__?.core;
	return candidate;
}

export class TauriDesktopPlatform implements DesktopPlatform {
	#bridge: TauriBridge;
	#listeners = new Set<(frame: DesktopFrame) => void>();
	#stopListening: (() => void) | undefined;
	constructor(bridge: TauriBridge) { this.#bridge = bridge; }
	async start(): Promise<void> {
		await this.#bridge.invoke("start_host");
		this.#stopListening = await this.#bridge.listen("desktop-frame", event => {
			try { this.#emit(JSON.parse(String(event.payload)) as DesktopFrame); } catch { /* malformed future frames are ignored */ }
		});
	}
	async send(command: DesktopCommand): Promise<void> { await this.#bridge.invoke("send_frame", { frame: JSON.stringify(command) }); }
	subscribe(listener: (frame: DesktopFrame) => void): () => void { this.#listeners.add(listener); return () => this.#listeners.delete(listener); }
	async openPath(path: string): Promise<void> { await this.#bridge.invoke("plugin:opener|open_path", { path }); }
	async notify(message: string): Promise<void> { await this.#bridge.invoke("plugin:notification|notify", { title: "ReActor", body: message }); }
	dispose(): void { this.#stopListening?.(); this.#stopListening = undefined; }
	#emit(frame: DesktopFrame): void { for (const listener of this.#listeners) listener(frame); }
}

export function createDesktopPlatform(): DesktopPlatform {
	const bridge = tauriBridge();
	return bridge ? new TauriDesktopPlatform(bridge) : new BrowserDesktopPlatform();
}

export class BrowserDesktopPlatform implements DesktopPlatform {
	#listeners = new Set<(frame: DesktopFrame) => void>();
	#sessions = new Map<string, { cwd: string; title: string }>();

	async start(): Promise<void> {
		this.#emit({ version: 1, type: "ready", reactorVersion: "browser-preview", profile: "default" });
	}
	async send(command: DesktopCommand): Promise<void> {
		if (command.type === "handshake") this.#emit({ version: 1, type: "response", id: command.id, ok: true, data: { protocolVersion: 1 } });
		if (command.type === "list_sessions") this.#emit({ version: 1, type: "response", id: command.id, ok: true, data: [...this.#sessions].map(([sessionId, session]) => ({ sessionId, ...session, status: "idle" })) });
		if (command.type === "create_session") {
			const sessionId = `preview-${this.#sessions.size + 1}`;
			this.#sessions.set(sessionId, { cwd: command.cwd, title: "New task" });
			this.#emit({ version: 1, type: "response", id: command.id, ok: true, data: { sessionId } });
		}
	}
	subscribe(listener: (frame: DesktopFrame) => void): () => void { this.#listeners.add(listener); return () => this.#listeners.delete(listener); }
	async openPath(path: string): Promise<void> { await this.notify(`Path ready: ${path}`); }
	async notify(message: string): Promise<void> { globalThis.console?.info(message); }
	#emit(frame: DesktopFrame): void { for (const listener of this.#listeners) listener(frame); }
}
