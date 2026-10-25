# Capri · encargo de arte y animación (PixelLab)

Especificación para generar el arte definitivo de la mascota. Está ajustada a **PixelLab** (límites, tamaños y forma de pedir las animaciones). Al final hay un brief resumido por si prefieres encargarlo a un artista.

El diseño es una **fusión**: el formato de mascota chibi de tu hoja con el diseño original de Capri en la serie (ver "Dirección de arte"). Las referencias están en `assets/inspo/pixellab/`:

| Archivo | Qué aporta | Uso en PixelLab |
|---|---|---|
| `ref_de_pie.png` | Proporciones chibi, escala, pose de pie (de tu hoja; fondo transparente, 96×96) | Referencia o imagen inicial del personaje base |
| `ref_sentada.png` | Pose sentada en el borde (de tu hoja) | Referencia de `base_sentada` |
| `ref_sentada_cruzada.png` | Piernas cruzadas (de tu hoja) | Referencia de `base_cruzada` |
| `ref_serie_cara.png` | Máscara verde de dos paneles, ojos concéntricos con pliegues en estrella, boca en zigzag (serie) | Imagen de estilo para la cara; guía para la descripción |
| `ref_serie_cuerpo.png` | Masa de pelo con brillo, mechones en rayo, cuerpo de esquirlas, borde violeta (serie) | Imagen de estilo para pelo y cuerpo |
| `ref_serie_amenaza.png` | Ojos múltiples y sonrisa triangular (serie) | Referencia del estado `peligro` |

Los archivos `@3x` son copias ampliadas de los de tu hoja, para verlos cómodamente; **no los subas**. Las de la serie son ilustraciones, no pixel art: sirven como referencia de estilo, no como imagen inicial.

---

## 1. Herramienta recomendada: PixelLab

**Por qué PixelLab:**
- Crea un personaje a partir de una referencia y lo anima con una descripción de texto (*Animate with text*), conservando el primer fotograma idéntico.
- Admite lienzos de hasta 256 px, de 4 a 16 fotogramas, paleta objetivo y fondo transparente.
- Tiene **servidor MCP oficial para Claude Code**: puedo generar yo las animaciones siguiendo este documento, revisarlas y montarlas en el proyecto.
- También funciona como plugin de **Aseprite** y en su editor web (*Creator*), por si quieres retocar a mano.

**Descartados:**
- **Retro Diffusion:** su modelo de animación solo hace caminatas de 48 px y sprites de 32 px, no animaciones a medida.
- **Generadores de imagen genéricos:** no mantienen el personaje idéntico entre fotogramas.

**Plan:** la cuenta gratuita sirve para probar el personaje base. Para todo el encargo conviene el **plan de entrada** (Tier 1), que algunas herramientas como *Animate with skeleton* exigen. Fuentes de terceros lo sitúan en unos 10–12 USD/mes con 1.000–2.000 generaciones; **compruébalo en pixellab.ai antes de pagar**. Un mes basta.

### Dos formas de hacerlo

**A. Lo genero yo por MCP (recomendado).** Tú solo creas la cuenta y me das acceso:
1. Entra en pixellab.ai, crea la cuenta y copia tu *API token* (en la sección de API/MCP).
2. En una terminal aparte (no en el chat, para que el token no quede en la conversación) ejecuta, sustituyendo el token:
   ```
   claude mcp add pixellab https://api.pixellab.ai/mcp --transport http --scope user -H "Authorization: Bearer TU_TOKEN"
   ```
3. Reinicia Claude Code y dime "genera el arte según docs/arte-pixellab.md". Yo genero, reviso fotograma a fotograma, repito lo que salga mal y lo integro.

**B. Lo haces tú en PixelLab (web o Aseprite)** siguiendo los pasos 2 a 4 tal cual, con los prompts copiados de aquí, y me pasas los PNG con la estructura de la sección 6.

---

## Dirección de arte: fusión

La silueta, el tamaño y la ternura de mascota vienen de tu hoja; el diseño, la paleta y los detalles, de la Capri de la serie. Si hay conflicto, **la cara y los colores mandan los de la serie, y las proporciones y poses, los de la hoja**.

