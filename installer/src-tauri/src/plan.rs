//! What installing (and uninstalling) Capri takes, as plain data: the tasks for the options he picked, the commands
//! each runs, the shortcuts and the uninstall entry. No side effects here; lib.rs runs them.

use std::path::{Path, PathBuf};

pub const KOKORO: [&str; 2] = [
    "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx",
    "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin",
];
pub const OLLAMA: &str = "https://ollama.com/download/OllamaSetup.exe";
pub const QWEN_MODELS: [&str; 2] = ["Qwen/Qwen3-TTS-12Hz-0.6B-Base", "Qwen/Qwen3-TTS-Tokenizer-12Hz"];
pub const QWEN_GPU_MB: u32 = 6000;
pub const UNINSTALL_KEY: &str = r"HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\Capri";
pub const UNINSTALLER: &str = "Desinstalar Capri.exe";

#[derive(Clone, Debug, serde::Deserialize)]
pub struct Options {
    pub dir: PathBuf,
    pub inicio: bool,     // Start menu shortcut
    pub escritorio: bool, // desktop shortcut
    pub arranque: bool,   // starts with Windows
    pub ollama: bool,     // install Ollama (when it's missing)
    pub voz: bool,        // her cloned voice (NVIDIA, 6 GB or more)
}

#[derive(Clone, Copy, Debug, PartialEq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Task {
    Copiar,
    Python,
    Voces,
    Ollama,
    Clonada,
    Accesos,
    Registro,
}

/// The tasks for these options, in order. Ollama and her clone only if asked (and possible: lib.rs checks).
pub fn tasks(o: &Options) -> Vec<Task> {
    let mut t = vec![Task::Copiar, Task::Python, Task::Voces];
    if o.ollama {
        t.push(Task::Ollama);
    }
    if o.voz {
        t.push(Task::Clonada);
    }
    t.extend([Task::Accesos, Task::Registro]);
    t
}

/// Where she may be installed: an absolute folder of its own, never a drive's root or Windows' own folders.
pub fn valid_dir(dir: &Path) -> Result<(), String> {
    let s = dir.to_string_lossy().to_lowercase().replace('/', "\\");
    if !dir.is_absolute() || dir.parent().is_none() || dir.components().count() < 3 {
        return Err("Elige una carpeta propia, por ejemplo C:\\Users\\tú\\AppData\\Local\\Programs\\Capri".into());
    }
    if ["\\windows", "\\program files", "\\programdata"].iter().any(|w| s.contains(w)) {
        return Err("Esa carpeta es de Windows o pide permisos de administrador: elige otra".into());
    }
    Ok(())
}

/// Her models: %LOCALAPPDATA%\Capri\modelos (the backend's default, settings.models_dir).
pub fn models(local_app_data: &Path) -> PathBuf {
    local_app_data.join("Capri").join("modelos")
}

pub struct Cmd {
    pub program: PathBuf,
    pub args: Vec<String>,
    pub cwd: Option<PathBuf>,
    pub env: Vec<(String, String)>,
}

/// Python and the backend's packages, exactly as locked; Python itself goes inside her folder.
pub fn uv_sync(dir: &Path) -> Cmd {
    Cmd {
        program: dir.join("uv.exe"),
        args: vec!["sync".into(), "--frozen".into(), "--no-dev".into(), "--python".into(), "3.12".into()],
        cwd: Some(dir.join("backend")),
        env: uv_env(dir),
    }
}

fn uv_env(dir: &Path) -> Vec<(String, String)> {
    vec![
        ("UV_PYTHON_INSTALL_DIR".into(), dir.join("python").to_string_lossy().into()),
        ("UV_PYTHON_PREFERENCE".into(), "only-managed".into()), // never whatever Python the PC has
        ("UV_NO_PROGRESS".into(), "1".into()),
    ]
}

