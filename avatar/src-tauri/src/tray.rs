//! Her tray icon: left click opens the input bar; the menu closes her and flips what you would
//! otherwise reach by shortcut or by editing config.toml. Most items just emit the event the
//! shortcut emits; the two plain config.toml keys are written here. Items that someone else owns
//! (the backend's modes, the frontend's camera and style) get their tick back through `tray_check`.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;

use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, Wry};

use crate::{ollama, user_config};

/// The ticked items by id, so the frontend can correct them when a mode changes by other means.
pub struct Checks(Mutex<HashMap<&'static str, CheckMenuItem<Wry>>>);

#[tauri::command]
pub fn tray_check(name: String, on: bool, checks: tauri::State<Checks>) {
    if let Some(item) = checks.0.lock().unwrap().get(name.as_str()) {
        let _ = item.set_checked(on);
    }
}

/// Keyboard focus for the input bar (the bar itself becomes clickable once the frontend reports its box).
pub fn focus_input(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.set_focus();
    }
    let _ = app.emit("open-input", ());
}

pub fn build(app: &AppHandle) -> tauri::Result<()> {
    let cfg = user_config::load().avatar;
    let mut checks = HashMap::new();
    let mut tick = |id: &'static str, label: &str, on: bool| -> tauri::Result<CheckMenuItem<Wry>> {
        let item = CheckMenuItem::with_id(app, id, label, true, on, None::<&str>)?;
        checks.insert(id, item.clone());
        Ok(item)
    };
    let (claude, dnd) = (tick("claude", "Modo Claude", true)?, tick("dnd", "No molestar", false)?);
    let (camera, style) = (tick("camera", "Modo cámara", cfg.camara)?, tick("style", "Estilo pixel", cfg.estilo == "pixel")?);
    let (roam, possess) = (tick("deambular", "Deambular", cfg.deambular)?, tick("poseer_ventanas", "Poseer ventanas", cfg.poseer_ventanas)?);
    let write = MenuItem::with_id(app, "open-input", "Escribirle", true, None::<&str>)?;
    let hide = MenuItem::with_id(app, "hide", "Esconderse / volver", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Cerrar Capri", true, None::<&str>)?;
    let quit_ollama = MenuItem::with_id(app, "quit-ollama", "Cerrar Capri y Ollama", true, None::<&str>)?;
    let line = || PredefinedMenuItem::separator(app);
    let menu = Menu::with_items(
        app,
        &[&write, &hide, &line()?, &claude, &dnd, &camera, &style, &roam, &possess, &line()?, &quit, &quit_ollama],
    )?;
    app.manage(Checks(Mutex::new(checks)));

    TrayIconBuilder::with_id("capri")
        .icon(app.default_window_icon().expect("the app has an icon").clone())
        .tooltip("Capri")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                focus_input(tray.app_handle());
            }
        })
        .on_menu_event(|app, event| match event.id().as_ref() {
            "open-input" => focus_input(app),
            id @ ("deambular" | "poseer_ventanas") => {
                // the click already flipped the tick; the frontend reads the key the next time she wanders
                let on = app.state::<Checks>().0.lock().unwrap().get(id).and_then(|i| i.is_checked().ok()).unwrap_or(true);
                if let Err(e) = user_config::save(id, toml_edit::value(on)) {
                    eprintln!("could not save {id}: {e}");
                }
            }
            id @ ("quit" | "quit-ollama") => {
                // she vanishes first, but a stuck page must not keep her from closing
                let with_ollama = id == "quit-ollama";
                let _ = app.emit("quit", with_ollama);
                let app = app.clone();
                std::thread::spawn(move || {
                    std::thread::sleep(Duration::from_millis(2500));
                    ollama::quit(with_ollama, app);
                });
            }
            id => {
                let _ = app.emit(id, ());
            }
        })
        .build(app)?;
    Ok(())
}
