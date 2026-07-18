# ReActor Desktop

The desktop renderer is a Vite React application hosted by Tauri 2. The Rust
shell owns native window and sidecar lifecycle only. Agent sessions, tools,
credentials, models, and persistence remain in the bundled `reactor
--mode desktop-rpc` process over versioned NDJSON.
