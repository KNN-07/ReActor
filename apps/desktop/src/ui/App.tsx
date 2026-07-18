import { useEffect, useMemo, useState } from "react";
import type { DesktopFrame, DesktopGitState, DesktopSessionSummary, WireAutonomyStateV1 } from "@reactor/wire";
import { snapshotToTranscript, Transcript } from "@reactor/shared-ui";
import type { TranscriptItem } from "@reactor/shared-ui";
import "../../../../packages/shared-ui/src/styles.css";
import { createDesktopPlatform, type DesktopPlatform } from "../platform";

const platform: DesktopPlatform = createDesktopPlatform();
const requestId = () => crypto.randomUUID();

const icons: Record<string, string> = {
	plus: "M12 5v14M5 12h14",
	folder: "M3.5 6.5h6l1.7 2h9.3v8.2a1.8 1.8 0 0 1-1.8 1.8H3.5zM3.5 6.5v-.7A1.8 1.8 0 0 1 5.3 4h3.1l1.7 2",
	wand: "m14 4 1.2 2.8L18 8l-2.8 1.2L14 12l-1.2-2.8L10 8l2.8-1.2zM6.5 13l.8 1.7L9 15.5l-1.7.8L6.5 18l-.8-1.7-1.7-.8 1.7-.8z",
	search: "m20 20-4.2-4.2M10.8 18a7.2 7.2 0 1 1 0-14.4 7.2 7.2 0 0 1 0 14.4Z",
	settings: "M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Zm0-5v2m0 13v2m9-8.5h-2m-14 0H3m15.4-6.4-1.4 1.4M7 17l-1.4 1.4m12.8 0L17 17M7 7 5.6 5.6",
	sliders: "M4 7h16M4 17h16M8 4v6M16 14v6",
	more: "M6 12h.01M12 12h.01M18 12h.01",
	check: "m5 12 4 4L19 6",
	chevron: "m9 5 7 7-7 7",
	branch: "M6 3v12a3 3 0 1 0 3 3h3a3 3 0 1 0 0-2H9a3 3 0 0 1-3-3V9h8a3 3 0 1 0 0-2H6",
	file: "M6 3.5h7l4 4v13H6zM13 3.5v4h4",
	archive: "M4 8h16v11H4zM3 5h18v3H3zM9 12h6",
};

function Icon({ name, size = 16 }: { name: string; size?: number }): React.ReactNode {
	return <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={icons[name] ?? icons.more} /></svg>;
}

function formatElapsed(updatedAt: string): string {
	const minutes = Math.max(1, Math.round((Date.now() - Date.parse(updatedAt)) / 60000));
	return `${minutes}m`;
}

interface ChangedFile {
	name: string;
	state: "added" | "removed" | "changed";
	staged: boolean;
}

function changedFiles(status: string): ChangedFile[] {
	return status.split("\n").filter(Boolean).map(line => {
		const indexState = line[0] ?? " ";
		const marker = line.slice(0, 2).trim();
		return {
			name: line.slice(3).trim() || line.trim(),
			state: marker === "??" || marker === "A" ? "added" : marker === "D" ? "removed" : "changed",
			staged: indexState !== " " && indexState !== "?",
		};
	});
}

interface DiffCount { additions: number; deletions: number }

function diffCounts(diff: string): Map<string, DiffCount> {
	const counts = new Map<string, DiffCount>();
	let current: string | null = null;
	for (const line of diff.split("\n")) {
		if (line.startsWith("diff --git ")) {
			const match = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
			current = match?.[2] ?? null;
			if (current && !counts.has(current)) counts.set(current, { additions: 0, deletions: 0 });
			continue;
		}
		if (!current) continue;
		const count = counts.get(current);
		if (!count) continue;
		if (line.startsWith("+") && !line.startsWith("+++")) count.additions++;
		if (line.startsWith("-") && !line.startsWith("---")) count.deletions++;
	}
	return counts;
}

function liveAssistantText(event: unknown): string | null {
	if (typeof event !== "object" || event === null || !("type" in event)) return null;
	if (event.type !== "message_start" && event.type !== "message_update" && event.type !== "message_end") return null;
	if (!("message" in event) || typeof event.message !== "object" || event.message === null) return null;
	const message = event.message as { role?: string; content?: unknown };
	if (message.role !== "assistant" || !Array.isArray(message.content)) return null;
	return message.content.flatMap(part => typeof part === "object" && part !== null && "type" in part && part.type === "text" && "text" in part && typeof part.text === "string" ? [part.text] : []).join("\n\n");
}

