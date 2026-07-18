import { describe, expect, test } from "bun:test";
import { BrowserDesktopPlatform } from "../src/platform";

describe("browser desktop platform", () => {
	test("implements deterministic command discovery and session actions", async () => {
		const platform = new BrowserDesktopPlatform();
		const frames: unknown[] = [];
		platform.subscribe(frame => frames.push(frame));
		await platform.start();
		await platform.send({ version: 1, type: "list_sessions", id: "sessions" });
		await platform.send({ version: 1, type: "list_commands", id: "commands", sessionId: "preview-1" });
		expect(frames.some(frame => typeof frame === "object" && frame !== null && "type" in frame && frame.type === "ready")).toBe(true);
		expect(frames.some(frame => typeof frame === "object" && frame !== null && "type" in frame && frame.type === "response" && "id" in frame && frame.id === "commands")).toBe(true);
	});
});
