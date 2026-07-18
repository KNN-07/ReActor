<p align="center">
  <img src="https://github.com/KNN-07/ReActor/blob/main/assets/hero.png?raw=true" alt="ReActor">
</p>

<p align="center">
  <strong>A terminal-first coding agent with the IDE wired in.</strong><br>
  <a href="https://reactor.norman.id.vn">Website</a> ·
  <a href="https://reactor.norman.id.vn/docs">Documentation</a> ·
  <a href="https://github.com/KNN-07/ReActor/releases">Releases</a> ·
  <a href="https://discord.gg/4NMW9cdXZa">Discord</a>
</p>

<p align="center">
  <a href="https://github.com/KNN-07/ReActor/releases"><img src="https://img.shields.io/github/v/release/KNN-07/ReActor?style=flat&colorA=222222&colorB=CB3837" alt="Latest release"></a>
  <a href="https://github.com/KNN-07/ReActor/actions"><img src="https://img.shields.io/github/actions/workflow/status/KNN-07/ReActor/ci.yml?style=flat&colorA=222222&colorB=3FB950" alt="CI status"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/KNN-07/ReActor?style=flat&colorA=222222&colorB=58A6FF" alt="MIT license"></a>
  <a href="https://bun.sh"><img src="https://img.shields.io/badge/runtime-Bun-f472b6?style=flat&colorA=222222" alt="Bun"></a>
</p>

ReActor is a batteries-included coding agent for macOS, Linux, and Windows. It combines a fast terminal UI with code intelligence, native search and editing, persistent execution kernels, browser and web access, debugging, memory, subagents, collaboration, and broad model-provider support.

Use it interactively, run a bounded autonomous objective, invoke it once from a script, embed the TypeScript SDK, or connect an editor over ACP.

## Highlights

- **IDE-grade code intelligence** — LSP diagnostics, references, symbols, code actions, and workspace-aware renames are available to the agent.
- **Reliable edits** — hashline patches reject stale anchors; structural AST edits are previewed before they are applied.
- **Native tooling** — in-process search, globbing, text handling, syntax analysis, PTY support, and image utilities avoid platform-specific shell dependencies.
- **Real execution environments** — persistent Python and JavaScript sessions can call ReActor tools; the debugger speaks DAP to LLDB, Delve, debugpy, and other adapters.
- **Parallel work** — typed subagents can work in isolated worktrees, coordinate, and return structured results. `/review` uses dedicated reviewers with priorities and a verdict.
- **Long-running goals, by choice** — `reactor run` and `/react start` enable bounded autonomy with verification requirements, pause conditions, and restart-safe lifecycle handling.
- **Open model routing** — use direct APIs, subscription plans, gateways, or local OpenAI-compatible servers; assign separate models to default, fast, reasoning, planning, and commit roles.
- **Extensible and collaborative** — load skills, rules, hooks, MCP servers, custom tools, and plugins; share encrypted live sessions in a terminal or browser.
- **Multiple front ends** — the same runtime powers the TUI, print mode, RPC, the TypeScript SDK, and Agent Client Protocol integrations.

## Install

ReActor requires a supported macOS, Linux, or Windows machine. Source development requires Bun 1.3.14 or newer.

**macOS and Linux**

```sh
curl -fsSL https://reactor.norman.id.vn/install | sh
```

**Homebrew**

```sh
brew install KNN-07/tap/reactor
```

**Windows PowerShell**

```powershell
irm https://reactor.norman.id.vn/install.ps1 | iex
```

**mise**

```sh
mise use -g github:KNN-07/ReActor
```

