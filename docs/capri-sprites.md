# Capri · hoja de sprites

![Hoja de sprites](capri-sprites.png)

Capri tiene dos estilos de arte para su cuerpo (más la cámara, que son primeros planos de la serie):

- **Pixel art (chibi):** 30 animaciones dibujadas con [PixelLab](https://pixellab.ai) a partir de un diseño chibi fiel
  al original (`avatar/assets/pet/anim/<clip>/<clip>_NN.png`). Es lo que muestra esta hoja.
- **Original:** las tiras animadas de la serie (`avatar/assets/original`, de lachydotmcg/capri-desktop).
- La mascota antigua **generada por código** (`avatar/src/pet/draw.ts`, `rig.ts`, `stamps.ts`) sigue en el proyecto
  solo como respaldo: se ve únicamente si a un estado le falta su clip.

## Cómo se reproducen

- **Lienzos:** 108 px de pie, 116 sentada y 136 con el portátil; el personaje mide unos 62×75 px. Se muestran ×2 sin
  suavizado. `render/pet.ts` mide los pies del primer fotograma de cada clip para ponerlos en la línea de suelo, así
  que los tamaños pueden variar entre clips.
- **Ritmo:** cada clip declara sus fotogramas y su fps en `avatar/src/pet/clips.ts` (`CLIPS`). Los bucles
  generados no siempre acaban donde empiezan, así que van y vuelven (`pingpong`).
- **Transiciones:** un estado puede tener una cadena de entrada (`enter`) y luego su bucle (`loop`). Al cambiar de
  estado se deshacen al revés las transiciones que el nuevo no comparte y se reproducen las que añade: de escribir a
  hablar se cierra el portátil y se levanta; de sentada a escribir solo se abre el portátil.
- **Clic:** la zona sensible sale de los píxeles opacos de cada fotograma.
- **Dirección del director:** `behaviors.ts` elige el estado. Prioridad: pinchada > acariciada > escribir > emoción
  (mientras habla y 15 s después) > dormir > saludar > reposo.

## Estados y clips

`a → b` es «`a` una vez y luego `b` en bucle». Vista: *frente* (de pie) o *3/4* (sentada).

| Estado | Clips | Fotogramas · fps | Vista | Cuándo |
|---|---|---|---|---|
| `sentada` (reposo) | `sentarse` → `sentada_idle` | 7·12 → 9·7 | 3/4 | reposo por defecto |
| `estirarse` | `sentarse` → `estirarse` | 13·10 | 3/4 | reposo, a ratos |
| `meditar` | `sentarse` → `meditar` | 9·6 | 3/4 | reposo, a ratos |
| `dormir` | `sentarse` → `dormirse` → `dormir` | 9·6 → 5·3 | 3/4 | 20 min sin actividad, o sin enlace |
| `escribir` | `sentarse` → `abrir_portatil` → `escribir` | 2·4 → 9·10 | 3/4 | mientras el modelo piensa |
| `triste` | `sentarse` → `triste` | 9·6 | 3/4 | emoción `triste` |
| `pinchada` | `sentarse` → `pinchada` | 9·12 | 3/4 | clic sobre ella |
| `acariciada` | `sentarse` → `acariciada` | 9·8 | 3/4 | pasar el ratón sobre su cabeza |
| `hablar` | `hablar` | 9·8 | frente | emoción `neutral` |
| `feliz` | `feliz` | 9·10 | frente | emoción `feliz` |
| `enamorada` | `enamorada` | 9·8 | frente | emoción `feliz` (variante) |
| `emocionada` | `emocionada` | 9·12 | frente | emoción `emocionada` |
| `traviesa` | `traviesa` | 9·10 | frente | emoción `traviesa` |
| `curiosa` | `curiosa` | 9·8 | frente | emoción `curiosa` |
| `pensativa` | `pensativa` | 9·6 | frente | emoción `pensativa` |
| `sorprendida` | `sorprendida` | 9·12 | frente | emoción `sorprendida` |
| `molesta` | `molesta` | 9·10 | frente | emoción `molesta` |
| `seria` | `seria` | 5·5 | frente | emoción `seria` |
| `saludar` | `saludar` | 9·10 | frente | al conectar; intro en pixel |

**Gestos del modelo** (sobre las poses de pie, mientras dura el gesto): `asentir`, `ladear` (`ladear_cabeza`),
`guino`, `saltar`, `senalar` y `cruzar_brazos`.

**Sin estado todavía:** `peligro` (su transformación con ojos múltiples, pensada para confirmar acciones peligrosas;
los ojos extra los pinta `scripts/import_chibi.py`), `de_pie_idle` y `hablar_sentada`.

## Regenerar y añadir

- **La hoja de arriba:** `uv run --project backend python scripts/build_sprite_sheet.py` (desde la raíz).
- **Reimportar todos los clips desde PixelLab:** `scripts/import_chibi.py` lee `scripts/chibi_manifest.json` (cada clip:
  personaje, animación, fotogramas y los que se conservan), recorta el banco del portátil de `escribir`, pinta los ojos
  de `peligro` y crea `abrir_portatil`. Imprime los fotogramas para `clips.ts`.
- **Un clip nuevo:** añádelo al manifiesto y a `CLIPS` (fotogramas y fps), y a `SPRITE_FOR` si es de un estado.
- **Revisar la mascota:** con `npx vite` en `avatar/`, abre `http://localhost:1420/preview.html` (`?live` animado).

El plan de arte y su historia están en [arte-pixellab.md](arte-pixellab.md).
