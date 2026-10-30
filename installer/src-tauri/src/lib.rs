//! Capri's installer (and uninstaller, the same exe run with --uninstall). The app, her backend's code, uv and her
//! voice files ride inside it (payload.zip, scripts/build_installer.ps1 makes it); Python and its packages, Kokoro,
//! Ollama and her cloned voice are downloaded while it installs. Only Windows' own tools do the work (tar, curl,
//! reg, PowerShell), each step reported to the page as it goes.

mod plan;

use std::io::{BufRead, BufReader};
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::Duration;

use plan::{Options, Task};
use serde::Serialize;
use tauri::{AppHandle, Emitter};

const NO_WINDOW: u32 = 0x0800_0000;
static PAYLOAD: &[u8] = include_bytes!(concat!(env!("CARGO_MANIFEST_DIR"), "/payload.zip"));

fn env_dir(name: &str) -> PathBuf {
    PathBuf::from(std::env::var_os(name).unwrap_or_default())
}

fn quiet(program: impl AsRef<std::ffi::OsStr>) -> Command {
    let mut c = Command::new(program);
    c.creation_flags(NO_WINDOW);
    c
}

fn powershell(script: &str) -> Result<String, String> {
    let out = quiet("powershell.exe").args(["-NoProfile", "-NonInteractive", "-Command", script]).output().map_err(|e| e.to_string())?;
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).trim().chars().take(300).collect())
    }
}

// ---- what this PC has ----

#[derive(Serialize)]
struct Info {
    modo: &'static str, // "install" | "uninstall"
    dir: String,
    gpu: String,
    vram_mb: u32,
    clonada: bool, // room for her cloned voice (an NVIDIA with 6 GB or more)
    ollama: bool,
    libre_gb: f64,
    version: &'static str,
    instalada: Option<String>, // where an earlier Capri is
    payload: bool,             // built with the app inside (a dev build isn't)
}

fn nvidia() -> (String, u32) {
    let Ok(out) = quiet("nvidia-smi").args(["--query-gpu=name,memory.total", "--format=csv,noheader,nounits"]).output() else {
        return (String::new(), 0);
    };
    let text = String::from_utf8_lossy(&out.stdout);
    let Some((name, mb)) = text.lines().next().and_then(|l| l.rsplit_once(',')) else { return (String::new(), 0) };
    (name.trim().to_string(), mb.trim().parse().unwrap_or(0))
}

fn ollama_installed() -> bool {
    env_dir("LOCALAPPDATA").join(r"Programs\Ollama\ollama.exe").exists()
        || quiet("where").arg("ollama").output().is_ok_and(|o| o.status.success())
}

fn installed_dir() -> Option<String> {
    let out = quiet("reg").args(["query", plan::UNINSTALL_KEY, "/v", "InstallLocation"]).output().ok()?;
    let text = String::from_utf8_lossy(&out.stdout);
    text.lines().find(|l| l.contains("InstallLocation")).and_then(|l| l.split("REG_SZ").nth(1)).map(|s| s.trim().to_string())
}

fn free_gb(dir: &Path) -> f64 {
    let at = dir.ancestors().find(|p| p.exists()).unwrap_or(Path::new("C:\\"));
    let drive = at.to_string_lossy().chars().next().unwrap_or('C');
    powershell(&format!("(Get-PSDrive {drive}).Free")).ok().and_then(|s| s.parse::<f64>().ok()).map(|b| (b / 1e9 * 10.0).round() / 10.0).unwrap_or(0.0)
}

/// Run as the uninstaller: with --uninstall (Windows' entry), or simply by being the copy named like it (a double click).
fn uninstalling() -> bool {
    std::env::args().any(|a| a == "--uninstall") || std::env::current_exe().is_ok_and(|e| e.file_name().is_some_and(|n| n == plan::UNINSTALLER))
}

#[tauri::command]
fn info() -> Info {
    let (gpu, vram_mb) = nvidia();
    let instalada = installed_dir();
    let dir = arg("--dir").or_else(|| instalada.clone()).unwrap_or_else(|| env_dir("LOCALAPPDATA").join(r"Programs\Capri").to_string_lossy().into());
    Info {
        modo: if uninstalling() { "uninstall" } else { "install" },
        libre_gb: free_gb(Path::new(&dir)),
        dir,
        clonada: vram_mb >= plan::QWEN_GPU_MB,
        gpu,
        vram_mb,
        ollama: ollama_installed(),
        version: env!("CARGO_PKG_VERSION"),
        instalada,
        payload: !PAYLOAD.is_empty(),
    }
}

fn arg(name: &str) -> Option<String> {
    let args: Vec<String> = std::env::args().collect();
    args.iter().position(|a| a == name).and_then(|i| args.get(i + 1).cloned())
}

// ---- running things, line by line to the page ----

