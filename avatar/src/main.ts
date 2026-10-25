import "@fontsource/chakra-petch/600.css";
import "@fontsource/jetbrains-mono/400.css";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import type { ServerMessage } from "./net/protocol.ts";
import { connect } from "./net/ws.ts";
import { Director, LINGER_MS } from "./pet/behaviors.ts";
import { ClipPlayer, gestureFrame } from "./pet/clips.ts";
import { GROUND, H, solve } from "./pet/rig.ts";
import { Fx, type Rect } from "./render/fx.ts";
import { createPet, SCALE } from "./render/pet.ts";
import { AvatarState, POSE_MS } from "./state/avatar.ts";
import { GlitchFx, OFF, VANISH_OUT_MS } from "./state/glitch.ts";
import { pickSeat, seatOf, type Perch, type Point, type Windows } from "./state/perch.ts";
import { mouthFor, Typewriter, type Mouth } from "./state/text.ts";

const HIDE_AFTER_MS = 6000;
const NUM_CTX = 8192;
const LOOK_RANGE = 140; // px from her head at which the gaze reaches its limit
const LOOK_IDLE_MS = 4000; // gaze returns to you when the mouse rests this long
const WANDER_MS = [3 * 60_000, 6 * 60_000]; // idle, she moves (or possesses a window) this often
const BELOW = (H - GROUND) * SCALE; // HUD px under her feet: her legs dangle over the ledge
const EDGE = 16; // px kept free at the screen sides
const GRAVITY = 0.0028; // px/ms², falling off a ledge
const POSSESS_MS = 2000;
// Possessing windows can be turned off with localStorage "capri.possess" = "0".
// ponytail: localStorage until phase 8 brings a settings file.
const possessAllowed = () => localStorage.getItem("capri.possess") !== "0";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const hud = document.querySelector<HTMLElement>(".hud")!;
const tx = $("tx");
const txN = $("tx-n");
const txMeta = $("tx-meta");
const txUser = $("tx-user");
const txText = $("tx-text");
const choices = $<HTMLOListElement>("choices");
const txMem = $("tx-mem");
const status = $("status");
const statusLabel = $("status-label");
const inputRow = $<HTMLFormElement>("input-row");
const input = $<HTMLInputElement>("input");
const stage = $("stage");

const STATUS = {
  down: "SIN ENLACE",
  idle: "ENLACE ESTABLE",
  looking: "ESCANEANDO PANTALLA",
  thinking: "PROCESANDO",
  speaking: "TRANSMITIENDO",
};
type Status = keyof typeof STATUS;

const cfg = await invoke<{ ws_url: string }>("config");
const avatar = new AvatarState(performance.now());
const typewriter = new Typewriter(50);
const pet = await createPet(stage);
const fx = new Fx($<HTMLCanvasElement>("fx"));
const director = new Director();
const clips = new ClipPlayer();
const glitch = new GlitchFx(performance.now());
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
if (import.meta.env.DEV) Object.assign(window, { __capri: { director, clips, glitch, teleport, possess, fall, wins: () => wins, perch: () => perch, at: () => at } }); // inspection from devtools

let turn = 0;
let awaiting = false; // a message of ours is being answered; a turn without one is Capri's own (a reminder)
let confirming: string | null = null; // id of the confirmation on screen
let sentAt = 0;
let latency: number | null = null;
let ctx: number | null = null;
let ended = true;
let hideTimer = 0;
let linkStatus: Status = "down";
let variant = 0;
let lastTalk = performance.now() - LINGER_MS; // start idle, not as if she had just spoken
let pokeAt = -Infinity;
let petAt = -Infinity;
let petSide = 1;
let petEnergy = 0;
let greetAt = -Infinity;
let cursor: [number, number] | null = null;
let cursorAt = -Infinity;
const latencies: number[] = [];
let teleporting = false;
let possessing: { since: number } | null = null; // the "peligro" eyes, before she dives in
let falling: { vy: number } | null = null;
let nextWander = performance.now() + wanderGap();
let wins: Windows = { fg: 0, wins: [] };
let perch: Perch | null = null; // the window she sits on; null = the taskbar
let at: Point = { x: 0, y: 0 }; // her feet, page px

function wanderGap(): number {
  return WANDER_MS[0] + Math.random() * (WANDER_MS[1] - WANDER_MS[0]);
}

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));
const busy = () => teleporting || !!possessing || !!falling;
const floor = () => innerHeight - BELOW;
/** Room a ledge needs above it: her and the transmission, which stack above her feet. */
const room = () => hud.offsetHeight - BELOW;
const limits = () => ({ room: room(), width: innerWidth, margin: hud.offsetWidth / 2 + EDGE });

