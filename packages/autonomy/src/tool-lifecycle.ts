import type { ToolLifecycleStore } from "./store";
import type { ToolLifecycleRecord } from "./types";

export class ToolLifecycleJournal {
	readonly #store: ToolLifecycleStore;
	readonly #now: () => number;

	constructor(store: ToolLifecycleStore, now: () => number = Date.now) {
		this.#store = store;
		this.#now = now;
	}

	async dispatch<T>(toolCallId: string, toolName: string, args: unknown, dispatch: () => Promise<T>): Promise<T> {
		await this.#store.append(this.#record(toolCallId, toolName, args, "started"));
		try {
			const result = await dispatch();
			await this.#store.append(this.#record(toolCallId, toolName, args, "completed"));
			return result;
		} catch (error) {
			await this.#store.append({
				...this.#record(toolCallId, toolName, args, "failed"),
				error: error instanceof Error ? error.message : String(error),
			});
			throw error;
		}
	}

	async recoverIndeterminate(): Promise<ToolLifecycleRecord[]> {
		const records = await this.#store.load();
		const latest = new Map<string, ToolLifecycleRecord>();
		for (const record of records) latest.set(record.toolCallId, record);
		const indeterminate: ToolLifecycleRecord[] = [];
		for (const record of latest.values()) {
			if (record.status !== "started") continue;
			const recovered = { ...record, status: "indeterminate" as const, timestamp: this.#now() };
			await this.#store.append(recovered);
			indeterminate.push(recovered);
		}
		return indeterminate;
	}

	#record(
		toolCallId: string,
		toolName: string,
		args: unknown,
		status: ToolLifecycleRecord["status"],
	): ToolLifecycleRecord {
		if (!toolCallId) throw new Error("A stable toolCallId is required before dispatch");
		return { version: 1, toolCallId, toolName, arguments: args, status, timestamp: this.#now() };
	}
}
