import "@fontsource/chakra-petch/600.css";
import "@fontsource/jetbrains-mono/400.css";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import type { Action, ClaudeEvent, ServerMessage } from "./net/protocol.ts";
import { connect } from "./net/ws.ts";
import { BEHAVIORS, Director, LINGER_MS } from "./pet/behaviors.ts";
import { ClipPlayer, gestureFrame, mouthCell, PERCHED, type ClipFrame, type Style } from "./pet/clips.ts";
import { GROUND, H, solve } from "./pet/rig.ts";
import { Fx, type Rect } from "./render/fx.ts";
import { CameraView } from "./render/camera.ts";
import { MASK_BOX, MaskView, type MaskLook } from "./render/mask.ts";
import { createPet, SCALE } from "./render/pet.ts";
import { AvatarState, POSE_MS } from "./state/avatar.ts";
import { panelFor, reaction, Tracker } from "./state/claude.ts";
import { CameraPlayer, shotFor, tagFor } from "./state/camera.ts";
import { Doze, sleepy } from "./state/doze.ts";
import { GlitchFx, OFF, VANISH_OUT_MS, type Glitch } from "./state/glitch.ts";
import { Mischief, PEEK_MS, peekPose, pickEdge, shy, type Edge, type PeekPose } from "./state/mischief.ts";
import { ledgeAt, pickSeat, seatOf, type Perch, type Point, type Windows } from "./state/perch.ts";
import { AURA_MAX_MS, zapEnd, zapStart, type BoltTarget } from "./state/zap.ts";
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
const DROP_TOLERANCE = 30; // px: let go this close to a window's top edge and she sits on it
const MASK_SCALE = 0.55; // her mask asleep, about 55 px wide
const WAKE_NEAR = 30; // px around the mask: the pointer this close wakes her
const STIR_NEAR = 110; // closer than this, she stirs and her eyes follow it
const HIDE_SCALE = 0.3; // /escondete: her mask, about half the size of the sleeping one
const HIDE_BLINK_MS = 4700; // hiding, she blinks once this often (130 ms)

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
const cam = $("cam");
const camTag = $("cam-tag");
const camClock = $("cam-clock");

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
const fxCanvas = $<HTMLCanvasElement>("fx");
const fx = new Fx(fxCanvas);
const director = new Director();
type AvatarSettings = { deambular: boolean; poseer_ventanas: boolean; estilo: string; dormir_min: number; camara: boolean };
const settings = await invoke<AvatarSettings>("avatar_settings");
let style: Style = settings.estilo === "pixel" ? "pixel" : "original";
let sleepAfter = settings.dormir_min * 60_000;
await pet.setStyle(style);
let clips = new ClipPlayer(style);
const glitch = new GlitchFx(performance.now());
const mischief = new Mischief(performance.now());
const petCanvas = pet.app.canvas as HTMLCanvasElement;
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
const doze = new Doze();
const mask = new MaskView($<HTMLCanvasElement>("mask"), MASK_SCALE);
const hideMask = new MaskView($<HTMLCanvasElement>("hide"), HIDE_SCALE);
const camView = new CameraView($<HTMLCanvasElement>("cam-feed"));
const camPlayer = new CameraPlayer();
let camera = false; // camera mode: her close-ups in a transmission frame instead of her body

/** Camera mode on or off: the feed takes her body's place (same spot, same ledges). */
async function setCamera(on: boolean): Promise<void> {
  if (on) await camView.load();
  camera = on;
  cam.hidden = !on;
  pet.app.stage.visible = !on;
}
await setCamera(settings.camara);
if (import.meta.env.DEV) Object.assign(window, { __capri: { director, doze, mask, zap, fx, hide, unhide, hiding: () => hiding, startPeek, peek: () => peek, zapCursor, camera: () => camera, camPlayer, clips: () => clips, style: () => style, glitch, teleport, possess, fall, hop: () => teleport(pickSeat(wins, limits(), { except: perch?.id })), wins: () => wins, perch: () => perch, at: () => at } }); // inspection from devtools

