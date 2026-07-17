/**
 * List and clean up agent-managed git worktrees under `~/.reactor/wt`.
 */
import { getProjectDir } from "@reactor/utils";
import { Args, Command, Flags } from "@reactor/utils/cli";
import { clearWorktrees, listWorktrees } from "../cli/worktree-cli";
import { Settings } from "../config/settings";

export default class Worktree extends Command {
	static description = "List or clear agent-managed git worktrees (~/.reactor/wt)";

	static aliases = ["wt"];

	static args = {
		// `list` (default) inspects the worktree dir; `clear` removes entries.
		// A positional action keeps `reactor worktree` (the no-arg form) useful.
		action: Args.string({
			description: "list (default) or clear",
			required: false,
			options: ["list", "clear"],
			default: "list",
		}),
	};

	static flags = {
		all: Flags.boolean({
			description: "Clear every entry, including live PR-checkout worktrees (clear)",
			default: false,
		}),
		"dry-run": Flags.boolean({
			char: "n",
			description: "Print what would be removed without touching the filesystem (clear)",
			default: false,
		}),
		json: Flags.boolean({ char: "j", description: "Emit machine-readable JSON", default: false }),
	};

	static examples = [
		"reactor worktree",
		"reactor worktree list --json",
		"reactor worktree clear",
		"reactor worktree clear --dry-run",
		"reactor worktree clear --all",
	];

	async run(): Promise<void> {
		const { args, flags } = await this.parse(Worktree);
		// Load settings so the `worktree.base` override is applied before we scan
		// — otherwise this command would inspect ~/.reactor/wt while the agent created
		// its worktrees under the configured base.
		await Settings.init({ cwd: getProjectDir() });
		if (args.action === "clear") {
			await clearWorktrees({
				all: flags.all ?? false,
				dryRun: flags["dry-run"] ?? false,
				json: flags.json ?? false,
			});
			return;
		}
		await listWorktrees({ json: flags.json ?? false });
	}
}
