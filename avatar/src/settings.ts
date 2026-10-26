// The tray's settings panel: a popover near the clock. It holds no state of its own: toggles ask
// Rust (`tray_action`) and show whatever `tray-state` events say, so it matches the real modes.
import "@fontsource/chakra-petch/600.css";
import "@fontsource/jetbrains-mono/400.css";
import "./settings.css";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import face from "../assets/faces/grin.png";

document.querySelector<HTMLImageElement>("#face")!.src = face;

const act = (id: string): void => void invoke("tray_action", { id });
const close = (): void => void getCurrentWindow().hide();

function show(name: string, on: boolean): void {
  const input = document.querySelector<HTMLInputElement>(`.row[data-id="${name}"] input`);
  if (input) input.checked = on;
  if (name === "style") {
    document.querySelectorAll<HTMLElement>("#style button").forEach((b) => b.classList.toggle("on", (b.dataset.style === "pixel") === on));
  }
}

const sync = (): Promise<void> => invoke<Record<string, boolean>>("tray_states").then((s) => Object.entries(s).forEach(([k, v]) => show(k, v)));
void sync();
void listen<[string, boolean]>("tray-state", (e) => show(...e.payload));
void getCurrentWindow().onFocusChanged(({ payload }) => payload && void sync()); // shown again

document.addEventListener("click", (e) => {
  const t = e.target as HTMLElement;
  const row = t.closest<HTMLElement>(".row");
  if (row) {
    e.preventDefault(); // the real state comes back as an event
    act(row.dataset.id!);
    return;
  }
  const seg = t.closest<HTMLElement>("#style button");
  if (seg) {
    if (!seg.classList.contains("on")) act("style");
    return;
  }
  const id = t.closest<HTMLElement>("[data-act]")?.dataset.act;
  if (id === "close") close();
  else if (id) {
    act(id);
    if (id !== "quit" && id !== "quit-ollama") close();
  }
});
document.addEventListener("keydown", (e) => e.key === "Escape" && close());
