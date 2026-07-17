import type { AutonomyStore } from "./store";
import type {
	AutonomyOptions,
	AutonomyPhase,
	AutonomyRoleConfiguration,
	AutonomyRoles,
	AutonomyState,
	AutonomyStopReason,
	VerificationEvidence,
} from "./types";

export const DEFAULT_AUTONOMY_OPTIONS: AutonomyOptions = {
	maxContinuations: 8,
	maxMinutes: 60,
	maxConsecutiveFailures: 2,
	requireVerification: true,
};

export type AutonomyOptionsOverride = Partial<AutonomyOptions>;

function validateOptions(options: AutonomyOptions): void {
	if (!Number.isInteger(options.maxContinuations) || options.maxContinuations <= 0) {
		throw new Error("maxContinuations must be a positive integer");
	}
	if (!Number.isFinite(options.maxMinutes) || options.maxMinutes <= 0) {
		throw new Error("maxMinutes must be positive");
	}
	if (!Number.isInteger(options.maxConsecutiveFailures) || options.maxConsecutiveFailures <= 0) {
		throw new Error("maxConsecutiveFailures must be a positive integer");
	}
	if (options.tokenBudget !== undefined && (!Number.isInteger(options.tokenBudget) || options.tokenBudget <= 0)) {
		throw new Error("tokenBudget must be a positive integer when provided");
	}
}

function cloneState(state: AutonomyState): AutonomyState {
	return {
		...state,
		options: { ...state.options },
		usage: { ...state.usage },
		todoSummary: { ...state.todoSummary },
		verificationEvidence: state.verificationEvidence.map(item => ({ ...item })),
	};
}

export function resolveAutonomyRoles<T>(configuration: AutonomyRoleConfiguration<T>): AutonomyRoles<T> {
	return {
		planning: configuration.plan ?? configuration.active,
		implementation: configuration.active,
		review: configuration.reviewer ?? configuration.advisor ?? configuration.slow ?? configuration.active,
	};
}

export class AutonomyController {
	readonly #store: AutonomyStore;
	readonly #now: () => number;
	#state: AutonomyState | null = null;
	#lastFailureFingerprint: string | undefined;

	constructor(store: AutonomyStore, now: () => number = Date.now) {
		this.#store = store;
		this.#now = now;
	}

	get state(): AutonomyState | null {
		return this.#state ? cloneState(this.#state) : null;
	}

	async load(): Promise<AutonomyState | null> {
		this.#state = await this.#store.load();
		if (this.#state?.status === "running") await this.#pause("restart");
		return this.state;
	}

	async start(objective: string, overrides: AutonomyOptionsOverride = {}): Promise<AutonomyState> {
		if (!objective.trim()) throw new Error("objective is required");
		const options = { ...DEFAULT_AUTONOMY_OPTIONS, ...overrides };
		validateOptions(options);
		const now = this.#now();
		this.#lastFailureFingerprint = undefined;
		this.#state = {
			version: 1,
			goalId: crypto.randomUUID(),
			objective: objective.trim(),
			phase: "planning",
			status: "running",
			options,
			usage: { continuations: 0, activeMilliseconds: 0, tokensUsed: 0, consecutiveFailures: 0 },
			todoSummary: { total: 0, terminal: 0, pending: 0 },
			verificationEvidence: [],
			startedAt: now,
			activeSince: now,
			updatedAt: now,
		};
		await this.#persist();
		return this.state as AutonomyState;
	}

	async pause(reason: AutonomyStopReason = "user-paused"): Promise<AutonomyState> {
		return await this.#pause(reason);
	}

