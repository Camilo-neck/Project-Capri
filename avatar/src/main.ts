import "@fontsource/chakra-petch/600.css";
import "@fontsource/jetbrains-mono/400.css";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { parse } from "./commands.ts";
import { camHeight, camResize, camWidth, type Corner } from "./state/camsize.ts";

import grinFace from "../assets/faces/grin.png";
import lookFace from "../assets/faces/look.png";

import { mountPlayer } from "./player.ts";
import * as sfx from "./sfx.ts";
import type { SfxKind } from "./sfxrecipes.ts";
import type { GlitchKind } from "./state/glitch.ts";
import type { Action, Buttons, ClaudeEvent, Emocion, PcEvent, ServerMessage, VoiceState } from "./net/protocol.ts";
import { connect } from "./net/ws.ts";
import { BEHAVIORS, Director, LINGER_MS } from "./pet/behaviors.ts";
import { ClipPlayer, gestureFrame, mouthCell, PERCHED, type ClipFrame, type Style } from "./pet/clips.ts";
import { GROUND, H, solve } from "./pet/rig.ts";
import { Fx, type Rect } from "./render/fx.ts";
import { IntroView } from "./render/intro.ts";
import { PixelIntroView } from "./render/pixelintro.ts";
import { Portrait } from "./render/portrait.ts";
import { cutinFor, faceSquare, portraitFor } from "./state/faces.ts";
import { reaction as pcReaction } from "./state/pc.ts";
import { Follow, sideOf } from "./state/screens.ts";
import { CameraView } from "./render/camera.ts";
import { MASK_BOX, MaskView, type MaskLook } from "./render/mask.ts";
import { createPet, SCALE } from "./render/pet.ts";
import { AvatarState, POSE_MS } from "./state/avatar.ts";
import { bigJob, panelFor, reaction, SPARK_GAP_MS, sparkFor, Tracker, type Panel } from "./state/claude.ts";
import { CameraPlayer, type ShotName, shotFor, tagFor } from "./state/camera.ts";
import { micView } from "./state/mic.ts";
import { AwayWatch, backLine, speaksOnBack } from "./state/away.ts";
import { Doze, sleepy, WAKE_MS } from "./state/doze.ts";
import { GlitchFx, OFF, VANISH_OUT_MS, type Glitch } from "./state/glitch.ts";
import { ResumeWatch, resumeLine, TICK_MS } from "./state/resume.ts";
import { juggleOrbs, spinScale, Tricks, TRICK_MS, type Trick } from "./state/tricks.ts";
import { Mischief, PEEK_MS, peekPose, pickEdge, shy, type Edge, type PeekPose } from "./state/mischief.ts";
import { canSit, ledgeAt, pickSeat, roomNeeded, seatOf, type Perch, type Point, type Windows } from "./state/perch.ts";
import { type Flight, type Hit, launch, step, Temper, thrown, Velocity } from "./state/throw.ts";
import { AURA_MAX_MS, zapEnd, zapStart, type BoltTarget, type Zap } from "./state/zap.ts";
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
const micDot = $("mic-dot");
const micChip = $("mic-chip");
const micText = $("mic-text");
const inputRow = $<HTMLFormElement>("input-row");
const input = $<HTMLInputElement>("input");
const stage = $("stage");
stage.style.visibility = "hidden"; // until her intro brings her in (playIntro)
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
// her intro when she starts: her close-up grabs the screen, says hi and dives down to her spot
const introHooks = {
  burst: (x: number, y: number, size: number) => fx.burst(x, y, size, false),
  crackle: (x: number, y: number, r: number, life: number) => fx.crackle(() => ({ x, y, r }), () => true, life),
  rush: (x: number, y: number) => fx.rush(x, y),
};
const showIntro = new IntroView($<HTMLCanvasElement>("intro"), introHooks); // the show's close-up (Original)
const pixelIntro = new PixelIntroView($<HTMLCanvasElement>("intro"), introHooks); // her own pixels (Pixel)
const intro = { // whichever is on
  get playing() { return showIntro.playing || pixelIntro.playing; },
  skip() { showIntro.skip(); pixelIntro.skip(); },
};
const director = new Director();
type AvatarSettings = { deambular: boolean; poseer_ventanas: boolean; estilo: string; dormir_min: number; camara: boolean; seguir_pantallas: boolean; camara_ancho: number; sonido: boolean; sonido_volumen: number };
const settings = await invoke<AvatarSettings>("avatar_settings");
let style: Style = settings.estilo === "pixel" ? "pixel" : "original";
let sleepAfter = settings.dormir_min * 60_000;
await pet.setStyle(style);
let clips = new ClipPlayer(style);
const glitch = new GlitchFx(performance.now());
const KICK_SFX: Record<GlitchKind, SfxKind | null> = { twitch: null, change: "blip", poke: "poke", hurt: "hurt", vanish: "vanish", arrive: "arrive", doze: "sleep" };
glitch.onKick = (kind) => sfx.play(KICK_SFX[kind]);
const mischief = new Mischief(performance.now());
const tricks = new Tricks(performance.now());
let trick: { name: Trick; since: number } | null = null; // a pirouette or juggling, while she has nothing to do
const petCanvas = pet.app.canvas as HTMLCanvasElement;
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
const doze = new Doze();
const mask = new MaskView($<HTMLCanvasElement>("mask"), MASK_SCALE);
const hideMask = new MaskView($<HTMLCanvasElement>("hide"), HIDE_SCALE);
const camView = new CameraView($<HTMLCanvasElement>("cam-feed"));
const portrait = new Portrait($<HTMLCanvasElement>("tx-face")); // her face by what she says
let faceMoving = false; // its glitch is still playing: keep redrawing it
let lastCutin = -Infinity;
let gameHid = false; // she put herself away for his game: she comes back when it's over
const camPlayer = new CameraPlayer();
let camera = false; // camera mode: her close-ups in a transmission frame instead of her body

