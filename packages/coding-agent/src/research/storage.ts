import { Database } from "bun:sqlite";
import * as fs from "node:fs";
import * as path from "node:path";
import { getAgentDir } from "@reactor/utils";
import type { ResearchState } from "./types";

function projectKey(root: string): string {
	return root.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-");
}

export function getResearchDbPath(projectRoot: string, agentDir = getAgentDir()): string {
	return path.join(agentDir, "research", `${projectKey(projectRoot)}.db`);
}

export class ResearchStorage {
	readonly #db: Database;
	constructor(readonly dbPath: string) {
		fs.mkdirSync(path.dirname(dbPath), { recursive: true });
		this.#db = new Database(dbPath);
		this.#db.run(
			`CREATE TABLE IF NOT EXISTS workflows (id TEXT PRIMARY KEY, workflow TEXT NOT NULL, topic TEXT NOT NULL, phase TEXT NOT NULL, project_root TEXT NOT NULL, branch TEXT, artifact_dir TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, completed_at INTEGER, autoresearch_session_id INTEGER, best_metrics TEXT NOT NULL, verification_required INTEGER NOT NULL, last_error TEXT)`,
		);
	}
	create(state: ResearchState): ResearchState {
		this.save(state);
		return state;
	}
	save(state: ResearchState): void {
		this.#db
			.query(
				`INSERT OR REPLACE INTO workflows VALUES ($id,$workflow,$topic,$phase,$projectRoot,$branch,$artifactDir,$createdAt,$updatedAt,$completedAt,$session,$metrics,$required,$error)`,
			)
			.run({
				$id: state.id,
				$workflow: state.workflow,
				$topic: state.topic,
				$phase: state.phase,
				$projectRoot: state.projectRoot,
				$branch: state.branch,
				$artifactDir: state.artifactDir,
				$createdAt: state.createdAt,
				$updatedAt: state.updatedAt,
				$completedAt: state.completedAt,
				$session: state.autoresearchSessionId,
				$metrics: JSON.stringify(state.bestMetrics),
				$required: state.verificationRequired ? 1 : 0,
				$error: state.lastError,
			});
	}
	get(id: string): ResearchState | null {
		const row = this.#db.query("SELECT * FROM workflows WHERE id = $id").get({ $id: id }) as Record<
			string,
			unknown
		> | null;
		if (!row) return null;
		return {
			id: String(row.id),
			workflow: row.workflow as ResearchState["workflow"],
			topic: String(row.topic),
			phase: row.phase as ResearchState["phase"],
			projectRoot: String(row.project_root),
			branch: row.branch ? String(row.branch) : null,
			artifactDir: String(row.artifact_dir),
			createdAt: Number(row.created_at),
			updatedAt: Number(row.updated_at),
			completedAt: row.completed_at == null ? null : Number(row.completed_at),
			autoresearchSessionId: row.autoresearch_session_id == null ? null : Number(row.autoresearch_session_id),
			bestMetrics: JSON.parse(String(row.best_metrics)) as Record<string, number>,
			verificationRequired: Number(row.verification_required) === 1,
			lastError: row.last_error ? String(row.last_error) : null,
		};
	}
	latest(workflow: ResearchState["workflow"]): ResearchState | null {
		const row = this.#db
			.query("SELECT id FROM workflows WHERE workflow = $workflow ORDER BY updated_at DESC LIMIT 1")
			.get({ $workflow: workflow }) as { id: string } | null;
		return row ? this.get(row.id) : null;
	}
	close(): void {
		this.#db.close();
	}
}
