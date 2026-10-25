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

export interface ConfirmRequest {
  type: "confirm_request";
  id: string;
  texto: string;
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

export interface Hotkey {
  type: "hotkey";
  name: string;
}

export type ServerMessage = State | UtteranceStart | TextDelta | UtteranceEnd | Remembered | ConfirmRequest;
export type ClientMessage = TextInput | Look | ConfirmResponse | Hotkey;
