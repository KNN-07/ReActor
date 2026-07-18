# ReActor Desktop

The desktop renderer is a Vite React application hosted by Tauri 2. The Rust
shell owns native window and sidecar lifecycle only. Agent sessions, tools,
credentials, models, and persistence remain in the bundled `reactor
--mode desktop-rpc` process over versioned NDJSON.

## Development

From the repository root:

```sh
bun --cwd apps/desktop run dev       # browser preview with a deterministic mock host
bun --cwd apps/desktop run tauri:dev # native window plus the bundled ReActor sidecar
```

`tauri:dev` builds the compiled `reactor` sidecar for the host target before
starting Tauri. The renderer uses the browser platform only when it is not
running inside Tauri; native dialogs, notifications, path opening, and the
NDJSON bridge are isolated in `src/platform.ts`.

## Packaging

```sh
bun --cwd apps/desktop run tauri:build
```

The build embeds the target-suffixed ReActor executable via Tauri `externalBin`
and produces the platform's installer artifacts. Linux packaging can be
restricted to the tested Debian target with `bunx --cwd apps/desktop tauri build
--bundles deb`.