| Elemento | De la hoja (mascota) | De la serie (Capri original) | Resultado |
|---|---|---|---|
| Proporciones | Chibi: cabeza grande, cuerpo fino, unos 70 px | Figura larga y estilizada | Chibi, pero con piernas largas y finas acabadas en punta |
| Pelo | Masa voluminosa con rizos (sus dos mechones en cuerno **no** se usan) | Masa enorme de **esquirlas** rojo neón con **brillo blanco** fino, puntas en **rayo**, algún fragmento suelto | Masa voluminosa de mascota con bordes de esquirla dentada, rojo neón, puntitos blancos de brillo y 2–3 mechones en rayo que caen a los lados. **Sin cuernos**: la parte de arriba es redondeada y dentada |
| Cabeza y cara | Cara verde con flequillo negro en forma de antifaz | Cabeza negra con **máscara verde de dos paneles** con muesca en V; **ojos concéntricos** (anillo verde, iris azul, brillo blanco) con **pliegues negros en estrella** | Cabeza negra pequeña con la máscara verde de dos paneles ocupando la parte alta de la cara; ojos concéntricos grandes y expresivos |
| Boca | Sonrisa blanca con dientes | **Zigzag** fino cuando está tranquila; **sonrisa triangular** blanca y dentada cuando se emociona | Igual que la serie |
| Cuerpo | Maillot rojo y negro con paneles verdes | Cuerpo de **esquirlas** angulosas negras, rojas y verdes | Maillot hecho de esquirlas angulosas: negro de base con trozos rojo neón y verde ácido; guantes y botas negros |
| Borde | Contorno negro | **Borde violeta** desplazado | Contorno negro de 1 px y, por fuera, **1 px violeta** en el lado inferior izquierdo de la silueta |
| Rasgo especial | — | **Ojos múltiples** cuando se pone amenazante | Estado `peligro` con ojitos extra que se abren por la máscara |
| Personalidad | Mascota tierna y juguetona | Glitch, intensa, algo inquietante | Juguetona y tierna, con un punto travieso o inquietante en `traviesa`, `molesta` y `peligro` |

---

## 2. Especificación técnica (todas las piezas)

| Parámetro | Valor | Motivo |
|---|---|---|
| Lienzo | **96 × 96 px** por fotograma | Tu hoja mide unos 70 px de alto nativo; 96 deja aire para saltos y brazos. 96×96×16 entra en el límite de PixelLab (524.288 px) |
| Tamaño del personaje | De pie: 68–72 px de alto con el pelo; sentada: 58–64 px | Igual densidad de píxel que tu hoja |
| Vista | *Side view* (cámara frontal), dirección **south** (mirando a la cámara) | Mascota de frente al usuario |
| Línea de suelo | Pies en **y = 92** (4 px de margen). Sentada en el borde: asiento en y ≈ 78 y piernas colgando hasta y ≈ 95 | Yo alineo después, pero cuanto más fiel, mejor |
| Fondo | **Transparente** (*Remove background* activado) | |
| Contorno | Negro de 1 px, sin antialiasing, sombreado plano con un solo tono oscuro, más **1 px violeta** por fuera en el lado inferior izquierdo | Hoja + borde desplazado de la serie |
| En pantalla | ×3 sin suavizado (288 px) | |
| Paleta objetivo | `#050402` contorno · `#1a1220` negro del traje y la cabeza · `#ff2457` rojo neón (pelo, esquirlas) · `#b81d48` sombra del rojo · `#6e1030` sombra profunda · `#16f46c` verde ácido (máscara, piel, esquirlas) · `#0fa84a` sombra del verde · `#1e7bff` iris · `#ffffff` blancos y brillo del pelo · `#8b38ff` borde violeta | Colores de la serie (los mismos que la versión vectorial), con sombras derivadas. En PixelLab: *Color → Target palette* |
| Fotogramas | Pares, de 4 a 16 (regla de PixelLab) | |
| Fotograma 1 | En todas las animaciones, **boca cerrada y pose neutra de su familia** | Así puedo encadenar animaciones y sincronizar el habla |

**No generes:** textos, "zZz", corazones flotantes, "?", "!", destellos, lágrimas ni efectos de glitch (separación de color, franjas desplazadas). Los pongo yo por código encima, a la misma escala de píxel, para poder combinarlos con cualquier pose. **Sí** forman parte del sprite el portátil, lo que la toque o sostenga, el brillo del pelo y los ojos extra de `peligro`.

