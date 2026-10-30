// no console window in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    capri_setup_lib::run()
}