	async #pause(reason: AutonomyStopReason): Promise<AutonomyState> {
		const state = this.#requireState();
		this.#accountActiveTime(state);
		state.status = "paused";
		state.stopReason = reason;
		state.activeSince = undefined;
		state.updatedAt = this.#now();
		await this.#persist();
		return this.state as AutonomyState;
	}

	async resume(overrides: AutonomyOptionsOverride = {}): Promise<AutonomyState> {
		const state = this.#requireState();
		if (state.status === "completed" || state.status === "stopped")
			throw new Error("A terminal goal cannot be resumed");
		const options = { ...state.options, ...overrides };
		validateOptions(options);
		state.options = options;
		state.status = "running";
		state.stopReason = undefined;
		state.activeSince = this.#now();
		state.updatedAt = this.#now();
		await this.#persist();
		return this.state as AutonomyState;
	}

	async stop(): Promise<AutonomyState> {
		const state = this.#requireState();
		this.#accountActiveTime(state);
		state.status = "stopped";
		state.stopReason = "user-stopped";
		state.activeSince = undefined;
		state.updatedAt = this.#now();
		await this.#persist();
		return this.state as AutonomyState;
	}

	async setPhase(phase: AutonomyPhase): Promise<AutonomyState> {
		const state = this.#requireRunning();
		state.phase = phase;
		state.updatedAt = this.#now();
		await this.#persist();
		return this.state as AutonomyState;
	}

	async setTodos(statuses: Array<"pending" | "in_progress" | "completed" | "abandoned">): Promise<AutonomyState> {
		const state = this.#requireState();
		const terminal = statuses.filter(status => status === "completed" || status === "abandoned").length;
		state.todoSummary = { total: statuses.length, terminal, pending: statuses.length - terminal };
		state.updatedAt = this.#now();
		await this.#persist();
		return this.state as AutonomyState;
	}

	async recordTurn(turnId: string, tokensUsed = 0): Promise<AutonomyState> {
		const state = this.#requireRunning();
		state.lastCompletedTurn = turnId;
		state.usage.continuations += 1;
		state.usage.tokensUsed += Math.max(0, tokensUsed);
		state.usage.consecutiveFailures = 0;
		this.#lastFailureFingerprint = undefined;
		this.#accountActiveTime(state);
		state.activeSince = this.#now();
		const reason = this.#limitReason(state);
		if (reason) return await this.#pause(reason);
		state.updatedAt = this.#now();
		await this.#persist();
		return this.state as AutonomyState;
	}

	async recordFailure(fingerprint: string): Promise<AutonomyState> {
		const state = this.#requireRunning();
		state.usage.consecutiveFailures =
			this.#lastFailureFingerprint === fingerprint ? state.usage.consecutiveFailures + 1 : 1;
		this.#lastFailureFingerprint = fingerprint;
		if (state.usage.consecutiveFailures >= state.options.maxConsecutiveFailures) {
			return await this.#pause("repeated-failure");
		}
		state.updatedAt = this.#now();
		await this.#persist();
		return this.state as AutonomyState;
	}

	async requireApproval(): Promise<AutonomyState> {
		return await this.#pause("approval-required");
	}

	async requireManualInput(): Promise<AutonomyState> {
		return await this.#pause("manual-input-required");
	}

	async interrupt(): Promise<AutonomyState> {
		return await this.#pause("user-interrupt");
	}

	async reportIndeterminateTool(): Promise<AutonomyState> {
		return await this.#pause("indeterminate-tool");
	}

	async complete(evidence: VerificationEvidence[] = []): Promise<AutonomyState> {
		const state = this.#requireRunning();
		state.verificationEvidence = evidence.map(item => ({ ...item }));
		if (state.todoSummary.pending > 0) return await this.#pause("todos-incomplete");
		if (state.options.requireVerification && evidence.length === 0) return await this.#pause("verification-required");
		state.phase = "complete";
		state.status = "completed";
		state.stopReason = undefined;
		this.#accountActiveTime(state);
		state.activeSince = undefined;
		state.updatedAt = this.#now();
		await this.#persist();
		return this.state as AutonomyState;
	}

	#limitReason(state: AutonomyState): AutonomyStopReason | undefined {
		if (state.usage.continuations >= state.options.maxContinuations) return "continuation-limit";
		if (state.usage.activeMilliseconds >= state.options.maxMinutes * 60_000) return "time-limit";
		if (state.options.tokenBudget !== undefined && state.usage.tokensUsed >= state.options.tokenBudget) {
			return "budget-exhausted";
		}
		return undefined;
	}

	#accountActiveTime(state: AutonomyState): void {
		if (state.activeSince !== undefined)
			state.usage.activeMilliseconds += Math.max(0, this.#now() - state.activeSince);
	}

	#requireState(): AutonomyState {
		if (!this.#state) throw new Error("No autonomous goal is active");
		return this.#state;
	}

	#requireRunning(): AutonomyState {
		const state = this.#requireState();
		if (state.status !== "running") throw new Error("The autonomous goal is not running");
		return state;
	}

	async #persist(): Promise<void> {
		if (!this.#state) return;
		await this.#store.save(cloneState(this.#state));
	}
}
