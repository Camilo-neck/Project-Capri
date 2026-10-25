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
}

impl Default for Avatar {
    fn default() -> Self {
        Self { deambular: true, poseer_ventanas: true }
    }
}

#[derive(Deserialize)]
#[serde(default)]
pub struct Shortcuts {
    pub escribir: String,
    pub teletransporte: String,
    pub mirar: String,
    pub no_molestar: String,
}

impl Default for Shortcuts {
    fn default() -> Self {
        Self {
            escribir: "Ctrl+Alt+Space".into(),
            teletransporte: "Ctrl+Alt+T".into(),
            mirar: "Ctrl+Alt+Shift+M".into(),
            no_molestar: "Ctrl+Alt+Shift+D".into(),
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

#[cfg(test)]
mod tests {
    use super::*;
    use tauri_plugin_global_shortcut::Shortcut;

    #[test]
    fn default_shortcuts_parse_and_missing_keys_default() {
        let keys = Shortcuts::default();
        for s in [keys.escribir, keys.teletransporte, keys.mirar, keys.no_molestar] {
            s.parse::<Shortcut>().unwrap_or_else(|e| panic!("{s}: {e}"));
        }
        let partial: UserConfig = toml::from_str("[avatar]\nposeer_ventanas = false\n").unwrap();
        assert!(partial.avatar.deambular && !partial.avatar.poseer_ventanas);
        assert_eq!(partial.atajos.escribir, "Ctrl+Alt+Space");
    }
}
