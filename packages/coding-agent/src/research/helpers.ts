import * as path from "node:path";
import type { ResearchState } from "./types";

export function researchSlug(value: string): string {
	return (
		value
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-|-$/g, "")
			.slice(0, 64) || "research"
	);
}

export function researchDate(): string {
	return new Date().toISOString().slice(0, 10);
}

export function createResearchState(
	workflow: ResearchState["workflow"],
	topic: string,
	root: string,
	branch: string | null,
): ResearchState {
	const createdAt = Date.now();
	const slug = researchSlug(topic);
	const artifactRoot = workflow === "survey" ? "surveys" : "papers";
	return {
		id: `${workflow}-${slug}-${createdAt}`,
		workflow,
		topic,
		phase: "intake",
		projectRoot: root,
		branch,
		artifactDir: path.join(root, artifactRoot, `${slug}-${researchDate()}`),
		createdAt,
		updatedAt: createdAt,
		completedAt: null,
		autoresearchSessionId: null,
		bestMetrics: {},
		verificationRequired: false,
		lastError: null,
	};
}
