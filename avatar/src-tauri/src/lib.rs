use std::io::{BufRead, BufReader};
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;

use serde::Serialize;
use tauri::{Emitter, LogicalPosition, Manager, RunEvent};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

#[derive(Clone, Serialize)]
struct Config {
    ws_url: String,
    style: String,
}

struct Backend(Mutex<Option<Child>>);

#[tauri::command]
fn config(cfg: tauri::State<Config>) -> Config {
    cfg.inner().clone()
}

/// Launches the Python backend and reads the ws URL (with its per-start token) from its first stdout line.
/// With CAPRI_WS_URL set, attaches to an already running backend instead.
fn start_backend() -> (String, Option<Child>) {
    if let Ok(url) = std::env::var("CAPRI_WS_URL") {
        return (url, None);
    }
    // ponytail: dev layout path; packaging the backend is phase 8.
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../backend");
    // The venv python.exe is a launcher that spawns the real interpreter, so killing it is not enough:
    // the backend exits on its own when the stdin pipe we hold closes (normal exit or crash).
    let mut cmd = Command::new(dir.join(".venv/Scripts/python.exe"));
    cmd.args(["-m", "app.main", "--exit-with-stdin"])
        .current_dir(&dir)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped());
    if std::env::var("CAPRI_DEMO").is_ok() {
        cmd.arg("--demo");
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    let mut child = cmd.spawn().expect("failed to start backend (run `uv sync` in backend/)");
    let mut reader = BufReader::new(child.stdout.take().unwrap());
    let mut url = String::new();
    reader.read_line(&mut url).expect("backend did not print its ws url");
    std::thread::spawn(move || for _ in reader.lines() {}); // keep draining stdout
    (url.trim().to_string(), Some(child))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let (ws_url, child) = start_backend();
    let style = std::env::var("CAPRI_STYLE").unwrap_or_default(); // set = style comparison mode with fps overlay
    let open_input = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::Space);

    let app = tauri::Builder::default()
        .manage(Config { ws_url, style })
        .manage(Backend(Mutex::new(child)))
        .invoke_handler(tauri::generate_handler![config])
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(move |app, shortcut, event| {
                    if shortcut == &open_input && event.state() == ShortcutState::Pressed {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.set_ignore_cursor_events(false);
                            let _ = w.set_focus();
                        }
                        let _ = app.emit("open-input", ());
                    }
                })
                .build(),
        )
        .setup(move |app| {
            app.global_shortcut().register(open_input)?;
            // Bottom-right corner of the primary monitor, above the taskbar.
            let w = app.get_webview_window("main").unwrap();
            if let (Some(m), Ok(size)) = (w.primary_monitor()?, w.outer_size()) {
                let scale = m.scale_factor();
                let screen = m.size().to_logical::<f64>(scale);
                let win = size.to_logical::<f64>(scale);
                w.set_position(LogicalPosition::new(screen.width - win.width - 16.0, screen.height - win.height - 56.0))?;
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app, event| {
        if let RunEvent::Exit = event {
            // Dropping the child closes its stdin, which stops the backend.
            app.state::<Backend>().0.lock().unwrap().take();
        }
    });
}
