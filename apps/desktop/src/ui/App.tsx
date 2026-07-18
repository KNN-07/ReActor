import { useEffect, useMemo, useState } from "react";
import type { DesktopFrame, DesktopSessionSummary } from "@reactor/wire";
import { snapshotToTranscript, Transcript, ToolCard } from "@reactor/shared-ui";
import "../../../../packages/shared-ui/src/styles.css";
import { createDesktopPlatform, type DesktopPlatform } from "../platform";

const platform: DesktopPlatform = createDesktopPlatform();
const requestId = () => crypto.randomUUID();

export function App(): React.ReactNode {
	const [sessions, setSessions] = useState<DesktopSessionSummary[]>([]);
	const [activeId, setActiveId] = useState<string | null>(null);
	const [composer, setComposer] = useState("");
	const [events, setEvents] = useState<DesktopFrame[]>([]);
	const [inspectorOpen, setInspectorOpen] = useState(true);
	const [gitState, setGitState] = useState<{ status: string; diff: string; branch: string | null } | null>(null);
	const [showArchived, setShowArchived] = useState(false);
	const [backendNotice, setBackendNotice] = useState<string | null>(null);
	const [uiRequest, setUiRequest] = useState<Extract<DesktopFrame, { type: "ui_request" }> | null>(null);
	useEffect(() => {
		const unsubscribe = platform.subscribe(frame => {
			setEvents(current => [...current.slice(-80), frame]);
			if (frame.type === "response" && frame.ok && Array.isArray(frame.data)) setSessions(frame.data as DesktopSessionSummary[]);
			if (frame.type === "response" && frame.ok && frame.data && typeof frame.data === "object" && "sessionId" in frame.data) setActiveId(String(frame.data.sessionId));
			if (frame.type === "response" && !frame.ok) setBackendNotice(frame.error);
			if (frame.type === "git_state") setGitState(frame.state);
			if (frame.type === "notice") setBackendNotice(frame.message);
			if (frame.type === "ui_request") setUiRequest(frame);
		});
		void platform.start().then(async () => {
			await platform.send({ version: 1, type: "handshake", id: requestId(), clientVersion: "desktop-preview" });
			await platform.send({ version: 1, type: "list_sessions", id: requestId() });
		});
		return unsubscribe;
	}, []);
	const active = sessions.find(session => session.sessionId === activeId);
	useEffect(() => {
		if (active?.cwd) void platform.send({ version: 1, type: "git_status", id: requestId(), cwd: active.cwd });
	}, [active?.cwd]);
	const snapshot = events.findLast(frame => frame.type === "session_snapshot" && frame.sessionId === activeId);
	const transcript = snapshot?.type === "session_snapshot" ? snapshotToTranscript(snapshot.snapshot) : [];
	const title = active?.title ?? "Untitled task";
	const send = async (): Promise<void> => {
		const text = composer.trim();
		if (!text || !activeId) return;
		setComposer("");
		await platform.send({ version: 1, type: "prompt", id: requestId(), sessionId: activeId, text });
	};
	const createSession = async (): Promise<void> => {
		await platform.send({ version: 1, type: "create_session", id: requestId(), cwd: "/workspace" });
		setActiveId(`preview-${sessions.length + 1}`);
	};
	const answerUiRequest = async (value: unknown, confirmed?: boolean): Promise<void> => {
		if (!uiRequest) return;
		await platform.send({ version: 1, type: "ui_response", id: requestId(), requestId: uiRequest.requestId, value, confirmed });
		setUiRequest(null);
	};
	const timeline = useMemo(() => transcript.length > 0 ? transcript : [{ id: "empty", role: "system" as const, text: "Start a task to bring the workspace into focus." }], [transcript]);
	return <div className="desktop-shell">
		{uiRequest && <div className="ui-request-backdrop"><section className="ui-request" role="dialog" aria-modal="true" aria-labelledby="ui-request-title"><h2 id="ui-request-title">{uiRequest.title}</h2>{uiRequest.message && <p>{uiRequest.message}</p>}{uiRequest.method === "select" && <div className="ui-options">{(uiRequest.options ?? []).map(option => <button key={option} onClick={() => void answerUiRequest(option)}>{option}</button>)}</div>}{uiRequest.method === "confirm" && <div className="ui-dialog-actions"><button className="quiet-action" onClick={() => void answerUiRequest(undefined, false)}>Cancel</button><button className="send-button" onClick={() => void answerUiRequest(undefined, true)}>Confirm</button></div>}{uiRequest.method === "input" && <form onSubmit={event => { event.preventDefault(); const value = new FormData(event.currentTarget).get("value"); void answerUiRequest(value); }}><input name="value" autoFocus placeholder={uiRequest.placeholder} /><button className="send-button" type="submit">Continue</button></form>}</section></div>}
		<aside className="task-rail">
			<div className="brand-lockup"><span className="brand-mark">R</span><span>ReActor</span><span className="brand-status">DESKTOP</span></div>
			<button className="new-task" onClick={createSession}>+ New task <kbd>⌘ K</kbd></button>
			<div className="rail-label">WORKSPACES</div>
			<div className="workspace-row"><span className="workspace-glyph">⌂</span><span>/workspace</span><span className="workspace-count">{sessions.length}</span></div>
			<div className="rail-label rail-label-spaced">TASKS <button className="archive-toggle" onClick={() => setShowArchived(value => !value)}>{showArchived ? "active" : "archive"}</button></div>
			<nav aria-label="Tasks">{sessions.filter(session => showArchived ? session.archived : !session.archived).map(session => <button className={`task-row ${activeId === session.sessionId ? "task-row-active" : ""}`} key={session.sessionId} onClick={() => setActiveId(session.sessionId)}><span className={`state-mark state-${session.status}`} /><span className="task-name">{session.title ?? "Untitled task"}</span><span className="task-time">now</span></button>)}</nav>
			<div className="rail-footer"><button className="quiet-action">⌕ Search tasks</button><button className="quiet-action">⚙ Settings</button><div className="profile-row"><span className="profile-avatar">N</span><span><strong>Local profile</strong><small>Shared with CLI</small></span><span className="profile-chevron">⌄</span></div></div>
		</aside>
		<main className="conversation-pane">{backendNotice && <div className="backend-notice" role="alert"><span>{backendNotice}</span><button onClick={() => setBackendNotice(null)} aria-label="Dismiss notice">×</button></div>}
			<header className="conversation-header"><div><div className="crumb">WORKSPACE / TASK</div><h1>{title}</h1></div><div className="header-actions"><button className="icon-button" aria-label="Toggle inspector" onClick={() => setInspectorOpen(value => !value)}>◧</button><button className="icon-button" aria-label="More actions">•••</button></div></header>
			<section className="conversation-scroll"><div className="conversation-intro"><span className="intro-line" /><span>{active ? "Today" : "Ready when you are"}</span></div><Transcript items={timeline} />{active && <ToolCard name="workspace" detail={`${active.cwd}\nGit state is shared across tasks in this worktree.`} />}</section>
			<footer className="composer-wrap"><div className="composer"><textarea aria-label="Message ReActor" value={composer} onChange={event => setComposer(event.target.value)} onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(); } }} placeholder={active ? "Ask ReActor to change the code..." : "Create a task to start"} disabled={!activeId} /><div className="composer-toolbar"><div className="composer-meta"><button className="composer-chip">reactor / default ⌄</button><button className="composer-chip">reasoning: standard ⌄</button></div><div className="composer-actions"><button className="composer-icon" aria-label="Attach image">＋</button><button className="send-button" onClick={() => void send()} disabled={!activeId || composer.trim().length === 0}>Send <span>↵</span></button></div></div></div><div className="composer-hint">Enter to send · Shift Enter for a new line</div></footer>
		</main>
			{inspectorOpen && <aside className="inspector"><div className="inspector-tabs"><button className="inspector-tab inspector-tab-active">Workspace</button><button className="inspector-tab">Autonomy</button></div><section className="inspector-section"><div className="section-heading"><h2>Changes</h2><button className="text-button" onClick={() => active?.cwd && void platform.send({ version: 1, type: "git_status", id: requestId(), cwd: active.cwd })}>Refresh</button></div>{gitState?.status ? <pre className="git-preview">{gitState.status}</pre> : <div className="empty-inspector"><div className="empty-icon">⌁</div><strong>No changes yet</strong><p>Git changes will appear here as ReActor works.</p></div>}</section><section className="inspector-section"><div className="section-heading"><h2>Session</h2><span className="live-badge">● synced</span></div><dl className="session-facts"><div><dt>Profile</dt><dd>default</dd></div><div><dt>Backend</dt><dd>SDK sidecar</dd></div><div><dt>Branch</dt><dd>{gitState?.branch ?? "not a repository"}</dd></div><div><dt>Tasks open</dt><dd>{sessions.filter(session => !session.archived).length}</dd></div></dl></section></aside>}
	</div>;
}
