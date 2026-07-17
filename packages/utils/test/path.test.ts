import { describe, expect, it } from "bun:test";
import { stripWindowsExtendedLengthPathPrefix } from "../src/path";

describe("stripWindowsExtendedLengthPathPrefix", () => {
	it("removes drive and UNC extended-length prefixes on Windows", () => {
		expect(stripWindowsExtendedLengthPathPrefix("\\\\?\\C:\\Users\\Shi Xin\\reactor.exe", "win32")).toBe(
			"C:\\Users\\Shi Xin\\reactor.exe",
		);
		expect(stripWindowsExtendedLengthPathPrefix("\\\\?\\UNC\\server\\share\\reactor.exe", "win32")).toBe(
			"\\\\server\\share\\reactor.exe",
		);
	});

	it("leaves non-Windows paths unchanged", () => {
		const path = "\\\\?\\C:\\Users\\Shi Xin\\reactor.exe";
		expect(stripWindowsExtendedLengthPathPrefix(path, "linux")).toBe(path);
	});
});
