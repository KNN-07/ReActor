import type { DesktopSnapshot } from "@reactor/wire";
import type { ReactNode } from "react";

export interface TranscriptItem {
	id: string;
	role: "user" | "assistant" | "tool" | "system";
	text: string;
}

export function Transcript({ items, streaming = false }: { items: TranscriptItem[]; streaming?: boolean }): ReactNode {
	return (
		<div className="transcript" aria-live={streaming ? "polite" : undefined}>
			{items.map(item => (
				<article className={`transcript-item transcript-item-${item.role}`} key={item.id}>
					<div className="transcript-role">{item.role}</div>
					<div className="transcript-copy">{item.text}</div>
				</article>
			))}
			{streaming && <div className="streaming-caret" aria-label="Assistant is responding" />}
		</div>
	);
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
		const candidate = entry as { type?: string; message?: { role?: string; content?: unknown } };
		if (candidate.type !== "message" || !candidate.message) return [];
		const role = candidate.message.role;
		if (role !== "user" && role !== "assistant" && role !== "toolResult") return [];
		const content = candidate.message.content;
		const text = typeof content === "string" ? content : JSON.stringify(content);
		return [
			{
				id: `${snapshot.sessionId}-${index}`,
				role: role === "toolResult" ? "tool" : role,
				text,
			} satisfies TranscriptItem,
		];
	});
}
