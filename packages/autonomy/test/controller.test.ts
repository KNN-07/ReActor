import { describe, expect, test } from "bun:test";
import { AutonomyController, type AutonomyState, type AutonomyStore, resolveAutonomyRoles } from "../src";

class MemoryStore implements AutonomyStore {
	value: AutonomyState | null = null;

	async load(): Promise<AutonomyState | null> {
		return this.value ? structuredClone(this.value) : null;
	}

	async save(state: AutonomyState): Promise<void> {
		this.value = structuredClone(state);
	}
}

describe("AutonomyController", () => {
	test("starts only explicitly and supports pause, override resume, and stop", async () => {
		const store = new MemoryStore();
		const controller = new AutonomyController(store, () => 1000);
		expect(controller.state).toBeNull();
		expect((await controller.start("ship it")).status).toBe("running");
		expect((await controller.pause()).stopReason).toBe("user-paused");
		const resumed = await controller.resume({ maxContinuations: 12, maxMinutes: 90 });
		expect(resumed.options.maxContinuations).toBe(12);
		expect(resumed.options.maxMinutes).toBe(90);
		expect((await controller.stop()).status).toBe("stopped");
	});

	test("pauses at continuation, token, and repeated equivalent failure limits", async () => {
		const continuation = new AutonomyController(new MemoryStore());
		await continuation.start("bounded", { maxContinuations: 1 });
		expect((await continuation.recordTurn("turn-1")).stopReason).toBe("continuation-limit");

		const budget = new AutonomyController(new MemoryStore());
		await budget.start("budgeted", { tokenBudget: 10 });
		expect((await budget.recordTurn("turn-1", 10)).stopReason).toBe("budget-exhausted");

		const failures = new AutonomyController(new MemoryStore());
		await failures.start("retry", { maxConsecutiveFailures: 2 });
		expect((await failures.recordFailure("same")).status).toBe("running");
		expect((await failures.recordFailure("same")).stopReason).toBe("repeated-failure");
	});

	test("pauses for approvals, manual input, interrupts, and indeterminate tools", async () => {
		for (const [method, reason] of [
			["requireApproval", "approval-required"],
			["requireManualInput", "manual-input-required"],
			["interrupt", "user-interrupt"],
			["reportIndeterminateTool", "indeterminate-tool"],
		] as const) {
			const controller = new AutonomyController(new MemoryStore());
			await controller.start(method);
			expect((await controller[method]()).stopReason).toBe(reason);
		}
	});

	test("requires terminal todos and concrete verification evidence", async () => {
		const controller = new AutonomyController(new MemoryStore());
		await controller.start("verified");
		await controller.setTodos(["completed", "pending"]);
		expect((await controller.complete([{ description: "bun test", executed: true, timestamp: 1 }])).stopReason).toBe(
			"todos-incomplete",
		);
		await controller.resume();
		await controller.setTodos(["completed", "abandoned"]);
		expect((await controller.complete()).stopReason).toBe("verification-required");
		await controller.resume();
		expect((await controller.complete([{ description: "bun test", executed: true, timestamp: 1 }])).status).toBe(
			"completed",
		);
	});

	test("loads a running goal as paused after restart", async () => {
		const store = new MemoryStore();
		const first = new AutonomyController(store);
		await first.start("restart-safe");
		const restarted = new AutonomyController(store);
		const state = await restarted.load();
		expect(state?.status).toBe("paused");
		expect(state?.stopReason).toBe("restart");
	});
});

test("role routing uses plan and reviewer fallbacks without adding a router", () => {
	expect(resolveAutonomyRoles({ active: "active", plan: "plan", slow: "slow" })).toEqual({
		planning: "plan",
		implementation: "active",
		review: "slow",
	});
	expect(resolveAutonomyRoles({ active: "active", advisor: "advisor", reviewer: "reviewer" }).review).toBe("reviewer");
});
