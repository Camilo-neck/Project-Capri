use std::io::{BufRead, BufReader};
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;
use tauri::{Emitter, LogicalPosition, LogicalSize, Manager, RunEvent, WebviewWindow};
mod win_watch;

use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

#[derive(Clone, Serialize)]
struct Config {
    ws_url: String,
}

struct Backend(Mutex<Option<Child>>);

/// Where the window should take the mouse: over Capri (hitbox, logical px in the window) or
/// everywhere while the UI needs it (input open). Elsewhere clicks go through to the desktop.
#[derive(Default)]
struct Mouse {
    hitbox: Mutex<Option<[f64; 4]>>,
    forced: AtomicBool,
}

/// Logical px between her ground line (the taskbar's top edge) and the bottom of the overlay:
/// room for her legs to dangle over the taskbar. Matches (H - GROUND) * SCALE in the frontend.
const BELOW_GROUND: f64 = 54.0;

#[tauri::command]
fn config(cfg: tauri::State<Config>) -> Config {
    cfg.inner().clone()
}

#[tauri::command]
fn set_hitbox(x: f64, y: f64, w: f64, h: f64, mouse: tauri::State<Mouse>) {
    *mouse.hitbox.lock().unwrap() = Some([x, y, w, h]);
}

#[tauri::command]
fn set_interactive(on: bool, mouse: tauri::State<Mouse>) {
    mouse.forced.store(on, Ordering::Relaxed);
}

/// The overlay: the primary monitor's work area plus BELOW_GROUND over the taskbar. Not the whole
/// monitor, or Windows would take it for a fullscreen app and push the taskbar behind it.
/// ponytail: fitted once at start; refit on display changes if that turns out to matter.
fn fit(w: &WebviewWindow) -> tauri::Result<()> {
    let Some(m) = w.primary_monitor()? else { return Ok(()) };
    let scale = m.scale_factor();
    let area = m.work_area();
    let pos = area.position.to_logical::<f64>(scale);
    let work = area.size.to_logical::<f64>(scale);
    let screen_bottom = m.position().to_logical::<f64>(scale).y + m.size().to_logical::<f64>(scale).height;
    let height = (work.height + BELOW_GROUND).min(screen_bottom - pos.y);
    w.set_position(LogicalPosition::new(pos.x, pos.y))?;
    w.set_size(LogicalSize::new(work.width, height))
}

/// ~30 Hz: forwards the cursor (for her gaze) and toggles click-through by hit-testing her.
fn watch_mouse(app: tauri::AppHandle) {
    let mut last_cursor = (f64::NAN, f64::NAN);
    let mut last_ignore = None;
    loop {
        std::thread::sleep(Duration::from_millis(33));
        let Some(w) = app.get_webview_window("main") else { continue };
        let (Ok(c), Ok(pos), Ok(scale)) = (app.cursor_position(), w.outer_position(), w.scale_factor()) else {
            continue;
        };
        let x = (c.x - pos.x as f64) / scale;
        let y = (c.y - pos.y as f64) / scale;
        if (x, y) != last_cursor {
            last_cursor = (x, y);
            let _ = app.emit("cursor", (x, y));
        }
        let mouse = app.state::<Mouse>();
        let inside = mouse
            .hitbox
            .lock()
            .unwrap()
            .is_some_and(|[bx, by, bw, bh]| x >= bx && y >= by && x <= bx + bw && y <= by + bh);
        let ignore = !(inside || mouse.forced.load(Ordering::Relaxed));
        if last_ignore != Some(ignore) && w.set_ignore_cursor_events(ignore).is_ok() {
            last_ignore = Some(ignore);
        }
    }
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
    let open_input = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::Space);
    let teleport = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::KeyT);
    let look = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT | Modifiers::SHIFT), Code::KeyM);

    let app = tauri::Builder::default()
        .manage(Config { ws_url })
        .manage(Backend(Mutex::new(child)))
        .manage(Mouse::default())
        .manage(win_watch::Latest::default())
        .invoke_handler(tauri::generate_handler![
            config,
            set_hitbox,
            set_interactive,
            win_watch::windows,
            win_watch::look_target,
            win_watch::capture_guard
        ])
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(move |app, shortcut, event| {
                    if event.state() != ShortcutState::Pressed {
                        return;
                    }
                    if shortcut == &teleport {
                        let _ = app.emit("teleport", ());
                    }
                    if shortcut == &look {
                        let _ = app.emit("look", ());
                    }
                    if shortcut == &open_input {
                        app.state::<Mouse>().forced.store(true, Ordering::Relaxed);
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
            // Another app may own a shortcut already: losing one is no reason not to start.
            for shortcut in [open_input, teleport, look] {
                if let Err(e) = app.global_shortcut().register(shortcut) {
                    eprintln!("shortcut {shortcut:?} not available: {e}");
                }
            }
            fit(&app.get_webview_window("main").unwrap())?;
            let handle = app.handle().clone();
            std::thread::spawn(move || watch_mouse(handle));
            let handle = app.handle().clone();
            std::thread::spawn(move || win_watch::watch(handle));
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
