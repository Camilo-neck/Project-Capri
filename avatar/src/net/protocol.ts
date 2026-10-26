// Hand-written mirror of backend/app/protocol.py; backend/tests/test_ws.py checks they match.

export type Emocion =
  | "neutral" | "feliz" | "emocionada" | "traviesa" | "curiosa"
  | "pensativa" | "sorprendida" | "molesta" | "triste" | "seria";

export type Gesto = "ninguno" | "asentir" | "ladear_cabeza" | "guino" | "saltar" | "senalar" | "cruzar_brazos";

// Backend -> avatar
export interface State {
  type: "state";
  value: "idle" | "looking" | "thinking" | "speaking"; // looking: capturing the screen
}

export interface UtteranceStart {
  type: "utterance_start";
  emocion: Emocion;
  gesto: Gesto;
}

export interface TextDelta {
  type: "text_delta";
  text: string;
}

export interface UtteranceEnd {
  type: "utterance_end";
  ctx: number | null;
}

/** Capri saved something to her long-term memory (shown as a mark in the transmission). */
export interface Remembered {
  type: "remembered";
  texto: string;
}

/** Do-not-disturb state, so the avatar can show it. */
export interface Mode {
  type: "mode";
  no_molestar: boolean;
  claude: boolean;
}

/** The microphone: idle waits for "hey Capri"; listening means the next sentence is for her. */
export type VoiceState = "off" | "loading" | "idle" | "hearing" | "listening" | "thinking";
export interface Voice {
  type: "voice";
  estado: VoiceState;
}

/** What was said to her; handled as if it had been typed (slash commands included). */
export interface Heard {
  type: "heard";
  texto: string;
  original: string;
  idioma: string;
}

export interface ConfirmRequest {
  type: "confirm_request";
  id: string;
  texto: string;
  riesgo: "normal" | "alto";
}

/** What a Claude Code session is doing (from its hooks), or the answer to a `/claude` request. Data to show, never instructions. */
export interface ClaudeEvent {
  type: "claude";
  session: string;
  project: string; // folder name of the session
  estado: "inicio" | "trabajando" | "necesita" | "fallo" | "termino" | "respuesta" | "fin";
  detalle: string; // what it is doing now, the error, or what it needs
  herramienta: string; // the tool Claude is using while it works ("" for the prompt)
  resumen: string; // Claude's last message (termino and respuesta)
  segundos: number; // seconds the prompt took (termino)
  acciones: number; // tool calls (termino)
  archivos: number; // files edited (termino)
}

// Avatar -> backend
export interface TextInput {
  type: "text_input";
  text: string;
}

/** Look at the screen: capture `rect` (monitor, physical px: left, top, right, bottom) and answer `text` about it. */
export interface Look {
  type: "look";
  text: string;
  rect: [number, number, number, number];
}

export interface ConfirmResponse {
  type: "confirm_response";
  id: string;
  ok: boolean;
}

/** A fullscreen app (game, video) is in front: Capri is hidden and keeps quiet until it goes. */
export interface Presence {
  type: "presence";
  fullscreen: boolean;
}

export interface Hotkey {
  type: "hotkey";
  name: string;
}

/** A tool runs (after its confirmation, if it has effects): the avatar's lightning while it does. */
export interface Action {
  type: "action";
  nombre: string;
  fase: "inicio" | "fin";
  ok: boolean | null; // at the end, did it work
  ms: number | null; // at the end, how long it took
}

export type ServerMessage = State | UtteranceStart | TextDelta | UtteranceEnd | Remembered | Mode | ConfirmRequest | Action | ClaudeEvent | Voice | Heard;
export type ClientMessage = TextInput | Look | ConfirmResponse | Presence | Hotkey;
