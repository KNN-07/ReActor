import { Args, Command, Flags } from "@reactor/utils/cli";
import { parseArgs } from "../cli/args";
import { runRootCommand } from "../main";

export default class Run extends Command {
	static description = "Run a bounded autonomous objective";

	static args = {
		objective: Args.string({ description: "Objective to complete", required: true }),
	};

	static flags = {
		"max-continuations": Flags.integer({ description: "Maximum automatic continuations (default: 8)" }),
		"max-minutes": Flags.integer({ description: "Maximum active minutes (default: 60)" }),
		"token-budget": Flags.integer({ description: "Maximum tokens for the objective" }),
	};

	async run(): Promise<void> {
		const { args, flags } = await this.parse(Run);
		if (!args.objective?.trim()) throw new Error("objective is required");
		const parsed = parseArgs([]);
		parsed.autonomyStart = {
			objective: args.objective,
			...(flags["max-continuations"] === undefined ? {} : { maxContinuations: flags["max-continuations"] }),
			...(flags["max-minutes"] === undefined ? {} : { maxMinutes: flags["max-minutes"] }),
			...(flags["token-budget"] === undefined ? {} : { tokenBudget: flags["token-budget"] }),
		};
		await runRootCommand(parsed, []);
	}
}
