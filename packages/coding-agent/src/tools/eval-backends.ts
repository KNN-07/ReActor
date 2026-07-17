import { $flag } from "@reactor/utils";
import type { ToolSession } from ".";

export interface EvalBackendsAllowance {
	python: boolean;
	js: boolean;
	ruby: boolean;
	julia: boolean;
}

/** Read per-backend allowance from settings (py/js default on; rb/jl opt-in, default off). */
export function readEvalBackendsAllowance(session: ToolSession): EvalBackendsAllowance {
	return {
		python: session.settings.get("eval.py") ?? true,
		js: session.settings.get("eval.js") ?? true,
		ruby: session.settings.get("eval.rb") ?? false,
		julia: session.settings.get("eval.jl") ?? false,
	};
}

/**
 * Materialize the active eval backend allowance: REACTOR_PY / REACTOR_JS / REACTOR_RB / REACTOR_JL
 * env flags override the per-key settings; otherwise settings win (py/js default
 * on, rb/jl default off).
 */
export function resolveEvalBackends(session: ToolSession): EvalBackendsAllowance {
	const settings = readEvalBackendsAllowance(session);
	return {
		python: $flag("REACTOR_PY", settings.python),
		js: $flag("REACTOR_JS", settings.js),
		ruby: $flag("REACTOR_RB", settings.ruby),
		julia: $flag("REACTOR_JL", settings.julia),
	};
}
