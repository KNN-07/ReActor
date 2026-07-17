export type ResearchWorkflow = "survey" | "autopaper";
export type SurveyPhase = "intake" | "research" | "writing" | "complete";
export type AutopaperPhase =
	| "intake"
	| "survey"
	| "ideation"
	| "experiments"
	| "verification"
	| "writing"
	| "review"
	| "complete";
export type ResearchPhase = SurveyPhase | AutopaperPhase;

export interface ResearchState {
	id: string;
	workflow: ResearchWorkflow;
	topic: string;
	phase: ResearchPhase;
	projectRoot: string;
	branch: string | null;
	artifactDir: string;
	createdAt: number;
	updatedAt: number;
	completedAt: number | null;
	autoresearchSessionId: number | null;
	bestMetrics: Record<string, number>;
	verificationRequired: boolean;
	lastError: string | null;
}

export interface ResearchCheckpointParams {
	phase: ResearchPhase;
	artifactPaths?: string[];
	verification?: "passed" | "failed" | "skipped";
	message?: string;
}

export interface SourceRecord {
	citationKey: string;
	title: string;
	authors: string[];
	year: number;
	identifier?: string;
	canonicalUrl: string;
	evidenceUrls: string[];
	verified: boolean;
}