---

## 3. Paso 1: personaje base

**Herramienta:** *Create character* (o *Create character Pro* para más calidad), 96×96, *side view*, *south*. Usa `ref_de_pie.png` como referencia de forma y proporciones, y `ref_serie_cara.png` y `ref_serie_cuerpo.png` como imágenes de estilo si la herramienta lo admite. Si solo admite una referencia, usa `ref_de_pie.png` y deja que el prompt aporte la serie.

**Prompt:**
```
Chibi pixel art desktop pet, a glitchy cyberpunk AI girl, front view facing the camera, standing,
full body, cute but slightly eerie. Huge voluminous hair mass in neon red made of jagged angular
shards, sprinkled with tiny white glitter dots, rounded jagged top with NO horns and no horn-like
tufts, and two or three lightning-bolt strands falling at the sides. Small black head with an acid-green angular mask of two
panes meeting in a V notch, covering the upper face. Big concentric eyes on the mask: green ring,
blue iris, white highlight, with thin black star-shaped creases around them. Thin white zigzag
mouth. Slim body made of angular shards: black base with neon red and acid green fragments, black
gloves and boots, long thin legs ending in sharp points. 1px black outline plus a 1px violet rim on
the lower-left side of the silhouette, flat shading with one darker tone, no anti-aliasing,
transparent background. Playful, mischievous personality.
```

**Criterio para aceptarlo:**
- **Proporciones y ternura** de `ref_de_pie.png` (cabeza grande, cuerpo fino, unos 70 px).
- **Rasgos de la serie** reconocibles: máscara verde de dos paneles, ojos concéntricos, pelo de esquirlas rojo neón con brillo y borde violeta.
- **Sin cuernos** ni mechones en forma de cuerno sobre la cabeza. PixelLab tiende a añadirlos: si salen, descarta la imagen.
- **Fusión, no copia:** no debe parecer ni la mascota de la hoja con otros colores ni la Capri de la serie encogida.

Genera varias semillas y quédate con la mejor; **todo lo demás parte de esta imagen**, así que vale la pena invertir aquí.

---

## 4. Paso 2: poses base

Cada familia de animaciones parte de una pose fija. Se obtienen del personaje base con *Re-pose* o *Edit image / Inpaint*, siempre a 96×96, mirando a cámara.

| Id | Pose | Referencia extra | Prompt |
|---|---|---|---|
| `base_de_pie` | De pie, relajada, brazos a los lados | — (es el personaje base) | — |
| `base_sentada` | Sentada en un borde invisible, piernas colgando por delante | `ref_sentada.png` | `sitting on the edge of a ledge, knees together, lower legs hanging down in front, hands resting on the ledge beside her hips, front view` |
| `base_portatil` | Como `base_sentada`, con un portátil pequeño abierto en el regazo (vemos la tapa por detrás) | — | `sitting on a ledge with a small open laptop on her lap, we see the back of the lid, hands on the keyboard behind the lid, front view` |
| `base_cruzada` | Sentada con las piernas cruzadas | `ref_sentada_cruzada.png` | `sitting cross-legged on the floor, hands resting on her knees, front view` |
| `base_rodillas` | Sentada abrazando las rodillas | — | `sitting on the floor hugging her knees to her chest, chin resting on the knees, front view` |

---

## 5. Paso 3: animaciones

**Herramienta:** *Animate with text* (versión nueva), con la pose base como *reference image*. Una sola dirección (*south*). Prompt = acción en inglés. Si una animación se deforma, prueba con *Animate with skeleton* o *Edit animation*, o reduce los fotogramas.

**Columnas:**
- **Fot.:** número de fotogramas.
- **fps:** velocidad a la que la reproduzco.
- **Tipo:** `bucle` se repite; `una vez` se reproduce y vuelve.
- **(⇄):** animaciones que también reproduzco al revés.

### 5.1 Reposo

