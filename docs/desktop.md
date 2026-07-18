# ReActor Desktop

ReActor Desktop is a native Tauri 2 shell around the existing ReActor coding-agent SDK. The renderer has no arbitrary shell or filesystem capability. It talks to a bundled `reactor --mode desktop-rpc` sidecar through versioned newline-delimited JSON frames.

## Development

Run the browser renderer with `bun --cwd=apps/desktop dev`. In a packaged build, Tauri starts the exact bundled sidecar with `--mode desktop-rpc`, forwards each stdout frame as a `desktop-frame` event, and accepts only validated frame strings through `send_frame`.

The desktop protocol version is exported from `@reactor/wire` as `DESKTOP_PROTOCOL_VERSION`. A client must complete `handshake` before creating sessions. Sessions are backed by normal ReActor session files and share the profile's credentials and model registry.

## Recovery and release

The shell emits `running`, `disconnected`, and `stopped` lifecycle events. A production release should add the one-shot clean restart policy around `disconnected`, preserve snapshots without replaying pending commands, and stop after repeated failures. Release artifacts must keep the sidecar version in lockstep and use Tauri updater signatures for each platform.