export function App(): React.ReactNode {
	const [sessions, setSessions] = useState<DesktopSessionSummary[]>([]);
	const [activeId, setActiveId] = useState<string | null>(null);
	const [composer, setComposer] = useState("");
	const [commitMessage, setCommitMessage] = useState("");
	const [events, setEvents] = useState<DesktopFrame[]>([]);
	const [openedSessions, setOpenedSessions] = useState<Set<string>>(() => new Set());
	const [liveMessages, setLiveMessages] = useState<Record<string, string>>({});
	const [inspectorOpen, setInspectorOpen] = useState(true);
	const [gitState, setGitState] = useState<DesktopGitState | null>(null);
	const [showArchived, setShowArchived] = useState(false);
	const [backendNotice, setBackendNotice] = useState<string | null>(null);
	const [autonomy, setAutonomy] = useState<WireAutonomyStateV1 | null>(null);
	const [uiRequest, setUiRequest] = useState<Extract<DesktopFrame, { type: "ui_request" }> | null>(null);

	useEffect(() => {
		const unsubscribe = platform.subscribe(frame => {
			setEvents(current => [...current.slice(-100), frame]);
			if (frame.type === "response" && frame.ok && Array.isArray(frame.data)) {
				const next = frame.data as DesktopSessionSummary[];
				setSessions(next);
				setActiveId(current => current ?? next.find(session => !session.archived)?.sessionId ?? null);
			}
			if (frame.type === "response" && frame.ok && frame.data && typeof frame.data === "object" && "sessionId" in frame.data) setActiveId(String(frame.data.sessionId));
			if (frame.type === "response" && !frame.ok) setBackendNotice(frame.error);
			if (frame.type === "session_snapshot") {
				setOpenedSessions(current => current.has(frame.sessionId) ? current : new Set(current).add(frame.sessionId));
				setLiveMessages(current => {
					const next = { ...current };
					delete next[frame.sessionId];
					return next;
				});
				const header = frame.snapshot.header as { title?: string; cwd?: string; timestamp?: string } | null;
				setSessions(current => current.some(session => session.sessionId === frame.sessionId) ? current : [...current, {
					sessionId: frame.sessionId,
					title: header?.title,
					cwd: header?.cwd ?? "",
					createdAt: header?.timestamp ?? new Date().toISOString(),
					updatedAt: header?.timestamp ?? new Date().toISOString(),
					status: frame.snapshot.status,
				}]);
			}
			if (frame.type === "session_event") {
				const text = liveAssistantText(frame.event);
				if (text !== null) setLiveMessages(current => ({ ...current, [frame.sessionId]: text }));
				if (typeof frame.event === "object" && frame.event !== null && "type" in frame.event && (frame.event.type === "message_end" || frame.event.type === "turn_end")) {
					void platform.send({ version: 1, type: "snapshot", id: requestId(), sessionId: frame.sessionId });
				}
			}
			if (frame.type === "session_status") setSessions(current => current.map(session => session.sessionId === frame.sessionId ? { ...session, status: frame.status } : session));
			if (frame.type === "git_state") setGitState(frame.state);
			if (frame.type === "autonomy_state" && frame.state && typeof frame.state === "object" && "version" in frame.state) setAutonomy(frame.state as WireAutonomyStateV1);
			if (frame.type === "notice") setBackendNotice(frame.message);
			if (frame.type === "ui_request") setUiRequest(frame);
		});
		void platform.start().then(async () => {
			await platform.send({ version: 1, type: "handshake", id: requestId(), clientVersion: "desktop-preview" });
			await platform.send({ version: 1, type: "list_sessions", id: requestId() });
		}).catch(error => setBackendNotice(`Unable to start ReActor: ${String(error)}`));
		return unsubscribe;
	}, []);

	const active = sessions.find(session => session.sessionId === activeId);
	useEffect(() => {
		if (!active) return;
		if (openedSessions.has(active.sessionId)) void platform.send({ version: 1, type: "snapshot", id: requestId(), sessionId: active.sessionId });
		else void platform.send({ version: 1, type: "open_session", id: requestId(), sessionId: active.sessionId, cwd: active.cwd });
		void platform.send({ version: 1, type: "git_status", id: requestId(), cwd: active.cwd });
	}, [active?.sessionId]);
	const snapshot = events.findLast(frame => frame.type === "session_snapshot" && frame.sessionId === activeId);
	const transcript = snapshot?.type === "session_snapshot" ? snapshotToTranscript(snapshot.snapshot) : [];
	const title = active?.title ?? "Untitled task";
	const files = useMemo(() => changedFiles(gitState?.status ?? ""), [gitState?.status]);
	const fileCounts = useMemo(() => diffCounts(gitState?.diff ?? ""), [gitState?.diff]);
	const totalDiff = useMemo(() => [...fileCounts.values()].reduce((total, count) => ({ additions: total.additions + count.additions, deletions: total.deletions + count.deletions }), { additions: 0, deletions: 0 }), [fileCounts]);
	const visibleSessions = sessions.filter(session => showArchived ? session.archived : !session.archived);
	const sessionGroups = useMemo(() => {
		const groups = new Map<string, DesktopSessionSummary[]>();
		for (const session of visibleSessions) {
			const current = groups.get(session.cwd) ?? [];
			current.push(session);
			groups.set(session.cwd, current);
		}
		return [...groups];
	}, [visibleSessions]);

	const send = async (): Promise<void> => {
		const text = composer.trim();
		if (!text || !activeId || !openedSessions.has(activeId)) return;
		setComposer("");
		await platform.send({ version: 1, type: active?.status === "running" ? "steer" : "prompt", id: requestId(), sessionId: activeId, text });
	};
	const updateStage = async (file: ChangedFile): Promise<void> => {
		if (!active) return;
		await platform.send({ version: 1, type: file.staged ? "git_unstage" : "git_stage", id: requestId(), cwd: active.cwd, files: [file.name] });
	};
	const commit = async (): Promise<void> => {
		if (!active || commitMessage.trim().length === 0) return;
		await platform.send({ version: 1, type: "git_commit", id: requestId(), cwd: active.cwd, message: commitMessage.trim() });
		setCommitMessage("");
	};
	const createSession = async (): Promise<void> => {
		const cwd = active?.cwd ?? await platform.chooseDirectory();
		if (!cwd) return;
		await platform.send({ version: 1, type: "create_session", id: requestId(), cwd });
	};
	const openWorkspace = async (): Promise<void> => {
		const cwd = await platform.chooseDirectory();
		if (!cwd) return;
		await platform.send({ version: 1, type: "create_session", id: requestId(), cwd });
	};
	const answerUiRequest = async (value: unknown, confirmed?: boolean): Promise<void> => {
		if (!uiRequest) return;
		await platform.send({ version: 1, type: "ui_response", id: requestId(), requestId: uiRequest.requestId, value, confirmed });
		setUiRequest(null);
	};
	const timeline: TranscriptItem[] = transcript.length > 0 ? [...transcript] : [{ id: "empty", role: "assistant", label: "ReActor", text: active ? "I’m ready to work in this workspace. Tell me what you want to change." : "Create a task to bring the workspace into focus." }];
	const liveMessage = activeId ? liveMessages[activeId] : undefined;
	if (liveMessage) timeline.push({ id: `live-${activeId}`, role: "assistant", label: "ReActor", text: liveMessage, status: "running" });

	return <div className="desktop-shell">
		{uiRequest && <div className="ui-request-backdrop"><section className="ui-request" role="dialog" aria-modal="true" aria-labelledby="ui-request-title"><div className="dialog-kicker">ACTION REQUIRED</div><h2 id="ui-request-title">{uiRequest.title}</h2>{uiRequest.message && <p>{uiRequest.message}</p>}{uiRequest.method === "select" && <div className="ui-options">{(uiRequest.options ?? []).map(option => <button key={option} onClick={() => void answerUiRequest(option)}>{option}<Icon name="chevron" size={15} /></button>)}</div>}{uiRequest.method === "confirm" && <div className="ui-dialog-actions"><button className="quiet-action" onClick={() => void answerUiRequest(undefined, false)}>Cancel</button><button className="send-button" onClick={() => void answerUiRequest(undefined, true)}>Confirm</button></div>}{uiRequest.method === "input" && <form onSubmit={event => { event.preventDefault(); const value = new FormData(event.currentTarget).get("value"); void answerUiRequest(value); }}><input name="value" autoFocus placeholder={uiRequest.placeholder} /><button className="send-button" type="submit">Continue</button></form>}</section></div>}
		<aside className="task-rail">
			<div className="brand-lockup"><span className="brand-mark">✦</span><strong>ReActor</strong><span className="brand-version">DESKTOP</span></div>
			<div className="rail-actions"><button className="rail-action rail-action-primary" onClick={createSession}><Icon name="plus" /> <span>New task</span><kbd>⌘N</kbd></button><button className="rail-action" onClick={() => void openWorkspace()}><Icon name="folder" /> <span>Open workspace</span><kbd>⌘O</kbd></button><button className="rail-action"><Icon name="wand" /> <span>Skills</span></button></div>
			<div className="rail-section-head"><span>SESSIONS</span><button aria-label="Search sessions" onClick={() => setBackendNotice("Session search is coming soon.")}><Icon name="search" size={14} /></button></div>
			<nav className="workspace-list" aria-label="Tasks">{sessionGroups.map(([cwd, group]) => <div className="workspace-group" key={cwd}><div className="workspace-label"><Icon name="folder" size={15} /><span>{cwd.split("/").pop() ?? "workspace"}</span><button onClick={createSession} aria-label={`New task in ${cwd}`}><Icon name="plus" size={15} /></button></div><div className="session-list">{group.map(session => <button className={`session-row ${activeId === session.sessionId ? "session-row-active" : ""}`} key={session.sessionId} onClick={() => setActiveId(session.sessionId)}><span className={`status-dot status-${session.status}`} /><span className="session-name">{session.title ?? "Untitled task"}</span><span className="session-time">{formatElapsed(session.updatedAt)}</span></button>)}</div></div>)}</nav>
			<div className="rail-footer"><button className="rail-footer-action" onClick={() => setShowArchived(value => !value)}><Icon name="archive" size={15} /> {showArchived ? "Active sessions" : "Archive"}</button><button className="rail-footer-action"><Icon name="search" size={15} /> Search sessions</button><div className="profile-row"><span className="profile-avatar">N</span><span><strong>Local profile</strong><small>Shared with CLI</small></span><Icon name="settings" size={15} /></div></div>
		</aside>
		<main className="conversation-pane">
			{backendNotice && <div className="backend-notice" role="alert"><span>{backendNotice}</span><button onClick={() => setBackendNotice(null)} aria-label="Dismiss notice">×</button></div>}
			<header className="conversation-header"><div className="title-line"><h1>{title}</h1><span className="context-chip"><Icon name="folder" size={13} />{active?.cwd.split("/").pop() ?? "workspace"}</span><span className="context-chip"><Icon name="branch" size={13} />{gitState?.branch ?? "main"}</span><span className={`header-status status-${active?.status ?? "idle"}`} /><span className="header-status-label">{active?.status === "running" ? "Running" : "Ready"}</span></div><div className="header-context"><span>Session · {active ? formatElapsed(active.updatedAt) : "—"}</span><button className="icon-button" aria-label="Toggle inspector" onClick={() => setInspectorOpen(value => !value)}><Icon name="sliders" /></button><button className="icon-button" aria-label="More actions"><Icon name="more" /></button></div></header>
			<section className="conversation-scroll"><Transcript items={timeline} streaming={liveMessage !== undefined} />{files.length > 0 && <section className="change-summary"><div className="change-summary-head"><strong>{files.length} files changed</strong><span><b>+{totalDiff.additions}</b> <em>−{totalDiff.deletions}</em></span></div><div className="change-summary-files">{files.map(file => { const count = fileCounts.get(file.name) ?? { additions: 0, deletions: 0 }; return <button className="change-summary-row" key={file.name}><span className={`language-mark language-${file.name.split(".").pop() ?? "file"}`}>{file.name.endsWith(".html") ? "5" : file.name.endsWith(".css") ? "⌘" : "JS"}</span><strong>{file.name}</strong><span><b>+{count.additions}</b> <em>−{count.deletions}</em></span></button>; })}</div></section>}</section>
			<footer className="composer-wrap"><div className="composer"><textarea aria-label="Message ReActor" value={composer} onChange={event => setComposer(event.target.value)} onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(); } }} placeholder={active ? openedSessions.has(active.sessionId) ? active.status === "running" ? "Send guidance while ReActor works" : "Ask for follow-up changes" : "Opening session…" : "Create a task to start"} disabled={!activeId || !openedSessions.has(activeId)} /><div className="composer-toolbar"><div className="composer-left"><button className="composer-attach" aria-label="Attach files" onClick={() => setBackendNotice("Image and file attachments are coming next.")}><Icon name="plus" size={18} /></button><span className="composer-control approval-control"><span className="approval-icon">♨</span>Session approvals</span></div><div className="composer-right"><span className="reasoning-indicator" aria-label="Reasoning enabled" /><span className="composer-control">Profile model</span>{active?.status === "running" && <button className="abort-button" onClick={() => activeId && void platform.send({ version: 1, type: "abort", id: requestId(), sessionId: activeId })}>Stop</button>}<button className="send-button" onClick={() => void send()} disabled={!activeId || !openedSessions.has(activeId) || composer.trim().length === 0} aria-label={active?.status === "running" ? "Send guidance" : "Send message"}>↑</button></div></div></div><span className="sr-only">Enter to send. Shift Enter for a new line.</span></footer>
		</main>
		{inspectorOpen && <aside className="inspector inspector-panels"><section className="inspector-section changes-section"><div className="inspector-heading"><h2>Changes</h2><strong className="diff-count"><b>+{totalDiff.additions}</b> <em>−{totalDiff.deletions}</em></strong></div><div className="changes-rule" /><div className="git-status"><div className="git-status-main"><Icon name="branch" size={15} /><span><strong>{gitState?.branch ?? "Not a repository"}</strong><small>{files.length > 0 ? `Working tree · ${files.length} modified` : "Working tree clean"}</small></span><button aria-label="Refresh Git status" onClick={() => active?.cwd && void platform.send({ version: 1, type: "git_status", id: requestId(), cwd: active.cwd })}>↻</button></div>{gitState?.sharedWorktree && <div className="shared-worktree-note">Shared by multiple active tasks</div>}</div><strong className="files-changed-label">{files.length} files changed</strong>{files.length > 0 ? <div className="file-list">{files.map(file => { const count = fileCounts.get(file.name) ?? { additions: 0, deletions: 0 }; return <div className="file-row" key={file.name}><span className={`language-mark language-${file.name.split(".").pop() ?? "file"}`}>{file.name.endsWith(".html") ? "5" : file.name.endsWith(".css") ? "⌘" : "JS"}</span><span>{file.name}</span><strong><b>+{count.additions}</b> <em>−{count.deletions}</em></strong><button className="stage-button" onClick={() => void updateStage(file)}>{file.staged ? "Unstage" : "Stage"}</button></div>; })}</div> : <div className="empty-inspector"><span className="empty-icon"><Icon name="check" /></span><strong>Working tree clean</strong><p>Changes will appear here as ReActor works.</p></div>}{files.length > 0 && <form className="commit-form" onSubmit={event => { event.preventDefault(); void commit(); }}><input value={commitMessage} onChange={event => setCommitMessage(event.target.value)} placeholder="Commit message" aria-label="Commit message" /><button type="submit" disabled={commitMessage.trim().length === 0 || !files.some(file => file.staged)}>Commit</button></form>}<button className="view-all" onClick={() => active?.cwd && void platform.openPath(active.cwd)}>Open workspace <Icon name="chevron" size={14} /></button></section><section className="inspector-section goal-section"><div className="inspector-heading"><h2>Goal</h2><button className="text-button">Edit</button></div><p className="goal-copy">{autonomy?.objective ?? "No active autonomy goal."}</p>{autonomy && <div className="goal-meta"><span>{autonomy.todoSummary.terminal}/{autonomy.todoSummary.total}</span><span>{active ? formatElapsed(active.updatedAt) : "—"} elapsed</span></div>}</section><section className="inspector-section progress-section"><div className="inspector-heading"><h2>Progress</h2><span className="progress-count">{autonomy ? `${autonomy.todoSummary.terminal}/${autonomy.todoSummary.total}` : "Idle"}</span></div>{autonomy ? <ol className="progress-list">{["Planning", "Implementing", "Reviewing", "Verifying"].map((step, index) => { const phases = ["planning", "implementing", "reviewing", "verifying", "complete"]; const current = phases.indexOf(autonomy.phase); const done = index < current || autonomy.phase === "complete"; return <li className={done ? "progress-done" : ""} key={step}><span><Icon name={done ? "check" : "more"} size={13} /></span>{step}</li>; })}</ol> : <p className="progress-empty">Start an autonomy goal to track progress and verification here.</p>}</section></aside>}
	</div>;
}
