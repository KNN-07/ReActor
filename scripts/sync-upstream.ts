import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { $ } from "bun";

interface UpstreamPin {
	repository: string;
	lastImportedSha: string;
}

interface RenameMap {
	replacements: Array<[string, string]>;
	protectedPaths: string[];
}

interface SyncReport {
	from: string;
	to: string;
	branch: string;
	generatedAt: string;
	status: "noop" | "applied" | "conflicted";
	skippedFiles: string[];
	message?: string;
}

function targetFromArgs(args: string[]): string {
	const index = args.indexOf("--to");
	const target = index >= 0 ? args[index + 1] : undefined;
	if (!target) throw new Error("Usage: bun run sync:upstream --to <sha>");
	return target;
}

async function git(...args: string[]): Promise<string> {
	const result = await $`git ${args}`.quiet().nothrow();
	if (result.exitCode !== 0) throw new Error(result.stderr.toString().trim() || `git ${args.join(" ")} failed`);
	return result.text().trim();
}

function transformPatch(patch: string, map: RenameMap): string {
	let transformed = patch;
	for (const [from, to] of map.replacements) transformed = transformed.replaceAll(from, to);
	return transformed;
}

function patchBlocks(patch: string): string[] {
	const starts: number[] = [];
	for (const match of patch.matchAll(/^diff --git /gm)) starts.push(match.index);
	return starts.map((start, index) => patch.slice(start, starts[index + 1] ?? patch.length));
}

function filterProtectedPatch(patch: string, protectedPaths: string[]): { patch: string; skippedFiles: string[] } {
	const kept: string[] = [];
	const skippedFiles: string[] = [];
	for (const block of patchBlocks(patch)) {
		const header = block.slice(0, block.indexOf("\n"));
		const target = header.match(/ b\/(.+)$/)?.[1];
		if (target && protectedPaths.some(prefix => target === prefix || target.startsWith(prefix))) {
			skippedFiles.push(target);
			continue;
		}
		kept.push(block);
	}
	return { patch: kept.join(""), skippedFiles };
}

async function writeReport(report: SyncReport): Promise<void> {
	await Bun.write(".upstream/sync-report.json", `${JSON.stringify(report, null, "\t")}\n`);
}

export async function syncUpstream(targetArg: string): Promise<SyncReport> {
	if (await git("status", "--porcelain")) throw new Error("Upstream sync requires a clean worktree");
	const pin = (await Bun.file(".upstream/oh-my-pi.json").json()) as UpstreamPin;
	const map = (await Bun.file(".upstream/rename-map.json").json()) as RenameMap;
	await git("fetch", "upstream");
	const target = await git("rev-parse", `${targetArg}^{commit}`);
	const ancestor = await $`git merge-base --is-ancestor ${pin.lastImportedSha} ${target}`.quiet().nothrow();
	if (ancestor.exitCode !== 0) throw new Error("The current upstream pin is not an ancestor of the requested target");
	const branch = `sync/oh-my-pi-${target.slice(0, 10)}`;
	await git("switch", "-c", branch);

	const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "reactor-upstream-"));
	try {
		await git("worktree", "add", "--detach", temporary, target);
		const diff = await $`git -C ${temporary} diff --binary ${pin.lastImportedSha} HEAD`.quiet().nothrow();
		if (diff.exitCode !== 0) throw new Error(diff.stderr.toString().trim() || "Could not generate upstream patch");
		const filtered = filterProtectedPatch(transformPatch(diff.text(), map), map.protectedPaths);
		if (!filtered.patch.trim()) {
			const report: SyncReport = {
				from: pin.lastImportedSha,
				to: target,
				branch,
				generatedAt: new Date().toISOString(),
				status: "noop",
				skippedFiles: filtered.skippedFiles,
			};
			await writeReport(report);
			return report;
		}
		const patchPath = path.join(temporary, "reactor.patch");
		await Bun.write(patchPath, filtered.patch);
		const apply = await $`git apply --3way --whitespace=nowarn ${patchPath}`.quiet().nothrow();
		const status = apply.exitCode === 0 ? "applied" : "conflicted";
		const report: SyncReport = {
			from: pin.lastImportedSha,
			to: target,
			branch,
			generatedAt: new Date().toISOString(),
			status,
			skippedFiles: filtered.skippedFiles,
			message: apply.exitCode === 0 ? undefined : apply.stderr.toString().trim(),
		};
		await writeReport(report);
		if (apply.exitCode !== 0) process.exitCode = 1;
		return report;
	} finally {
		await $`git worktree remove --force ${temporary}`.quiet().nothrow();
		await fs.rm(temporary, { recursive: true, force: true });
	}
}

if (import.meta.main) {
	const report = await syncUpstream(targetFromArgs(process.argv.slice(2)));
	process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