/// Her cloned voice: its own Python with PyTorch for CUDA 12.8, faster-qwen3-tts, and the models.
pub fn qwen(dir: &Path, models: &Path) -> Vec<Cmd> {
    let root = models.join("tts").join("qwen");
    let py = root.join("env").join("Scripts").join("python.exe");
    let uv = dir.join("uv.exe");
    let pip = |args: &[&str]| Cmd {
        program: uv.clone(),
        args: ["pip", "install", "--python", &py.to_string_lossy()].iter().chain(args).map(|s| s.to_string()).collect(),
        cwd: None,
        env: uv_env(dir),
    };
    let fetch = QWEN_MODELS
        .iter()
        .map(|m| format!("d({m:?}, local_dir={:?})", root.join(m.split('/').next_back().unwrap()).to_string_lossy()))
        .collect::<Vec<_>>()
        .join("; ");
    vec![
        Cmd {
            program: uv.clone(),
            args: vec!["venv".into(), "--python".into(), "3.12".into(), root.join("env").to_string_lossy().into()],
            cwd: None,
            env: uv_env(dir),
        },
        pip(&["torch", "--index-url", "https://download.pytorch.org/whl/cu128"]),
        pip(&["faster-qwen3-tts==0.5.4", "transformers==5.15.1"]),
        Cmd {
            program: py.clone(),
            args: vec!["-c".into(), format!("from huggingface_hub import snapshot_download as d; {fetch}")],
            cwd: None,
            env: vec![],
        },
    ]
}

/// A PowerShell line that makes a shortcut (WScript.Shell), each path quoted for PowerShell.
pub fn shortcut(lnk: &Path, target: &Path, icon: &Path) -> String {
    let q = |p: &Path| format!("'{}'", p.to_string_lossy().replace('\'', "''"));
    format!(
        "$s = (New-Object -ComObject WScript.Shell).CreateShortcut({}); $s.TargetPath = {}; $s.WorkingDirectory = {}; \
         $s.IconLocation = {}; $s.Description = 'Capri'; $s.Save()",
        q(lnk),
        q(target),
        q(target.parent().unwrap_or(target)),
        q(icon)
    )
}

/// The "Add or remove programs" entry: (value, type, data).
pub fn uninstall_entry(dir: &Path, version: &str, size_mb: u64) -> Vec<(&'static str, &'static str, String)> {
    let exe = dir.join(UNINSTALLER);
    vec![
        ("DisplayName", "REG_SZ", "Capri".into()),
        ("DisplayVersion", "REG_SZ", version.into()),
        ("Publisher", "REG_SZ", "Capri".into()),
        ("DisplayIcon", "REG_SZ", dir.join("avatar.exe").to_string_lossy().into()),
        ("InstallLocation", "REG_SZ", dir.to_string_lossy().into()),
        ("UninstallString", "REG_SZ", format!("\"{}\" --uninstall", exe.to_string_lossy())),
        ("EstimatedSize", "REG_DWORD", (size_mb * 1024).to_string()),
        ("NoModify", "REG_DWORD", "1".into()),
        ("NoRepair", "REG_DWORD", "1".into()),
    ]
}

/// Whether a shortcut's target is inside her folder (Windows paths: any case, either slash).
pub fn points_into(target: &str, dir: &Path) -> bool {
    let norm = |s: &str| s.to_lowercase().replace('/', "\\").trim_end_matches('\\').to_string();
    let (t, d) = (norm(target), norm(&dir.to_string_lossy()));
    !d.is_empty() && t.starts_with(&format!("{d}\\"))
}

/// What a password manager keeps for her (keyring's targets): the keys of app/llm/providers.py, app/steam.py and
/// app/cloudvoice.py.
pub const KEY_TARGETS: [&str; 12] = [
    "capri",
    "anthropic@capri",
    "openai@capri",
    "gemini@capri",
    "openrouter@capri",
    "groq@capri",
    "mistral@capri",
    "deepseek@capri",
    "xai@capri",
    "steam@capri",
    "fish@capri",
    "elevenlabs@capri",
];

#[cfg(test)]
mod tests {
    use super::*;

    fn opts(ollama: bool, voz: bool) -> Options {
        Options { dir: PathBuf::from(r"C:\Users\ana\AppData\Local\Programs\Capri"), inicio: true, escritorio: true, arranque: false, ollama, voz }
    }

    #[test]
    fn it_removes_her_voice_and_steam_keys_too() {
        for t in ["steam@capri", "fish@capri", "elevenlabs@capri", "openai@capri"] {
            assert!(KEY_TARGETS.contains(&t), "{t}");
        }
    }