// Camera mode's frame, resized from its corners (state/camsize.ts) and saved for next time.
const CAM_BOTTOM = 54; // its bottom over the stage's (styles.css .cam): on her ledge
let camW = camWidth(settings.camara_ancho);
let camGrab: { corner: Corner; x: number; y: number; w: number } | null = null;
function sizeCam(w: number): void {
  camW = w;
  cam.style.width = `${w}px`;
  cam.style.height = `${camHeight(w)}px`;
}
sizeCam(camW);
cam.addEventListener("pointerdown", (e) => {
  const corner = (e.target as HTMLElement).closest<HTMLElement>(".cam-grip")?.dataset.corner as Corner | undefined;
  if (!corner || e.button !== 0) return;
  e.stopPropagation(); // not a drag of her
  camGrab = { corner, x: e.clientX, y: e.clientY, w: camW };
  cam.classList.add("resizing");
  cam.setPointerCapture(e.pointerId);
});
cam.addEventListener("pointermove", (e) => {
  if (camGrab) sizeCam(camResize(camGrab.w, camGrab.corner, e.clientX - camGrab.x, e.clientY - camGrab.y));
});
cam.addEventListener("pointerup", () => {
  if (!camGrab) return;
  camGrab = null;
  cam.classList.remove("resizing");
  void invoke("save_cam_width", { ancho: camW }).catch((err) => console.warn("save_cam_width", err));
});

/** Camera mode on or off: the feed takes her body's place (same spot, same ledges). */
async function setCamera(on: boolean): Promise<void> {
  if (on) await camView.load();
  camera = on;
  cam.hidden = !on;
  $("tx-face").hidden = on; // the feed already is her face
  pet.app.stage.visible = !on;
}
await setCamera(settings.camara);
if (import.meta.env.DEV) Object.assign(window, { __capri: { director, doze, mask, zap, fx, hide, unhide, hiding: () => hiding, startPeek, peek: () => peek, zapCursor, camera: () => camera, camPlayer, clips: () => clips, style: () => style, glitch, teleport, possess, fall, hop: () => teleport(pickSeat(wins, limits(), { except: perch?.id })), wins: () => wins, perch: () => perch, at: () => at } }); // inspection from devtools

let turn = 0;
let awaiting = false; // a message of ours is being answered; a turn without one is Capri's own (a reminder)
let confirming: string | null = null; // id of the confirmation on screen
let confirmingRed = false; // a red one takes only a click, never a key
let buttonsId: string | null = null; // her Buttons on screen (cancel a reminder, done...): they hold nothing up
let buttonsTimer = 0;
const BUTTONS_MS = 120_000; // left alone this long, they go
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
let flying: Flight | null = null; // thrown: in the air (state/throw.ts)
const velocity = new Velocity(); // the pointer while she's dragged: how hard she's thrown
const temper = new Temper();
let dizzyUntil = 0; // landed flat: seeing stars until then
let madPending = false; // thrown once too often: she'll say so once she lands
let press: { x: number; y: number; dx: number; dy: number } | null = null; // pointer down on her
let dragging = false;
const claudeTrack = new Tracker();
const claudeEl = $("claude");
const claudePanel = $("claude-panel");
const player = mountPlayer($("player"), (m) => link.send(m));
let claudeLine = "";
let claudeSpark = 0; // when Claude's last spark went off
let claudeGap = 0;
let claudePending: Panel | null = null; // Claude finished while she was hiding
let claudeTimer = 0;
let dnd = false; // do not disturb (the backend owns it; this mirrors it for the status bar)
let fullscreen = false; // a fullscreen app is in front: hidden and not rendering
await sfx.init(() => dnd || fullscreen || reducedMotion.matches); // her sound effects stay quiet then
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
const busy = () => teleporting || !!possessing || !!falling || !!flying || performance.now() < dizzyUntil || dragging || doze.asleep || !!peek
  || hiding || intro.playing;
const floor = () => innerHeight - BELOW;
/** Room a ledge needs above it: just her while the transmission is closed (`talking` forces the whole column
 * of her and the transmission, which stack above her feet). Open it on a window too low for that and she falls. */
const limits = (talking = false) => ({
  room: roomNeeded({ quiet: !talking && tx.hidden && inputRow.hidden && linkStatus === "idle", pet: stage.offsetHeight, hud: hud.offsetHeight, below: BELOW }),
  width: innerWidth,
  margin: hud.offsetWidth / 2 + EDGE,
});

/** A spot on the taskbar, `frac` 0..1 from left to right. */
function onTaskbar(frac: number): Point {
  return { x: EDGE + hud.offsetWidth / 2 + frac * (innerWidth - hud.offsetWidth - 2 * EDGE), y: floor() };
}

