# Capri

Asistente local para Windows con un avatar 2D animado, inspirado en Capri de *Cyberpunk: Edgerunners 2*: una IA
que «vive» en tu PC dentro de un biochip. Habla por voz o por texto, ve tu pantalla solo cuando se lo pides, abre
programas, pone música, te recuerda cosas y reacciona a lo que pasa en tu PC.

> Proyecto personal sin ánimo de lucro, sin afiliación con Studio Trigger, CD PROJEKT RED ni Netflix. El arte de la
> serie y su voz clonada no tienen la licencia del código: ver [NOTICE.md](NOTICE.md).

## Qué hace

- **Chat y voz:** ventana flotante transparente; llámala por su nombre («Capri, …») o con `Ctrl+Alt+V`. Entiende
  español e inglés y contesta con voz propia (clonada en GPU NVIDIA, o voces en CPU).
- **Cerebro a elección:** un modelo local con Ollama (por defecto), tu plan de Claude (Claude Code), o una API en la
  nube con tu clave (Claude, GPT, Gemini, OpenRouter, Groq, Mistral, DeepSeek, Grok).
- **Herramientas con permisos por niveles:** lo irreparable siempre pide un clic. Nada sale de tu PC salvo lo que
  elijas (ver [Seguridad](docs/arquitectura.md#seguridad)).
- **Avatar:** tres aspectos (arte original, pixel art, cámara), pasea por la barra de tareas y se sienta en tus
  ventanas, con truquitos y reacciones.
- **Extras:** recordatorios y alarmas de Windows, calendario (iCal, `.ics`, Outlook), Spotify, modo Claude Code,
  rutinas («modo chamba»), clic derecho sobre ella para un menú rápido y un asistente de primer arranque.

## Instalar

**Con el instalador** (lo más fácil): ejecuta `CapriSetup.exe`. Windows dirá «Windows protegió tu PC» porque no está
firmado: *Más información › Ejecutar de todas formas*. Instala en `%LOCALAPPDATA%\Programs\Capri`, sin administrador.

**Desde el código:**

```powershell
# requisitos: Windows 11, Python 3.12 con uv, Node 20+, Rust (Tauri 2), Ollama (opcional)
cd backend; uv sync                      # el backend
cd ..\avatar; npm install                # el avatar
npm run tauri dev                        # lanza el backend solo
```

Con GPU NVIDIA y su voz clonada, o Ollama y un modelo, el asistente del primer arranque te guía. Sin ellos funciona
con voces en CPU y un cerebro en la nube.

## Estructura

```
backend/      Python (FastAPI + WebSocket): cerebro, voz, herramientas, memoria, calendario
avatar/       Tauri 2 + PixiJS + TypeScript: ventana transparente, panel, menú rápido, asistente
  src-tauri/  la parte en Rust (bandeja, atajos, ventanas)
installer/    el instalador y desinstalador (Tauri, estética de su biochip)
scripts/      herramientas manuales: build del instalador, pruebas de GPU/voz, evaluaciones
docs/         arquitectura, comandos, hoja de sprites
```

## Desarrollo

```powershell
cd backend;  uv run pytest              # tests del backend
cd avatar;   npm test                   # tests del avatar
cd avatar\src-tauri; cargo test --lib   # tests de la parte Rust
cd installer\src-tauri; cargo test --lib
powershell -File scripts/build_installer.ps1   # dist\CapriSetup.exe (con Capri cerrada)
```

Más en [CONTRIBUTING.md](CONTRIBUTING.md) y [docs/arquitectura.md](docs/arquitectura.md). Los comandos de su barra
están en [docs/comandos.md](docs/comandos.md).

## Licencia

El **código** es MIT ([LICENSE](LICENSE)). El arte, las tomas de la serie y la voz clonada **no**: ver [NOTICE.md](NOTICE.md).