    #[test]
    fn only_the_tasks_he_picked() {
        use Task::*;
        assert_eq!(tasks(&opts(false, false)), [Copiar, Python, Voces, Accesos, Registro]);
        assert_eq!(tasks(&opts(true, true)), [Copiar, Python, Voces, Ollama, Clonada, Accesos, Registro]);
    }

    #[test]
    fn a_folder_of_its_own_never_windows_or_a_drive() {
        assert!(valid_dir(Path::new(r"C:\Users\ana\AppData\Local\Programs\Capri")).is_ok());
        assert!(valid_dir(Path::new(r"D:\Apps\Capri")).is_ok());
        assert!(valid_dir(Path::new(r"C:\")).is_err());
        assert!(valid_dir(Path::new(r"Capri")).is_err());
        assert!(valid_dir(Path::new(r"C:\Windows\Capri")).is_err());
        assert!(valid_dir(Path::new(r"C:\Program Files\Capri")).is_err()); // asks for admin
    }

    #[test]
    fn python_and_its_packages_as_locked_inside_her_folder() {
        let dir = Path::new(r"C:\Capri\app");
        let c = uv_sync(dir);
        assert_eq!(c.program, dir.join("uv.exe"));
        assert!(c.args.contains(&"--frozen".to_string()) && c.args.contains(&"--no-dev".to_string()));
        assert_eq!(c.cwd.as_deref(), Some(dir.join("backend").as_path()));
        assert!(c.env.contains(&("UV_PYTHON_INSTALL_DIR".into(), r"C:\Capri\app\python".into())));
    }

    #[test]
    fn her_clone_gets_cuda_pytorch_the_pinned_packages_and_both_models() {
        let cmds = qwen(Path::new(r"C:\Capri\app"), Path::new(r"C:\Users\ana\AppData\Local\Capri\modelos"));
        let all: Vec<String> = cmds.iter().map(|c| c.args.join(" ")).collect();
        assert!(all[0].starts_with("venv --python 3.12") && all[0].ends_with(r"tts\qwen\env"));
        assert!(all[1].contains("torch --index-url https://download.pytorch.org/whl/cu128"));
        assert!(all[2].contains("faster-qwen3-tts==0.5.4 transformers==5.15.1"));
        assert!(all[3].contains("Qwen/Qwen3-TTS-12Hz-0.6B-Base") && all[3].contains(r"qwen\\Qwen3-TTS-Tokenizer-12Hz"));
        assert!(cmds[3].program.ends_with(r"env\Scripts\python.exe"));
    }

    #[test]
    fn a_shortcut_survives_a_quote_in_the_path() {
        let s = shortcut(Path::new(r"C:\Users\O'Neil\Desktop\Capri.lnk"), Path::new(r"C:\Users\O'Neil\Capri\avatar.exe"), Path::new(r"C:\x.ico"));
        assert!(s.contains(r"'C:\Users\O''Neil\Desktop\Capri.lnk'") && s.contains(r"'C:\Users\O''Neil\Capri'"));
    }

    #[test]
    fn only_shortcuts_into_her_folder_are_hers() {
        let dir = Path::new(r"C:\Users\ana\AppData\Local\Programs\Capri");
        assert!(points_into(r"C:\Users\ana\AppData\Local\Programs\Capri\avatar.exe", dir));
        assert!(points_into(r"c:/users/ana/appdata/local/programs/capri/avatar.exe", dir));
        assert!(!points_into(r"C:\Users\ana\Documents\code\capri\avatar\src-tauri\target\release\avatar.exe", dir));
        assert!(!points_into(r"C:\Users\ana\AppData\Local\Programs\Capri2\avatar.exe", dir)); // a sibling folder
        assert!(!points_into("", dir));
    }

    #[test]
    fn the_uninstall_entry_points_at_its_uninstaller() {
        let e = uninstall_entry(Path::new(r"C:\Capri"), "0.1.0", 2500);
        let get = |k: &str| e.iter().find(|(n, _, _)| *n == k).unwrap().2.clone();
        assert_eq!(get("UninstallString"), "\"C:\\Capri\\Desinstalar Capri.exe\" --uninstall");
        assert_eq!(get("EstimatedSize"), "2560000");
        assert_eq!(get("DisplayName"), "Capri");
    }
}
