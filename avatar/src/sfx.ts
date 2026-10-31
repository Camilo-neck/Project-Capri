// Her sound effects: plays the recipes of sfxrecipes.ts with WebAudio. Off, quiet or muted (do not disturb, a fullscreen
// app) it does nothing. The switch and volume live in config.toml ([avatar] sonido, sonido_volumen); they are re-read
// every few seconds, so the panel's changes arrive without a restart.
import { invoke } from "@tauri-apps/api/core";

import { GAP_MS, RECIPES, gain, type Recipe, type SfxKind } from "./sfxrecipes.ts";

const REREAD_MS = 3000;

let ctx: AudioContext | null = null;
let static_: AudioBuffer | null = null;
let muted: () => boolean = () => false;
let on = true;
let volume = 50;
let readAt = -Infinity;
const last = new Map<SfxKind, number>();

async function reread(): Promise<void> {
  try {
    const c = await invoke<{ sonido: boolean; sonido_volumen: number }>("avatar_settings");
    on = c.sonido;
    volume = c.sonido_volumen;
  } catch {
    // keeps what it had
  }
}

/** `mute` says when to stay quiet (do not disturb, a fullscreen app...). */
export async function init(mute: () => boolean): Promise<void> {
  muted = mute;
  readAt = performance.now();
  await reread();
}

export function play(kind: SfxKind | null): void {
  if (!kind) return;
  const now = performance.now();
  if (now - readAt > REREAD_MS) {
    readAt = now;
    void reread();
  }
  if (!on || muted() || now - (last.get(kind) ?? -Infinity) < GAP_MS[kind]) return;
  const master = gain(volume);
  if (!master) return;
  last.set(kind, now);
  try {
    ctx ??= new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
    schedule(ctx, RECIPES[kind], master);
  } catch {
    // no audio device: she stays silent
  }
}

function envelope(c: AudioContext, at: number, ms: number, peak: number): GainNode {
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.linearRampToValueAtTime(peak, at + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, at + ms / 1000);
  return g;
}

function schedule(c: AudioContext, r: Recipe, master: number): void {
  const out = c.createGain();
  out.gain.value = master;
  out.connect(c.destination);
  const t0 = c.currentTime + 0.01;
  for (const t of r.tones) {
    const o = c.createOscillator();
    const at = t0 + t.at / 1000;
    o.type = t.wave;
    o.frequency.setValueAtTime(t.f0, at);
    if (t.f1 !== t.f0) o.frequency.exponentialRampToValueAtTime(t.f1, at + t.ms / 1000);
    o.connect(envelope(c, at, t.ms, t.gain)).connect(out);
    o.start(at);
    o.stop(at + t.ms / 1000 + 0.02);
  }
  for (const n of r.noise ?? []) {
    static_ ??= whiteNoise(c);
    const src = c.createBufferSource();
    const hp = c.createBiquadFilter();
    const at = t0 + n.at / 1000;
    src.buffer = static_;
    hp.type = "highpass";
    hp.frequency.value = n.high;
    src.connect(hp).connect(envelope(c, at, n.ms, n.gain)).connect(out);
    src.start(at);
    src.stop(at + n.ms / 1000 + 0.02);
  }
}

function whiteNoise(c: AudioContext): AudioBuffer {
  const buf = c.createBuffer(1, c.sampleRate, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}