/** A spot on the taskbar, `frac` 0..1 from left to right. */
function onTaskbar(frac: number): Point {
  return { x: EDGE + hud.offsetWidth / 2 + frac * (innerWidth - hud.offsetWidth - 2 * EDGE), y: floor() };
}

/** Moves the HUD column (transmission, input and Capri) so her feet are at `at`. */
function placeHud(): void {
  hud.style.transform = `translate(${Math.round(at.x - hud.offsetWidth / 2)}px, ${Math.round(at.y - room())}px)`;
}
at = onTaskbar(1);
placeHud();
addEventListener("resize", () => {
  if (!perch) at.y = floor();
  placeHud();
});

/** Her body on the page: center, feet line, and rough size, for the screen effects. */
function body(): { x: number; y: number; ground: number; size: number } {
  const r = stage.getBoundingClientRect();
  const b = pet.bounds() ?? { x: 0, y: 0, w: r.width, h: r.height };
  return { x: r.left + b.x + b.w / 2, y: r.top + b.y + b.h / 2, ground: r.top + b.y + b.h, size: Math.max(b.w, b.h) };
}

/** Somewhere on the taskbar at least a third of it away from here. */
function farOnTaskbar(): Point {
  const spot = (at.x - EDGE - hud.offsetWidth / 2) / (innerWidth - hud.offsetWidth - 2 * EDGE);
  return onTaskbar(spot > 0.5 ? Math.random() * Math.max(0, spot - 0.35) : Math.min(1, spot + 0.35 + Math.random() * (0.65 - spot)));
}

/** Collapses, leaves a column of light, streaks to `to` (a window ledge, or null: the taskbar) and lands. */
async function teleport(to: Perch | null = null, { dive = false } = {}): Promise<void> {
  if (teleporting || falling) return;
  teleporting = true;
  const from = body();
  if (!reducedMotion.matches && !dive) {
    glitch.kick("vanish", performance.now());
    fx.burst(from.x, from.y, from.size, false);
    await sleep(VANISH_OUT_MS);
    fx.beam(from.x, from.ground);
  }
  const seat = to && seatOf(wins, to, limits());
  perch = seat ? to : null;
  at = seat || farOnTaskbar();
  placeHud();
  if (!reducedMotion.matches) {
    const there = body();
    if (!dive) fx.streak(from.x, from.y, there.x, there.y);
    await sleep(60);
    fx.beam(there.x, there.ground, true);
    glitch.kick("arrive", performance.now());
    fx.burst(there.x, there.y, there.size, true);
  }
  teleporting = false;
}

/** Her ledge is gone: she drops to the taskbar. */
function fall(): void {
  perch = null;
  if (reducedMotion.matches) {
    at.y = floor();
    placeHud();
    return;
  }
  falling = { vy: 0 };
}

/** On a ledge: all her eyes open, she dives into the window and takes it over for a moment, then comes out elsewhere. */
async function possess(): Promise<void> {
  const win = perch && wins.wins.find((w) => w.id === perch!.id);
  if (!win || busy() || reducedMotion.matches) return;
  possessing = { since: performance.now() };
  await sleep(900); // the "peligro" clip: her eyes open
  possessing = null;
  teleporting = true;
  const from = body();
  glitch.kick("vanish", performance.now());
  fx.burst(from.x, from.y, from.size * 0.6, false);
  await sleep(VANISH_OUT_MS);
  const id = win.id;
  // drawn over the window as it is now, minus the windows in front of it
  const covers = (): Rect[] => {
    const i = wins.wins.findIndex((w) => w.id === id);
    return i < 0 ? [] : wins.wins.slice(0, i);
  };
  fx.possess(win, covers, () => cursor, POSSESS_MS);
  await sleep(POSSESS_MS);
  teleporting = false;
  await teleport(pickSeat(wins, limits(), Math.random, { except: id }), { dive: true });
}

/** Wandering: another ledge or the taskbar, or, sitting on a window, possessing it now and then. */
function wander(): void {
  if (perch && possessAllowed() && Math.random() < 0.3) {
    void possess();
    return;
  }
  void teleport(Math.random() < 0.6 ? pickSeat(wins, limits(), Math.random, { except: perch?.id }) : null);
}

