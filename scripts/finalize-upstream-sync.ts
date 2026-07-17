import { $ } from "bun";

interface UpstreamPin {
	repository: string;
	lastImportedSha: string;
	importDate: string;
	reactorCommit: string;
	validationStatus: string;
}

interface SyncReport {
	to: string;
	status: "noop" | "applied" | "conflicted";
}

const GATES: string[][] = [
	["bun", "run", "check"],
	["bun", "run", "ci:test:full"],
	["bun", "run", "ci:test:smoke"],
	["bun", "run", "test:py"],
	["bun", "run", "ci:test:install-methods"],
	["bun", "run", "ci:release:build-binaries"],
];

async function run(command: string[]): Promise<void> {
	const child = Bun.spawn(command, { stdin: "inherit", stdout: "inherit", stderr: "inherit" });
	if ((await child.exited) !== 0) throw new Error(`Validation gate failed: ${command.join(" ")}`);
}

const branch = (await $`git branch --show-current`.text()).trim();
if (!branch.startsWith("sync/oh-my-pi-")) throw new Error("Finalize must run on a sync/oh-my-pi-* branch");
const report = (await Bun.file(".upstream/sync-report.json").json()) as SyncReport;
if (report.status === "conflicted")
	throw new Error("Resolve upstream conflicts and update the sync report before finalizing");
for (const gate of GATES) await run(gate);

const pin = (await Bun.file(".upstream/oh-my-pi.json").json()) as UpstreamPin;
pin.lastImportedSha = report.to;
pin.importDate = new Date().toISOString().slice(0, 10);
pin.reactorCommit = (await $`git rev-parse HEAD`.text()).trim();
pin.validationStatus = "passed";
await Bun.write(".upstream/oh-my-pi.json", `${JSON.stringify(pin, null, "\t")}\n`);
await $`git add -A`;
await $`git commit -m ${`chore(sync): import oh-my-pi ${report.to.slice(0, 10)}`}`;