let turn = 0;
let awaiting = false; // a message of ours is being answered; a turn without one is Capri's own (a reminder)
let confirming: string | null = null; // id of the confirmation on screen
let confirmingRed = false; // a red one takes only a click, never a key
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
let press: { x: number; y: number; dx: number; dy: number } | null = null; // pointer down on her
let dragging = false;
const claudeTrack = new Tracker();
const claudeEl = $("claude");
const claudePanel = $("claude-panel");
let claudeLine = "";
let claudeGap = 0;
let claudePending: { title: string; body: string } | null = null; // Claude finished while she was hiding
let claudeTimer = 0;
let dnd = false; // do not disturb (the backend owns it; this mirrors it for the status bar)
let fullscreen = false; // a fullscreen app is in front: hidden and not rendering
let nextWander = performance.now() + wanderGap();
let wins: Windows = { fg: 0, wins: [] };
let perch: Perch | null = null; // the window she sits on; null = the taskbar
let at: Point = { x: 0, y: 0 }; // her feet, page px
let activeAt = performance.now(); // last time you did something with her (talking counts through lastTalk)
let pcIdle = 0; // ms since the last keyboard or mouse input anywhere
let maskOffset: Point = { x: 0, y: 0 }; // asleep: her mask, from her feet (it rides along with her window)
let acting: object | null = null; // a tool running: her sparks last while this is the same run
let peek: (PeekPose & { until: number; ducks: number }) | null = null; // peeking in from a screen edge
let hiding = false; // /escondete: just her small mask in the bottom-left corner, eyes open

function wanderGap(): number {
  return WANDER_MS[0] + Math.random() * (WANDER_MS[1] - WANDER_MS[0]);
}

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));
const busy = () => teleporting || !!possessing || !!falling || dragging || doze.asleep || !!peek || hiding;
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

/** Her opaque area in canvas px, mirrored too when she sits mirrored. */
function petBounds(): { x: number; y: number; w: number; h: number } | null {
  const b = pet.bounds();
  return b && petCanvas.style.transform === "scaleX(-1)" ? { ...b, x: petCanvas.offsetWidth - b.x - b.w } : b;
}

/** Her body on the page: center, feet line, and rough size, for the screen effects. */
function body(): { x: number; y: number; ground: number; size: number } {
  if (peek) {
    const c = petCanvas.getBoundingClientRect();
    return { x: c.left + c.width / 2, y: c.top + c.height / 2, ground: c.bottom, size: Math.min(c.width, c.height) * 0.7 };
  }
  if (camera) {
    const c = cam.getBoundingClientRect();
    return { x: c.left + c.width / 2, y: c.top + c.height / 2, ground: c.bottom, size: c.width };
  }
  const r = stage.getBoundingClientRect();
  const b = petBounds() ?? { x: 0, y: 0, w: r.width, h: r.height };
  return { x: r.left + b.x + b.w / 2, y: r.top + b.y + b.h / 2, ground: r.top + b.y + b.h, size: Math.max(b.w, b.h) };
}

/** Somewhere on the taskbar at least a third of it away from here. */
function farOnTaskbar(): Point {
  const spot = (at.x - EDGE - hud.offsetWidth / 2) / (innerWidth - hud.offsetWidth - 2 * EDGE);
  return onTaskbar(spot > 0.5 ? Math.random() * Math.max(0, spot - 0.35) : Math.min(1, spot + 0.35 + Math.random() * (0.65 - spot)));
}