function setStatus(s: Status): void {
  if (s !== "down" && linkStatus === "down") greetAt = performance.now();
  if (s === "looking") fx.scan();
  if (s === "thinking" && linkStatus === "idle" && !awaiting) startTurn(""); // she speaks up on her own
  if (s === "idle") awaiting = false;
  if (linkStatus === "looking" && s !== "looking") guardOff(); // the shot is taken
  if (s === "thinking" && linkStatus !== "thinking" && !busy()) {
    // while she works, she sits on the window in front if she can
    const seat = pickSeat(wins, limits(), Math.random, { frontOnly: true });
    if (seat && seat.id !== perch?.id) void teleport(seat);
  }
  linkStatus = s;
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
        if (confirming) hideChoices(); // the confirmation timed out: the turn moved on
        // Also covers a retry: the new utterance replaces the text shown so far.
        if (avatar.setEmotion(msg.emocion) && !teleporting) glitch.kick(msg.emocion === "molesta" ? "hurt" : "change", now);
        avatar.playGesture(msg.gesto, now);
        variant = Math.floor(Math.random() * 1000);
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
        showChoices(msg.id, msg.texto);
        break;
      case "remembered":
        txMem.hidden = false;
        txMem.title = msg.texto; // hover shows what she saved
        break;
    }
  },
  (up) => {
    if (!up) hideChoices(); // the backend treats a lost connection as "no"
    setStatus(up ? "idle" : "down");
  },
);

/** An action with effects waits on a click: [1] do it (marked), [2] don't. Neither is preselected. */
function showChoices(id: string, what: string): void {
  confirming = id;
  const option = (n: 1 | 2, label: string) => {
    const li = document.createElement("li");
    const b = document.createElement("button");
    b.type = "button";
    b.className = n === 1 ? "warn" : "";
    b.innerHTML = `<span class="mark">[${n}]${n === 1 ? " ⚠" : ""}</span> `;
    b.append(label);
    b.addEventListener("click", () => answer(n === 1));
    li.append(b);
    return li;
  };
  choices.replaceChildren(option(1, what), option(2, "Ahora no"));
  choices.hidden = false;
  showTx();
}

function hideChoices(): void {
  confirming = null;
  choices.hidden = true;
  choices.replaceChildren();
}

function answer(ok: boolean): void {
  if (!confirming) return;
  link.send({ type: "confirm_response", id: confirming, ok });
  hideChoices();
}

// Keys 1 / 2 answer too, unless they're being typed into the input.
addEventListener("keydown", (e) => {
  if (!confirming || (e.key !== "1" && e.key !== "2") || (document.activeElement === input && input.value)) return;
  e.preventDefault();
  answer(e.key === "1");
});

// The window lets clicks through except over the boxes reported to Rust each frame: Capri, the
// input bar and transmission while the bar is open, and the transmission while a choice waits.
function setInputOpen(open: boolean): void {
  inputRow.hidden = !open;
  hud.classList.toggle("input-open", open);
  if (open) {
    input.focus();
    if (txText.textContent) showTx();
  }
}

let guardTimer = 0;

function guardOff(): void {
  clearTimeout(guardTimer);
  void invoke("capture_guard", { on: false });
}

/** Bookkeeping for a message just sent: turn number, latency clock, the transmission header. */
function startTurn(shown: string): void {
  turn += 1;
  awaiting = shown !== "";
  sentAt = awaiting ? performance.now() : 0; // her own turns have no latency to measure
  latency = null;
  txN.textContent = String(turn).padStart(4, "0");
  txUser.textContent = awaiting ? `› ${shown}` : "";
  typewriter.clear(); // leftovers of the previous reply would reveal at once and fake the latency
  txMem.hidden = true;
  txText.textContent = "";
  updateMeta();
  showTx();
}

/** Looks at the screen you were on (Ctrl+Alt+M or /mira), with Capri kept out of the shot. */
async function look(question: string): Promise<void> {
  const rect = await invoke<[number, number, number, number]>("look_target");
  await invoke("capture_guard", { on: true }).catch((e) => console.warn("capture_guard", e));
  if (!link.send({ type: "look", text: question, rect })) {
    guardOff();
    return;
  }
  guardTimer = window.setTimeout(guardOff, 5000); // in case the backend never answers
  startTurn(question ? `/mira ${question}` : "/mira");
}

void listen("open-input", () => setInputOpen(true));
void listen("look", () => void look(""));
void listen("teleport", () => void teleport(pickSeat(wins, limits(), Math.random, { except: perch?.id })));
void invoke<Windows | null>("windows").then((w) => (wins = w ?? wins)); // already sent before this page loaded
void listen<Windows>("windows", (e) => {
  wins = e.payload;
  if (!perch || teleporting) return;
  const seat = seatOf(wins, perch, limits());
  if (!seat) fall();
  else if (seat.x !== at.x || seat.y !== at.y) {
    at = seat; // rides along with the window
    placeHud();
  }
});
void listen<[number, number]>("cursor", (e) => {
  cursor = e.payload;
  cursorAt = performance.now();
});
input.addEventListener("keydown", (e) => {
  if (e.key === "Escape") setInputOpen(false);
});
inputRow.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = input.value.trim();
  const mira = text.match(/^\/mira(?:\s+|$)(.*)$/s);
  if (mira) {
    input.value = "";
    void look(mira[1]);
    return;
  }
  if (!text || !link.send({ type: "text_input", text })) return;
  input.value = "";
  startTurn(text);
});
setInputOpen(false);

