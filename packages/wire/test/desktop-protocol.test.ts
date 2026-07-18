import { describe, expect, test } from "bun:test";
import { DESKTOP_PROTOCOL_VERSION, type DesktopCommand, type DesktopFrame } from "../src";

describe("desktop protocol contract", () => {
	test("uses a stable version and correlation envelope", () => {
		const command: DesktopCommand = { version: DESKTOP_PROTOCOL_VERSION, type: "health", id: "health-1" };
		const frame: DesktopFrame = {
			version: DESKTOP_PROTOCOL_VERSION,
			type: "response",
			id: command.id,
			ok: true,
			data: { ready: true },
		};
		expect(command.version).toBe(1);
		expect(frame).toMatchObject({ version: command.version, type: "response", id: command.id, ok: true });
	});

	test("keeps session identity on asynchronous frames", () => {
		const frame: DesktopFrame = {
			version: DESKTOP_PROTOCOL_VERSION,
			type: "session_status",
			sessionId: "session-1",
			status: "running",
		};
		expect(frame).toMatchObject({ version: 1, sessionId: "session-1", status: "running" });
	});

	test("models guarded workspace mutations as explicit commands", () => {
		const discard: DesktopCommand = {
			version: DESKTOP_PROTOCOL_VERSION,
			type: "git_discard",
			id: "discard-1",
			cwd: "/workspace",
			files: ["src/app.ts"],
			confirmed: false,
		};
		const autonomy: DesktopCommand = {
			version: DESKTOP_PROTOCOL_VERSION,
			type: "autonomy_start",
			id: "goal-1",
			sessionId: "session-1",
			objective: "Verify the desktop task",
		};
		expect(discard.confirmed).toBe(false);
		expect(autonomy.objective).toContain("desktop");
	});

	test("supports command execution, thinking controls, and attachments", () => {
		const command: DesktopCommand = {
			version: DESKTOP_PROTOCOL_VERSION,
			type: "execute_command",
			id: "command-1",
			sessionId: "session-1",
			text: "/compact",
		};
		const prompt: DesktopCommand = {
			version: DESKTOP_PROTOCOL_VERSION,
			type: "prompt",
			id: "prompt-1",
			sessionId: "session-1",
			text: "Inspect this image",
			attachments: [{ name: "screen.png", mimeType: "image/png", data: "aW1hZ2U=" }],
		};
		expect(command.type).toBe("execute_command");
		expect(prompt.attachments?.[0]?.mimeType).toBe("image/png");
	});
});
