import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { resolveUpdateMethodForTest } from "@reactor/coding-agent/cli/update-cli";
import { removeSyncWithRetries } from "@reactor/utils";

// Issue #845: on Windows with Bun installed via Scoop, ~/.bun is a junction
// to scoop\persist\Oven-sh.Bun\.bun. `bun pm bin -g` and the reactor path that
// $which finds may end up referring to the same directory through different
// path strings (one through the junction, one through the real target).
// `isPathInDirectory` did purely lexical comparison via path.resolve, which
// does not follow filesystem links, so it misclassified Bun-installed reactor
// as "binary" and tried to swap reactor.exe in place – which fails on Windows
// because Bun has the file open (EPERM on unlink of .bak).
//
// We reproduce the realpath-resolution bug with a symlink (works on macOS /
// Linux; the bug is realpath, not junction-specific).

describe("issue-845: resolveUpdateMethod follows symlinks/junctions", () => {
	let tmpRoot: string;
	let realBinDir: string;
	let linkedBinDir: string;
	let reactorPathViaLink: string;

	beforeAll(() => {
		tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "reactor-issue-845-"));
		realBinDir = path.join(tmpRoot, "real", "bin");
		fs.mkdirSync(realBinDir, { recursive: true });
		fs.writeFileSync(path.join(realBinDir, "reactor"), "#!/bin/sh\n", { mode: 0o755 });

		linkedBinDir = path.join(tmpRoot, "link-bin");
		fs.symlinkSync(realBinDir, linkedBinDir, "dir");
		reactorPathViaLink = path.join(linkedBinDir, "reactor");
	});

	afterAll(() => {
		removeSyncWithRetries(tmpRoot);
	});

	it("classifies reactor reached through a symlinked bin dir as bun-managed", () => {
		// $which resolves through the symlink, `bun pm bin -g` returns the real path
		// (or vice versa). Either direction must be recognized.
		const method = resolveUpdateMethodForTest(reactorPathViaLink, realBinDir);
		expect(method).toBe("bun");
	});

	it("classifies reactor at the real bin dir as bun-managed when bunBinDir is symlinked", () => {
		const reactorAtReal = path.join(realBinDir, "reactor");
		const method = resolveUpdateMethodForTest(reactorAtReal, linkedBinDir);
		expect(method).toBe("bun");
	});
});
