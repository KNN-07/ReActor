import type { DesktopSnapshot } from "@reactor/wire";
import type { ReactNode } from "react";

export interface TranscriptItem {
	id: string;
	role: "user" | "assistant" | "tool" | "system";
	text: string;
	label?: string;
	meta?: string;
	status?: "running" | "complete" | "error";
}

export function Transcript({ items, streaming = false }: { items: TranscriptItem[]; streaming?: boolean }): ReactNode {
	return (
		<div className="transcript" aria-live={streaming ? "polite" : undefined}>
			{items.map(item => (
				<article className={`transcript-item transcript-item-${item.role}`} key={item.id}>
					{item.role === "assistant" && (
						<div className="transcript-avatar" aria-hidden="true">
							✦
						</div>
					)}
					<div className="transcript-body">
						{item.label && (
							<div className="transcript-role">
								{item.label}
								{item.meta && <span>{item.meta}</span>}
							</div>
						)}
						<div className="transcript-copy">{item.text}</div>
					</div>
					{item.role === "tool" && (
						<span
							className={`transcript-tool-state state-${item.status ?? "complete"}`}
							aria-label={item.status ?? "complete"}
						>
							{item.status === "running" ? "·" : item.status === "error" ? "!" : "✓"}
						</span>
					)}
				</article>
			))}
			{streaming && <div className="streaming-caret" aria-label="Assistant is responding" />}
		</div>
	);
}

function contentText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.flatMap(part => {
			if (typeof part !== "object" || part === null) return [];
			if (!("type" in part) || part.type !== "text" || !("text" in part) || typeof part.text !== "string") return [];
			return [part.text];
		})
		.join("\n\n");
}

export function ToolCard({
	name,
	detail,
	error = false,
}: {
	name: string;
	detail: string;
	error?: boolean;
}): ReactNode {
	return (
		<section className={`tool-card${error ? " tool-card-error" : ""}`} aria-label={`${name} tool result`}>
			<div className="tool-card-title">
				<span>{error ? "!" : "↳"}</span>
				{name}
			</div>
			<pre>{detail}</pre>
		</section>
	);
}

export function snapshotToTranscript(snapshot: DesktopSnapshot): TranscriptItem[] {
	return snapshot.entries.flatMap((entry, index) => {
		if (entry === null || typeof entry !== "object") return [];
		const candidate = entry as {
			type?: string;
			message?: { role?: string; content?: unknown; toolName?: string; isError?: boolean; timestamp?: number };
		};
		if (candidate.type !== "message" || !candidate.message) return [];
		const role = candidate.message.role;
		if (role !== "user" && role !== "assistant" && role !== "toolResult") return [];
		const content = candidate.message.content;
		const text = contentText(content);
		const timestamp = candidate.message.timestamp
			? new Date(candidate.message.timestamp).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
			: undefined;
		if (role === "assistant" && Array.isArray(content)) {
			const items: TranscriptItem[] = [];
			for (const [contentIndex, part] of content.entries()) {
				if (typeof part !== "object" || part === null || !("type" in part)) continue;
				if (part.type === "text" && "text" in part && typeof part.text === "string" && part.text.trim()) {
					items.push({
						id: `${snapshot.sessionId}-${index}-${contentIndex}`,
						role: "assistant",
						text: part.text,
						label: "ReActor",
						meta: timestamp,
					});
				}
				if (part.type === "toolCall" && "name" in part && typeof part.name === "string") {
					const intent =
						"intent" in part && typeof part.intent === "string" ? part.intent : "Working in the workspace";
					items.push({
						id: `${snapshot.sessionId}-${index}-${contentIndex}`,
						role: "tool",
						text: intent,
						label: part.name.replaceAll("_", " "),
						status: "running",
					});
				}
				if (
					(part.type === "thinking" || part.type === "redactedThinking") &&
					"thinking" in part &&
					typeof part.thinking === "string"
				) {
					items.push({
						id: `${snapshot.sessionId}-${index}-${contentIndex}`,
						role: "tool",
						text: part.thinking,
						label: part.type === "redactedThinking" ? "Redacted reasoning" : "Reasoning",
						status: "complete",
					});
				}
				if (part.type === "image") {
					items.push({
						id: `${snapshot.sessionId}-${index}-${contentIndex}`,
						role: "assistant",
						text: "[Image attachment]",
						label: "ReActor",
					});
				}
			}
			return items;
		}
		return [
			{
				id: `${snapshot.sessionId}-${index}`,
				role: role === "toolResult" ? "tool" : role,
				text: text || (role === "toolResult" ? "Tool completed" : ""),
				label:
					role === "user"
						? "You"
						: role === "toolResult"
							? (candidate.message.toolName?.replaceAll("_", " ") ?? "Tool")
							: "ReActor",
				meta: timestamp,
				status: role === "toolResult" ? (candidate.message.isError ? "error" : "complete") : undefined,
			} satisfies TranscriptItem,
		];
	});
}
