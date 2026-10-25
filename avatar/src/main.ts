import "@fontsource/chakra-petch/600.css";
import "@fontsource/jetbrains-mono/400.css";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";

import type { ServerMessage } from "./net/protocol.ts";
import { connect } from "./net/ws.ts";
import { createAvatar, type Style } from "./render/avatar.ts";
import { AvatarState } from "./state/avatar.ts";
import { mouthFor, Typewriter, type Mouth } from "./state/text.ts";

const HIDE_AFTER_MS = 6000;
const NUM_CTX = 8192;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const tx = $("tx");
const txN = $("tx-n");
const txMeta = $("tx-meta");
const txUser = $("tx-user");
const txText = $("tx-text");
const status = $("status");
const statusLabel = $("status-label");
const inputRow = $<HTMLFormElement>("input-row");
const input = $<HTMLInputElement>("input");

const STATUS = { down: "SIN ENLACE", idle: "ENLACE ESTABLE", thinking: "PROCESANDO", speaking: "TRANSMITIENDO" };
type Status = keyof typeof STATUS;

const cfg = await invoke<{ ws_url: string; style: string }>("config");
const win = getCurrentWindow();
const avatar = new AvatarState(performance.now());
const typewriter = new Typewriter(50);
const renderer = await createAvatar($("stage"), (cfg.style || "layers") as Style, cfg.style !== "");

let turn = 0;
let sentAt = 0;
let latency: number | null = null;
let ctx: number | null = null;
let ended = true;
let hideTimer = 0;
const latencies: number[] = [];

function setStatus(s: Status): void {
  status.dataset.state = s;
  statusLabel.textContent = STATUS[s];
}

function updateMeta(): void {
  const parts = [new Date().toLocaleTimeString("es", { hour12: false })];
  if (latency !== null) parts.push(`${latency} ms`);
  if (ctx !== null) parts.push(`ctx ${(ctx / 1000).toFixed(1)}k/${NUM_CTX / 1024}k`);
  txMeta.textContent = parts.join(" · ");
}

function showTx(): void {
  clearTimeout(hideTimer);
  hideTimer = 0;
  tx.hidden = false;
}

const link = connect(
  cfg.ws_url,
  (msg: ServerMessage) => {
    const now = performance.now();
    switch (msg.type) {
      case "state":
        setStatus(msg.value);
        break;
      case "utterance_start":
        // Also covers a retry: the new utterance replaces the text shown so far.
        avatar.setEmotion(msg.emocion, now);
        avatar.playGesture(msg.gesto, now);
        typewriter.clear();
        txText.textContent = "";
        ended = false;
        tx.classList.add("typing");
        showTx();
        break;
      case "text_delta":
        typewriter.push(msg.text);
        break;
      case "utterance_end":
        ended = true;
        ctx = msg.ctx ?? ctx;
        updateMeta();
        break;
      case "confirm_request":
        break; // phase 5
    }
  },
  (up) => setStatus(up ? "idle" : "down"),
);

// Click-through except while the input bar is open (and, from phase 5, while a confirmation is pending).
function setInputOpen(open: boolean): void {
  inputRow.hidden = !open;
  void win.setIgnoreCursorEvents(!open);
  if (open) {
    input.focus();
    if (txText.textContent) showTx();
  }
}

void listen("open-input", () => setInputOpen(true));
input.addEventListener("keydown", (e) => {
  if (e.key === "Escape") setInputOpen(false);
});
inputRow.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text || !link.send({ type: "text_input", text })) return;
  input.value = "";
  turn += 1;
  sentAt = performance.now();
  latency = null;
  txN.textContent = String(turn).padStart(4, "0");
  txUser.textContent = `› ${text}`;
  txText.textContent = "";
  updateMeta();
  showTx();
});
setInputOpen(false);

renderer.app.ticker.add((ticker) => {
  const now = performance.now();
  const revealed = typewriter.tick(ticker.deltaMS);
  if (revealed) {
    txText.textContent += revealed;
    txText.parentElement!.scrollTop = txText.parentElement!.scrollHeight;
    if (latency === null && sentAt) {
      latency = Math.round(now - sentAt);
      latencies.push(latency);
      const sorted = [...latencies].sort((a, b) => a - b);
      console.info(`Enter -> first char: ${latency} ms (median ${sorted[sorted.length >> 1]} ms over ${sorted.length})`);
      updateMeta();
    }
    let m: Mouth | null = avatar.mouth ?? "closed";
    for (const ch of revealed) m = mouthFor(ch) ?? m;
    avatar.mouth = m;
  } else if (!typewriter.pending) {
    avatar.mouth = ended ? null : "closed";
    if (ended && tx.classList.contains("typing")) {
      tx.classList.remove("typing");
      if (inputRow.hidden) hideTimer = window.setTimeout(() => (tx.hidden = true), HIDE_AFTER_MS);
    }
  }
  renderer.draw(avatar.pose(now), now);
});