Prebuilt artifacts are also available on the [Releases page](https://github.com/KNN-07/ReActor/releases).

## Quick start

Start ReActor in a project directory. The interactive setup connects a provider and selects a model.

```sh
cd your-project
reactor
```

Useful entry points:

```sh
reactor "Explain this repository"       # interactive session with an initial prompt
reactor -p "Summarize the current diff" # print one response and exit
reactor --continue                       # continue the previous session
reactor --resume                         # choose a saved session
reactor run "Fix the failing tests"     # bounded autonomous objective
reactor acp                              # ACP server for an editor
reactor --mode rpc --no-session          # NDJSON RPC over stdio
```

Attach files or images by prefixing their paths with `@`:

```sh
reactor @error.log @screenshot.png "Diagnose this failure"
```

Run `reactor --help` for all flags and `reactor <command> --help` for command-specific help.

### Shell completions

Completion data is generated from the live CLI metadata, including flags, enum values, models, and saved sessions.

```sh
# zsh
eval "$(reactor completions zsh)"

# bash
eval "$(reactor completions bash)"

# fish
reactor completions fish > ~/.config/fish/completions/reactor.fish
```

## Tools

ReActor gives the model one integrated tool surface:

| Area | Capabilities |
| --- | --- |
| Files and search | Read files, directories, archives, databases, notebooks, PDFs, URLs, PRs, issues, and internal URIs; write, hashline-edit, AST-edit, grep, and glob |
| Code intelligence | LSP diagnostics and navigation, semantic rename and code actions, AST queries, DAP debugging |
| Execution | Persistent shell sessions, Python and JavaScript kernels, notebooks, SSH |
| Coordination | Subagents, worktree isolation, task lists, user questions, agent messaging, process supervision |
| Web and media | Multi-provider web search, structured page extraction, browser automation, image inspection/generation, text-to-speech |
| State | Sessions, checkpoints, rewind, project memory, durable recall, and reflection |

Tools can be restricted with `--tools`, disabled individually through settings, or extended with plugins and MCP servers. See the [tool reference](https://reactor.norman.id.vn/docs/tools).

## Models and configuration

ReActor supports dozens of providers across direct APIs, OAuth subscriptions, gateways, cloud platforms, and local servers such as Ollama, LM Studio, llama.cpp, vLLM, and LiteLLM.

```sh
reactor models                         # browse available models
reactor --model opus                   # fuzzy model selection
reactor --smol <model> --slow <model>  # assign role-specific models
reactor config                         # manage settings
```

Provider credentials can come from the interactive login flow, environment variables, or the auth broker. Model aliases, fallback chains, role routing, path-scoped model filters, and custom OpenAI-compatible providers are configurable.

User data lives under `~/.reactor`; project-local configuration uses `.reactor`. ReActor intentionally does not add legacy command aliases or legacy data-directory fallbacks.

- [Providers and authentication](docs/providers.md)
- [Models and routing](docs/models.md)
- [Settings](docs/settings.md)
- [Environment variables](docs/environment-variables.md)
- [Secrets](docs/secrets.md)

## Sessions, rules, and extensions

Sessions are saved automatically and can be resumed, forked, exported, compacted, or shared. Project instructions are discovered from common agent-rule formats, including `AGENTS.md`, Cursor rules, Cline rules, and Copilot instructions.

ReActor can also load:

- **skills** for reusable workflows and knowledge;
- **rules** and Time-Traveling Stream Rules for targeted course correction;
- **extensions and hooks** for runtime behavior and UI integration;
- **MCP servers and custom tools** for external capabilities;
- **plugins** that bundle these components for installation.

Start with [sessions](docs/session.md), [context files](docs/context-files.md), [skills](docs/skills.md), [extensions](docs/extensions.md), and [MCP configuration](docs/mcp-config.md).

## SDK, RPC, and editor integration

The `@reactor/coding-agent` package exposes the runtime to TypeScript applications. Other hosts can use NDJSON RPC over stdio, while editors such as Zed can connect through ACP.

- [TypeScript SDK](docs/sdk.md)
- [RPC protocol](docs/rpc.md)
- [Desktop and editor integration](docs/desktop.md)
- [Collaboration](docs/collab.md)

## Development

Clone the repository, install all workspaces, build the native addon, and link the local CLI:

```sh
git clone https://github.com/KNN-07/ReActor.git
cd ReActor
bun setup
bun dev
```

Common checks:

```sh
bun check               # TypeScript, formatting/brand, and Rust checks
bun test                # local TypeScript test suite
bun run test:rs         # Rust tests
bun run test:py         # Python tests
bun run ci:test:smoke   # CLI and worker smoke probes
```

Run `bun run build:native` after changing Rust crates or `packages/natives`. The main implementation is in `packages/coding-agent`; architecture and package-specific guidance live in [its development guide](packages/coding-agent/DEVELOPMENT.md).

The monorepo is organized around these layers:

| Path | Purpose |
| --- | --- |
| `packages/coding-agent` | CLI, TUI application, SDK, tools, sessions, and integrations |
| `packages/agent` | Agent runtime and tool-call state management |
| `packages/ai` | Multi-provider streaming LLM client |
| `packages/catalog` | Generated model catalog, provider descriptors, and model identity |
| `packages/tui` | Differential terminal UI library |
| `packages/natives` | N-API bindings for the Rust-native toolchain |
| `packages/autonomy` | Opt-in autonomous goal lifecycle |
| `packages/stats` | Local usage and observability dashboard |
| `crates/` | Search, shell, AST, isolation, and native platform implementations |
| `python/` | Python RPC and remote worker components |

Additional packages provide collaboration, memory, hashline editing, wire protocols, UI sharing, benchmarks, and extensions.

## Contributing

Issues and discussions are open to everyone. Pull requests require a maintainer vouch and unvouched PRs are closed automatically. Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a PR.

This public fork tracks a pinned upstream revision through a reviewable sync workflow. Do not merge a floating upstream branch; see the repository development rules and contribution guide for the supported process.

## License and credits

ReActor is available under the [MIT License](LICENSE).

Maintained by [norman (KNN-07)](https://github.com/KNN-07). ReActor builds on the work of Mario Zechner's [Pi](https://github.com/badlogic/pi-mono) and subsequent contributors.

© 2025 Mario Zechner<br>
© 2025–2026 Can Bölük<br>
© 2026 norman (KNN-07)
