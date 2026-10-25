//! Where the other top-level windows are, so Capri can sit on them and possess them, and which
//! monitor to capture when she looks at the screen. Only rectangles, z-order and the foreground
//! window: never titles or contents.

use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;
use tauri::{Emitter, Manager, WebviewWindow};
use windows_sys::Win32::Foundation::{BOOL, HWND, LPARAM, RECT};
use windows_sys::Win32::Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_CLOAKED, DWMWA_EXTENDED_FRAME_BOUNDS};
use windows_sys::Win32::Graphics::Gdi::{GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTOPRIMARY};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GetClassNameW, GetForegroundWindow, GetWindowLongW, IsIconic, IsWindowVisible, IsZoomed,
    SetWindowDisplayAffinity, GWL_EXSTYLE, WDA_EXCLUDEFROMCAPTURE, WDA_NONE, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW,
};

/// One window, in logical px relative to the overlay.
#[derive(Clone, PartialEq, Serialize)]
pub struct Win {
    id: isize,
    x: f64,
    y: f64,
    w: f64,
    h: f64,
    max: bool,
}

/// Visible windows front to back, and which one has the focus.
#[derive(Clone, PartialEq, Serialize)]
pub struct Windows {
    fg: isize,
    wins: Vec<Win>,
}

/// The latest list, for a page that (re)loads after it was sent.
#[derive(Default)]
pub struct Latest(Mutex<Option<Windows>>);

#[tauri::command]
pub fn windows(latest: tauri::State<Latest>) -> Option<Windows> {
    latest.0.lock().unwrap().clone()
}

/// The monitor of the window the user was on (never Capri's own; the primary if none), physical px:
/// left, top, right, bottom. That's what she captures when asked to look.
#[tauri::command]
pub fn look_target(latest: tauri::State<Latest>) -> [i32; 4] {
    let fg = latest.0.lock().unwrap().as_ref().map_or(0, |w| w.fg);
    let r = monitor_rect(fg as HWND);
    [r.left, r.top, r.right, r.bottom]
}

/// Keeps the overlay (Capri and her HUD) out of screen captures while she looks, so she
/// doesn't see herself; off again afterwards so the user's own screenshots still show her.
#[tauri::command]
pub fn capture_guard(on: bool, window: WebviewWindow) -> Result<(), String> {
    let hwnd = window.hwnd().map_err(|e| e.to_string())?;
    let ok = unsafe { SetWindowDisplayAffinity(hwnd.0 as HWND, if on { WDA_EXCLUDEFROMCAPTURE } else { WDA_NONE }) };
    if ok == 0 { Err("SetWindowDisplayAffinity failed".into()) } else { Ok(()) }
}

const SHELL_CLASSES: [&str; 4] = ["Progman", "WorkerW", "Shell_TrayWnd", "Shell_SecondaryTrayWnd"];

fn class_name(hwnd: HWND) -> String {
    let mut buf = [0u16; 64];
    let n = unsafe { GetClassNameW(hwnd, buf.as_mut_ptr(), buf.len() as i32) };
    String::from_utf16_lossy(&buf[..n.max(0) as usize])
}

/// A window the user would call a window: shown, not minimized, not cloaked (other virtual
/// desktops, suspended UWP apps), not a tool palette, not the desktop or the taskbar.
fn real_window(hwnd: HWND) -> Option<RECT> {
    unsafe {
        if IsWindowVisible(hwnd) == 0 || IsIconic(hwnd) != 0 {
            return None;
        }
        let ex = GetWindowLongW(hwnd, GWL_EXSTYLE) as u32;
        if ex & (WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE) != 0 {
            return None;
        }
        let mut cloaked = 0u32;
        let size = std::mem::size_of::<u32>() as u32;
        if DwmGetWindowAttribute(hwnd, DWMWA_CLOAKED as u32, &mut cloaked as *mut _ as *mut _, size) == 0 && cloaked != 0 {
            return None;
        }
        let mut r: RECT = std::mem::zeroed();
        let size = std::mem::size_of::<RECT>() as u32;
        // the visible frame, without the invisible resize borders of GetWindowRect
        if DwmGetWindowAttribute(hwnd, DWMWA_EXTENDED_FRAME_BOUNDS as u32, &mut r as *mut _ as *mut _, size) != 0 {
            return None;
        }
        if r.right - r.left < 120 || r.bottom - r.top < 80 || SHELL_CLASSES.contains(&class_name(hwnd).as_str()) {
            return None;
        }
        Some(r)
    }
}

