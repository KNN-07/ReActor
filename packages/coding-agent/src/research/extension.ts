import * as fs from "node:fs";
import * as path from "node:path";
import { prompt } from "@reactor/utils";
import { type } from "arktype";
import type { ExtensionContext, ExtensionFactory } from "../extensibility/extensions";
import * as git from "../utils/git";
import { applyResearchCheckpoint } from "./checkpoint";
import { createResearchState, researchDate, researchSlug } from "./helpers";
import contextTemplate from "./prompt-context.md" with { type: "text" };
import { getResearchDbPath, ResearchStorage } from "./storage";
import type { ResearchState } from "./types";

const checkpointSchema = type({
	phase: "string",
	"artifactPaths?": "string[]",
	"verification?": "string",
	"message?": "string",
});
const commands = ["survey", "peer-review", "autopaper"] as const;

export const createResearchExtension: ExtensionFactory = api => {
	const current = async (
		ctx: ExtensionContext,
		workflow: ResearchState["workflow"],
	): Promise<{ storage: ResearchStorage; state: ResearchState | null }> => {
		const storage = new ResearchStorage(getResearchDbPath(ctx.cwd));
		return { storage, state: storage.latest(workflow) };
	};
	const start = async (ctx: ExtensionContext, workflow: ResearchState["workflow"], topic: string): Promise<void> => {
		const root = (await git.repo.root(ctx.cwd)) ?? ctx.cwd;
		if (workflow === "autopaper") {
			const status = await git.status(root, { porcelainV1: true });
			if (status.trim()) {
				ctx.ui.notify(`Autopaper requires a clean worktree. Commit or stash:\n${status.trim()}`, "error");
				return;
			}
			if (await git.branch.current(root)) {
				const branchName = `autopaper/${researchSlug(topic)}-${researchDate()}`;
				try {
					await git.branch.checkoutNew(root, branchName);
				} catch (error) {
					ctx.ui.notify(
						`Unable to create isolated branch ${branchName}: ${error instanceof Error ? error.message : String(error)}`,
						"error",
					);
					return;
				}
			}
		}
		const branch = await git.branch.current(root);
		const state = createResearchState(workflow, topic, root, branch);
		const storage = new ResearchStorage(getResearchDbPath(root));
		storage.create(state);
		storage.close();
		ctx.ui.notify(`${workflow} started: ${state.artifactDir}`, "info");
	};
	for (const command of commands)
		api.registerCommand(command, {
			description:
				command === "survey"
					? "Literature survey with verified sources"
					: command === "peer-review"
						? "Review a manuscript with research personas"
						: "Resumable survey to paper workflow",
			async handler(args, ctx) {
				const [verb, ...rest] = args.trim().split(/\s+/).filter(Boolean);
				if (command === "peer-review" && verb && !["status", "cancel", "resume", "new"].includes(verb)) {
					const paperPath = path.resolve(ctx.cwd, verb);
					if (!fs.existsSync(paperPath)) {
						ctx.ui.notify(`Manuscript not found: ${paperPath}`, "error");
						return;
					}
					const output = path.join(
						ctx.cwd,
						"reviews",
						`${researchSlug(path.basename(paperPath, path.extname(paperPath)))}-${researchDate()}`,
					);
					fs.mkdirSync(output, { recursive: true });
					fs.writeFileSync(
						path.join(output, "review.json"),
						JSON.stringify({ paperPath, status: "incomplete", reviewers: [], metaReview: null }, null, 2),
					);
					fs.writeFileSync(
						path.join(output, "review-report.md"),
						`# Peer review\n\nManuscript: ${paperPath}\n\nReviewers are pending.\n`,
					);
					ctx.ui.notify(`Peer-review artifacts written to ${output}`, "info");
					return;
				}
				if (verb === "status") {
					const { storage, state } = await current(ctx, command === "peer-review" ? "survey" : command);
					ctx.ui.notify(
						state ? `${state.workflow}: ${state.phase} — ${state.topic}` : "No active research workflow",
						"info",
					);
					storage.close();
					return;
				}
				if (verb === "cancel") {
					const { storage, state } = await current(ctx, command === "peer-review" ? "survey" : command);
					if (state) {
						state.lastError = "Cancelled by user";
						state.updatedAt = Date.now();
						storage.save(state);
					}
					storage.close();
					ctx.ui.notify("Research workflow cancelled; generated artifacts were preserved", "info");
					return;
				}
				if (verb === "resume") {
					const { storage, state } = await current(ctx, command === "peer-review" ? "survey" : command);
					storage.close();
					ctx.ui.notify(
						state ? `Resuming ${state.workflow} at ${state.phase}` : "No resumable workflow",
						state ? "info" : "error",
					);
					return;
				}
				const topic = (verb === "new" ? rest : [verb, ...rest]).join(" ").trim();
				if (topic) await start(ctx, command === "peer-review" ? "survey" : command, topic);
				else ctx.ui.notify(`Usage: /${command} [topic]`, "warning");
			},
		});
	api.registerTool({
		name: "research_checkpoint",
		label: "Research checkpoint",
		description: "Advance a survey or autopaper workflow through a validated phase transition.",
		parameters: checkpointSchema,
		defaultInactive: true,
		async execute(_id, params, _signal, _update, ctx) {
			const storage = new ResearchStorage(getResearchDbPath(ctx.cwd));
			const state = storage.latest("survey") ?? storage.latest("autopaper");
			if (!state) {
				storage.close();
				return { content: [{ type: "text", text: "No active research workflow" }] };
			}
			const next = applyResearchCheckpoint(state, params as never, artifact =>
				fs.existsSync(path.isAbsolute(artifact) ? artifact : path.join(state.artifactDir, artifact)),
			);
			storage.save(next);
			storage.close();
			return {
				content: [
					{
						type: "text",
						text: next.lastError
							? `Checkpoint rejected: ${next.lastError}`
							: `Checkpoint advanced to ${next.phase}`,
					},
				],
				details: next,
			};
		},
	});
	api.on("before_agent_start", async (event, ctx) => {
		const storage = new ResearchStorage(getResearchDbPath(ctx.cwd));
		const state = storage.latest("survey") ?? storage.latest("autopaper");
		storage.close();
		if (!state || state.phase === "complete") return;
		event.systemPrompt.push(prompt.render(contextTemplate, { workflow_context: JSON.stringify(state) }));
	});
};
