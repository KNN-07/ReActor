import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { AutonomyState, ToolLifecycleRecord } from "./types";

export interface AutonomyStore {
	load(): Promise<AutonomyState | null>;
	save(state: AutonomyState): Promise<void>;
}

export class FileAutonomyStore implements AutonomyStore {
	readonly #filePath: string;

	constructor(filePath: string) {
		this.#filePath = filePath;
	}

	async load(): Promise<AutonomyState | null> {
		try {
			return (await Bun.file(this.#filePath).json()) as AutonomyState;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
			throw error;
		}
	}

	async save(state: AutonomyState): Promise<void> {
		await fs.mkdir(path.dirname(this.#filePath), { recursive: true });
		const temporary = `${this.#filePath}.${process.pid}.tmp`;
		await Bun.write(temporary, `${JSON.stringify(state, null, "\t")}\n`);
		await fs.rename(temporary, this.#filePath);
	}
}

export interface ToolLifecycleStore {
	append(record: ToolLifecycleRecord): Promise<void>;
	load(): Promise<ToolLifecycleRecord[]>;
}

export class JsonlToolLifecycleStore implements ToolLifecycleStore {
	readonly #filePath: string;

	constructor(filePath: string) {
		this.#filePath = filePath;
	}

	async append(record: ToolLifecycleRecord): Promise<void> {
		await fs.mkdir(path.dirname(this.#filePath), { recursive: true });
		await fs.appendFile(this.#filePath, `${JSON.stringify(record)}\n`);
	}

	async load(): Promise<ToolLifecycleRecord[]> {
		try {
			const text = await Bun.file(this.#filePath).text();
			return text
				.split("\n")
				.filter(Boolean)
				.map(line => JSON.parse(line) as ToolLifecycleRecord);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
			throw error;
		}
	}
}
