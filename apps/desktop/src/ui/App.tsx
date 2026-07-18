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
	useEffect(() => {
		const unsubscribe = platform.subscribe(frame => {
			setEvents(current => [...current.slice(-80), frame]);
			if (frame.type === "response" && frame.ok && Array.isArray(frame.data)) setSessions(frame.data as DesktopSessionSummary[]);
		});
		void platform.start().then(() => platform.send({ version: 1, type: "handshake", id: requestId(), clientVersion: "desktop-preview" }));
		return unsubscribe;
	}, []);
	const active = sessions.find(session => session.sessionId === activeId);
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
	const timeline = useMemo(() => transcript.length > 0 ? transcript : [{ id: "empty", role: "system" as const, text: "Start a task to bring the workspace into focus." }], [transcript]);
	return <div className="desktop-shell">
		<aside className="task-rail">
			<div className="brand-lockup"><span className="brand-mark">R</span><span>ReActor</span><span className="brand-status">DESKTOP</span></div>
			<button className="new-task" onClick={createSession}>+ New task <kbd>⌘ K</kbd></button>
			<div className="rail-label">WORKSPACES</div>
			<div className="workspace-row"><span className="workspace-glyph">⌂</span><span>/workspace</span><span className="workspace-count">{sessions.length}</span></div>
			<div className="rail-label rail-label-spaced">TASKS</div>
			<nav aria-label="Tasks">{sessions.map(session => <button className={`task-row ${activeId === session.sessionId ? "task-row-active" : ""}`} key={session.sessionId} onClick={() => setActiveId(session.sessionId)}><span className={`state-mark state-${session.status}`} /><span className="task-name">{session.title ?? "Untitled task"}</span><span className="task-time">now</span></button>)}</nav>
			<div className="rail-footer"><button className="quiet-action">⌕ Search tasks</button><button className="quiet-action">⚙ Settings</button><div className="profile-row"><span className="profile-avatar">N</span><span><strong>Local profile</strong><small>Shared with CLI</small></span><span className="profile-chevron">⌄</span></div></div>
		</aside>
		<main className="conversation-pane">
			<header className="conversation-header"><div><div className="crumb">WORKSPACE / TASK</div><h1>{title}</h1></div><div className="header-actions"><button className="icon-button" aria-label="Toggle inspector" onClick={() => setInspectorOpen(value => !value)}>◧</button><button className="icon-button" aria-label="More actions">•••</button></div></header>
			<section className="conversation-scroll"><div className="conversation-intro"><span className="intro-line" /><span>{active ? "Today" : "Ready when you are"}</span></div><Transcript items={timeline} />{active && <ToolCard name="workspace" detail={`${active.cwd}\nGit state is shared across tasks in this worktree.`} />}</section>
			<footer className="composer-wrap"><div className="composer"><textarea aria-label="Message ReActor" value={composer} onChange={event => setComposer(event.target.value)} onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(); } }} placeholder={active ? "Ask ReActor to change the code..." : "Create a task to start"} disabled={!activeId} /><div className="composer-toolbar"><div className="composer-meta"><button className="composer-chip">reactor / default ⌄</button><button className="composer-chip">reasoning: standard ⌄</button></div><div className="composer-actions"><button className="composer-icon" aria-label="Attach image">＋</button><button className="send-button" onClick={() => void send()} disabled={!activeId || composer.trim().length === 0}>Send <span>↵</span></button></div></div></div><div className="composer-hint">Enter to send · Shift Enter for a new line</div></footer>
		</main>
		{inspectorOpen && <aside className="inspector"><div className="inspector-tabs"><button className="inspector-tab inspector-tab-active">Workspace</button><button className="inspector-tab">Autonomy</button></div><section className="inspector-section"><div className="section-heading"><h2>Changes</h2><button className="text-button">Refresh</button></div><div className="empty-inspector"><div className="empty-icon">⌁</div><strong>No changes yet</strong><p>Git changes will appear here as ReActor works.</p></div></section><section className="inspector-section"><div className="section-heading"><h2>Session</h2><span className="live-badge">● synced</span></div><dl className="session-facts"><div><dt>Profile</dt><dd>default</dd></div><div><dt>Backend</dt><dd>SDK sidecar</dd></div><div><dt>Tasks open</dt><dd>{sessions.length}</dd></div></dl></section></aside>}
	</div>;
}
