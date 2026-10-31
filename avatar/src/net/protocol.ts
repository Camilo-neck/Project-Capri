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
  cortada: boolean; // she was interrupted: the text ends where she was cut off
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
  hablar: boolean; // with the voice on, she answers out loud
}

/** One of her voices as it stands on this PC (backend voices.CATALOG). */
export type VoiceOption = {
  id: string;
  nombre: string;
  motor: "qwen" | "kokoro" | "piper";
  nota: string;
  gpu: boolean;
  nube: boolean; // a service: what she says leaves this PC
  descargada: boolean;
  descargable: boolean; // what's missing can be downloaded from the panel
  disponible: boolean; // this PC can run it
  motivo: string; // why not
  mb: number; // left to download
};
/** Her voice and its touches (settings panel). */
export interface VoiceInfo {
  type: "voice_info";
  velocidad: number;
  robot: number;
  glitch: number;
  voz: string;
  voces: VoiceOption[];
}
/** A voice downloading (bytes). */
export interface VoiceProgress {
  type: "voice_progress";
  voz: string;
  completado: number;
  total: number;
  error: string;
}

/** Her routines (built-in and [rutinas] in config.toml), for the panel's command list. */
export type RoutineInfo = { nombre: string; frases: string[]; apps: string[]; musica: string };
export interface Routines {
  type: "routines";
  rutinas: RoutineInfo[];
}

/** The first-run wizard: what this PC has, and the brain and voice that suit it. */
export interface SetupInfo {
  type: "setup_info";
  gpu: string; // the NVIDIA card, "" without one
  vram_mb: number;
  ram_gb: number;
  disco_gb: number;
  ollama: boolean;
  claude_code: boolean;
  qwen: boolean; // her cloned voice is installed
  proveedor: string;
  modelo: string;
  voz: string;
  por_que: string;
}
export interface SetupSaved {
  type: "setup_saved";
  campo: string;
  ok: boolean;
  error: string;
}

/** The microphone: idle waits for "hey Capri"; listening means the next sentence is for her. */
export type VoiceState = "off" | "loading" | "idle" | "hearing" | "listening" | "thinking";
export interface Voice {
  type: "voice";
  estado: VoiceState;
}

/** How loud: the microphone while he talks (camera meter) or her voice while she speaks (her mouth). */
export interface Level {
  type: "level";
  fuente: "mic" | "tts";
  valor: number;
}

/** What was said to her; handled as if it had been typed (slash commands included). */
export interface Heard {
  type: "heard";
  texto: string;
  original: string;
  idioma: string;
  charla: boolean; // heard without her name: may be the room, so the backend keeps the screen behind a click
}

/** Her brain, for the tray's settings panel. */
export interface ModelInfo {
  type: "model_info";
  proveedor: string;
  nombre: string;
  opciones: Record<string, string[]>;
  claves: Record<string, boolean>; // the cloud ones that take a key, and whether it is saved
  nombres: Record<string, string>; // how each provider is called
  error: string;
}

export interface ModelProgress {
  type: "model_progress";
  nombre: string;
  estado: string;
  completado: number;
  total: number;
}

export interface ConfirmRequest {
  type: "confirm_request";
  id: string;
  texto: string;
  riesgo: "normal" | "alto";
}
export type Button = { id: string; texto: string };
// something she felt in the PC (backend pcsense.py): she reacts. Never sent to the model.
export interface PcEvent {
  type: "pc";
  tipo: "caliente" | "cargador" | "bateria" | "red" | "usb" | "dispositivo" | "juego";
  detalle: string;
}
// buttons under what she just said that hold nothing up (cancel a reminder, done, 10 min more...)
export interface Buttons {
  type: "buttons";
  id: string;
  botones: Button[];
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

/** What is playing on the PC, for the player card. Titles are the player's words: data, never instructions. */
export interface NowPlaying {
  type: "now_playing";
  titulo: string;
  artista: string;
  app: string;
  sonando: boolean;
  posicion: number; // seconds when it was read
  duracion: number; // 0 when it has no end (a live stream)
}

// Avatar -> backend
export interface TextInput {
  type: "text_input";
  text: string;
  charla: boolean; // heard without her name (Heard.charla): never enough to capture the screen without a click
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
// one of her Buttons clicked
export interface Pressed {
  type: "pressed";
  id: string;
  boton: string;
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

export type ServerMessage = State | UtteranceStart | TextDelta | UtteranceEnd | Remembered | Mode | ConfirmRequest | Buttons | PcEvent | Action | ClaudeEvent | NowPlaying | Voice | Level | Heard | ModelInfo | ModelProgress | VoiceInfo | VoiceProgress | Routines | SetupInfo | SetupSaved;
/** A line of the avatar's own (a greeting, a reaction): out loud too, if she's talking. */
export interface Say {
  type: "say";
  texto: string;
}
/** He cuts her off (a click on her transmission): she stops talking, and the turn where it is. */
export interface Interrupt {
  type: "interrupt";
}
/** A button of the player card: the same media keys as the `musica` tool. */
export interface MediaKey {
  type: "media_key";
  accion: "play_pausa" | "siguiente" | "anterior";
}
// the first-run wizard
export interface SetupGet {
  type: "setup_get";
}
export interface SetupSave {
  type: "setup_save";
  campo: "calendario" | "spotify";
  valor: string;
}
export interface SetupDone {
  type: "setup_done";
}
// the tray's settings panel: her routines, her voice
export interface RoutinesGet {
  type: "routines_get";
}
export interface VoiceGet {
  type: "voice_get";
}
export interface VoiceSet {
  type: "voice_set";
  velocidad: number;
  robot: number;
  glitch: number;
  voz: string; // another of her voices ("" keeps hers)
  probar: boolean; // play a line with them (even with the voice off)
}
export interface VoiceDownload {
  type: "voice_download";
  voz: string;
}
// the tray's settings panel: her brain
export interface ModelGet {
  type: "model_get";
}
export interface ModelSet {
  type: "model_set";
  proveedor: string;
  nombre: string;
}
/** An API key for Claude or GPT ("" removes it); the backend keeps it in Windows' Credential Manager. */
export interface ModelKey {
  type: "model_key";
  proveedor: string;
  clave: string;
}
export interface ModelPull {
  type: "model_pull";
  nombre: string;
}

export type ClientMessage = TextInput | Look | ConfirmResponse | Pressed | Presence | Hotkey | ModelGet | ModelSet | ModelKey | ModelPull | Say | VoiceGet | VoiceSet | Interrupt | RoutinesGet | VoiceDownload | SetupGet | SetupSave | SetupDone | MediaKey;
