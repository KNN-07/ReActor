import * as path from "node:path";
import { getConfigRootDir } from "@reactor/utils";

/** Resolve the private runtime directory shared by reactor processes in one project directory. */
export function daemonRuntimeDir(projectDir: string, configRoot: string = getConfigRootDir()): string {
	const key = Bun.hash.wyhash(path.resolve(projectDir)).toString(16).padStart(16, "0");
	return path.join(configRoot, "run", "daemons", key);
}

/** Resolve the Unix socket or Windows named pipe used by one project broker. */
export function daemonBrokerEndpoint(projectDir: string, runtimeDir: string): string {
	if (process.platform === "win32") {
		const key = Bun.hash.wyhash(path.resolve(projectDir)).toString(16).padStart(16, "0");
		return `\\\\.\\pipe\\reactor-daemon-${key}`;
	}
	return path.join(runtimeDir, "broker.sock");
}
