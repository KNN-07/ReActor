#!/usr/bin/env bun

import { $ } from "bun";
import * as fs from "node:fs/promises";
import * as path from "node:path";

const desktopDir = path.resolve(import.meta.dir, "..");
const repoRoot = path.resolve(desktopDir, "..", "..");
const codingAgentDir = path.join(repoRoot, "packages", "coding-agent");

async function targetTriple(): Promise<string> {
	const output = await $`rustc -vV`.cwd(repoRoot).quiet().text();
	const host = output.split("\n").find(line => line.startsWith("host: "))?.slice("host: ".length).trim();
	if (!host) throw new Error("rustc did not report a host target triple");
	return host;
}

async function main(): Promise<void> {
	await $`bun run build`.cwd(codingAgentDir);
	const triple = await targetTriple();
	const executableSuffix = process.platform === "win32" ? ".exe" : "";
	const source = path.join(codingAgentDir, "dist", `reactor${executableSuffix}`);
	const destinationDir = path.join(desktopDir, "src-tauri", "binaries");
	const destination = path.join(destinationDir, `reactor-sidecar-${triple}${executableSuffix}`);
	await fs.mkdir(destinationDir, { recursive: true });
	await fs.copyFile(source, destination);
	if (process.platform !== "win32") await fs.chmod(destination, 0o755);
	process.stdout.write(`Prepared ${path.relative(repoRoot, destination)}\n`);
}

await main();