#[derive(Clone, Serialize)]
struct Step {
    tarea: String,
    estado: &'static str, // activa | hecha | fallo | omitida
    detalle: String,
}

fn step(app: &AppHandle, tarea: &str, estado: &'static str, detalle: impl Into<String>) {
    let _ = app.emit("step", Step { tarea: tarea.into(), estado, detalle: detalle.into() });
}

fn log(app: &AppHandle, line: impl Into<String>) {
    let _ = app.emit("log", line.into());
}

fn exec(app: &AppHandle, cmd: &plan::Cmd) -> Result<(), String> {
    let mut c = quiet(&cmd.program);
    c.args(&cmd.args).stdout(Stdio::piped()).stderr(Stdio::piped()).stdin(Stdio::null());
    if let Some(cwd) = &cmd.cwd {
        c.current_dir(cwd);
    }
    for (k, v) in &cmd.env {
        c.env(k, v);
    }
    log(app, format!("> {} {}", cmd.program.file_name().unwrap_or_default().to_string_lossy(), cmd.args.join(" ")));
    let mut child = c.spawn().map_err(|e| format!("no pude ejecutar {}: {e}", cmd.program.display()))?;
    let pipes = [child.stdout.take().map(|p| Box::new(p) as Box<dyn std::io::Read + Send>), child.stderr.take().map(|p| Box::new(p) as _)];
    let readers: Vec<_> = pipes
        .into_iter()
        .flatten()
        .map(|p| {
            let app = app.clone();
            std::thread::spawn(move || BufReader::new(p).lines().map_while(Result::ok).for_each(|l| log(&app, l)))
        })
        .collect();
    let status = child.wait().map_err(|e| e.to_string())?;
    readers.into_iter().for_each(|r| drop(r.join()));
    if status.success() { Ok(()) } else { Err(format!("terminó con código {}", status.code().unwrap_or(-1))) }
}

/// Downloads with Windows' curl, showing how much came in so far; the file only appears once whole.
fn download(app: &AppHandle, url: &str, to: &Path) -> Result<(), String> {
    if to.exists() {
        return Ok(());
    }
    std::fs::create_dir_all(to.parent().unwrap()).map_err(|e| e.to_string())?;
    let part = to.with_extension("part");
    let name = to.file_name().unwrap_or_default().to_string_lossy().to_string();
    let mut child = quiet("curl.exe").args(["-L", "--fail", "-s", "-o"]).arg(&part).arg(url).spawn().map_err(|e| e.to_string())?;
    let status = loop {
        if let Some(s) = child.try_wait().map_err(|e| e.to_string())? {
            break s;
        }
        let mb = std::fs::metadata(&part).map(|m| m.len() / 1_000_000).unwrap_or(0);
        log(app, format!("  {name}: {mb} MB"));
        std::thread::sleep(Duration::from_secs(2));
    };
    if !status.success() {
        let _ = std::fs::remove_file(&part);
        return Err(format!("no se pudo descargar {name}"));
    }
    std::fs::rename(&part, to).map_err(|e| e.to_string())
}

// ---- installing ----

#[derive(Serialize, Clone)]
struct Done {
    ok: bool,
    error: String,
    avisos: Vec<String>,
}

#[tauri::command]
fn install(opts: Options, app: AppHandle) -> Result<(), String> {
    plan::valid_dir(&opts.dir)?;
    if PAYLOAD.is_empty() {
        return Err("Este instalador se compiló sin la app dentro (usa scripts/build_installer.ps1)".into());
    }
    std::thread::spawn(move || {
        let mut avisos = vec![];
        for task in plan::tasks(&opts) {
            let name = serde_json::to_value(task).unwrap().as_str().unwrap().to_string();
            step(&app, &name, "activa", "");
            match do_task(&app, task, &opts) {
                Ok(note) => step(&app, &name, "hecha", note),
                Err(e) if matches!(task, Task::Copiar | Task::Python) => {
                    step(&app, &name, "fallo", e.clone());
                    let _ = app.emit("done", Done { ok: false, error: e, avisos });
                    return;
                }
                Err(e) => {
                    step(&app, &name, "fallo", e.clone());
                    avisos.push(format!("{name}: {e}"));
                }
            }
        }
        let _ = app.emit("done", Done { ok: true, error: String::new(), avisos });
    });
    Ok(())
}