/** Moves the HUD column (transmission, input and Capri) so her feet are at `at`. */
function placeHud(): void {
  hud.style.transform = `translate(${Math.round(at.x - hud.offsetWidth / 2)}px, ${Math.round(at.y - (hud.offsetHeight - BELOW))}px)`; // her feet at the bottom of the column
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
  renderStatus();
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
  renderStatus();
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

/** The open microphone as a tag at her head, on her left (clear of the transmission, which stacks above her):
 * on her, or on her sleeping mask; hiding and camera mode have their own (state/mic.ts). */
/** The stage is a fixed 288 px tall, and her art doesn't fill it: the smaller she is (the chibi), the more empty
 * space between the transmission above and her head. The highest her pixels have been since the style changed
 * (monotonic, so the transmission doesn't bounce with her poses) is pulled up out of the way. */
let topSeen = Infinity;
let trimmed = 0;
function trimStage(): void {
  const b = peek || camera || hiding || doze.asleep || teleporting || possessing || flying || falling ? null : petBounds();
  if (b && b.h > 0) topSeen = Math.min(topSeen, b.y);
  // in camera mode its frame is what's on top, whatever its size (it may need more room than the stage, not less)
  const want = camera ? stage.offsetHeight - CAM_BOTTOM - cam.offsetHeight - 8
    : Number.isFinite(topSeen) ? Math.max(0, Math.round(topSeen) - 8) : 0;
  if (want !== trimmed) {
    trimmed = want;
    stage.style.marginTop = `${4 - want}px`;
  }
}

function drawMic(): void {
  const view = micView({ voice, hiding, camera });
  micChip.hidden = view !== "dot" && view !== "bar";
  if (micChip.hidden) return;
  let right: number, top: number;
  if (doze.asleep) {
    const [bx, by] = mask.box();
    [right, top] = [bx - 6, by];
  } else {
    const c = stage.getBoundingClientRect();
    const b = peek ? body() : null;
    const p = petBounds();
    if (b) [right, top] = [b.x - b.size / 2 - 6, b.y - 10];
    else [right, top] = p ? [c.left + p.x - 6, c.top + p.y + p.h * 0.2] : [c.left + c.width / 2 - 60, c.top + c.height * 0.3];
  }
  micChip.style.translate = `${Math.max(4, Math.round(right - micChip.offsetWidth))}px ${Math.max(4, Math.round(top))}px`;
}

/** Hiding: the small mask in its corner, eyes open on the pointer, a blink now and then. */
function drawHide(now: number): void {
  // shown once her body has come apart
  const shown = hiding && glitch.at(now, false).collapse >= 1;
  hideMask.show(shown);
  micDot.hidden = !shown || voice === "off";
  if (!shown) return;
  hideMask.center = hideSpot();
  if (!micDot.hidden) {
    const [bx, by, bw] = hideMask.box();
    micDot.style.transform = `translate(${Math.round(bx + bw - 4)}px, ${Math.round(by + 4)}px)`;
    micDot.classList.toggle("beat", voice === "hearing");
  }
  const blink = now % HIDE_BLINK_MS < 130;
  hideMask.draw(
    { eyes: blink ? [0, 0] : [1, 1], look: cursor ? { x: cursor[0], y: cursor[1] } : null },
    { bob: reducedMotion.matches ? 0 : [0, -1, -2, -1][Math.floor(now / 600) % 4], px: style === "pixel" ? SCALE : 1 },
  );
}
hideMask.canvas.addEventListener("pointerdown", (e) => e.button === 0 && unhide());

/** Keeps a tick in the tray menu in step with the state it shows. */
function trayCheck(name: string, on: boolean): void {
  void invoke("tray_check", { name, on }).catch((e) => console.warn("tray_check", e));
}

/** /cierra: she vanishes, and Capri closes, stopping Ollama too (it holds her model in VRAM). The tray can leave Ollama running. */
async function quit(stopOllama = true): Promise<void> {
  setInputOpen(false);
  if (!reducedMotion.matches) {
    glitch.kick("vanish", performance.now());
    const b = body();
    fx.burst(b.x, b.y, b.size, false);
    await sleep(VANISH_OUT_MS + 150);
  }
  await invoke("quit", { stopOllama });
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

// Once in a while: the sleep setting (edits apply without a restart).
setInterval(async () => {
  sleepAfter = (await invoke<AvatarSettings>("avatar_settings")).dormir_min * 60_000;
}, 10_000);

// Every second: how long the PC has been idle. Him touching it again after a while away wakes her
// (she used to stay a mask until the pointer came close) and gets a word about it.
const awayWatch = new AwayWatch();
let lastBack = "";
let claudeDone: { project: string; at: number } | null = null; // Claude finished while he may have been away
setInterval(async () => {
  pcIdle = await invoke<number>("idle_ms");
  const gone = awayWatch.tick(pcIdle);
  if (gone) onBack(gone);
}, 1000);

function quiet(): boolean {
  return !speaksOnBack({ hiding, dnd, fullscreen, moving: teleporting || !!possessing || !!falling || dragging,
    down: linkStatus === "down" });
}

function onBack(gone: number): void {
  const done = claudeDone && claudeDone.at >= Date.now() - gone ? claudeDone.project : null;
  claudeDone = null;
  greetBack(() => {
    const line = backLine(gone, new Date().getHours(), done, lastBack);
    lastBack = line.texto.split(" Ah, y Claude")[0];
    return line;
  });
}

// Back from sleep: the window is fitted and raised again, the drawing is checked, and she says so.
const resumeWatch = new ResumeWatch(Date.now());
setInterval(() => {
  const gap = resumeWatch.tick(Date.now());
  if (gap) void onResume(gap);
}, TICK_MS);

async function onResume(gap: number): Promise<void> {
  await invoke("refit").catch((e) => console.warn("refit", e));
  const now = performance.now();
  activeAt = now; // whoever woke the PC is at it: no instant nap
  pcIdle = 0;
  awayWatch.reset(); // this absence gets the wake-from-sleep line, not the "you're back" one
  greetBack(() => resumeLine(gap));
}

/** He's back (from away, or the PC woke): she wakes if asleep and, unless she must keep quiet, arrives
 * with her glitch and says `line` (asleep, once she's back together). */
function greetBack(line: () => { texto: string; emocion: Emocion }): void {
  const now = performance.now();
  activeAt = now;
  const wasAsleep = doze.asleep;
  wakeUp(); // asleep: her eyes snap open, then back() brings her together with the glitch
  if (quiet()) return;
  if (!wasAsleep) {
    glitch.kick("arrive", now);
    if (!reducedMotion.matches) {
      const b = body();
      fx.burst(b.x, b.y, b.size, true);
    }
    greetAt = now;
  }
  setTimeout(() => sayLocal(line()), wasAsleep ? WAKE_MS + 150 : 0);
}

/** A line of hers that no model wrote: shown and typed like a reply. */
function sayLocal({ texto, emocion }: { texto: string; emocion: Emocion }): void {
  link.send({ type: "say", texto }); // out loud too, if she's talking
  avatar.setEmotion(emocion);
  variant = Math.floor(Math.random() * 1000);
  typewriter.clear();
  txUser.textContent = "";
  txText.textContent = "";
  ended = true;
  tx.classList.add("typing");
  showTx();
  typewriter.push(texto);
}

function setStatus(s: Status): void {
  if (s === "thinking" || s === "speaking" || s === "looking") {
    wakeUp();
    unhide(); // she comes out to answer
  }
  if (s !== "down" && linkStatus === "down") greetAt = performance.now();
  if (s === "looking") {
    fx.scan();
    // a capture she didn't start (a screenshot, his search read off the browser): she keeps herself out of it too
    if (linkStatus !== "looking") {
      void invoke("capture_guard", { on: true }).catch((e) => console.warn("capture_guard", e));
      clearTimeout(guardTimer);
      guardTimer = window.setTimeout(guardOff, 5000);
    }
  }
  if (s === "thinking" && linkStatus === "idle" && !awaiting) {
    startTurn(""); // she speaks up on her own (a reminder, a greeting): where he is
    void comeToHim();
  }
  if (s === "idle") awaiting = false;
  if (linkStatus === "looking" && s !== "looking") guardOff(); // the shot is taken
  if (s === "thinking" && linkStatus !== "thinking" && !busy()) {
    // while she works, she sits on the window in front if she can
    const seat = pickSeat(wins, limits(true), { frontOnly: true }); // the transmission is about to open
    if (seat && seat.id !== perch?.id) void teleport(seat);
  }
  linkStatus = s;
  status.dataset.state = s;
  renderStatus();
}

const VOICE_LABEL: Record<VoiceState, string> = {
  off: "",
  loading: "CARGANDO VOZ",
  idle: "ESCUCHANDO · «HEY CAPRI»",
  hearing: "OYÉNDOTE",
  listening: "TE ESCUCHO",
  thinking: "ENTENDIENDO",
};
/** What the tag at her head says (the status bar, with the input open, has the longer words above). */
const CHIP_LABEL: Record<VoiceState, string> = {
  off: "",
  loading: "CARGANDO",
  idle: "MIC",
  hearing: "OYÉNDOTE",
  listening: "TE ESCUCHO",
  thinking: "ENTENDIENDO",
};
let voice: VoiceState = "off";
let ttsAt = 0; // last level of her voice out loud (her mouth follows it, not the text)
let ttsLevel = 0;
const voiced = (now: number): boolean => now - ttsAt < 200;

/** The status bar. The open microphone: a dot at rest, its words only while she's listening to you
 * (the mask carries it when she hides, the feed's tag in camera mode; see state/mic.ts). */
function renderStatus(): void {
  const view = micView({ voice, hiding, camera });
  const bar = view === "bar" && (linkStatus === "idle" || linkStatus === "down");
  if (view === "bar" || view === "dot") status.dataset.mic = view;
  else delete status.dataset.mic;
  status.dataset.voice = voice;
  micChip.dataset.mic = view === "bar" ? "bar" : "dot";
  micChip.dataset.voice = voice;
  micText.textContent = CHIP_LABEL[voice];
  statusLabel.textContent = bar ? VOICE_LABEL[voice] : linkStatus === "idle" && dnd ? "NO MOLESTAR" : STATUS[linkStatus];
}

function setVoice(v: VoiceState): void {
  voice = v;
  trayCheck("voz", v !== "off");
  if (v === "hearing" || v === "listening") wakeUp();
  renderStatus();
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
        if (!awaiting) sfx.play("notify"); // she speaks up on her own: a reminder, a greeting
        if (confirming) hideChoices(); // the confirmation timed out: the turn moved on
        else if (buttonsId) hideButtons(); // what she says next replaces them
        // Also covers a retry: the new utterance replaces the text shown so far.
        if (avatar.setEmotion(msg.emocion) && !teleporting) glitch.kick(msg.emocion === "molesta" ? "hurt" : "change", now);
        avatar.playGesture(msg.gesto, now);
        showFace(msg.emocion);
        {
          const shot = cutinFor(msg.emocion, msg.gesto, now, lastCutin, hiding || dnd || camera || fullscreen || reducedMotion.matches);
          if (shot) {
            lastCutin = now;
            void cutin(shot);
          }
        }
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
        if (msg.cortada) {
          typewriter.clear(); // cut off: what she hadn't shown yet she never said
          txText.textContent = txText.textContent!.trimEnd() + "—";
          ttsAt = 0;
        }
        ended = true;
        ctx = msg.ctx ?? ctx;
        updateMeta();
        break;
      case "pc":
        void onPc(msg);
        break;
      case "buttons":
        showButtons(msg);
        break;
      case "confirm_request":
        showChoices(msg.id, msg.texto, msg.riesgo === "alto");
        void comeToHim(); // the question is for him: on his screen
        break;
      case "mode":
        dnd = msg.no_molestar;
        trayCheck("dnd", dnd);
        trayCheck("claude", msg.claude);
        trayCheck("hablar", msg.hablar);
        status.dataset.dnd = dnd ? "1" : "";
        setStatus(linkStatus);
        break;
      case "action":
        zap(msg);
        break;
      case "now_playing":
        sfx.play("radio");
        player.show(msg);
        break;
      case "claude":
        onClaude(msg, now);
        break;
      case "voice":
        setVoice(msg.estado);
        break;
      case "level":
        if (msg.fuente === "mic") {
          cam.style.setProperty("--lv", msg.valor.toFixed(2));
          micChip.style.setProperty("--lv", msg.valor.toFixed(2));
        }
        else {
          ttsAt = now;
          ttsLevel = msg.valor;
        }
        break;
      case "heard":
        wakeUp();
        submit(msg.texto, msg.original, msg.charla);
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
  if (msg.estado === "termino") sfx.play("notify");
  else if (msg.estado === "necesita") sfx.play("alert");
  if (msg.estado === "termino") claudeDone = { project: msg.project, at: Date.now() };
  if (msg.estado === "necesita") void comeToHim(); // Claude asks him something: she comes to his screen
  const react = reaction(msg);
  const free = !hiding && !dnd && !teleporting && !possessing && !falling && !dragging && !peek;
  if (react && free) {
    wakeUp();
    if (avatar.setEmotion(react.emocion)) glitch.kick("change", now);
    avatar.playGesture(react.gesto, now);
    lastTalk = Math.max(lastTalk, now - LINGER_MS + 3500);
  }
  // her lightning follows what Claude does
  const z = sparkFor(msg);
  if (free && !reducedMotion.matches) {
    if (z && now - claudeSpark >= SPARK_GAP_MS) {
      claudeSpark = now;
      spark(z, () => performance.now() - now < 1200, 1200);
    } else if (msg.estado === "fallo") {
      glitch.kick("hurt", now);
      fx.impact(body().x, body().y);
    } else if (bigJob(msg)) {
      void victory();
    }
  }
  const panel = panelFor(msg);
  if (!panel) return;
  const asked = msg.estado === "respuesta"; // she was asked for it: it shows even on do-not-disturb or when hiding
  if (asked && hiding) unhide();
  if (!hiding && (asked || !dnd)) showClaudePanel(panel, !asked);
  else claudePending = panel;
}

function showClaudePanel(p: Panel, autoClose: boolean): void {
  ($("claude-face") as HTMLImageElement).src = p.face === "grin" ? grinFace : lookFace;
  $("claude-project").textContent = p.project;
  $("claude-badge").textContent = p.badge;
  $("claude-title").textContent = p.title;
  const body = $("claude-body");
  body.textContent = p.body;
  body.hidden = !p.body;
  body.scrollTop = 0;
  $("claude-stats").textContent = p.stats;
  $("claude-stats").hidden = !p.stats;
  claudePanel.dataset.tone = p.tone;
  claudePanel.hidden = false;
  clearTimeout(claudeTimer);
  if (autoClose) claudeTimer = window.setTimeout(() => (claudePanel.hidden = true), 45_000);
}

// A click closes the bubble, unless it was to select Claude's words.
// a click on her transmission while she talks out loud cuts her off
tx.addEventListener("click", (e) => {
  if (voiced(performance.now()) && !(e.target as HTMLElement).closest("button")) link.send({ type: "interrupt" });
});
claudePanel.addEventListener("click", () => {
  if (!getSelection()?.toString()) claudePanel.hidden = true;
});
claudePanel.addEventListener("mouseenter", () => clearTimeout(claudeTimer));
claudePanel.addEventListener("mouseleave", () => {
  clearTimeout(claudeTimer);
  claudeTimer = window.setTimeout(() => (claudePanel.hidden = true), 15_000);
});

/** Every frame: the ticker's words and tone, where it sits (over her head, or her corner while she hides), and its height over the taskbar. */
function drawClaude(now: number): void {
  const line = claudeTrack.line(now);
  claudeEl.hidden = !line || (!hiding && !claudePanel.hidden); // the bubble says it better
  if (line && !claudeEl.hidden) {
    $("claude-target").textContent = line.target;
    const key = line.tone === "think" ? "think" : `${line.verb}|${line.target}|${line.project}`; // the seconds tick without a flash
    if (key !== claudeLine) {
      claudeLine = key;
      $("claude-verb").textContent = line.verb;
      $("claude-where").textContent = line.project;
      claudeEl.classList.remove("flash");
      void claudeEl.offsetWidth; // restart the animation
      claudeEl.classList.add("flash");
    }
    claudeEl.dataset.tone = line.tone;
  }
  if (claudeEl.dataset.hiding !== (hiding ? "1" : "")) {
    claudeEl.dataset.hiding = hiding ? "1" : "";
    if (hiding) document.body.append(claudeEl);
    else hud.insertBefore(claudeEl, status);
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
  if (a.fase === "inicio") {
    const z = zapStart(a.nombre);
    if (!z) return;
    const run = {};
    acting = run;
    spark(z, () => acting === run, AURA_MAX_MS);
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

/** Sparks crawl over her while `alive`, and a bolt leaps to where the tool acts. */
function spark(z: Zap, alive: () => boolean, life: number): void {
  wakeUp();
  fx.crackle(aura, alive, life);
  glitch.kick("change", performance.now());
  if (z.bolt) {
    const to = boltTo(z.bolt);
    fx.bolt(() => body(), () => to);
  }
  const front = wins.wins.find((w) => w.id === wins.fg && !w.max);
  if (z.frame && front) fx.surge(front);
}

function aura(): { x: number; y: number; r: number } {
  const b = body();
  return { x: b.x, y: b.y, r: b.size * 0.6 };
}

/** Done with something big: speed lines and a shockwave, and an anime cut-in of her laughing or grinning. */
async function victory(): Promise<void> {
  const b = body();
  glitch.kick("change", performance.now());
  fx.rush(b.x, b.y);
  await cutin(Math.random() < 0.5 ? "risa" : "sonrisa");
}

/** An anime cut-in of her face from the show, pushed in by her, toward the middle of the screen. */
async function cutin(shot: ShotName): Promise<void> {
  const b = body();
  await camView.load();
  const still = camView.still(shot, 1);
  if (!still) return;
  const dir = b.x > innerWidth / 2 ? -1 : 1;
  const x = Math.min(Math.max(b.x + dir * 190, 140), innerWidth - 140);
  fx.cutin(x, Math.max(90, b.y - 140), still, dir);
}

/** Something she felt in the PC (state/pc.ts): the effect on her, then her word about it. A game
 *  puts her away while he plays and brings her back after; on do-not-disturb, only that. */
async function onPc(e: PcEvent): Promise<void> {
  const r = pcReaction(e);
  if (!r) return;
  sfx.play("notify");
  if (r.hide && !hiding) {
    gameHid = true;
    if (!dnd && !fullscreen) sayLocal(r);
    await sleep(2500);
    hide();
    return;
  }
  if (r.unhide && gameHid) {
    gameHid = false;
    unhide();
  }
  if (dnd || fullscreen || hiding || busy()) return;
  const now = performance.now();
  const b = body();
  const tray = { x: innerWidth - 60, y: innerHeight - 12 }; // by the clock, where things get plugged in
  avatar.setEmotion(r.emocion);
  if (r.fx === "heat") fx.heat(() => {
    const [x, y] = headOnPage();
    return { x, y };
  });
  else if (r.fx === "bolt" && !reducedMotion.matches) fx.bolt(() => body(), () => tray);
  else if (r.fx === "sag" || r.fx === "hurt") {
    glitch.kick("hurt", now);
    if (r.fx === "hurt") fx.impact(b.x, b.y);
  } else if (r.fx === "dive" && !reducedMotion.matches) { // into the stick by the clock, a rummage, and back
    glitch.kick("vanish", now);
    fx.streak(b.x, b.y, tray.x, tray.y);
    stage.style.visibility = "hidden";
    await sleep(1600);
    stage.style.visibility = "";
    glitch.kick("arrive", performance.now());
    fx.burst(b.x, b.y, b.size, true);
  }
  sayLocal(r);
}

// ---- several screens: she follows the pointer to the one it stays on (state/screens.ts) ----

type Screens = { rects: [number, number, number, number][]; here: number; cursor: number };
const follow = new Follow();
let following = false;

setInterval(async () => {
  if (following || hiding || fullscreen || busy()) return;
  const s = await invoke<Screens | null>("screens").catch(() => null);
  if (!s || s.rects.length < 2) return;
  if (follow.tick(s.cursor, s.here, performance.now()) && (await invoke<AvatarSettings>("avatar_settings")).seguir_pantallas) {
    await goToScreen(s);
  }
}, 500);

/** Something needs him (a confirmation, a reminder, Claude asking, her own word): she comes to his screen now. */
async function comeToHim(): Promise<void> {
  if (following || hiding || fullscreen) return;
  const s = await invoke<Screens | null>("screens").catch(() => null);
  if (s && s.rects.length > 1 && s.cursor !== s.here) await goToScreen(s);
}

/** To the pointer's screen: through the edge if it's right next to hers (she jumps out of this one and comes
 *  out of a tear on the other), else her usual teleport. */
async function goToScreen(s: Screens): Promise<void> {
  const rect = ([x, y, w, h]: [number, number, number, number]) => ({ x, y, w, h });
  const side = sideOf(rect(s.rects[s.here]), rect(s.rects[s.cursor]));
  following = teleporting = true;
  const from = body();
  if (!reducedMotion.matches) {
    if (side) {
      const to = { x: side === "right" ? innerWidth : side === "left" ? 0 : from.x, y: side === "bottom" ? innerHeight : side === "top" ? 0 : from.y };
      fx.streak(from.x, from.y, to.x, to.y);
    }
    glitch.kick("vanish", performance.now());
    fx.burst(from.x, from.y, from.size * 0.6, false);
    await sleep(VANISH_OUT_MS);
  }
  await invoke("go_to_screen", { i: s.cursor });
  await sleep(150); // the overlay moved and resized
  perch = null;
  const half = hud.offsetWidth / 2 + EDGE;
  const x = side === "right" ? half + 40 : side === "left" ? innerWidth - half - 40 : innerWidth / 2;
  at = { x: Math.min(Math.max(x, half), innerWidth - half), y: floor() };
  placeHud();
  if (!reducedMotion.matches) {
    const there = body();
    if (side === "left" || side === "right") fx.crack(side === "right" ? EDGE : innerWidth - EDGE, there.y); // the tear she came out of
    glitch.kick("arrive", performance.now());
    fx.burst(there.x, there.y, there.size, true);
  }
  following = teleporting = false;
}

/** Her portrait by what she says, glitching into the face of how she feels now. */
function showFace(e: Emocion): void {
  if (camera) return; // the feed already is her face
  void camView.load().then(() => {
    const p = portraitFor(e);
    const still = camView.still(p.shot, p.index);
    portrait.set(`${p.shot}:${p.index}`, still && faceSquare(still, p.shot), performance.now());
    faceMoving = true;
  });
}

/** An action with effects waits on a click: [1] do it (marked), [2] don't. Neither is preselected.
 *  A red one (deleting, installing, outside her folder, after reading outside content) shows as danger. */
function showChoices(id: string, what: string, red = false): void {
  hideButtons(); // a confirmation takes their place
  confirming = id;
  confirmingRed = red;
  sfx.play(red ? "alert_red" : "alert");
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

/** Her Buttons under what she said (Cancelar, Hecho, 10 min más...): a click sends it and they go. A
 *  confirmation that comes meanwhile takes their place. */
function showButtons(msg: Buttons): void {
  if (confirming) return;
  buttonsId = msg.id;
  choices.replaceChildren(...msg.botones.map((b) => {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = `▸ ${b.texto}`;
    btn.addEventListener("click", () => {
      sfx.play("click");
      link.send({ type: "pressed", id: msg.id, boton: b.id });
      hideButtons();
    });
    li.append(btn);
    return li;
  }));
  choices.hidden = false;
  showTx();
  clearTimeout(buttonsTimer);
  buttonsTimer = window.setTimeout(() => {
    hideButtons();
    hideTx();
  }, BUTTONS_MS);
}

function hideButtons(): void {
  if (!buttonsId) return;
  buttonsId = null;
  clearTimeout(buttonsTimer);
  if (!confirming) {
    choices.hidden = true;
    choices.replaceChildren();
  }
}

function hideChoices(): void {
  confirming = null;
  confirmingRed = false;
  choices.hidden = true;
  choices.replaceChildren();
}

function answer(ok: boolean): void {
  if (!confirming) return;
  sfx.play("click");
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
  if (!confirming && !buttonsId) tx.hidden = true;
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

/** Looks at the screen you were on (its shortcut, Ctrl+Alt+Shift+M by default, or /mira), with Capri kept out of the shot. */
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
// Tray menu: the items with no shortcut. Its ticks follow the real state through trayCheck.
void listen("claude", () => link.send({ type: "hotkey", name: "claude" }));
void listen("voz", () => link.send({ type: "hotkey", name: "voz" }));
void listen("hablar", () => link.send({ type: "hotkey", name: "hablar" }));
void listen("listen", () => link.send({ type: "hotkey", name: "escuchar" }));
void listen("hide", () => (hiding ? unhide() : hide()));
void listen<boolean>("quit", (e) => void quit(e.payload));
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
// How she looks is one of three, never two at once: the show's art, the pixel pet, or the camera feed. The camera
// sits over the art she had (which stays the one under it: her mask asleep, her look when she's back).
type Look = "original" | "pixel" | "camara";
const LOOKS: Look[] = ["original", "pixel", "camara"];
const appearance = (): Look => (camera ? "camara" : style);

async function setLook(to: Look): Promise<void> {
  if (to === appearance()) return;
  if (to !== "camara" && style !== to) {
    await pet.setStyle(to);
    style = to;
    clips = new ClipPlayer(style);
    topSeen = Infinity; // her size is another's: measure again
    void invoke("save_style", { estilo: style }).catch((e) => console.warn("save_style", e));
    trayCheck("style", style === "pixel");
  }
  if (camera !== (to === "camara")) {
    await setCamera(to === "camara");
    void invoke("save_camera", { on: camera }).catch((e) => console.warn("save_camera", e));
    trayCheck("camera", camera);
    renderStatus();
  }
  glitch.kick("change", performance.now());
}
// its shortcut (Ctrl+Alt+Shift+A) goes round the three (original, pixel, camera); the panel picks one
// (`mode-<look>`). Saved in config.toml for next time.
void listen("style", () => setLook(LOOKS[(LOOKS.indexOf(appearance()) + 1) % LOOKS.length]));
for (const m of LOOKS) void listen(`mode-${m}`, () => setLook(m));
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
mask.canvas.addEventListener("pointerdown", (e) => e.button === 0 && wakeUp());

// A right click on her (her body, her camera, her mask asleep or hiding): her quick menu at the pointer. Nowhere
// else the webview's own menu (Back, Reload, Inspect) shows.
addEventListener("contextmenu", (e) => {
  e.preventDefault();
  const t = e.target as Node;
  if (stage.contains(t) || t === mask.canvas || t === hideMask.canvas) void invoke("quick_menu");
});

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
  if (submit(text)) input.value = "";
});

// her own commands, handled here (the rest go to the backend); names, aliases and arguments from commands.json
const OWN: Record<string, (arg: string) => void> = {
  "/escondete": (arg) => (arg === "off" || (!arg && hiding) ? unhide() : hiding ? undefined : hide()),
  "/vuelve": () => unhide(),
  "/cierra": () => void quit(),
  "/mira": (arg) => void look(arg),
};

/** What was typed or said, as a message or one of her own commands; `shown` is what to display for a spoken command. Returns whether it was taken. */
function submit(text: string, shown = "", charla = false): boolean {
  const own = parse(text);
  if (own) {
    if (own.name !== "/cierra" && own.name !== "/mira") setInputOpen(false);
    OWN[own.name](own.arg);
    return true;
  }
  if (!text || !link.send({ type: "text_input", text, charla })) return false;
  startTurn(shown || text);
  return true;
}
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
  if (dragging || falling || flying) return [{ clip: "dangle", index: Math.floor(now / 100) % 24 }, null];
  if (possessing) return [{ clip: perch ? "perch_glitch" : "glitch", index: Math.min(9, Math.floor((now - possessing.since) / 90)) }, null];
  const mouth = talking ? mouthCell(avatar.mouth ?? "closed", base) : null;
  if (perch && base && PERCHED[base.clip]) return [{ clip: PERCHED[base.clip], index: base.index }, null];
  return [base, mouth];
}

// Poke: click on her. Drag: press and move, she follows the pointer and, let go on a window's top
// edge, sits there (anywhere else she falls). Pet: rub the mouse back and forth over her head.
stage.addEventListener("pointerdown", (e) => {
  if (e.button !== 0) return; // a right click is her quick menu (contextmenu)
  if (doze.asleep) return wakeUp(); // the feed showing her mask
  if (peek && !teleporting) return void hopPeek(null); // caught peeking: back to her spot
  const now = performance.now();
  if (!temper.canGrab(now) && !busy()) { // thrown once too often: hands off for a while
    glitch.kick("poke", now);
    zapCursor();
    sayLocal({ texto: "¡Ni se te ocurra!", emocion: "molesta" });
    return;
  }
  const caught = !!flying; // caught in the air: back in his hand
  if (!caught && busy()) return;
  flying = null;
  activeAt = now;
  press = { x: e.clientX, y: e.clientY, dx: at.x - e.clientX, dy: at.y - e.clientY };
  if (caught) {
    dragging = true;
    glitch.kick("change", now);
  }
  stage.setPointerCapture(e.pointerId);
});
stage.addEventListener("pointerup", () => {
  if (!press) return;
  const dragged = dragging;
  press = null;
  dragging = false;
  if (dragged) {
    const v = velocity.get(performance.now());
    if (thrown(v) && !reducedMotion.matches) throwHer(v);
    else drop();
    return;
  }
  pokeAt = performance.now();
  if (!teleporting) glitch.kick("poke", pokeAt);
});

/** Let go mid-swing: she flies off with the pointer's speed (state/throw.ts). */
function throwHer(v: { vx: number; vy: number }): void {
  const now = performance.now();
  perch = null;
  flying = launch(at, v);
  const mood = temper.thrown(now);
  if (mood === "mad") madPending = true;
  else if (mood === "again") avatar.setEmotion("sorprendida");
  else if (Math.random() < 0.5) sayLocal({ texto: Math.random() < 0.5 ? "¡Wiiii!" : "¡Allá voooy!", emocion: "emocionada" });
}

/** Where her feet can go while she flies, and the windows' top edges she can catch. */
function flightBounds(): { left: number; right: number; top: number; floor: number } {
  const half = hud.offsetWidth / 2 + EDGE;
  return { left: half, right: innerWidth - half, top: body().size + EDGE, floor: floor() };
}

function flightLedges(): { id: number; x1: number; x2: number; y: number }[] {
  return wins.wins.filter((w) => canSit(w, limits())).map((w) => ({ id: w.id, x1: w.x, x2: w.x + w.w, y: w.y }));
}

/** What she ran into in the air. */
function onHit(h: Hit, now: number): void {
  const b = body();
  const clampX = (x: number) => Math.min(Math.max(x, flightBounds().left), flightBounds().right);
  switch (h.kind) {
    case "wall": { // the glass cracks where she slammed into it
      const x = h.side === "left" ? EDGE : h.side === "right" ? innerWidth - EDGE : b.x;
      fx.crack(x, h.side === "top" ? EDGE : b.y);
      fx.impact(b.x, b.y);
      glitch.kick("hurt", now);
      break;
    }
    case "bounce":
      fx.burst(h.x, h.y, 40, false);
      glitch.kick("change", now);
      break;
    case "ledge": { // she caught it: she sits there
      const seat = ledgeAt(wins, { x: h.x, y: h.y }, limits(), DROP_TOLERANCE);
      const there = seat && seatOf(wins, seat, limits());
      if (seat && there) {
        perch = seat;
        at = there;
      } else falling = { vy: 0 };
      glitch.kick("change", now);
      break;
    }
    case "feet": // on her feet, a little skid
      at = { x: clampX(h.x + h.vx * 90), y: floor() };
      fx.burst(b.x, b.ground, b.size * 0.5, false);
      glitch.kick("change", now);
      break;
    case "flat": // slid along the floor, lying there seeing stars a moment
      at = { x: clampX(h.x + h.vx * 60), y: floor() };
      dizzyUntil = now + 1300;
      avatar.setEmotion("sorprendida");
      glitch.kick("hurt", now);
      fx.stars(() => {
        const [x, y] = headOnPage();
        return { x, y };
      }, 1300);
      break;
  }
  if (!flying && madPending) { // three times in a minute: enough
    madPending = false;
    avatar.setEmotion("molesta");
    zapCursor();
    sayLocal({ texto: "¡Ya basta! Un rato sin agarrarme.", emocion: "molesta" });
  }
}

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
      velocity.push(e.clientX, e.clientY, performance.now());
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
    voice,
  };
  if (camPlayer.want(shotFor(sc), now) && !doze.asleep) glitch.kick("change", now);
  camTag.textContent = tagFor(sc);
  camClock.textContent = new Date().toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit", hour12: false });
  cam.classList.toggle("talking", !ended || typewriter.pending);
  cam.classList.toggle("hearing", voice === "hearing" && ended && !typewriter.pending);
  camView.draw({ frame: camPlayer.frame(now), glitch: reducedMotion.matches ? OFF : g, seed, mask: maskLook(now) });
}

let lastHitbox = "";
let lastFrame = -1;
pet.app.ticker.add((ticker) => {
  const now = performance.now();
  const revealed = typewriter.tick(ticker.deltaMS);
  if (revealed) {
    if (!voiced(now)) sfx.play("tick"); // out loud she needs no typing under her voice
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
  if (voiced(now)) {
    avatar.mouth = ttsLevel > 0.35 ? "A" : ttsLevel > 0.12 ? "E" : "closed";
    lastTalk = now;
  } else if (ttsAt && ended && !typewriter.pending && avatar.mouth !== null) {
    avatar.mouth = null; // her voice just stopped
    ttsAt = 0;
  }
  if (!ended || typewriter.pending) lastTalk = now;
  petEnergy = Math.max(0, petEnergy - ticker.deltaMS * 0.08);
  if (flying) {
    const r = step(flying, Math.min(ticker.deltaMS, 50), flightBounds(), flightLedges(), now);
    flying = r.flight;
    if (r.flight) at = { x: r.flight.x, y: r.flight.y };
    if (r.hit) onHit(r.hit, now);
    placeHud();
  }
  if (dizzyUntil && now >= dizzyUntil) { // she springs back up and shakes it off
    dizzyUntil = 0;
    glitch.kick("change", now);
  }
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
  const calm = linkStatus === "idle" && tx.hidden && inputRow.hidden && !confirming && !busy() && !camera && !reducedMotion.matches
    && now - lastTalk > LINGER_MS;
  if (trick && (!calm || now - trick.since > TRICK_MS[trick.name])) trick = null;
  const next = trick ? null : tricks.next(now, calm);
  if (next) {
    const since = now;
    trick = { name: next, since };
    if (next === "juggle") {
      const reach = () => {
        const b = body();
        return { x: b.x, y: b.y + b.size * 0.1, size: b.size };
      };
      fx.juggle(reach, juggleOrbs, () => trick?.since === since, TRICK_MS.juggle);
    }
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
    { now: t, status: voiced(t) ? "speaking" : linkStatus === "looking" ? "thinking" : linkStatus, emocion: avatar.emocion, variant, lastTalk, pokeAt, petAt, greetAt },
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
  trimStage();
  // on a window's left corner the show's art sits mirrored, legs hanging out to the left
  const tilt = flying ? ` rotate(${((flying.rot * 180) / Math.PI).toFixed(1)}deg)` : now < dizzyUntil ? " rotate(90deg)" : "";
  const spin = trick?.name === "spin" ? ` scaleX(${spinScale((now - trick.since) / TRICK_MS.spin).toFixed(1)})` : "";
  const mirror = (!peek && style === "original" && perch?.side === "left" ? "scaleX(-1)" : "") + spin + tilt;
  if (!peek && petCanvas.style.transform !== mirror) petCanvas.style.transform = mirror;
  if (!clipFrame) pet.paint(pose, t);
  const g = glitch.at(t, linkStatus === "idle" && name !== "pinchada");
  pet.glitch(reducedMotion.matches ? OFF : g, frame % 997);
  if (camera) drawFeed(now, g, frame % 997);

  drawMask(now);
  drawHide(now);
  drawMic();
  drawClaude(now);
  if (faceMoving) faceMoving = portrait.draw(now);
  // a fast drag must not slip off her; during her intro a click anywhere skips it
  const boxes: number[][] = dragging || camGrab || intro.playing ? [[0, 0, innerWidth, innerHeight]] : [];
  if (!mask.canvas.hidden) boxes.push(mask.box());
  if (!hideMask.canvas.hidden) boxes.push(hideMask.box());
  const b = teleporting || doze.asleep || camera || peek || hiding ? null : petBounds(); // while she's gone, nothing to click
  if (peek && !teleporting) {
    const c = petCanvas.getBoundingClientRect();
    boxes.push([c.left, c.top, c.width, c.height]);
  }
  if (camera && !teleporting && !hiding) {
    const c = cam.getBoundingClientRect();
    boxes.push([c.left - 6, c.top - 6, c.width + 12, c.height + 12]); // its corner grips stick out
  }
  if (b) {
    const r = stage.getBoundingClientRect();
    boxes.push([r.left + b.x, r.top + b.y, b.w, b.h]);
  }
  const ui = [...(player.el.hidden ? [] : [player.el]), ...(claudePanel.hidden ? [] : [claudePanel]), ...(inputRow.hidden ? [] : [inputRow, status]), ...(inputRow.hidden && !confirming && !buttonsId && !voiced(now) ? [] : [tx])];
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

/** Her intro when she starts (not with a fullscreen app in front): when her face lands on her spot, her
 * body comes in there with the usual glitch. Without the drawings, she just appears. */
async function playIntro(): Promise<void> {
  const view = style === "pixel" ? pixelIntro : showIntro;
  if (!fullscreen && (await view.load())) {
    sfx.play("boot");
    const [x, y] = headOnPage();
    await view.play({ to: { x, y, size: body().size * 0.45 }, label: "¡HOLA!", caption: "CAPRI · PROJECT CAPRICORN",
      still: reducedMotion.matches });
  }
  stage.style.visibility = "";
  const now = performance.now();
  glitch.kick("arrive", now);
  if (!reducedMotion.matches) {
    const b = body();
    fx.burst(b.x, b.y, b.size, true);
  }
  greetAt = now;
}

// a click while it plays skips it (and does nothing else)
addEventListener("pointerdown", (e) => {
  if (!intro.playing) return;
  e.stopImmediatePropagation();
  intro.skip();
}, true);

void playIntro();
