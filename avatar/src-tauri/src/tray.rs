//! Her tray icon: left click opens the input bar; right click opens the settings panel (a small
//! webview window near the clock, `settings.html`). Most toggles just emit the event the shortcut
//! emits; the two plain config.toml keys are written here. Modes that someone else owns (the
//! backend's, the frontend's camera and style) get their state back through `tray_check`.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent};

use crate::{ollama, user_config};

const PANEL: (f64, f64) = (340.0, 720.0);

/// The toggles by id, so the panel shows the real state when it opens and when a mode changes by other means.
pub struct States(Mutex<HashMap<&'static str, bool>>);
static HID_AT: Mutex<Option<Instant>> = Mutex::new(None);

fn set_state(app: &AppHandle, name: &str, on: bool) {
    let states = app.state::<States>();
    let mut map = states.0.lock().unwrap();
    if let Some((key, v)) = map.iter_mut().find(|(k, _)| **k == name) {
        *v = on;
        let _ = app.emit("tray-state", (*key, on));
    }
}

#[tauri::command]
pub fn tray_check(name: String, on: bool, app: AppHandle) {
    set_state(&app, &name, on);
}

#[tauri::command]
pub fn tray_states(states: tauri::State<States>) -> HashMap<&'static str, bool> {
    states.0.lock().unwrap().clone()
}

/// What a click in the panel does.
#[tauri::command]
pub fn tray_action(id: String, app: AppHandle) {
    match id.as_str() {
        "open-input" => focus_input(&app),
        "deambular" | "poseer_ventanas" => {
            let on = !app.state::<States>().0.lock().unwrap().get(id.as_str()).copied().unwrap_or(true);
            set_state(&app, &id, on);
            // the frontend reads the key the next time she wanders
            if let Err(e) = user_config::save(&id, toml_edit::value(on)) {
                eprintln!("could not save {id}: {e}");
            }
        }
        "quit" | "quit-ollama" => {
            // she vanishes first, but a stuck page must not keep her from closing
            let with_ollama = id == "quit-ollama";
            let _ = app.emit("quit", with_ollama);
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_millis(2500));
                ollama::quit(with_ollama, app);
            });
        }
        _ => {
            let _ = app.emit(&id, ());
        }
    }
}

/// Keyboard focus for the input bar (the bar itself becomes clickable once the frontend reports its box).
pub fn focus_input(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.set_focus();
    }
    let _ = app.emit("open-input", ());
}

/// The panel sits over the work area's bottom right corner, by the clock.
fn toggle_panel(w: &WebviewWindow) {
    if w.is_visible().unwrap_or(false) {
        let _ = w.hide();
        return;
    }
    // the click on the tray icon blurred the panel a moment ago, which hid it: don't bring it back
    if HID_AT.lock().unwrap().is_some_and(|t| t.elapsed() < Duration::from_millis(300)) {
        return;
    }
    if let (Ok(Some(m)), Ok(size)) = (w.primary_monitor(), w.outer_size()) {
        let a = m.work_area();
        let margin = (8.0 * m.scale_factor()) as i32;
        let x = a.position.x + a.size.width as i32 - size.width as i32 - margin;
        let y = a.position.y + a.size.height as i32 - size.height as i32 - margin;
        let _ = w.set_position(PhysicalPosition::new(x, y));
    }
    let _ = w.show();
    let _ = w.set_focus();
}

pub fn build(app: &AppHandle) -> tauri::Result<()> {
    let cfg = user_config::load().avatar;
    app.manage(States(Mutex::new(HashMap::from([
        ("claude", true),
        ("dnd", false),
        ("voz", false),
        ("camera", cfg.camara),
        ("style", cfg.estilo == "pixel"),
        ("deambular", cfg.deambular),
        ("poseer_ventanas", cfg.poseer_ventanas),
    ]))));

    let panel = WebviewWindowBuilder::new(app, "settings", WebviewUrl::App("settings.html".into()))
        .title("Capri · ajustes")
        .inner_size(PANEL.0, PANEL.1)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .resizable(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .visible(false)
        .build()?;
    let hide = panel.clone();
    panel.on_window_event(move |e| {
        if let WindowEvent::Focused(false) = e {
            *HID_AT.lock().unwrap() = Some(Instant::now());
            let _ = hide.hide();
        }
    });

    TrayIconBuilder::with_id("capri")
        .icon(app.default_window_icon().expect("the app has an icon").clone())
        .tooltip("Capri")
        .on_tray_icon_event(move |tray, event| {
            if let TrayIconEvent::Click { button, button_state: MouseButtonState::Up, .. } = event {
                match button {
                    MouseButton::Left => focus_input(tray.app_handle()),
                    MouseButton::Right => toggle_panel(&panel),
                    _ => {}
                }
            }
        })
        .build(app)?;
    Ok(())
}