/** Her head center in page (CSS) px. */
function headOnPage(): [number, number] {
  const [hx, hy] = solve(director.last).headCenter;
  const r = stage.getBoundingClientRect();
  return [r.left + hx * SCALE, r.top + hy * SCALE];
}

// Poke: click on her. Pet: rub the mouse back and forth over her head.
stage.addEventListener("pointerdown", (e) => {
  if (e.button !== 0) return;
  pokeAt = performance.now();
  if (!teleporting) glitch.kick("poke", pokeAt);
});
stage.addEventListener("pointermove", (e) => {
  const [hx, hy] = headOnPage();
  if (Math.abs(e.clientY - hy) > 30 || Math.abs(e.clientX - hx) > 40) return;
  petEnergy += Math.abs(e.movementX);
  if (petEnergy > 60) {
    petAt = performance.now();
    petSide = e.clientX < hx ? -1 : 1;
  }
});

let lastHitbox = "";
let lastFrame = -1;
pet.app.ticker.add((ticker) => {
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
      if (inputRow.hidden) hideTimer = window.setTimeout(() => {
          if (!confirming) tx.hidden = true; // a pending choice stays up
        }, HIDE_AFTER_MS);
    }
  }
  if (!ended || typewriter.pending) lastTalk = now;
  petEnergy = Math.max(0, petEnergy - ticker.deltaMS * 0.08);
  if (falling) {
    falling.vy += GRAVITY * ticker.deltaMS;
    at.y += falling.vy * ticker.deltaMS;
    if (at.y >= floor()) {
      at.y = floor();
      falling = null;
      glitch.kick("change", now);
      const b = body();
      fx.burst(b.x, b.ground, b.size * 0.5, false);
    }
    placeHud();
  }
  if (now > nextWander) {
    nextWander = now + wanderGap();
    if (linkStatus === "idle" && tx.hidden && inputRow.hidden && now - lastTalk > LINGER_MS && !busy()) wander();
  }

  const frame = Math.floor(now / POSE_MS);
  if (frame === lastFrame) return; // pixel art pacing: 20 fps
  lastFrame = frame;
  const t = frame * POSE_MS;
  const s = avatar.pose(t);

  let look: [number, number] = [0, 0];
  if (cursor && now - cursorAt < LOOK_IDLE_MS) {
    const [hx, hy] = headOnPage();
    look = [Math.max(-1, Math.min(1, (cursor[0] - hx) / LOOK_RANGE)), Math.max(-1, Math.min(1, (cursor[1] - hy) / LOOK_RANGE))];
  }
  const { name, pose } = director.frame(
    { now: t, status: linkStatus === "looking" ? "thinking" : linkStatus, emocion: avatar.emocion, variant, lastTalk, pokeAt, petAt, greetAt },
    { look, petSide },
    { gesto: s.gesto, gestureT: s.gestureT, mouth: s.mouth, blinking: s.blinking },
  );
  // Behaviors with PixelLab sprite clips show those; the rest use the code-drawn pet.
  clips.update(name, t);
  const base = clips.frame(t);
  const eyes = possessing && { clip: "peligro", index: Math.min(8, Math.floor((now - possessing.since) / 100)) };
  const clipFrame = eyes || (gestureFrame(s.gesto, s.gestureT, base, name) ?? base);
  pet.showClip(clipFrame);
  if (!clipFrame) pet.paint(pose, t);
  const g = glitch.at(t, linkStatus === "idle" && name !== "pinchada");
  pet.glitch(reducedMotion.matches ? OFF : g, frame % 997);

  const boxes: number[][] = [];
  const b = teleporting ? null : pet.bounds(); // while she's gone, nothing to click
  if (b) {
    const r = stage.getBoundingClientRect();
    boxes.push([r.left + b.x, r.top + b.y, b.w, b.h]);
  }
  const ui = [...(inputRow.hidden ? [] : [inputRow, status]), ...(inputRow.hidden && !confirming ? [] : [tx])];
  for (const el of ui) {
    const r = el.getBoundingClientRect();
    if (r.width) boxes.push([r.left, r.top, r.width, r.height]);
  }
  const rounded = boxes.map((box) => box.map(Math.round));
  const key = rounded.map((box) => box.map((v) => Math.round(v / 4)).join()).join("|");
  if (key !== lastHitbox) {
    lastHitbox = key;
    void invoke("set_hitboxes", { boxes: rounded });
  }
});
