# Arquitectura de Proyecto Capri

## Visión general

```
┌─────────── avatar (Tauri 2) ───────────┐        ┌──────────── backend (Python) ────────────┐
│ ventana transparente a pantalla        │  WS    │ FastAPI en 127.0.0.1:8765                │
│ completa, PixiJS, HTML/CSS             │◄──────►│ orquestador → modelo → JSON validado     │
│ bandeja, atajos, panel, menú rápido    │ token  │ voz (Whisper, TTS), herramientas,        │
│ asistente de primer arranque           │        │ memoria SQLite, calendario, Spotify      │
└────────────────────────────────────────┘        └──────────────────────────────────────────┘
        Rust: ventanas, bandeja, hitboxes                    procesos aparte: Ollama, Qwen3-TTS
```

El avatar lanza el backend como proceso hijo y lee su URL (con un token por arranque) de la primera línea de su
salida. El backend se cierra solo cuando se cierra su entrada estándar.

## Backend (`backend/app/`)

| Módulo | Qué hace |
|---|---|
| `main.py`, `ws.py` | arranque; WebSocket (solo `127.0.0.1`, token por arranque, valida `Origin`) |
| `orchestrator.py` | un turno: contexto, modelo, acciones con confirmación, recordatorios, rutinas |
| `llm/providers.py`, `llm/client.py` | cerebro: Ollama, Claude Code, APIs en la nube; validación del JSON |
| `voice.py`, `speech.py`, `voices.py`, `qwen_worker.py` | oído (Whisper + VAD), voz (Qwen3-TTS, Kokoro, Piper), catálogo de voces |
| `tools.py`, `power.py`, `launch.py` | herramientas y sus niveles de permiso |
| `commands.py`, `commands.json`, `spoken.py` | comandos de la barra y frases habladas |
| `memory.py`, `reminders.py`, `winalarm.py`, `calendar_ics.py` | memoria (SQLite + FTS5), recordatorios, alarmas de Windows, calendario |
| `routines.py`, `spotify.py`, `claude_link.py`, `pcsense.py` | rutinas, música, modo Claude Code, sensores del PC |
| `firstrun.py`, `settings.py`, `protocol.py` | asistente de inicio, configuración, mensajes del WebSocket |

La salida del modelo es siempre JSON `{emocion, gesto, accion, texto}` validado con pydantic; si falla, un reintento
y luego `neutral`.

## Avatar (`avatar/`)

- `src/main.ts`: el bucle principal; `src/state/`: lógica pura y con tests (percha en ventanas, trucos, intro…);
  `src/render/`: PixiJS, cámara, intro; `src/pet/`: la mascota en pixel art; `src/net/`: WebSocket y protocolo.
- Tres ventanas más, cada una con su HTML: `settings.html` (panel en pestañas), `quick.html` (clic derecho sobre ella),
  `setup.html` (primer arranque).
- `src-tauri/src/`: bandeja y ventanas (`tray.rs`), atajos globales y backend (`lib.rs`), configuración
  (`user_config.rs`), ventanas del escritorio (`win_watch.rs`), Ollama (`ollama.rs`).

## Voz

Oído: faster-whisper `large-v3-turbo` en GPU (o `small` en CPU sin NVIDIA) con VAD de Silero. Voz: Qwen3-TTS 0.6B
clonado con `faster-qwen3-tts` en un proceso aparte con su propio entorno; Kokoro y Piper en CPU. El micrófono solo
está abierto con la voz activa y el audio nunca se guarda. Detalles de uso en el asistente y en `/ayuda`.

## Seguridad

- Lo que aparece en pantalla son datos, nunca instrucciones. La captura solo ocurre por atajo, comando explícito o clic.
- Niveles de herramientas (`power.py`): libre, con clic, con clic y aviso rojo, sin tecla, y nunca (credenciales,
  claves, perfiles de navegador, su propia config).
- Las claves de API van al Administrador de credenciales de Windows, nunca a `config.toml`.
- Las rutinas solo abren programas «normales» y solo por orden del usuario.

## Red

Todo es local salvo, a petición del usuario: la API de su cerebro en la nube si lo elige; calendario por iCal;
Spotify (PKCE, su propia app); leer páginas web públicas (nunca de su red ni de su PC); la búsqueda en su navegador;
las descargas de modelos y paquetes del instalador y del asistente (Ollama, Hugging Face, PyPI, GitHub de `kokoro-onnx`).

## Instalador (`installer/`)

Un `CapriSetup.exe` con la app, el código del backend, `uv` y su voz dentro (`scripts/build_installer.ps1` arma el
paquete). Descarga Python y los paquetes, Kokoro y, si se marcan, Ollama y la voz clonada. El mismo exe, copiado como
`Desinstalar Capri.exe`, desinstala. La lógica pura está en `installer/src-tauri/src/plan.rs` (con tests).
