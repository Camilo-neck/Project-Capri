// Where the open microphone shows: a dot at rest, the words only while she's actually listening,
// on her mask when she hides, on the feed's own tag in camera mode. Pure; main.ts draws it.

import type { VoiceState } from "../net/protocol.ts";

export type MicView = "none" | "dot" | "bar" | "mask" | "tag";

export function micView(v: { voice: VoiceState; hiding: boolean; camera: boolean }): MicView {
  if (v.voice === "off") return "none";
  if (v.hiding) return "mask";
  if (v.camera) return "tag";
  return v.voice === "hearing" || v.voice === "listening" || v.voice === "thinking" ? "bar" : "dot";
}
