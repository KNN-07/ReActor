# ReActor Desktop

The desktop renderer is a Vite React application hosted by Tauri 2. The Rust
shell owns native window and sidecar lifecycle only. Agent sessions, tools,
credentials, models, and persistence remain in the bundled `reactor
--mode desktop-rpc` process over versioned NDJSON.

## Development

Install the repository dependencies first. Native development also requires a
working Rust toolchain and the platform prerequisites required by Tauri 2
(WebView2 and the MSVC C++ build tools on Windows).

```sh
bun install
bun run desktop:web # browser preview with a deterministic mock host
bun run desktop:dev # native window plus the bundled ReActor sidecar
```

`desktop:dev` builds the compiled `reactor` sidecar for the host target before
starting Tauri. The renderer uses the browser platform only when it is not
running inside Tauri; native dialogs, notifications, path opening, and the
NDJSON bridge are isolated in `src/platform.ts`.

Run the desktop checks without opening a window with:

```sh
bun run desktop:check
```

## Packaging

```sh
bun run desktop:build
```

The build embeds the target-suffixed ReActor executable via Tauri `externalBin`
and produces the platform's installer artifacts under
`apps/desktop/src-tauri/target/release/bundle`. Linux packaging can be
restricted to the tested Debian target from `apps/desktop` with
`bunx tauri build --bundles deb`.