| Id | Base | Fot. | fps | Tipo | Prompt |
|---|---|---|---|---|---|
| `sentada_idle` | base_sentada | 8 | 8 | bucle | `idle, lower legs swinging back and forth alternately, gentle breathing, one blink` |
| `meditar` | base_cruzada | 8 | 6 | bucle | `floating cross-legged meditating with eyes closed and a calm smile, slowly bobbing up and down, hair gently floating` |
| `estirarse` | base_sentada | 12 | 10 | una vez | `stretching both arms up high above her head and yawning with eyes closed, then relaxing back to the starting pose` |
| `dormir` | base_cruzada | 8 | 4 | bucle | `asleep sitting, head drooped to one side, eyes closed, slow breathing, small open mouth` |
| `dormirse` (⇄ despertar) | base_cruzada | 6 | 8 | una vez | `getting sleepy: eyelids getting heavy, head slowly nodding down until asleep` |

### 5.2 Pensando

| Id | Base | Fot. | fps | Tipo | Prompt |
|---|---|---|---|---|---|
| `escribir` | base_portatil | 8 | 10 | bucle | `typing quickly on the laptop, hands alternating, focused eyes, head bobbing slightly` |
| `escribir_pausa` | base_portatil | 8 | 6 | bucle | `stops typing and looks up thinking, finger tapping her chin, then looks back at the screen` |

### 5.3 Hablando, una por emoción

Las de pie parten de `base_de_pie`. En todas, el fotograma 1 lleva boca cerrada y el habla abre y cierra la boca a lo largo del ciclo; mientras se escribe el texto avanzo los fotogramas y al terminar vuelvo al 1.

| Id | Emoción | Fot. | fps | Prompt |
|---|---|---|---|---|
| `hablar` | neutral | 8 | 8 | `talking casually, mouth opening and closing, one hand gesturing while she speaks` |
| `hablar_sentada` | neutral (si está sentada) | 8 | 8 | `talking while sitting, mouth opening and closing, small hand gestures` (base: base_sentada) |
| `feliz` | feliz | 8 | 10 | `happy little hops in place, eyes closed in joy, big white triangular grin with jagged teeth, arms swinging` |
| `enamorada` | feliz (variante) | 8 | 8 | `hands on her cheeks, heart-shaped eyes, blushing, swaying side to side happily` |
| `emocionada` | emocionada | 8 | 12 | `jumping up and down with both arms raised, star-shaped sparkling eyes, open mouth` |
| `traviesa` | traviesa | 8 | 10 | `giggling behind her hand, winking one eye, shoulders shaking with laughter, other hand on hip` |
| `curiosa` | curiosa | 8 | 8 | `leaning forward curiously, head tilting side to side, finger on chin, wide eyes` |
| `pensativa` | pensativa | 8 | 6 | `thinking with hand on chin, eyes looking up, slow sway` |
| `sorprendida` | sorprendida | 8 | 12 | `startled: jumps back a little with hands up, eyes wide open, mouth open in an O, hair shards bristling, slight trembling` |
| `molesta` | molesta | 8 | 10 | `annoyed with arms crossed, tapping one foot, angry slanted eyes, jagged triangular grin showing teeth, hair shards bristling, head turned slightly away` |
| `triste` | triste | 8 | 6 | `sad, hugging her knees, head down, droopy eyes, small sniffle movement` (base: base_rodillas) |
| `seria` | seria | 4 | 4 | `serious, hands behind her back, steady gaze, small slow nod` |

### 5.4 Interacción con el ratón

| Id | Base | Fot. | fps | Tipo | Prompt |
|---|---|---|---|---|---|
| `pinchada` | base_sentada | 8 | 12 | una vez | `poked: squashes down, wobbles, dizzy spiral eyes, wavy mouth, then recovers` |
| `acariciada` | base_sentada | 8 | 8 | bucle | `being petted on the head: leans her head into the touch, eyes closed happily, blushing, content smile` |
| `saludar` | base_de_pie | 8 | 10 | bucle ×2 | `waving hello with one hand raised high, cheerful grin` |

### 5.5 Estado especial de la serie

| Id | Base | Fot. | fps | Tipo | Prompt |
|---|---|---|---|---|---|
| `peligro` | base_de_pie | 8 | 10 | bucle | `menacing: leans forward with clawed hands raised, several extra small concentric eyes open one by one across the green mask, wide jagged triangular grin, hair shards flare up and bristle` (referencia: `ref_serie_amenaza.png`) |

Se usa cuando va a hacer algo con efectos y pide confirmación (fase 5), y como variante intensa de `molesta`.

### 5.6 Gestos cortos (de pie)

