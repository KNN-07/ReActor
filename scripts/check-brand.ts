import * as fs from "node:fs/promises";
import * as path from "node:path";

const ROOT = path.resolve(import.meta.dir, "..");
const ALLOWED_FILES = [
	/^\.upstream\//,
	/^LICENSE$/,
	/^THIRD_PARTY_NOTICES\.md$/,
	/(^|\/)CHANGELOG\.md$/,
	/^docs\/porting-from-pi-mono\.md$/,
	/^packages\/coding-agent\/test\/fixtures\//,
	/(^|\/)legacy-pi(?:-[^/]+)?(?:\/|\.)/,
];
const ALLOWED_TEXT_LINES: Readonly<Record<string, readonly RegExp[]>> = {
	"AGENTS.md": [/upstream.*\.upstream\/oh-my-pi\.json/i, /sync\/oh-my-pi-/i],
	"CONTRIBUTING.md": [/sync\/oh-my-pi-/i],
	"README.md": [/\b(?:fork|upstream).*oh-my-pi/i],
	"scripts/finalize-upstream-sync.ts": [/\.upstream\/oh-my-pi\.json/i, /sync\/oh-my-pi-/i, /import oh-my-pi/i],
	"scripts/sync-upstream.ts": [/\.upstream\/oh-my-pi\.json/i, /sync\/oh-my-pi-/i],
};
const TEXT_TOKENS = [
	/@oh[-_ ]?my[-_ ]?pi\b/i,
	/(?<![A-Za-z])omp(?![A-Za-z])/i,
	/\.omp(?:\/|\b)/i,
	/Omp(?:[A-Z][A-Za-z0-9_]*)?/,
	/\bOMPS\b/,
	/robo+mp/i,
	/\/v1\/pi\//i,
	/@reactor\/pi(?:[-/]|\b)/i,
	/\bpi\.gen_ai\b/i,
	/\.pi_config\b/i,
	/X-Rob/i,
];
const PATH_TOKENS = [/(^|\/)\.omp(\/|$)/, /(^|[._-])robomp([._-]|$)/, /(^|\/)pi-[^/]+/];

function isAllowedTextLine(file: string, line: string): boolean {
	return ALLOWED_TEXT_LINES[file]?.some(pattern => pattern.test(line)) ?? false;
}

async function walk(directory: string, relative = ""): Promise<string[]> {
	const files: string[] = [];
	for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
		if ([".git", "node_modules", "target", "dist"].includes(entry.name)) continue;
		const child = path.join(relative, entry.name);
		if (entry.isDirectory()) files.push(...(await walk(path.join(directory, entry.name), child)));
		else files.push(child);
	}
	return files;
}

const leaks: string[] = [];
for (const file of await walk(ROOT)) {
	if (file === "scripts/check-brand.ts") continue;
	if (ALLOWED_FILES.some(pattern => pattern.test(file))) continue;
	if (PATH_TOKENS.some(pattern => pattern.test(file))) leaks.push(`${file}: legacy path`);
	const bytes = await Bun.file(path.join(ROOT, file)).bytes();
	if (bytes.includes(0)) continue;
	const lines = new TextDecoder().decode(bytes).split("\n");
	for (const [index, line] of lines.entries()) {
		if (isAllowedTextLine(file, line)) continue;
		for (const token of TEXT_TOKENS) {
			if (token.test(line)) {
				leaks.push(`${file}:${index + 1}: ${token.source}`);
				break;
			}
		}
	}
}
if (leaks.length > 0) {
	process.stderr.write(`ReActor brand leaks detected:\n${leaks.map(leak => `- ${leak}`).join("\n")}\n`);
	process.exit(1);
}
process.stdout.write("brand-check: ok\n");
