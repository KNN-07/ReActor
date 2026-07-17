import { AutonomyController, type AutonomyOptionsOverride, FileAutonomyStore } from "@reactor/autonomy";
import { getAgentDir } from "@reactor/utils/dirs";
import type { AgentSession, AgentSessionEvent } from "../session/agent-session";

export interface AutonomyLaunchOptions extends AutonomyOptionsOverride {
	objective: string;
}

export class AutonomySessionRuntime {
	static readonly #sessions = new WeakMap<AgentSession, AutonomySessionRuntime>();
	readonly controller: AutonomyController;
	readonly #session: AgentSession;
	#unsubscribe: (() => void) | undefined;

	constructor(session: AgentSession) {
		this.#session = session;
		const sessionId = session.sessionManager.getSessionId();
		this.controller = new AutonomyController(new FileAutonomyStore(`${getAgentDir()}/autonomy/${sessionId}.json`));
		AutonomySessionRuntime.#sessions.set(session, this);
	}

	static forSession(session: AgentSession): AutonomySessionRuntime {
		return AutonomySessionRuntime.#sessions.get(session) ?? new AutonomySessionRuntime(session);
	}

	async start(options: AutonomyLaunchOptions): Promise<void> {
		await this.controller.start(options.objective, options);
		this.#unsubscribe = this.#session.subscribe(event => {
			void this.#observe(event);
		});
	}

	async recover(): Promise<void> {
		await this.controller.load();
	}

	async #observe(event: AgentSessionEvent): Promise<void> {
		const state = this.controller.state;
		if (state?.status !== "running") return;
		if (event.type === "tool_execution_start" && event.toolName === "ask") {
			await this.controller.requireManualInput();
			await this.#session.goalRuntime.pauseGoal();
			return;
		}
		if (event.type === "tool_execution_end" && event.isError) {
			const next = await this.controller.recordFailure(`${event.toolName}:${JSON.stringify(event.result)}`);
			if (next.status === "paused") await this.#session.goalRuntime.pauseGoal();
			return;
		}
		if (event.type === "agent_end") {
			const usage = this.#session.getSessionStats().tokens;
			const next = await this.controller.recordTurn(String(Date.now()), usage.output);
			if (next.status === "paused") await this.#session.goalRuntime.pauseGoal();
		}
	}

	async dispose(): Promise<void> {
		this.#unsubscribe?.();
		this.#unsubscribe = undefined;
	}
}
