import type { AutopaperPhase, ResearchCheckpointParams, ResearchPhase, ResearchState, SurveyPhase } from "./types";

const SURVEY: Record<SurveyPhase, ResearchPhase[]> = {
	intake: ["research"],
	research: ["writing"],
	writing: ["complete"],
	complete: [],
};
const AUTOPAPER: Record<AutopaperPhase, ResearchPhase[]> = {
	intake: ["survey"],
	survey: ["ideation"],
	ideation: ["experiments"],
	experiments: ["verification", "writing"],
	verification: ["writing"],
	writing: ["review"],
	review: ["writing", "complete"],
	complete: [],
};

export function allowedResearchTransitions(workflow: "survey" | "autopaper", phase: ResearchPhase): ResearchPhase[] {
	return workflow === "survey" ? (SURVEY[phase as SurveyPhase] ?? []) : (AUTOPAPER[phase as AutopaperPhase] ?? []);
}

export function validateResearchCheckpoint(
	state: ResearchState,
	params: ResearchCheckpointParams,
	artifactExists: (path: string) => boolean,
): string[] {
	const errors: string[] = [];
	if (!allowedResearchTransitions(state.workflow, state.phase).includes(params.phase)) {
		errors.push(`Invalid transition ${state.phase} → ${params.phase}`);
	}
	for (const artifact of params.artifactPaths ?? [])
		if (!artifactExists(artifact)) errors.push(`Missing artifact: ${artifact}`);
	if (params.verification === "failed") errors.push(params.message ?? "Verification failed");
	if (state.verificationRequired && params.verification !== "passed" && params.phase === "writing") {
		errors.push("Required verification must pass before writing");
	}
	return errors;
}

export function applyResearchCheckpoint(
	state: ResearchState,
	params: ResearchCheckpointParams,
	artifactExists: (path: string) => boolean,
): ResearchState {
	const errors = validateResearchCheckpoint(state, params, artifactExists);
	if (errors.length > 0) return { ...state, updatedAt: Date.now(), lastError: errors.join("; ") };
	return {
		...state,
		phase: params.phase,
		updatedAt: Date.now(),
		completedAt: params.phase === "complete" ? Date.now() : state.completedAt,
		lastError: null,
	};
}