unsafe extern "system" fn collect(hwnd: HWND, out: LPARAM) -> BOOL {
    unsafe {
        let out = &mut *(out as *mut Vec<(HWND, RECT, bool)>);
        if let Some(r) = real_window(hwnd) {
            out.push((hwnd, r, IsZoomed(hwnd) != 0));
        }
    }
    1
}

/// The whole monitor a window is on (the primary one for no window), physical px.
fn monitor_rect(hwnd: HWND) -> RECT {
    unsafe {
        let monitor = MonitorFromWindow(hwnd, MONITOR_DEFAULTTOPRIMARY);
        let mut info: MONITORINFO = std::mem::zeroed();
        info.cbSize = std::mem::size_of::<MONITORINFO>() as u32;
        GetMonitorInfoW(monitor, &mut info);
        info.rcMonitor
    }
}

/// Is the focused window covering its whole monitor (a game, a video)? Then Capri gets out of the way.
fn fullscreen_app(fg: HWND, own: isize) -> bool {
    if fg.is_null() || fg as isize == own || SHELL_CLASSES.contains(&class_name(fg).as_str()) {
        return false;
    }
    let mut r: RECT = unsafe { std::mem::zeroed() };
    let size = std::mem::size_of::<RECT>() as u32;
    if unsafe { DwmGetWindowAttribute(fg, DWMWA_EXTENDED_FRAME_BOUNDS as u32, &mut r as *mut _ as *mut _, size) } != 0 {
        return false;
    }
    let m = monitor_rect(fg);
    r.left <= m.left && r.top <= m.top && r.right >= m.right && r.bottom >= m.bottom
}

/// ~10 Hz (smooth enough to ride a dragged window): emits "windows" whenever the visible windows
/// change, "fullscreen" when a fullscreen app comes and goes, and refits the overlay when the
/// screen or the taskbar changes.
pub fn watch(app: tauri::AppHandle) {
    let mut last: Option<Windows> = None;
    let mut last_fullscreen = false;
    let mut last_area = None;
    for tick in 0u64.. {
        std::thread::sleep(Duration::from_millis(100));
        let Some(w) = app.get_webview_window("main") else { continue };
        if tick % 20 == 0 {
            let area = w.primary_monitor().ok().flatten().map(|m| (m.work_area().position, m.work_area().size, *m.size()));
            if area.is_some() && area != last_area {
                if last_area.is_some() {
                    let _ = crate::fit(&w);
                }
                last_area = area;
            }
        }
        let (Ok(own), Ok(pos), Ok(scale)) = (w.hwnd(), w.outer_position(), w.scale_factor()) else { continue };
        let full = fullscreen_app(unsafe { GetForegroundWindow() }, own.0 as isize);
        if full != last_fullscreen {
            last_fullscreen = full;
            let _ = app.emit("fullscreen", full);
        }
        let mut found: Vec<(HWND, RECT, bool)> = Vec::new();
        unsafe { EnumWindows(Some(collect), &mut found as *mut _ as LPARAM) };
        let wins = found
            .into_iter()
            .filter(|(hwnd, _, _)| *hwnd as isize != own.0 as isize)
            .map(|(hwnd, r, max)| Win {
                id: hwnd as isize,
                x: (r.left - pos.x) as f64 / scale,
                y: (r.top - pos.y) as f64 / scale,
                w: (r.right - r.left) as f64 / scale,
                h: (r.bottom - r.top) as f64 / scale,
                max,
            })
            .collect();
        // Typing to her focuses her own window: "the window in front" is then the one you came from.
        let fg = unsafe { GetForegroundWindow() } as isize;
        let fg = if fg == own.0 as isize { last.as_ref().map_or(0, |l| l.fg) } else { fg };
        let now = Windows { fg, wins };
        if last.as_ref() != Some(&now) {
            let _ = app.emit("windows", &now);
            *app.state::<Latest>().0.lock().unwrap() = Some(now.clone());
            last = Some(now);
        }
    }
}
