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

const PANEL: (f64, f64) = (340.0, 660.0); // in tabs: a longer one scrolls inside
const QUICK: (f64, f64) = (268.0, 344.0); // her quick menu (right click on her), `quick.html`
const SETUP: (f64, f64) = (520.0, 640.0); // the first-run wizard, `setup.html`

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
        "deambular" | "poseer_ventanas" | "reaccionar_pc" | "seguir_pantallas" => {
            let on = !app.state::<States>().0.lock().unwrap().get(id.as_str()).copied().unwrap_or(true);
            set_state(&app, &id, on);
            // the frontend reads the key the next time she wanders, the backend every few seconds
            if let Err(e) = user_config::save(&id, toml_edit::value(on)) {
                eprintln!("could not save {id}: {e}");
            }
        }
        "setup" => show_setup(&app),
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
    show_panel(w);
}

fn show_panel(w: &WebviewWindow) {
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

/// Her quick menu's top-left: right and below the pointer, flipped to the other side where it wouldn't fit,
/// and always inside the work area. Physical px; `area` is x, y, width, height.
fn place(cursor: (i32, i32), size: (i32, i32), area: (i32, i32, i32, i32)) -> (i32, i32) {
    let (ax, ay, aw, ah) = area;
    let x = if cursor.0 + size.0 > ax + aw { cursor.0 - size.0 } else { cursor.0 };
    let y = if cursor.1 + size.1 > ay + ah { cursor.1 - size.1 } else { cursor.1 };
    (x.clamp(ax, (ax + aw - size.0).max(ax)), y.clamp(ay, (ay + ah - size.1).max(ay)))
}

/// The first-run wizard, in the middle of the screen (on its own on a fresh install; from the panel otherwise).
pub fn show_setup(app: &AppHandle) {
    let Some(w) = app.get_webview_window("setup") else { return };
    let _ = w.center();
    let _ = w.emit("setup-open", ());
    let _ = w.show();
    let _ = w.set_focus();
}

/// The pages the wizard may open in his browser (getting Ollama, a cloud key, a Spotify app): these and nothing else.
const WEB: [&str; 10] = [
    "https://ollama.com/download",
    "https://console.anthropic.com/settings/keys",
    "https://platform.openai.com/api-keys",
    "https://aistudio.google.com/apikey",
    "https://openrouter.ai/keys",
    "https://console.groq.com/keys",
    "https://console.mistral.ai/api-keys",
    "https://platform.deepseek.com/api_keys",
    "https://console.x.ai",
    "https://developer.spotify.com/dashboard",
];

fn allowed(url: &str) -> bool {
    WEB.contains(&url)
}

#[tauri::command]
pub fn open_web(url: String) -> Result<(), String> {
    if !allowed(&url) {
        return Err(format!("{url} no está entre las páginas del asistente"));
    }
    std::process::Command::new("explorer").arg(&url).spawn().map(|_| ()).map_err(|e| e.to_string())
}

/// The wizard is over: its window goes.
#[tauri::command]
pub fn setup_close(app: AppHandle) {
    if let Some(w) = app.get_webview_window("setup") {
        let _ = w.hide();
    }
}

/// A right click on her: her quick menu at the pointer.
#[tauri::command]
pub fn quick_menu(app: AppHandle) {
    let Some(w) = app.get_webview_window("quick") else { return };
    if let Ok(c) = app.cursor_position() {
        if let Ok(Some(m)) = app.monitor_from_point(c.x, c.y) {
            let s = m.scale_factor();
            let a = m.work_area();
            let size = ((QUICK.0 * s) as i32, (QUICK.1 * s) as i32);
            let area = (a.position.x, a.position.y, a.size.width as i32, a.size.height as i32);
            let (x, y) = place((c.x as i32, c.y as i32), size, area);
            let _ = w.set_position(PhysicalPosition::new(x, y));
        }
    }
    let _ = w.emit("quick-open", ());
    let _ = w.show();
    let _ = w.set_focus();
}

/// The settings panel, open on one of its tabs (her quick menu's "Comandos" and "Más ajustes…").
#[tauri::command]
pub fn open_panel(tab: String, app: AppHandle) {
    if let Some(w) = app.get_webview_window("settings") {
        let _ = w.emit("panel-tab", tab);
        show_panel(&w);
    }
}

pub fn build(app: &AppHandle) -> tauri::Result<()> {
    let cfg = user_config::load().avatar;
    app.manage(States(Mutex::new(HashMap::from([
        ("claude", true),
        ("dnd", false),
        ("voz", false),
        ("hablar", true), // the backend sends Mode when it is off
        ("camera", cfg.camara),
        ("style", cfg.estilo == "pixel"),
        ("deambular", cfg.deambular),
        ("poseer_ventanas", cfg.poseer_ventanas),
        ("reaccionar_pc", cfg.reaccionar_pc),
        ("seguir_pantallas", cfg.seguir_pantallas),
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

    let quick = WebviewWindowBuilder::new(app, "quick", WebviewUrl::App("quick.html".into()))
        .title("Capri")
        .inner_size(QUICK.0, QUICK.1)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .resizable(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .visible(false)
        .build()?;
    let hide_quick = quick.clone();
    quick.on_window_event(move |e| {
        if let WindowEvent::Focused(false) = e {
            let _ = hide_quick.hide();
        }
    });

    WebviewWindowBuilder::new(app, "setup", WebviewUrl::App("setup.html".into()))
        .title("Capri · primer arranque")
        .inner_size(SETUP.0, SETUP.1)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .resizable(false)
        .always_on_top(true)
        .visible(false)
        .build()?;
    if !user_config::load().inicio.listo {
        show_setup(app);
    }

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

#[cfg(test)]
mod tests {
    use super::{allowed, place};

    #[test]
    fn the_wizard_opens_only_its_own_pages() {
        assert!(allowed("https://ollama.com/download"));
        assert!(allowed("https://developer.spotify.com/dashboard"));
        assert!(!allowed("https://ollama.com/download?x=1"));
        assert!(!allowed("file:///C:/Windows/System32/calc.exe"));
        assert!(!allowed("https://evil.example"));
    }

    const AREA: (i32, i32, i32, i32) = (0, 0, 1920, 1032);

    #[test]
    fn the_quick_menu_opens_by_the_pointer_and_never_off_screen() {
        assert_eq!(place((500, 400), (268, 404), AREA), (500, 400)); // right and below
        assert_eq!(place((1800, 400), (268, 404), AREA), (1532, 400)); // no room on the right: to its left
        assert_eq!(place((500, 900), (268, 404), AREA), (500, 496)); // near the taskbar: above
        assert_eq!(place((100, 100), (268, 404), (0, 0, 200, 300)), (0, 0)); // a tiny screen: its corner
        assert_eq!(place((2500, 300), (268, 404), (1920, 0, 1920, 1032)), (2500, 300)); // a second monitor
    }
}
