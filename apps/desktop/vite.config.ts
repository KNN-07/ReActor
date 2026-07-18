import { defineConfig } from "vite";
import * as path from "node:path";

export default defineConfig({
	clearScreen: false,
	server: {
		host: "127.0.0.1",
		port: 1420,
		strictPort: true,
	},
	resolve: {
		alias: {
			"@reactor/shared-ui": path.resolve(import.meta.dirname, "../../packages/shared-ui/src/index.tsx"),
			"@reactor/wire": path.resolve(import.meta.dirname, "../../packages/wire/src/index.ts"),
		},
	},
});
