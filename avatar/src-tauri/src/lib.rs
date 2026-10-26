use std::io::{BufRead, BufReader};
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;
use tauri::{Emitter, LogicalPosition, LogicalSize, Manager, RunEvent, WebviewWindow};
mod ollama;
mod tray;
mod user_config;
mod win_watch;

use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

#[derive(Clone, Serialize)]
struct Config {
    ws_url: String,
}

struct Backend(Mutex<Option<Child>>);

/// Where the window takes the mouse: over the boxes the frontend reports (Capri, and the input bar
/// or a confirmation while they're up; logical px in the window). Elsewhere clicks go through.
#[derive(Default)]
struct Mouse {
    hitboxes: Mutex<Vec<[f64; 4]>>,
}

/// Logical px between her ground line (the taskbar's top edge) and the bottom of the overlay:
/// room for her legs to dangle over the taskbar. Matches (H - GROUND) * SCALE in the frontend.
const BELOW_GROUND: f64 = 54.0;

#[tauri::command]
fn config(cfg: tauri::State<Config>) -> Config {
    cfg.inner().clone()
}

#[tauri::command]
fn set_hitboxes(boxes: Vec<[f64; 4]>, mouse: tauri::State<Mouse>) {
    *mouse.hitboxes.lock().unwrap() = boxes;
}

/// The overlay: the primary monitor's work area plus BELOW_GROUND over the taskbar. Not the whole
/// monitor, or Windows would take it for a fullscreen app and push the taskbar behind it.
/// Fitted at start and again when the screen or the taskbar changes (win_watch::watch).
pub(crate) fn fit(w: &WebviewWindow) -> tauri::Result<()> {
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

/// After sleep Windows may have moved the screen or dropped her place on top: fit and raise her again.
#[tauri::command]
fn refit(app: tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = fit(&w);
        let _ = w.set_always_on_top(false);
        let _ = w.set_always_on_top(true);
    }
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
            .hitboxes
            .lock()
            .unwrap()
            .iter()
            .any(|&[bx, by, bw, bh]| x >= bx && y >= by && x <= bx + bw && y <= by + bh);
        let ignore = !inside;
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
    ollama::ensure(); // /cierra may have stopped it
    // ponytail: the backend runs from this checkout (its .venv), even in the release build; bundling
    // Python (PyInstaller) only matters to install Capri on another PC.
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
    // Global shortcuts from config.toml [atajos], each emitting an event to the frontend.
    let keys = user_config::load().atajos;
    let shortcuts: Vec<(Shortcut, &'static str)> = [
        (keys.escribir, "open-input"),
        (keys.teletransporte, "teleport"),
        (keys.mirar, "look"),
        (keys.no_molestar, "dnd"),
        (keys.estilo, "style"),
        (keys.camara, "camera"),
    ]
    .into_iter()
    .filter_map(|(text, event)| match text.parse::<Shortcut>() {
        Ok(s) => Some((s, event)),
        Err(e) => {
            eprintln!("shortcut {text:?} for {event} not understood: {e}");
            None
        }
    })
    .collect();
    let registered = shortcuts.clone();

    let app = tauri::Builder::default()
        .manage(Config { ws_url })
        .manage(Backend(Mutex::new(child)))
        .manage(Mouse::default())
        .manage(win_watch::Latest::default())
        .invoke_handler(tauri::generate_handler![
            config,
            set_hitboxes,
            refit,
            win_watch::windows,
            win_watch::idle_ms,
            win_watch::look_target,
            win_watch::capture_guard,
            user_config::avatar_settings,
            user_config::save_style,
            user_config::save_camera,
            ollama::quit,
            tray::tray_check
        ])
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(move |app, shortcut, event| {
                    if event.state() != ShortcutState::Pressed {
                        return;
                    }
                    let Some(&(_, name)) = shortcuts.iter().find(|(s, _)| s == shortcut) else { return };
                    if name == "open-input" {
                        tray::focus_input(app);
                    } else {
                        let _ = app.emit(name, ());
                    }
                })
                .build(),
        )
        .setup(move |app| {
            // Another app may own a shortcut already: losing one is no reason not to start.
            for (shortcut, name) in registered {
                if let Err(e) = app.global_shortcut().register(shortcut) {
                    eprintln!("shortcut for {name} not available (another app has it?): {e}");
                }
            }
            fit(&app.get_webview_window("main").unwrap())?;
            tray::build(app.handle())?;
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
