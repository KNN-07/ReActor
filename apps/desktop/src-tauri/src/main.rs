use std::{
	io::{BufRead, BufReader, Write},
	path::PathBuf,
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

#[derive(Serialize)]
struct HostStatus {
	state: &'static str,
	pid:   Option<u32>,
}

fn sidecar_path(app: &AppHandle) -> Result<PathBuf, String> {
	let name = if cfg!(target_os = "windows") {
		"reactor-sidecar.exe"
	} else {
		"reactor-sidecar"
	};
	let mut candidates = Vec::new();
	if let Ok(executable) = std::env::current_exe() {
		if let Some(directory) = executable.parent() {
			candidates.push(directory.join(name));
		}
	}
	if let Ok(resource) = app.path().resource_dir() {
		candidates.push(resource.join(name));
		candidates.push(resource.join("binaries").join(name));
	}
	candidates
		.into_iter()
		.find(|candidate| candidate.is_file())
		.ok_or_else(|| format!("bundled ReActor sidecar not found ({name})"))
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
	let stderr = child.stderr.take().ok_or("sidecar stderr unavailable")?;
	let handle = app.clone();
	std::thread::spawn(move || {
		for line in BufReader::new(stdout).lines().map_while(Result::ok) {
			let _ = handle.emit("desktop-frame", line);
		}
		let _ = handle.emit("desktop-lifecycle", Lifecycle { state: "disconnected" });
	});
	let error_handle = app.clone();
	std::thread::spawn(move || {
		for line in BufReader::new(stderr).lines().map_while(Result::ok) {
			let frame = serde_json::json!({
				"version": 1,
				"type": "notice",
				"level": "error",
				"message": format!("ReActor backend: {line}"),
			});
			let _ = error_handle.emit("desktop-frame", frame.to_string());
		}
	});
	let _ = app.emit("desktop-lifecycle", Lifecycle { state: "running" });
	*slot = Some(child);
	Ok(())
}

#[tauri::command]
fn query_host(state: State<'_, Sidecar>) -> Result<HostStatus, String> {
	let mut slot = state
		.0
		.lock()
		.map_err(|_| "sidecar lock poisoned".to_string())?;
	if let Some(child) = slot.as_mut() {
		if child.try_wait().map_err(|e| e.to_string())?.is_none() {
			return Ok(HostStatus { state: "running", pid: Some(child.id()) });
		}
		*slot = None;
	}
	Ok(HostStatus { state: "stopped", pid: None })
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

fn stop_sidecar(app: &AppHandle, state: &Sidecar) -> Result<(), String> {
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

#[tauri::command]
fn stop_host(app: AppHandle, state: State<'_, Sidecar>) -> Result<(), String> {
	stop_sidecar(&app, &state)
}

fn main() {
	let app = tauri::Builder::default()
		.plugin(tauri_plugin_dialog::init())
		.plugin(tauri_plugin_notification::init())
		.plugin(tauri_plugin_opener::init())
		.plugin(tauri_plugin_store::Builder::default().build())
		.manage(Sidecar(Arc::new(Mutex::new(None))))
		.invoke_handler(tauri::generate_handler![start_host, query_host, send_frame, stop_host])
		.setup(|app| {
			let _ = app.emit("desktop-lifecycle", Lifecycle { state: "starting" });
			start_host(app.handle().clone(), app.state()).map_err(std::io::Error::other)?;
			Ok(())
		})
		.build(tauri::generate_context!())
		.expect("error while running ReActor Desktop");
	app.run(|handle, event| {
		if matches!(event, tauri::RunEvent::ExitRequested { .. }) {
			let state = handle.state::<Sidecar>();
			let _ = stop_sidecar(handle, &state);
		}
	});
}
