import { isManagedResearchBranch } from "./git";

/** Shared lifecycle seam used by research workflows when handing off experiments. */
export interface AutoresearchController {
	active: boolean;
	activate(): void;
	deactivate(): void;
	isManagedBranch(branch: string | null): boolean;
}

export function createAutoresearchController(): AutoresearchController {
	let active = false;
	return {
		get active() {
			return active;
		},
		activate() {
			active = true;
		},
		deactivate() {
			active = false;
		},
		isManagedBranch: isManagedResearchBranch,
	};
}
