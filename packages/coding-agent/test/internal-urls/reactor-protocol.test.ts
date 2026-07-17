import { describe, expect, it } from "bun:test";
import { InternalUrlRouter } from "@reactor/coding-agent/internal-urls";

describe("OmpProtocolHandler", () => {
	it("treats reactor://docs as the documentation root", async () => {
		const resource = await InternalUrlRouter.instance().resolve("reactor://docs");

		expect(resource.content).toContain("# Documentation");
		expect(resource.content).toContain("tools/read.md");
	});

	it("resolves docs-prefixed documentation paths", async () => {
		const router = InternalUrlRouter.instance();
		const direct = await router.resolve("reactor://tools/read.md");
		const prefixed = await router.resolve("reactor://docs/tools/read.md");

		expect(prefixed.content).toBe(direct.content);
		expect(prefixed.content).toContain("# read");
	});
});
