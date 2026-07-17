import * as fs from "node:fs/promises";
import * as path from "node:path";

const ROOT = path.resolve(import.meta.dir, "..");
const ALLOWED = [
	/^\.upstream\//,
	/^LICENSE$/,
	/^THIRD_PARTY_NOTICES\.md$/,
	/(^|\/)CHANGELOG\.md$/,
	/^docs\/porting-from-pi-mono\.md$/,
];
const TEXT_TOKENS = [/@oh-my-pi\//, /(?<![A-Za-z])omp(?![A-Za-z])/, /\.omp(?:\/|\b)/, /\bOMP_/, /Oh My Pi/];
const PATH_TOKENS = [/(^|\/)\.omp(\/|$)/, /(^|[._-])robomp([._-]|$)/, /(^|\/)pi-[^/]+/];

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
	if (ALLOWED.some(pattern => pattern.test(file))) continue;
	if (PATH_TOKENS.some(pattern => pattern.test(file))) leaks.push(`${file}: legacy path`);
	const bytes = await Bun.file(path.join(ROOT, file)).bytes();
	if (bytes.includes(0)) continue;
	const text = new TextDecoder().decode(bytes);
	for (const token of TEXT_TOKENS) {
		if (token.test(text)) {
			leaks.push(`${file}: ${token.source}`);
			break;
		}
	}
}
if (leaks.length > 0) {
	process.stderr.write(`ReActor brand leaks detected:\n${leaks.map(leak => `- ${leak}`).join("\n")}\n`);
	process.exit(1);
}
process.stdout.write("brand-check: ok\n");
