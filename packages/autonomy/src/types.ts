export type AutonomyStatus = "running" | "paused" | "stopped" | "completed";

export type AutonomyPhase = "planning" | "implementing" | "reviewing" | "verifying" | "complete";

export type AutonomyStopReason =
	| "approval-required"
	| "budget-exhausted"
	| "continuation-limit"
	| "indeterminate-tool"
	| "manual-input-required"
	| "repeated-failure"
	| "restart"
	| "time-limit"
	| "todos-incomplete"
	| "user-interrupt"
	| "user-paused"
	| "user-stopped"
	| "verification-required";

export interface AutonomyOptions {
	maxContinuations: number;
	maxMinutes: number;
	maxConsecutiveFailures: number;
	tokenBudget?: number;
	requireVerification: boolean;
}

export interface AutonomyUsage {
	continuations: number;
	activeMilliseconds: number;
	tokensUsed: number;
	consecutiveFailures: number;
}

export interface AutonomyTodoSummary {
	total: number;
	terminal: number;
	pending: number;
}

export interface VerificationEvidence {
	command?: string;
	description: string;
	executed: boolean;
	timestamp: number;
}

export interface AutonomyState {
	version: 1;
	goalId: string;
	objective: string;
	phase: AutonomyPhase;
	status: AutonomyStatus;
	options: AutonomyOptions;
	usage: AutonomyUsage;
	todoSummary: AutonomyTodoSummary;
	lastCompletedTurn?: string;
	stopReason?: AutonomyStopReason;
	verificationEvidence: VerificationEvidence[];
	startedAt: number;
	activeSince?: number;
	updatedAt: number;
}

export type ToolLifecycleStatus = "started" | "completed" | "failed" | "indeterminate";

export interface ToolLifecycleRecord {
	version: 1;
	toolCallId: string;
	toolName: string;
	arguments: unknown;
	status: ToolLifecycleStatus;
	timestamp: number;
	error?: string;
}

export interface AutonomyRoleConfiguration<T> {
	active: T;
	plan?: T;
	slow?: T;
	advisor?: T;
	reviewer?: T;
}

export interface AutonomyRoles<T> {
	planning: T;
	implementation: T;
	review: T;
}
