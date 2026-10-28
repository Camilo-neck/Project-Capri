//! Ollama, which runs her model: started with her if it isn't running, and stopped with her when
//! asked (/cierra), since it holds the model in VRAM.

use std::net::{SocketAddr, TcpStream};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::time::Duration;

const ADDR: &str = "127.0.0.1:11434";
const PROCESSES: [&str; 2] = ["ollama app.exe", "ollama.exe"]; // the tray app first, or it starts the server again

fn running() -> bool {
    let addr: SocketAddr = ADDR.parse().unwrap();
    TcpStream::connect_timeout(&addr, Duration::from_millis(300)).is_ok()
}

fn no_window(cmd: &mut Command) -> &mut Command {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    cmd
}

/// Starts Ollama's server, hidden, if nothing answers on its port. Not its tray app: newer versions
/// open their window on every start.
pub fn ensure() {
    if running() {
        return;
    }
    let exe = PathBuf::from(std::env::var_os("LOCALAPPDATA").unwrap_or_default()).join("Programs/Ollama/ollama.exe");
    let exe = if exe.exists() { exe } else { PathBuf::from("ollama") };
    let started = no_window(Command::new(exe).arg("serve"))
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn();
    if let Err(e) = started {
        eprintln!("could not start Ollama: {e}");
    }
}

/// Stops Ollama (tray app and server), freeing the VRAM her model holds.
pub fn stop() {
    for name in PROCESSES {
        let _ = no_window(Command::new("taskkill").args(["/IM", name, "/F"])).output();
    }
}

/// /cierra: closes Capri (her backend goes with her) and, if asked, Ollama too.
#[tauri::command]
pub fn quit(stop_ollama: bool, app: tauri::AppHandle) {
    if stop_ollama {
        stop();
    }
    app.exit(0);
}
