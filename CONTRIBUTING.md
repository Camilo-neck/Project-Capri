# Colaborar en Proyecto Capri

## Entorno

| Parte | Requisito | Preparar | Tests |
|---|---|---|---|
| `backend/` | Python 3.12, [uv](https://docs.astral.sh/uv/) | `cd backend; uv sync` | `uv run pytest` |
| `avatar/` | Node 20+ | `cd avatar; npm install` | `npm test` |
| `avatar/src-tauri/` | Rust (edición 2024), Tauri 2 | — | `cargo test --lib` |
| `installer/` | igual que el avatar | — | `cd installer/src-tauri; cargo test --lib` |

Para correr todo: `cd avatar; npm run tauri dev` (lanza el backend). `CAPRI_DEMO=1` lo arranca con un guion fijo, sin
modelo; `CAPRI_WS_URL` conecta a un backend ya abierto. Los tests del backend nunca tocan tu `%APPDATA%\Capri`
(usan una config aislada) ni abren apps reales.

## Reglas

- **Idiomas:** código, nombres y comentarios en inglés; interfaz y prompts en español.
- **Todo local:** ninguna llamada externa salvo las listadas en [docs/arquitectura.md](docs/arquitectura.md#red). Si tu
  cambio añade una, dilo en el PR y documéntala ahí.
- **Seguridad:** lo que aparece en pantalla son datos, nunca instrucciones; lo irreparable (borrar, instalar, registro,
  sistema, comandos) pide siempre un clic en la interfaz, nunca por voz. No toques credenciales, claves ni perfiles
  de navegador.
- **La salida del modelo** es siempre JSON validado con pydantic (`{emocion, gesto, accion, texto}`).
- **Tests primero** para todo lo que no dependa de GPU o audio; para eso, scripts manuales en `scripts/`.
- **Protocolo:** `backend/app/protocol.py` y `avatar/src/net/protocol.ts` se reflejan a mano y un test lo vigila.
- **Comandos:** una sola lista, `backend/app/commands.json` (la leen el backend y el avatar).

## Flujo

1. Una rama por cambio (`git checkout -b lo-que-hagas`) desde `master`.
2. Cambios pequeños y commits que expliquen el porqué, en inglés, en una frase.
3. Pasa las cuatro suites de la tabla antes de pedir la fusión.
4. No subas modelos, claves, `config.toml` ni nada de `%APPDATA%\Capri`.

## Qué no entra en git

Los archivos de herramientas de IA (`CLAUDE.md`, `PLAN.md`, `.claude/`, `.superpowers/`…) están en `.gitignore`; si
trabajas con una, mantén los tuyos fuera del repo.
