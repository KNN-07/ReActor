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
});