| Id | Fot. | fps | Tipo | Prompt |
|---|---|---|---|---|
| `asentir` | 6 | 12 | una vez | `nodding twice` |
| `ladear` | 6 | 10 | una vez | `tilting her head to one side and back` |
| `guino` | 4 | 10 | una vez | `winking one eye with a smile` |
| `saltar` | 8 | 12 | una vez | `a small happy jump: crouch, jump up, land` |
| `senalar` | 6 | 10 | una vez | `pointing to the side with her right arm, then lowering it` |
| `cruzar_brazos` | 6 | 10 | una vez | `crossing her arms over her chest` |

### 5.7 Transiciones entre familias (evitan saltos)

| Id | De → a | Fot. | fps | Prompt |
|---|---|---|---|---|
| `levantarse` (⇄ sentarse) | base_sentada → base_de_pie | 8 | 12 | `standing up from sitting on the ledge to standing upright` |
| `cruzar_piernas` (⇄) | base_sentada → base_cruzada | 6 | 10 | `pulling her legs up and crossing them` |
| `abrazar_rodillas` (⇄) | base_cruzada → base_rodillas | 6 | 8 | `pulling her knees up to her chest and hugging them` |
| `abrir_portatil` (⇄ cerrarlo) | base_sentada → base_portatil | 6 | 10 | `taking out a small laptop and opening it on her lap` |

**Total:** 5 poses base y unas 37 animaciones.

---

## 6. Entrega

```
avatar/assets/pet/
  base/        base_de_pie.png, base_sentada.png, ...           (96×96)
  anim/        sentada_idle/sentada_idle_01.png ... _08.png      (96×96 cada uno)
               escribir/escribir_01.png ...
```

- **Alternativa válida:** una tira horizontal por animación (`escribir.png` de 8×96 = 768 px de ancho por 96 de alto), que es como exporta Aseprite.
- **Nombres:** exactamente los `Id` de las tablas, en minúsculas, con número de 2 cifras.
- **Si algo no cuadra:** con un fondo de color plano y uniforme (por ejemplo `#00ff00`) también me sirve, siempre que ese color no aparezca en el personaje.

## 7. Control de calidad (por animación)

- [ ] Es la misma Capri: pelo, cara, colores y proporciones iguales en todos los fotogramas.
- [ ] Fotograma 1 en la pose base de su familia y con la boca cerrada.
- [ ] Los pies (o el asiento) no "patinan": la base no se desplaza salvo que la acción lo pida.
- [ ] Sin píxeles sueltos, sin halos, fondo totalmente transparente.
- [ ] Contorno negro de 1 px, borde violeta en el lado inferior izquierdo y solo colores de la paleta.
- [ ] Rasgos de la serie presentes: máscara verde de dos paneles, ojos concéntricos, pelo de esquirlas con brillo.
- [ ] Sin cuernos.
- [ ] Los bucles cierran: el último fotograma enlaza con el primero sin saltos.

## 8. Coste estimado

Con *Animate with text* a 96×96, 8 fotogramas cuestan 2 generaciones y 4–6 fotogramas, 1. Las ~36 animaciones son unas 60 generaciones. Sumando poses base y repeticiones (calcula ×3), salen **unas 200–250 generaciones**: caben de sobra en un mes del plan de entrada.

## 9. Si lo encargas a un artista

> Pixel art desktop pet, 96×96 px canvas per frame, character ~70 px tall, front view, transparent background, 1 px black outline plus a 1 px violet rim on the lower-left, palette below. The character is a fusion: chibi proportions and pet poses from the attached pet sheet (`pet_reference.png`), with the design of Capri from Cyberpunk: Edgerunners 2 (neon red shard hair with glitter, green two-pane mask, concentric eyes, shard body, extra eyes when menacing; see `ref_serie_*.png`). Read the "Dirección de arte" table. Deliver one Aseprite file with one tag per animation (names and frame counts in the attached table) plus PNG strips. Frame 1 of every animation = base pose with closed mouth; loops must close cleanly. No text or floating effects (hearts, zZz, ?, !): those are added in code.

Adjunta la tabla "Dirección de arte", las secciones 2, 4 y 5 de este documento, la hoja de referencia y los recortes `ref_serie_*.png`.

## 10. Cómo lo integro yo

