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
}

impl Default for Avatar {
    fn default() -> Self {
        Self { deambular: true, poseer_ventanas: true, estilo: "original".into() }
    }
}

#[derive(Deserialize)]
#[serde(default)]
pub struct Shortcuts {
    pub escribir: String,
    pub teletransporte: String,
    pub mirar: String,
    pub no_molestar: String,
    pub estilo: String,
}

impl Default for Shortcuts {
    fn default() -> Self {
        Self {
            escribir: "Ctrl+Alt+Space".into(),
            teletransporte: "Ctrl+Alt+T".into(),
            mirar: "Ctrl+Alt+Shift+M".into(),
            no_molestar: "Ctrl+Alt+Shift+D".into(),
            estilo: "Ctrl+Alt+Shift+P".into(),
        }
    }
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

/// Saves the style picked with the shortcut, keeping the rest of the file (comments too) as it is.
fn save_style_in(text: &str, estilo: &str) -> Result<String, String> {
    let mut doc = text.parse::<toml_edit::DocumentMut>().map_err(|e| e.to_string())?;
    if !doc.contains_table("avatar") {
        doc["avatar"] = toml_edit::table();
    }
    doc["avatar"]["estilo"] = toml_edit::value(estilo);
    Ok(doc.to_string())
}

#[tauri::command]
pub fn save_style(estilo: String) -> Result<(), String> {
    if estilo != "original" && estilo != "pixel" {
        return Err(format!("unknown style {estilo:?}"));
    }
    let p = path();
    let text = std::fs::read_to_string(&p).unwrap_or_default();
    if let Some(dir) = p.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    std::fs::write(&p, save_style_in(&text, &estilo)?).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tauri_plugin_global_shortcut::Shortcut;

    #[test]
    fn default_shortcuts_parse_and_missing_keys_default() {
        let keys = Shortcuts::default();
        for s in [keys.escribir, keys.teletransporte, keys.mirar, keys.no_molestar, keys.estilo] {
            s.parse::<Shortcut>().unwrap_or_else(|e| panic!("{s}: {e}"));
        }
        let partial: UserConfig = toml::from_str("[avatar]\nposeer_ventanas = false\n").unwrap();
        assert!(partial.avatar.deambular && !partial.avatar.poseer_ventanas);
        assert_eq!(partial.atajos.escribir, "Ctrl+Alt+Space");
        assert_eq!(partial.avatar.estilo, "original");
    }

    #[test]
    fn saving_the_style_keeps_comments_and_other_keys() {
        let text = "# mine
[avatar]
deambular = false  # quiet

[atajos]
mirar = \"Ctrl+M\"
";
        let out = save_style_in(text, "pixel").unwrap();
        assert!(out.contains("# mine") && out.contains("deambular = false  # quiet") && out.contains("mirar = \"Ctrl+M\""));
        let read: UserConfig = toml::from_str(&out).unwrap();
        assert_eq!(read.avatar.estilo, "pixel");
        assert!(!read.avatar.deambular);
        let fresh: UserConfig = toml::from_str(&save_style_in("", "original").unwrap()).unwrap();
        assert_eq!(fresh.avatar.estilo, "original");
    }
}