/** What she looks like right now and where (her canvas, or the feed in camera mode), for afterimages. */
function likeness(): { img: HTMLCanvasElement; x: number; y: number } {
  const el = camera ? cam : petCanvas;
  const r = el.getBoundingClientRect();
  let img: HTMLCanvasElement;
  if (camera) {
    img = document.createElement("canvas");
    img.width = r.width;
    img.height = r.height;
    img.getContext("2d")!.drawImage(camView.canvas, 0, 0, r.width, r.height);
  } else img = pet.snapshot();
  return { img, x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

/** Her afterimages from where she was (`was`) to where she is now. */
function trail(was: ReturnType<typeof likeness>): void {
  const el = camera ? cam : petCanvas;
  const r = el.getBoundingClientRect();
  fx.ghosts(was.img, was, { x: r.left + r.width / 2, y: r.top + r.height / 2 });
}

/** Collapses, leaves a column of light, streaks to `to` (a window ledge, or null: the taskbar) and lands. */
async function teleport(to: Perch | null = null, { dive = false } = {}): Promise<void> {
  if (teleporting || falling) return;
  teleporting = true;
  const from = body();
  const was = !reducedMotion.matches && !dive ? likeness() : null;
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
    if (was) trail(was);
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
  await teleport(pickSeat(wins, limits(), { except: id }), { dive: true });
}

/** Wandering: another ledge or the taskbar, or, sitting on a window, possessing it now and then,
 * as far as config.toml [avatar] allows (read each time, so edits apply without a restart). */
async function wander(): Promise<void> {
  const cfg = await invoke<AvatarSettings>("avatar_settings");
  if (perch && cfg.poseer_ventanas && !camera && Math.random() < 0.3) {
    void possess();
    return;
  }
  if (cfg.deambular && !camera && Math.random() < 0.2) {
    void startPeek();
    return;
  }
  if (cfg.deambular) void teleport(Math.random() < 0.6 ? pickSeat(wins, limits(), { except: perch?.id }) : null);
}

/** Puts her canvas half off a screen edge (or upside down from the top); null puts it back under the HUD. */
function placePeek(p: PeekPose | null): void {
  if (!p) {
    petCanvas.style.transform = "";
    return;
  }
  const r = stage.getBoundingClientRect(); // where the canvas sits untransformed
  const dx = p.cx - (r.left + r.width / 2), dy = p.cy - (r.top + r.height / 2);
  petCanvas.style.transform = `translate(${Math.round(dx)}px, ${Math.round(dy)}px) rotate(${p.rot}deg) scaleX(${p.flip ? -1 : 1})`;
}

/** Vanishes, and comes back peeking in from an edge (another one than now), or (edge null) back under her HUD. */
async function hopPeek(edge: Edge | null, ducks = 0): Promise<void> {
  if (teleporting) return;
  teleporting = true;
  const was = likeness();
  if (!reducedMotion.matches) {
    glitch.kick("vanish", performance.now());
    fx.burst(was.x, was.y, petCanvas.offsetHeight * 0.5, false);
    await sleep(VANISH_OUT_MS);
  }
  const now = performance.now();
  const pose = edge && peekPose(edge, innerWidth, innerHeight, Math.random());
  peek = pose ? { ...pose, until: now + PEEK_MS[0] + Math.random() * (PEEK_MS[1] - PEEK_MS[0]), ducks } : null;
  placePeek(pose);
  if (!reducedMotion.matches) {
    trail(was);
    glitch.kick("arrive", performance.now());
    const b = body();
    fx.burst(b.x, b.y, b.size, true);
  }
  teleporting = false;
}

/** Sometimes, instead of moving along the taskbar or the windows, she peeks in from a screen edge. */
function startPeek(edge?: Edge): Promise<void> {
  return hopPeek(edge ?? pickEdge(Math.random, peek?.edge));
}

/** The pointer came near, idle: a red bolt at it and a sly grin. */
function zapCursor(): void {
  if (!cursor) return;
  const now = performance.now();
  const at = () => ({ x: cursor![0], y: cursor![1] });
  fx.bolt(() => body(), at, 380);
  fx.crackle(() => ({ ...at(), r: 40 }), () => true, 500);
  glitch.kick("change", now);
  avatar.setEmotion("traviesa");
  lastTalk = Math.max(lastTalk, now - LINGER_MS + 2500); // grins for a couple of seconds
}

/** Where she hides: the bottom-left corner, just over the taskbar (the right one has the tray and the clock). */
function hideSpot(): Point {
  return { x: EDGE + (6 - MASK_BOX.left * HIDE_SCALE), y: floor() - (10 + MASK_BOX.bottom * HIDE_SCALE) };
}

/** /escondete: she comes apart and streaks off to the corner, where only a small mask is left, eyes open on the pointer. */
function hide(): void {
  if (hiding || teleporting || doze.asleep) return;
  if (peek) {
    peek = null;
    placePeek(null);
  }
  hiding = true;
  clearTimeout(hideTimer);
  hideTx(); // nothing of hers left floating around
  glitch.kick("doze", performance.now());
  cam.style.visibility = "hidden";
  if (!reducedMotion.matches) {
    const b = body(), to = hideSpot();
    fx.burst(b.x, b.y, b.size * 0.4, false);
    fx.streak(b.x, b.y, to.x, to.y);
  }
}

/** Out of hiding (a click on her mask, /vuelve, /escondete again, or something to say). */
function unhide(): void {
  if (!hiding) return;
  hiding = false;
  if (claudePending) showClaudePanel(claudePending, true);
  claudePending = null;
  hideMask.show(false);
  cam.style.visibility = "";
  glitch.kick("arrive", performance.now());
  if (!reducedMotion.matches) {
    const b = body(), from = hideSpot();
    fx.streak(from.x, from.y, b.x, b.y);
    fx.burst(b.x, b.y, b.size, true);
  }
}

/** Hiding: the small mask in its corner, eyes open on the pointer, a blink now and then. */
function drawHide(now: number): void {
  // shown once her body has come apart
  const shown = hiding && glitch.at(now, false).collapse >= 1;
  hideMask.show(shown);
  if (!shown) return;
  hideMask.center = hideSpot();
  const blink = now % HIDE_BLINK_MS < 130;
  hideMask.draw(
    { eyes: blink ? [0, 0] : [1, 1], look: cursor ? { x: cursor[0], y: cursor[1] } : null },
    { bob: reducedMotion.matches ? 0 : [0, -1, -2, -1][Math.floor(now / 600) % 4], px: style === "pixel" ? SCALE : 1 },
  );
}
hideMask.canvas.addEventListener("pointerdown", () => unhide());

/** /cierra: she vanishes, and Capri closes, stopping Ollama too (it holds her model in VRAM). */
async function quit(): Promise<void> {
  setInputOpen(false);
  if (!reducedMotion.matches) {
    glitch.kick("vanish", performance.now());
    const b = body();
    fx.burst(b.x, b.y, b.size, false);
    await sleep(VANISH_OUT_MS + 150);
  }
  await invoke("quit", { stopOllama: true });
}

/** A long while with nobody around: she comes apart and only her mask is left, eyes shut, where her head was. */
function fallAsleep(now: number): void {
  const [hx, hy] = headOnPage();
  maskOffset = { x: hx - at.x, y: hy - at.y };
  doze.start(now);
  glitch.kick("doze", now);
  if (!reducedMotion.matches) {
    const b = body();
    fx.burst(b.x, b.y, b.size * 0.5, false);
  }
}

/** Her eyes snap open (the ticker brings her body back after them). */
function wakeUp(): void {
  const now = performance.now();
  activeAt = now;
  if (!doze.asleep) return;
  doze.wake(now);
  if (!doze.asleep) back(now); // she was still coming apart
}

function back(now: number): void {
  mask.show(false);
  glitch.kick("arrive", now);
  if (!reducedMotion.matches) {
    const b = body();
    fx.burst(b.x, b.y, b.size, true);
  }
  greetAt = now; // she says hi again
  lastTalk = Math.max(lastTalk, now - LINGER_MS); // awake and idle, not straight back to her nap
}

// Once in a while: how long the PC has been idle, and the setting (edits apply without a restart).
setInterval(async () => {
  pcIdle = await invoke<number>("idle_ms");
  sleepAfter = (await invoke<AvatarSettings>("avatar_settings")).dormir_min * 60_000;
}, 10_000);

function setStatus(s: Status): void {
  if (s === "thinking" || s === "speaking" || s === "looking") {
    wakeUp();
    unhide(); // she comes out to answer
  }
  if (s !== "down" && linkStatus === "down") greetAt = performance.now();
  if (s === "looking") fx.scan();
  if (s === "thinking" && linkStatus === "idle" && !awaiting) startTurn(""); // she speaks up on her own
  if (s === "idle") awaiting = false;
  if (linkStatus === "looking" && s !== "looking") guardOff(); // the shot is taken
  if (s === "thinking" && linkStatus !== "thinking" && !busy()) {
    // while she works, she sits on the window in front if she can
    const seat = pickSeat(wins, limits(), { frontOnly: true });
    if (seat && seat.id !== perch?.id) void teleport(seat);
  }
  linkStatus = s;
  status.dataset.state = s;
  statusLabel.textContent = s === "idle" && dnd ? "NO MOLESTAR" : STATUS[s];
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
        wakeUp();
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
        showChoices(msg.id, msg.texto, msg.riesgo === "alto");
        break;
      case "mode":
        dnd = msg.no_molestar;
        status.dataset.dnd = dnd ? "1" : "";
        setStatus(linkStatus);
        break;
      case "action":
        zap(msg);
        break;
      case "claude":
        onClaude(msg, now);
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

/** Claude mode: the ticker follows the session that moved last; she reacts and shows Claude's words unless hiding or on do-not-disturb. */
function onClaude(msg: ClaudeEvent, now: number): void {
  claudeTrack.push(msg, now);
  const react = reaction(msg);
  if (react && !hiding && !dnd && !teleporting && !possessing && !falling && !dragging && !peek) {
    wakeUp();
    if (avatar.setEmotion(react.emocion)) glitch.kick("change", now);
    avatar.playGesture(react.gesto, now);
    lastTalk = Math.max(lastTalk, now - LINGER_MS + 3500);
  }
  const panel = panelFor(msg);
  if (!panel) return;
  const asked = msg.estado === "respuesta"; // she was asked for it: it shows even on do-not-disturb or when hiding
  if (asked && hiding) unhide();
  if (!hiding && (asked || !dnd)) showClaudePanel(panel, !asked);
  else claudePending = panel;
}

function showClaudePanel(p: { title: string; body: string }, autoClose: boolean): void {
  $("claude-title").textContent = p.title;
  $("claude-body").textContent = p.body;
  claudePanel.hidden = false;
  $("claude-body").scrollTop = 0;
  clearTimeout(claudeTimer);
  if (autoClose) claudeTimer = window.setTimeout(() => (claudePanel.hidden = true), 45_000);
}

$("claude-close").addEventListener("click", () => (claudePanel.hidden = true));
claudePanel.addEventListener("mouseenter", () => clearTimeout(claudeTimer));
claudePanel.addEventListener("mouseleave", () => {
  clearTimeout(claudeTimer);
  claudeTimer = window.setTimeout(() => (claudePanel.hidden = true), 15_000);
});

/** Every frame: the ticker text and tone, and its height over the taskbar. */
function drawClaude(now: number): void {
  const line = claudeTrack.line(now);
  claudeEl.hidden = !line;
  if (line) {
    const text = line.text;
    if (text !== claudeLine) $("claude-text").textContent = claudeLine = text;
    claudeEl.dataset.tone = line.tone;
    claudeEl.dataset.hiding = hiding ? "1" : "";
  }
  const gap = Math.round(innerHeight - floor()) + 8;
  if (gap !== claudeGap) {
    claudeGap = gap;
    document.documentElement.style.setProperty("--floor-gap", `${gap}px`);
  }
}

/** Where a bolt goes: the middle of the screen, the tray corner, or the window in front (nearest point). */
function boltTo(target: BoltTarget): Point {
  const front = wins.wins.find((w) => w.id === wins.fg && !w.max);
  if (target === "tray") return { x: innerWidth - 40, y: innerHeight - 20 };
  if (target === "window" && front) {
    const b = body();
    return { x: Math.min(Math.max(b.x, front.x), front.x + front.w), y: Math.min(Math.max(b.y, front.y), front.y + front.h) };
  }
  return { x: innerWidth / 2, y: innerHeight / 2 };
}

/** Her lightning while a tool runs (David's arcs in the show), and how it ends. */
function zap(a: Action): void {
  if (reducedMotion.matches) return;
  const now = performance.now();
  const aura = () => {
    const b = body();
    return { x: b.x, y: b.y, r: b.size * 0.6 };
  };
  if (a.fase === "inicio") {
    const z = zapStart(a.nombre);
    if (!z) return;
    wakeUp();
    const run = {};
    acting = run;
    fx.crackle(aura, () => acting === run, AURA_MAX_MS);
    glitch.kick("change", now);
    if (z.bolt) {
      const to = boltTo(z.bolt);
      fx.bolt(() => body(), () => to);
    }
    const front = wins.wins.find((w) => w.id === wins.fg && !w.max);
    if (z.frame && front) fx.surge(front);
    return;
  }
  acting = null;
  const end = zapEnd(a.nombre, a.ok, a.ms);
  const b = body();
  if (end === "fallo") {
    glitch.kick("hurt", now);
    fx.impact(b.x, b.y);
  } else if (end === "chispa") {
    fx.crackle(aura, () => true, 450);
  } else if (end === "victoria") {
    void victory();
  }
}

/** Done with something big: speed lines and a shockwave, and an anime cut-in of her laughing or grinning. */
async function victory(): Promise<void> {
  const b = body();
  glitch.kick("change", performance.now());
  fx.rush(b.x, b.y);
  await camView.load();
  const still = camView.still(Math.random() < 0.5 ? "risa" : "sonrisa", 1);
  if (!still) return;
  const dir = b.x > innerWidth / 2 ? -1 : 1; // toward the middle of the screen
  const x = Math.min(Math.max(b.x + dir * 190, 140), innerWidth - 140);
  fx.cutin(x, Math.max(90, b.y - 140), still, dir);
}

/** An action with effects waits on a click: [1] do it (marked), [2] don't. Neither is preselected.
 *  A red one (deleting, installing, outside her folder, after reading outside content) shows as danger. */
function showChoices(id: string, what: string, red = false): void {
  confirming = id;
  confirmingRed = red;
  const option = (n: 1 | 2, label: string) => {
    const li = document.createElement("li");
    const b = document.createElement("button");
    b.type = "button";
    b.className = n === 1 ? (red ? "danger" : "warn") : "";
    b.innerHTML = `<span class="mark">[${n}]${n === 1 ? (red ? " ⚠⚠ PELIGROSO" : " ⚠") : ""}</span> `;
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
  confirmingRed = false;
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
  if (confirmingRed && e.key === "1") return; // the red one: only a click
  e.preventDefault();
  answer(e.key === "1");
});

// The window lets clicks through except over the boxes reported to Rust each frame: Capri, the
// input bar and transmission while the bar is open, and the transmission while a choice waits.
function setInputOpen(open: boolean): void {
  if (open) wakeUp();
  inputRow.hidden = !open;
  hud.classList.toggle("input-open", open);
  if (open) {
    input.focus();
    if (txText.textContent) showTx();
  } else if (!tx.hidden && !tx.classList.contains("typing") && !hideTimer) {
    // she's done talking: the transmission goes like it does with the bar closed
    hideTimer = window.setTimeout(hideTx, HIDE_AFTER_MS);
  }
}

/** The transmission goes away, unless a choice still waits on it. */
function hideTx(): void {
  hideTimer = 0;
  if (!confirming) tx.hidden = true;
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
void listen("look", () => {
  wakeUp();
  void look("");
});
void listen("dnd", () => link.send({ type: "hotkey", name: "no_molestar" }));
// A game or video fullscreen in front: hide, stop rendering (no GPU while you play), keep quiet.
void listen<boolean>("fullscreen", (e) => {
  if (e.payload === fullscreen) return;
  fullscreen = e.payload;
  hud.style.visibility = fxCanvas.style.visibility = mask.canvas.style.visibility = hideMask.canvas.style.visibility = fullscreen ? "hidden" : "";
  if (fullscreen) {
    pet.app.ticker.stop();
    lastHitbox = "";
    void invoke("set_hitboxes", { boxes: [] }); // nothing of hers to click while hidden
  } else {
    pet.app.ticker.start();
  }
  link.send({ type: "presence", fullscreen });
});
// Ctrl+Alt+Shift+P: the show's art <-> the pixel pet, saved in config.toml for next time.
void listen("style", async () => {
  const next: Style = style === "pixel" ? "original" : "pixel";
  await pet.setStyle(next);
  style = next;
  clips = new ClipPlayer(style);
  glitch.kick("change", performance.now());
  void invoke("save_style", { estilo: style }).catch((e) => console.warn("save_style", e));
});
// Ctrl+Alt+Shift+C: camera mode on/off, saved in config.toml for next time.
void listen("camera", async () => {
  await setCamera(!camera);
  glitch.kick("change", performance.now());
  void invoke("save_camera", { on: camera }).catch((e) => console.warn("save_camera", e));
});
void listen("teleport", () => hiding ? unhide() : doze.asleep ? wakeUp() : void teleport(pickSeat(wins, limits(), { except: perch?.id })));
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
  if (doze.phase === "mask" && nearMask(WAKE_NEAR)) wakeUp();
  if (!busy() && linkStatus === "idle" && tx.hidden && inputRow.hidden && !reducedMotion.matches) {
    const b = body();
    if (mischief.zap(cursorAt, Math.hypot(cursor[0] - b.x, cursor[1] - b.y), true)) zapCursor();
  }
});
mask.canvas.addEventListener("pointerdown", () => wakeUp());

/** The pointer within `pad` px of her mask (in camera mode, of the feed showing it). */
function nearMask(pad: number): boolean {
  if (!cursor) return false;
  const c = cam.getBoundingClientRect();
  const [x, y, w, h] = camera ? [c.left, c.top, c.width, c.height] : mask.box();
  return cursor[0] >= x - pad && cursor[0] <= x + w + pad && cursor[1] >= y - pad && cursor[1] <= y + h + pad;
}
/** What she was sent from the bar, oldest first, kept between launches; ↑/↓ walk it like a shell. */
const HISTORY_MAX = 100;
const history: string[] = (() => {
  try {
    return JSON.parse(localStorage.getItem("capri.history") ?? "[]");
  } catch {
    return [];
  }
})();
let historyAt = history.length; // history.length = the line being typed
let draft = "";

function remember(text: string) {
  if (text && history[history.length - 1] !== text) history.push(text);
  history.splice(0, history.length - HISTORY_MAX);
  historyAt = history.length;
  draft = "";
  try {
    localStorage.setItem("capri.history", JSON.stringify(history));
  } catch {
    /* private mode: the history just lasts this session */
  }
}

input.addEventListener("keydown", (e) => {
  if (e.key === "Escape") setInputOpen(false);
  if ((e.key !== "ArrowUp" && e.key !== "ArrowDown") || e.shiftKey || e.altKey || e.ctrlKey) return;
  e.preventDefault();
  if (e.key === "ArrowUp" ? historyAt === 0 : historyAt === history.length) return;
  if (historyAt === history.length) draft = input.value; // leaving the line being typed: keep it
  historyAt += e.key === "ArrowUp" ? -1 : 1;
  input.value = history[historyAt] ?? draft;
  input.setSelectionRange(input.value.length, input.value.length);
});
inputRow.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (text) remember(text);
  // her own commands, handled here (the backend has /olvida and /nomolestes)
  const command = { "/escondete": () => (hiding ? unhide() : hide()), "/vuelve": unhide, "/cierra": () => void quit() }[text.toLowerCase()];
  if (command) {
    input.value = "";
    if (text.toLowerCase() !== "/cierra") setInputOpen(false);
    command();
    return;
  }
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
  if (peek) {
    const b = body();
    return [b.x, b.y];
  }
  if (camera) {
    const c = cam.getBoundingClientRect();
    return [c.left + c.width / 2, c.top + c.height * 0.4];
  }
  const r = stage.getBoundingClientRect();
  const b = style === "original" && petBounds();
  if (b) return [r.left + b.x + b.w / 2, r.top + b.y + b.h * 0.3]; // her mask, under the mane
  const [hx, hy] = solve(director.last).headCenter;
  return [r.left + hx * SCALE, r.top + hy * SCALE];
}

/** The show's art: hanging while dragged or falling, sitting on windows, the jaw while she talks. */
function originalFrame(base: ClipFrame | null, now: number, talking: boolean): [ClipFrame | null, number | null] {
  if (dragging || falling) return [{ clip: "dangle", index: Math.floor(now / 100) % 24 }, null];
  if (possessing) return [{ clip: perch ? "perch_glitch" : "glitch", index: Math.min(9, Math.floor((now - possessing.since) / 90)) }, null];
  const mouth = talking ? mouthCell(avatar.mouth ?? "closed", base) : null;
  if (perch && base && PERCHED[base.clip]) return [{ clip: PERCHED[base.clip], index: base.index }, null];
  return [base, mouth];
}

// Poke: click on her. Drag: press and move, she follows the pointer and, let go on a window's top
// edge, sits there (anywhere else she falls). Pet: rub the mouse back and forth over her head.
stage.addEventListener("pointerdown", (e) => {
  if (doze.asleep) return wakeUp(); // the feed showing her mask
  if (peek && !teleporting) return void hopPeek(null); // caught peeking: back to her spot
  if (e.button !== 0 || busy()) return;
  activeAt = performance.now();
  press = { x: e.clientX, y: e.clientY, dx: at.x - e.clientX, dy: at.y - e.clientY };
  stage.setPointerCapture(e.pointerId);
});
stage.addEventListener("pointerup", () => {
  if (!press) return;
  const dragged = dragging;
  press = null;
  dragging = false;
  if (dragged) {
    drop();
    return;
  }
  pokeAt = performance.now();
  if (!teleporting) glitch.kick("poke", pokeAt);
});

/** Let go after a drag: onto the ledge under her feet, if any; otherwise she falls to the taskbar. */
function drop(): void {
  const seat = ledgeAt(wins, at, limits(), DROP_TOLERANCE);
  const there = seat && seatOf(wins, seat, limits());
  if (seat && there) {
    perch = seat;
    at = there;
    placeHud();
    glitch.kick("change", performance.now());
  } else if (at.y < floor()) {
    fall();
  }
}

stage.addEventListener("pointermove", (e) => {
  if (press) {
    if (!dragging && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 6) {
      dragging = true;
      perch = null;
      glitch.kick("change", performance.now());
    }
    if (dragging) {
      const half = hud.offsetWidth / 2 + EDGE;
      at = { x: Math.min(Math.max(e.clientX + press.dx, half), innerWidth - half), y: Math.min(e.clientY + press.dy, floor()) };
      placeHud();
    }
    return;
  }
  const [hx, hy] = headOnPage();
  if (Math.abs(e.clientY - hy) > 30 || Math.abs(e.clientX - hx) > 40) return;
  petEnergy += Math.abs(e.movementX);
  if (petEnergy > 60) {
    petAt = performance.now();
    petSide = e.clientX < hx ? -1 : 1;
  }
});

/** Asleep: her mask's eyes (stirring as the pointer comes close); null while she's awake. */
function maskLook(now: number): MaskLook | null {
  if (doze.phase !== "mask" && doze.phase !== "waking") return null;
  const stirred = doze.phase === "mask" && nearMask(STIR_NEAR);
  return doze.landing(now)
    ? { eyes: [0, 0], flat: "#fff4f6" }
    : { eyes: doze.eyes(now, stirred), look: stirred && cursor ? { x: cursor[0], y: cursor[1] } : null };
}

/** Asleep: her mask floating where her head was, bobbing slowly (in camera mode the feed shows it instead). */
function drawMask(now: number): void {
  const look = camera ? null : maskLook(now);
  mask.show(!!look);
  if (!look) return;
  mask.center = { x: at.x + maskOffset.x, y: at.y + maskOffset.y };
  const calm = reducedMotion.matches;
  mask.draw(look, {
    bob: calm ? 0 : [0, -1.5, -3, -1.5][Math.floor(now / 500) % 4],
    shake: doze.phase === "waking" && !calm ? Math.round(Math.random() * 4 - 2) : 0,
    px: style === "pixel" ? SCALE : 1,
  });
}

/** Camera mode: the shot for the moment (cuts glitch), its tag, the clock, the voice level. */
function drawFeed(now: number, g: Glitch, seed: number): void {
  const sc = {
    status: linkStatus,
    emocion: avatar.emocion,
    talking: now - lastTalk < LINGER_MS,
    listening: !inputRow.hidden,
    confirming: !!confirming,
    asleep: doze.phase === "mask" || doze.phase === "waking",
  };
  if (camPlayer.want(shotFor(sc), now) && !doze.asleep) glitch.kick("change", now);
  camTag.textContent = tagFor(sc);
  camClock.textContent = new Date().toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit", hour12: false });
  cam.classList.toggle("talking", !ended || typewriter.pending);
  camView.draw({ frame: camPlayer.frame(now), glitch: reducedMotion.matches ? OFF : g, seed, mask: maskLook(now) });
}

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
      if (inputRow.hidden) hideTimer = window.setTimeout(hideTx, HIDE_AFTER_MS);
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
  const was = doze.phase;
  if (doze.tick(now) === "awake" && was === "waking") back(now);
  if (!doze.asleep && linkStatus === "idle" && tx.hidden && inputRow.hidden && !confirming && !busy() &&
      sleepy(sleepAfter, now - Math.max(lastTalk, activeAt), pcIdle)) fallAsleep(now);
  if (peek && !teleporting) {
    // shy: the pointer close sends her to another edge (twice at most); time's up, or you need her: back
    const needed = linkStatus !== "idle" || !inputRow.hidden || !tx.hidden || !!confirming;
    if (needed || now > peek.until || (shy(peek, cursor) && peek.ducks >= 2)) void hopPeek(null);
    else if (shy(peek, cursor)) void hopPeek(pickEdge(Math.random, peek.edge), peek.ducks + 1);
  }
  if (now > nextWander) {
    nextWander = now + wanderGap();
    if (linkStatus === "idle" && tx.hidden && inputRow.hidden && now - lastTalk > LINGER_MS && !busy()) void wander();
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
  // Behaviors with sprite clips show those; in the pixel style the rest use the code-drawn pet.
  clips.update(name, t);
  const base = clips.frame(t);
  let clipFrame: ClipFrame | null;
  let jaw: number | null = null;
  if (style === "original") [clipFrame, jaw] = originalFrame(base, now, BEHAVIORS[name].talks && !!s.mouth);
  else {
    const eyes = possessing && { clip: "peligro", index: Math.min(8, Math.floor((now - possessing.since) / 100)) };
    clipFrame = eyes || (gestureFrame(s.gesto, s.gestureT, base, name) ?? base);
  }
  pet.showClip(clipFrame, jaw);
  // on a window's left corner the show's art sits mirrored, legs hanging out to the left
  const mirror = !peek && style === "original" && perch?.side === "left" ? "scaleX(-1)" : "";
  if (!peek && petCanvas.style.transform !== mirror) petCanvas.style.transform = mirror;
  if (!clipFrame) pet.paint(pose, t);
  const g = glitch.at(t, linkStatus === "idle" && name !== "pinchada");
  pet.glitch(reducedMotion.matches ? OFF : g, frame % 997);
  if (camera) drawFeed(now, g, frame % 997);

  drawMask(now);
  drawHide(now);
  drawClaude(now);
  const boxes: number[][] = dragging ? [[0, 0, innerWidth, innerHeight]] : []; // a fast drag must not slip off her
  if (!mask.canvas.hidden) boxes.push(mask.box());
  if (!hideMask.canvas.hidden) boxes.push(hideMask.box());
  const b = teleporting || doze.asleep || camera || peek || hiding ? null : petBounds(); // while she's gone, nothing to click
  if (peek && !teleporting) {
    const c = petCanvas.getBoundingClientRect();
    boxes.push([c.left, c.top, c.width, c.height]);
  }
  if (camera && !teleporting && !hiding) {
    const c = cam.getBoundingClientRect();
    boxes.push([c.left, c.top, c.width, c.height]);
  }
  if (b) {
    const r = stage.getBoundingClientRect();
    boxes.push([r.left + b.x, r.top + b.y, b.w, b.h]);
  }
  const ui = [...(claudePanel.hidden ? [] : [claudePanel]), ...(inputRow.hidden ? [] : [inputRow, status]), ...(inputRow.hidden && !confirming ? [] : [tx])];
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