fn do_task(app: &AppHandle, task: Task, o: &Options) -> Result<String, String> {
    let dir = &o.dir;
    let models = plan::models(&env_dir("LOCALAPPDATA"));
    match task {
        Task::Copiar => {
            let _ = quiet("taskkill").args(["/IM", "avatar.exe", "/F"]).output(); // an update: the running one goes first
            std::thread::sleep(Duration::from_millis(800));
            std::fs::create_dir_all(dir).map_err(|e| format!("no pude crear {}: {e}", dir.display()))?;
            let zip = std::env::temp_dir().join("capri-payload.zip");
            std::fs::write(&zip, PAYLOAD).map_err(|e| e.to_string())?;
            log(app, format!("> extrayendo en {}", dir.display()));
            let tar = env_dir("SystemRoot").join(r"System32\tar.exe"); // Windows' own, not another one on the PATH
            let out = quiet(tar).arg("-xf").arg(&zip).arg("-C").arg(dir).output().map_err(|e| e.to_string())?;
            let _ = std::fs::remove_file(&zip);
            if !out.status.success() {
                return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
            }
            let me = std::env::current_exe().map_err(|e| e.to_string())?;
            std::fs::copy(&me, dir.join(plan::UNINSTALLER)).map_err(|e| e.to_string())?;
            Ok(dir.display().to_string())
        }
        Task::Python => exec(app, &plan::uv_sync(dir)).map(|_| "Python 3.12 y sus paquetes".into()),
        Task::Voces => {
            let tts = models.join("tts");
            std::fs::create_dir_all(tts.join("qwen")).map_err(|e| e.to_string())?;
            for (from, to) in [("capri.npy", tts.join("capri.npy")), ("capri.wav", tts.join(r"qwen\capri.wav")), ("capri.txt", tts.join(r"qwen\capri.txt"))] {
                if !to.exists() {
                    std::fs::copy(dir.join("voz").join(from), &to).map_err(|e| format!("{from}: {e}"))?;
                }
            }
            for url in plan::KOKORO {
                download(app, url, &tts.join(url.rsplit('/').next().unwrap()))?;
            }
            Ok("Kokoro y su voz afinada".into())
        }
        Task::Ollama => {
            if ollama_installed() {
                return Ok("ya estaba".into());
            }
            let setup = std::env::temp_dir().join("OllamaSetup.exe");
            download(app, plan::OLLAMA, &setup)?;
            exec(app, &plan::Cmd { program: setup.clone(), args: ["/VERYSILENT", "/NORESTART", "/SUPPRESSMSGBOXES"].map(String::from).to_vec(), cwd: None, env: vec![] })?;
            let _ = std::fs::remove_file(setup);
            Ok("instalado".into())
        }
        Task::Clonada => {
            for cmd in plan::qwen(dir, &models) {
                exec(app, &cmd)?;
            }
            Ok("PyTorch, faster-qwen3-tts y sus modelos".into())
        }
        Task::Accesos => {
            let exe = dir.join("avatar.exe");
            let programs = env_dir("APPDATA").join(r"Microsoft\Windows\Start Menu\Programs");
            let mut made = vec![];
            let mut make = |lnk: PathBuf, what: &str| -> Result<(), String> {
                powershell(&plan::shortcut(&lnk, &exe, &exe))?;
                made.push(what.to_string());
                Ok(())
            };
            if o.inicio {
                make(programs.join("Capri.lnk"), "Inicio")?;
            }
            if o.escritorio {
                let desktop = PathBuf::from(powershell("[Environment]::GetFolderPath('Desktop')")?);
                make(desktop.join("Capri.lnk"), "escritorio")?;
            }
            if o.arranque {
                make(programs.join(r"Startup\Capri.lnk"), "arranque con Windows")?;
            }
            Ok(made.join(", "))
        }
        Task::Registro => {
            let mb = dir_size(dir) / 1_000_000;
            for (name, kind, data) in plan::uninstall_entry(dir, env!("CARGO_PKG_VERSION"), mb) {
                let out = quiet("reg").args(["add", plan::UNINSTALL_KEY, "/v", name, "/t", kind, "/d", &data, "/f"]).output().map_err(|e| e.to_string())?;
                if !out.status.success() {
                    return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
                }
            }
            Ok("en «Agregar o quitar programas»".into())
        }
    }
}

fn dir_size(dir: &Path) -> u64 {
    std::fs::read_dir(dir)
        .map(|rd| rd.flatten().map(|e| if e.path().is_dir() { dir_size(&e.path()) } else { e.metadata().map(|m| m.len()).unwrap_or(0) }).sum())
        .unwrap_or(0)
}

/// Opens her and closes the installer.
#[tauri::command]
fn launch(dir: String, app: AppHandle) {
    let exe = Path::new(&dir).join("avatar.exe");
    let _ = Command::new(&exe).current_dir(&dir).spawn();
    app.exit(0);
}

// ---- uninstalling ----

#[derive(serde::Deserialize)]
struct Removal {
    dir: PathBuf,
    memoria: bool, // %APPDATA%\Capri: her config, memory, reminders
    modelos: bool, // %LOCALAPPDATA%\Capri: her voices, Whisper, uv's cache
    claves: bool,  // the API keys in the Credential Manager
}

