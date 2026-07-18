use std::{
	io::{BufRead, BufReader, Write},
	process::{Child, Command, Stdio},
	sync::{Arc, Mutex},
};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

struct Sidecar(Arc<Mutex<Option<Child>>>);

#[derive(Serialize, Clone)]
struct Lifecycle {
	state: &'static str,
}

fn sidecar_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
	let resource = app.path().resource_dir().map_err(|e| e.to_string())?;
	let name = if cfg!(target_os = "windows") {
		"reactor-sidecar.exe"
	} else {
		"reactor-sidecar"
	};
	Ok(resource.join(name))
}

#[tauri::command]
fn start_host(app: AppHandle, state: State<'_, Sidecar>) -> Result<(), String> {
	let mut slot = state
		.0
		.lock()
		.map_err(|_| "sidecar lock poisoned".to_string())?;
	if let Some(child) = slot.as_mut() {
		if child.try_wait().map_err(|e| e.to_string())?.is_none() {
			return Ok(());
		}
		*slot = None;
	}
	let path = sidecar_path(&app)?;
	let child = Command::new(path)
		.args(["--mode", "desktop-rpc"])
		.stdin(Stdio::piped())
		.stdout(Stdio::piped())
		.stderr(Stdio::piped())
		.spawn()
		.map_err(|e| format!("failed to start ReActor sidecar: {e}"))?;
	let mut child = child;
	let stdout = child.stdout.take().ok_or("sidecar stdout unavailable")?;
	let handle = app.clone();
	std::thread::spawn(move || {
		for line in BufReader::new(stdout).lines().flatten() {
			let _ = handle.emit("desktop-frame", line);
		}
		let _ = handle.emit("desktop-lifecycle", Lifecycle { state: "disconnected" });
	});
	let _ = app.emit("desktop-lifecycle", Lifecycle { state: "running" });
	*slot = Some(child);
	Ok(())
}

#[tauri::command]
fn send_frame(frame: String, state: State<'_, Sidecar>) -> Result<(), String> {
	let mut slot = state
		.0
		.lock()
		.map_err(|_| "sidecar lock poisoned".to_string())?;
	let child = slot.as_mut().ok_or("ReActor sidecar is not running")?;
	let stdin = child.stdin.as_mut().ok_or("sidecar stdin unavailable")?;
	stdin
		.write_all(frame.as_bytes())
		.map_err(|e| e.to_string())?;
	stdin.write_all(b"\n").map_err(|e| e.to_string())?;
	stdin.flush().map_err(|e| e.to_string())
}

#[tauri::command]
fn stop_host(app: AppHandle, state: State<'_, Sidecar>) -> Result<(), String> {
	let mut slot = state
		.0
		.lock()
		.map_err(|_| "sidecar lock poisoned".to_string())?;
	if let Some(mut child) = slot.take() {
		if let Some(stdin) = child.stdin.as_mut() {
			let _ = writeln!(stdin, "{}", r#"{"version":1,"type":"shutdown","id":"tauri-shutdown"}"#);
			let _ = stdin.flush();
		}
		for _ in 0..50 {
			if child.try_wait().map_err(|e| e.to_string())?.is_some() {
				break;
			}
			std::thread::sleep(std::time::Duration::from_millis(100));
		}
		if child.try_wait().map_err(|e| e.to_string())?.is_none() {
			let _ = child.kill();
			let _ = child.wait();
		}
	}
	let _ = app.emit("desktop-lifecycle", Lifecycle { state: "stopped" });
	Ok(())
}

fn main() {
	tauri::Builder::default()
		.manage(Sidecar(Arc::new(Mutex::new(None))))
		.invoke_handler(tauri::generate_handler![start_host, send_frame, stop_host])
		.setup(|app| {
			let _ = app.emit("desktop-lifecycle", Lifecycle { state: "starting" });
			Ok(())
		})
		.run(tauri::generate_context!())
		.expect("error while running ReActor Desktop");
}
