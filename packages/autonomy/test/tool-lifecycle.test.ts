import { describe, expect, test } from "bun:test";
import type { ToolLifecycleRecord, ToolLifecycleStore } from "../src";
import { ToolLifecycleJournal } from "../src";

class MemoryJournalStore implements ToolLifecycleStore {
	records: ToolLifecycleRecord[] = [];

	async append(record: ToolLifecycleRecord): Promise<void> {
		this.records.push(structuredClone(record));
	}

	async load(): Promise<ToolLifecycleRecord[]> {
		return structuredClone(this.records);
	}
}

describe("ToolLifecycleJournal", () => {
	test("persists started before dispatch and then completion", async () => {
		const store = new MemoryJournalStore();
		const journal = new ToolLifecycleJournal(store, () => 10);
		const result = await journal.dispatch("stable-1", "bash", { command: "touch marker" }, async () => {
			expect(store.records.map(record => record.status)).toEqual(["started"]);
			return 42;
		});
		expect(result).toBe(42);
		expect(store.records.map(record => record.status)).toEqual(["started", "completed"]);
	});

	test("records failure without hiding it", async () => {
		const store = new MemoryJournalStore();
		const journal = new ToolLifecycleJournal(store);
		await expect(
			journal.dispatch("stable-2", "edit", { path: "a" }, async () => {
				throw new Error("failed");
			}),
		).rejects.toThrow("failed");
		expect(store.records.at(-1)).toMatchObject({ status: "failed", error: "failed" });
	});

	test("reports unmatched edit, shell, and MCP starts as indeterminate without replay", async () => {
		const store = new MemoryJournalStore();
		for (const [toolCallId, toolName] of [
			["e", "edit"],
			["b", "bash"],
			["m", "mcp.call"],
		]) {
			store.records.push({
				version: 1,
				toolCallId,
				toolName,
				arguments: { value: toolName },
				status: "started",
				timestamp: 1,
			});
		}
		const journal = new ToolLifecycleJournal(store, () => 20);
		const recovered = await journal.recoverIndeterminate();
		expect(recovered.map(record => [record.toolName, record.status])).toEqual([
			["edit", "indeterminate"],
			["bash", "indeterminate"],
			["mcp.call", "indeterminate"],
		]);
		expect(store.records).toHaveLength(6);
	});
});
