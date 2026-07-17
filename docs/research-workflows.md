# Research workflows

ReActor includes four built-in research capabilities. `/autoresearch` remains the experiment loop; `/survey` creates a verified literature survey; `/peer-review` reviews a manuscript; and `/autopaper` composes those phases with optional Lean verification.

## Commands

- `/survey [topic]`, `/survey new`, `/survey resume`, `/survey status`, `/survey cancel`
- `/peer-review [paper-path] [--venue <venue>] [--output <dir>]`
- `/autopaper [topic]`, `/autopaper new`, `/autopaper resume`, `/autopaper status`, `/autopaper cancel`

Workflow state is project-keyed SQLite under `~/.reactor/research/`. Generated files stay in `surveys/<slug>-<date>/` or `papers/<slug>-<date>/`; cancel preserves them. Checkpoints are explicit and invalid transitions do not advance state. `/review` is unchanged and remains the code/PR review command.

Autopaper uses `autopaper/<slug>-<date>` isolation when Git is available and requires a clean worktree. Lean and PDF compilation are optional; unavailable compilers are recorded as skipped, never as verified.