- **Reproductor:** carga las tiras o las carpetas, alinea la línea de suelo, unifica la paleta y limpia los bordes (como hice con tu hoja).
- **Máquina de estados:** la que ya existe (`avatar/src/pet/behaviors.ts`), con las mismas prioridades. En vez de poses calculadas reproduce animaciones y, al cambiar de familia, pasa por la transición correspondiente (por ejemplo, sentada → `levantarse` → `feliz`). Nunca hay un corte seco.
- **Habla:** durante el texto avanza los fotogramas de la animación de su emoción y al terminar vuelve al fotograma 1 (boca cerrada).
- **Ratón:** igual que ahora. La caja de clic sale de los píxeles del fotograma actual; clic = `pinchada`, frotar la cabeza = `acariciada`.
- **Efectos (zZz, corazones, ?, !, destellos, lágrimas):** por código encima del sprite, a la misma escala.
- **Lo que se pierde frente a la versión por código:** los ojos ya no siguen al ratón, porque van dibujados en el sprite. Se puede recuperar con un sello de iris encima si se pide en un paso aparte.
- **Mientras llega el arte:** sigue funcionando la mascota generada por código, y cada animación que llegue sustituye a la suya.

---

## 11. Estado de la generación (25/10/2026)

Cuenta de prueba agotada: 39 de 40 generaciones.

**Personaje a usar desde ahora:** **`a8d5ef9f-16d5-4804-a349-a9cf47cb626e`** ("Capri 8dir": 8 direcciones, vista *side*, 96×96, creado desde `avatar/assets/pet/base/base_de_pie.png`). El anterior de 4 direcciones (`79cce1f3-…`) queda obsoleto.

**Generado y guardado** en `avatar/assets/pet/anim/` (los fotogramas de animación salen a 132×132: el lienzo crece para dejar sitio al movimiento):
- `sentarse`: 9 fotogramas, 3/4 (*south-east*). Se sienta en el borde con las piernas colgando. ✅
- `sentada_idle`: 7 fotogramas, 3/4. Bucle sentada balanceando las piernas, con parpadeo. ✅
- `de_pie_idle`: 9 fotogramas, de frente, de la versión chibi anterior. Reproducir en ida y vuelta. Sirve de muestra, pero hay que regenerarlo con el personaje nuevo.

**Aprendido:**
- **Usar el circuito de personaje** (`create_character` v3 desde la base y `animate_character` v3 por dirección), no el de imagen suelta.
- **Movimientos en el sitio de frente:** funcionan.
- **Cambiar de pose de frente** (sentarse hacia la cámara): no funciona; se probó con edición por referencia, `animate_image` y `animate_character`.
- **La familia sentada va en 3/4 (*south-east*):** ahí sí funciona, sentarse y el bucle en reposo.
- **Para animar desde una pose ya generada:** `animate_character` con `custom_start_frame_url` (sube el fotograma con `get_upload_url`). Así se encadenan transición → bucle.
- **Coste real:** 2–3 generaciones por animación de 6–8 fotogramas.
- **Descargas:** el servidor de archivos de PixelLab rechaza el agente de usuario de Python. `scripts/fetch_pet_anim.py` ya lo tiene en cuenta.

**Ajuste del plan de animaciones:**
- **En 3/4 (*south-east*):** las familias sentada, piernas cruzadas, portátil y abrazando rodillas (`sentada_idle`, `meditar`, `dormir`, `escribir`, `triste`, `acariciada`, `pinchada`), generadas encadenando desde `sentarse` o su bucle.
- **De frente (*south*):** las de pie (habla, emociones, gestos, `saludar`, `peligro`).
- **La transición `levantarse`** es `sentarse` al revés, y al ponerse de pie gira de 3/4 a frente con un fotograma de rotación.

**⚠ Hay que rehacer la base:** la base actual y los clips `sentarse` y `sentada_idle` tienen **cuernos**, y Capri no debe llevarlos (decidido el 25/10/2026). Antes de generar más animaciones:
1. Regenerar la base desde `base_de_pie.png` editándola para quitar los cuernos (Pro Flash *edit*, unas 5 generaciones) o con el prompt nuevo.
2. Crear de nuevo el personaje de 8 direcciones a partir de ella.
3. Rehacer `sentarse` y `sentada_idle`.

**Para continuar** hace falta el plan de pago: quedan unas 30 animaciones, unas 90 generaciones más las repeticiones.