#[tauri::command]
fn uninstall(r: Removal, app: AppHandle) -> Result<(), String> {
    if !r.dir.join("avatar.exe").exists() && !r.dir.join(plan::UNINSTALLER).exists() {
        return Err(format!("No encuentro Capri en {}", r.dir.display()));
    }
    std::thread::spawn(move || {
        let mut avisos = vec![];
        let mut doing = |what: &str, f: &mut dyn FnMut() -> Result<(), String>| {
            step(&app, what, "activa", "");
            match f() {
                Ok(()) => step(&app, what, "hecha", ""),
                Err(e) => {
                    step(&app, what, "fallo", e.clone());
                    avisos.push(format!("{what}: {e}"));
                }
            }
        };
        doing("cerrar", &mut || {
            let _ = quiet("taskkill").args(["/IM", "avatar.exe", "/F"]).output();
            std::thread::sleep(Duration::from_secs(2)); // her backend goes with her
            Ok(())
        });
        doing("alarmas", &mut || {
            // none at all is fine too (Get-ScheduledTask fails on a folder that isn't there)
            powershell("$t = @(Get-ScheduledTask -ErrorAction SilentlyContinue | Where-Object TaskPath -eq '\\Capri\\'); \
                        $t | Unregister-ScheduledTask -Confirm:$false; exit 0")
            .map(|_| ())
        });
        doing("accesos", &mut || {
            let programs = env_dir("APPDATA").join(r"Microsoft\Windows\Start Menu\Programs");
            let desktop = PathBuf::from(powershell("[Environment]::GetFolderPath('Desktop')")?);
            for lnk in [programs.join("Capri.lnk"), programs.join(r"Startup\Capri.lnk"), desktop.join("Capri.lnk")] {
                // only ours: a Capri.lnk to another copy of her (a dev build's autostart) stays
                let q = lnk.to_string_lossy().replace('\'', "''");
                let target = powershell(&format!("(New-Object -ComObject WScript.Shell).CreateShortcut('{q}').TargetPath")).unwrap_or_default();
                if lnk.exists() && plan::points_into(&target, &r.dir) {
                    let _ = std::fs::remove_file(lnk);
                }
            }
            Ok(())
        });
        doing("registro", &mut || {
            let _ = quiet("reg").args(["delete", plan::UNINSTALL_KEY, "/f"]).output();
            Ok(())
        });
        doing("app", &mut || remove(&r.dir));
        if r.memoria {
            doing("memoria", &mut || remove(&env_dir("APPDATA").join("Capri")));
        }
        if r.modelos {
            doing("modelos", &mut || remove(&env_dir("LOCALAPPDATA").join("Capri")));
        }
        if r.claves {
            doing("claves", &mut || {
                for t in plan::KEY_TARGETS {
                    let _ = quiet("cmdkey").arg(format!("/delete:{t}")).output();
                }
                Ok(())
            });
        }
        let _ = app.emit("done", Done { ok: avisos.is_empty(), error: String::new(), avisos });
    });
    Ok(())
}

fn remove(p: &Path) -> Result<(), String> {
    for _ in 0..5 {
        match std::fs::remove_dir_all(p) {
            Ok(()) => return Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
            Err(_) => std::thread::sleep(Duration::from_secs(1)), // a process letting go of a file
        }
    }
    std::fs::remove_dir_all(p).map_err(|e| format!("{}: {e}", p.display()))
}

/// Closes the installer; a copy that ran from the temp folder (to uninstall the folder it came from) goes too.
#[tauri::command]
fn quit(app: AppHandle) {
    if std::env::args().any(|a| a == "--relocated") {
        if let Ok(me) = std::env::current_exe() {
            let _ = quiet("cmd").args(["/c", "ping", "127.0.0.1", "-n", "3", ">nul", "&", "del", "/q"]).arg(&me).spawn();
        }
    }
    app.exit(0);
}

/// Uninstalling from inside the folder it removes: a copy in the temp folder does it instead.
fn relocate() -> bool {
    if !uninstalling() || std::env::args().any(|a| a == "--relocated") {
        return false;
    }
    let Ok(me) = std::env::current_exe() else { return false };
    let Some(dir) = me.parent() else { return false };
    if me.file_name().is_none_or(|n| n != plan::UNINSTALLER) {
        return false;
    }
    if arg("--dir").is_some() {
        return false; // already the relocated copy
    }
    let copy = std::env::temp_dir().join("capri-desinstalar.exe");
    if std::fs::copy(&me, &copy).is_err() {
        return false;
    }
    Command::new(copy).args(["--uninstall", "--relocated", "--dir"]).arg(dir).spawn().is_ok()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    if relocate() {
        return;
    }
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![info, install, uninstall, launch, quit])
        .run(tauri::generate_context!())
        .expect("error while running the installer");
}
