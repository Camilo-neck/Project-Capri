//! The parts of the user's config.toml (%APPDATA%\Capri, created by the backend) that the app
//! itself uses: avatar behavior and global shortcuts. Missing file or keys fall back to defaults.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};

#[derive(Deserialize, Default)]
#[serde(default)]
pub struct UserConfig {
    pub avatar: Avatar,
    pub atajos: Shortcuts,
}

#[derive(Deserialize, Serialize, Clone)]
#[serde(default)]
pub struct Avatar {
    pub deambular: bool,
    pub poseer_ventanas: bool,
    /// "original" (the show's art) or "pixel" (the PixelLab pet).
    pub estilo: String,
    /// Minutes without using the PC or talking to her before she sleeps down to her mask; 0 = never.
    pub dormir_min: u32,
    /// Camera mode: her close-ups from the show in a transmission frame instead of her whole body.
    pub camara: bool,
    /// She reacts to the PC: processor, charger, battery, network, USB sticks, devices, games (the backend reads it).
    pub reaccionar_pc: bool,
    /// With several screens, she follows the pointer to the one it stays on.
    pub seguir_pantallas: bool,
}

impl Default for Avatar {
    fn default() -> Self {
        Self { deambular: true, poseer_ventanas: true, estilo: "original".into(), dormir_min: 20, camara: false, reaccionar_pc: true, seguir_pantallas: true }
    }
}

/// One rule: Ctrl+Alt to talk to her (write, listen), Ctrl+Alt+Shift for everything else.
#[derive(Deserialize, Serialize, Clone)]
#[serde(default)]
pub struct Shortcuts {
    pub escribir: String,
    pub escuchar: String,
    pub mirar: String,
    pub no_molestar: String,
    /// Goes round her looks: Original, Pixel art, Camera. (Was `estilo`; the camera's own key is gone.)
    #[serde(alias = "estilo")]
    pub apariencia: String,
    pub teletransporte: String,
}

impl Default for Shortcuts {
    fn default() -> Self {
        Self {
            escribir: "Ctrl+Alt+Space".into(),
            escuchar: "Ctrl+Alt+V".into(),
            mirar: "Ctrl+Alt+Shift+M".into(),
            no_molestar: "Ctrl+Alt+Shift+D".into(),
            apariencia: "Ctrl+Alt+Shift+A".into(),
            teletransporte: "Ctrl+Alt+Shift+T".into(),
        }
    }
}

impl Shortcuts {
    /// (what it does, its keys, the event it emits), in the order the panel lists them.
    pub fn all(&self) -> [(&'static str, &str, &'static str); 6] {
        [
            ("Escribirle", &self.escribir, "open-input"),
            ("Escuchar (la siguiente frase es para ella; si habla, la corta)", &self.escuchar, "listen"),
            ("Mirar la pantalla", &self.mirar, "look"),
            ("No molestar", &self.no_molestar, "dnd"),
            ("Apariencia: Original, Pixel art, Cámara", &self.apariencia, "style"),
            ("Traerla (o despertarla, o que vuelva)", &self.teletransporte, "teleport"),
        ]
    }
}

/// The shortcuts in use, for the panel's command list.
#[tauri::command]
pub fn shortcuts() -> Vec<(String, String)> {
    load().atajos.all().iter().map(|(what, keys, _)| (what.to_string(), keys.to_string())).collect()
}

/// Same rule as the backend's settings.path(): CAPRI_CONFIG, else %APPDATA%\Capri\config.toml.
fn path() -> PathBuf {
    std::env::var_os("CAPRI_CONFIG").map(PathBuf::from).unwrap_or_else(|| {
        PathBuf::from(std::env::var_os("APPDATA").unwrap_or_default()).join("Capri").join("config.toml")
    })
}

pub fn load() -> UserConfig {
    let Ok(text) = std::fs::read_to_string(path()) else { return UserConfig::default() };
    toml::from_str(&text).unwrap_or_else(|e| {
        eprintln!("config.toml not valid, using defaults: {e}");
        UserConfig::default()
    })
}

/// Read on every call, so edits apply the next time she wanders.
#[tauri::command]
pub fn avatar_settings() -> Avatar {
    load().avatar
}

/// Sets one [avatar] key, keeping the rest of the file (comments too) as it is.
fn set_in(text: &str, key: &str, value: toml_edit::Item) -> Result<String, String> {
    let mut doc = text.parse::<toml_edit::DocumentMut>().map_err(|e| e.to_string())?;
    if !doc.contains_table("avatar") {
        doc["avatar"] = toml_edit::table();
    }
    doc["avatar"][key] = value;
    Ok(doc.to_string())
}

pub fn save(key: &str, value: toml_edit::Item) -> Result<(), String> {
    let p = path();
    let text = std::fs::read_to_string(&p).unwrap_or_default();
    if let Some(dir) = p.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    std::fs::write(&p, set_in(&text, key, value)?).map_err(|e| e.to_string())
}

/// The style picked with its shortcut, for next time.
#[tauri::command]
pub fn save_style(estilo: String) -> Result<(), String> {
    if estilo != "original" && estilo != "pixel" {
        return Err(format!("unknown style {estilo:?}"));
    }
    save("estilo", toml_edit::value(estilo))
}

/// Camera mode on or off (its shortcut), for next time.
#[tauri::command]
pub fn save_camera(on: bool) -> Result<(), String> {
    save("camara", toml_edit::value(on))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tauri_plugin_global_shortcut::Shortcut;

    #[test]
    fn default_shortcuts_parse_and_missing_keys_default() {
        let keys = Shortcuts::default();
        for (_, s, _) in keys.all() {
            s.parse::<Shortcut>().unwrap_or_else(|e| panic!("{s}: {e}"));
        }
        let old: UserConfig = toml::from_str("[atajos]
estilo = \"Ctrl+Alt+P\"
camara = \"Ctrl+Alt+C\"
").unwrap();
        assert_eq!(old.atajos.apariencia, "Ctrl+Alt+P"); // an older config still works
        let partial: UserConfig = toml::from_str("[avatar]\nposeer_ventanas = false\n").unwrap();
        assert!(partial.avatar.deambular && !partial.avatar.poseer_ventanas);
        assert_eq!(partial.atajos.escribir, "Ctrl+Alt+Space");
        assert_eq!(partial.avatar.estilo, "original");
        assert_eq!(partial.avatar.dormir_min, 20);
    }

    #[test]
    fn saving_the_style_keeps_comments_and_other_keys() {
        let text = "# mine
[avatar]
deambular = false  # quiet

[atajos]
mirar = \"Ctrl+M\"
";
        let out = set_in(&set_in(text, "estilo", toml_edit::value("pixel")).unwrap(), "camara", toml_edit::value(true)).unwrap();
        assert!(out.contains("# mine") && out.contains("deambular = false  # quiet") && out.contains("mirar = \"Ctrl+M\""));
        let read: UserConfig = toml::from_str(&out).unwrap();
        assert_eq!(read.avatar.estilo, "pixel");
        assert!(!read.avatar.deambular && read.avatar.camara);
        let fresh: UserConfig = toml::from_str(&set_in("", "estilo", toml_edit::value("original")).unwrap()).unwrap();
        assert_eq!(fresh.avatar.estilo, "original");
    }
}
