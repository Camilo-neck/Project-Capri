fn main() {
    // the app rides inside (scripts/build_installer.ps1); a dev build gets an empty one and says so
    let payload = std::path::Path::new("payload.zip");
    if !payload.exists() {
        std::fs::write(payload, b"").expect("payload.zip");
    }
    println!("cargo:rerun-if-changed=payload.zip");
    tauri_build::build()
}
