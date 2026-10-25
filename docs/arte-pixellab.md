# Capri · encargo de arte y animación (PixelLab)

Especificación para generar el arte definitivo de la mascota. Está ajustada a **PixelLab** (límites, tamaños y forma de pedir las animaciones). Al final hay un brief resumido por si prefieres encargarlo a un artista.

Las imágenes de referencia ya están preparadas en `assets/inspo/pixellab/`, con fondo transparente y a la escala nativa de tu hoja:

| Archivo | Uso |
|---|---|
| `ref_de_pie.png` | Referencia principal del personaje (de pie, de frente) |
| `ref_sentada.png` | Referencia de la pose sentada en el borde |
| `ref_sentada_cruzada.png` | Referencia de las piernas cruzadas |

Los archivos `@3x` son copias ampliadas para verlas cómodamente; **no los subas**.

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
2. En una terminal ejecuta, sustituyendo el token:
   ```
   claude mcp add pixellab https://api.pixellab.ai/mcp -t http -H "Authorization: Bearer TU_TOKEN"
   ```
3. Reinicia Claude Code y dime "genera el arte según docs/arte-pixellab.md". Yo genero, reviso fotograma a fotograma, repito lo que salga mal y lo integro.

**B. Lo haces tú en PixelLab (web o Aseprite)** siguiendo los pasos 2 a 4 tal cual, con los prompts copiados de aquí, y me pasas los PNG con la estructura de la sección 6.

---

## 2. Especificación técnica (todas las piezas)

| Parámetro | Valor | Motivo |
|---|---|---|
| Lienzo | **96 × 96 px** por fotograma | Tu hoja mide unos 70 px de alto nativo; 96 deja aire para saltos y brazos. 96×96×16 entra en el límite de PixelLab (524.288 px) |
| Tamaño del personaje | De pie: 68–72 px de alto con el pelo; sentada: 58–64 px | Igual densidad de píxel que tu hoja |
| Vista | *Side view* (cámara frontal), dirección **south** (mirando a la cámara) | Mascota de frente al usuario |
| Línea de suelo | Pies en **y = 92** (4 px de margen). Sentada en el borde: asiento en y ≈ 78 y piernas colgando hasta y ≈ 95 | Yo alineo después, pero cuanto más fiel, mejor |
| Fondo | **Transparente** (*Remove background* activado) | |
| Contorno | Negro de 1 px, sin antialiasing, sombreado plano con un solo tono oscuro | Estilo de tu hoja |
| En pantalla | ×3 sin suavizado (288 px) | |
| Paleta objetivo | `#050402` contorno · `#a92855` pelo y traje · `#88324d` sombra pelo · `#5a1e31` sombra profunda · `#290911` casi negro rojizo · `#6fc47a` piel · `#3f8f53` sombra piel · `#ffffff` blanco (ojos, dientes) · `#2f7dff` iris | Muestreada de tu hoja, salvo `#3f8f53` (sombra de piel derivada del verde), el blanco y el iris. En PixelLab: *Color → Target palette* |
| Fotogramas | Pares, de 4 a 16 (regla de PixelLab) | |
| Fotograma 1 | En todas las animaciones, **boca cerrada y pose neutra de su familia** | Así puedo encadenar animaciones y sincronizar el habla |

**No generes:** textos, "zZz", corazones flotantes, "?", "!", destellos ni lágrimas. Los pongo yo por código encima, a la misma escala de píxel, para poder combinarlos con cualquier pose. **Sí** forman parte del sprite el portátil y lo que la toque o sostenga.

---

## 3. Paso 1: personaje base

**Herramienta:** *Create character* (o *Create character Pro* para más calidad), 96×96, *side view*, *south*, con `ref_de_pie.png` como referencia o imagen inicial.

**Prompt:**
```
Chibi pixel art girl, desktop pet mascot, front view facing the camera, standing, full body.
Huge voluminous messy hair in deep magenta-crimson with flame-like curls, two curled horn-like
tufts on top, hair reaching the shoulders. Green skin. A black jagged mask-like fringe across the
upper face with one spike pointing down between the eyes. Big round eyes with blue iris and a white
highlight. Wide white grin with small teeth. Slim body in an asymmetric crimson and black leotard
with diagonal black panels; bare green shoulders and one green thigh; long black gloves; one black
boot leg and one crimson leg with pointed feet. 1px black outline, flat shading with one darker
tone, no anti-aliasing, transparent background. Playful, mischievous personality.
```

**Criterio para aceptarlo:** que se parezca a `ref_de_pie.png` en pelo, cara y colores. Genera varias semillas y quédate con la mejor; **todo lo demás parte de esta imagen**, así que vale la pena invertir aquí.

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
| `feliz` | feliz | 8 | 10 | `happy little hops in place, eyes closed in joy, big grin, arms swinging` |
| `enamorada` | feliz (variante) | 8 | 8 | `hands on her cheeks, heart-shaped eyes, blushing, swaying side to side happily` |
| `emocionada` | emocionada | 8 | 12 | `jumping up and down with both arms raised, star-shaped sparkling eyes, open mouth` |
| `traviesa` | traviesa | 8 | 10 | `giggling behind her hand, winking one eye, shoulders shaking with laughter, other hand on hip` |
| `curiosa` | curiosa | 8 | 8 | `leaning forward curiously, head tilting side to side, finger on chin, wide eyes` |
| `pensativa` | pensativa | 8 | 6 | `thinking with hand on chin, eyes looking up, slow sway` |
| `sorprendida` | sorprendida | 8 | 12 | `startled: jumps back a little with hands up, eyes wide open, mouth open in an O, slight trembling` |
| `molesta` | molesta | 8 | 10 | `annoyed with arms crossed, tapping one foot, frowning angry eyes, gritted teeth, head turned slightly away` |
| `triste` | triste | 8 | 6 | `sad, hugging her knees, head down, droopy eyes, small sniffle movement` (base: base_rodillas) |
| `seria` | seria | 4 | 4 | `serious, hands behind her back, steady gaze, small slow nod` |

### 5.4 Interacción con el ratón

| Id | Base | Fot. | fps | Tipo | Prompt |
|---|---|---|---|---|---|
| `pinchada` | base_sentada | 8 | 12 | una vez | `poked: squashes down, wobbles, dizzy spiral eyes, wavy mouth, then recovers` |
| `acariciada` | base_sentada | 8 | 8 | bucle | `being petted on the head: leans her head into the touch, eyes closed happily, blushing, content smile` |
| `saludar` | base_de_pie | 8 | 10 | bucle ×2 | `waving hello with one hand raised high, cheerful grin` |

### 5.5 Gestos cortos (de pie)

| Id | Fot. | fps | Tipo | Prompt |
|---|---|---|---|---|
| `asentir` | 6 | 12 | una vez | `nodding twice` |
| `ladear` | 6 | 10 | una vez | `tilting her head to one side and back` |
| `guino` | 4 | 10 | una vez | `winking one eye with a smile` |
| `saltar` | 8 | 12 | una vez | `a small happy jump: crouch, jump up, land` |
| `senalar` | 6 | 10 | una vez | `pointing to the side with her right arm, then lowering it` |
| `cruzar_brazos` | 6 | 10 | una vez | `crossing her arms over her chest` |

### 5.6 Transiciones entre familias (evitan saltos)

| Id | De → a | Fot. | fps | Prompt |
|---|---|---|---|---|
| `levantarse` (⇄ sentarse) | base_sentada → base_de_pie | 8 | 12 | `standing up from sitting on the ledge to standing upright` |
| `cruzar_piernas` (⇄) | base_sentada → base_cruzada | 6 | 10 | `pulling her legs up and crossing them` |
| `abrazar_rodillas` (⇄) | base_cruzada → base_rodillas | 6 | 8 | `pulling her knees up to her chest and hugging them` |
| `abrir_portatil` (⇄ cerrarlo) | base_sentada → base_portatil | 6 | 10 | `taking out a small laptop and opening it on her lap` |

**Total:** 5 poses base y unas 36 animaciones.

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
- [ ] Contorno de 1 px y solo colores de la paleta.
- [ ] Los bucles cierran: el último fotograma enlaza con el primero sin saltos.

## 8. Coste estimado

Con *Animate with text* a 96×96, 8 fotogramas cuestan 2 generaciones y 4–6 fotogramas, 1. Las ~36 animaciones son unas 60 generaciones. Sumando poses base y repeticiones (calcula ×3), salen **unas 200–250 generaciones**: caben de sobra en un mes del plan de entrada.

## 9. Si lo encargas a un artista

> Pixel art desktop pet, 96×96 px canvas per frame, character ~70 px tall, front view, transparent background, 1 px black outline, palette below. Style and character: see attached reference sheet (`pet_reference.png`) and crops. Deliver one Aseprite file with one tag per animation (names and frame counts in the attached table) plus PNG strips. Frame 1 of every animation = base pose with closed mouth; loops must close cleanly. No text or floating effects (hearts, zZz, ?, !): those are added in code.

Adjunta las secciones 2, 4 y 5 de este documento y la hoja de referencia.

## 10. Cómo lo integro yo

- **Reproductor:** carga las tiras o las carpetas, alinea la línea de suelo, unifica la paleta y limpia los bordes (como hice con tu hoja).
- **Máquina de estados:** la que ya existe (`avatar/src/pet/behaviors.ts`), con las mismas prioridades. En vez de poses calculadas reproduce animaciones y, al cambiar de familia, pasa por la transición correspondiente (por ejemplo, sentada → `levantarse` → `feliz`). Nunca hay un corte seco.
- **Habla:** durante el texto avanza los fotogramas de la animación de su emoción y al terminar vuelve al fotograma 1 (boca cerrada).
- **Ratón:** igual que ahora. La caja de clic sale de los píxeles del fotograma actual; clic = `pinchada`, frotar la cabeza = `acariciada`.
- **Efectos (zZz, corazones, ?, !, destellos, lágrimas):** por código encima del sprite, a la misma escala.
- **Lo que se pierde frente a la versión por código:** los ojos ya no siguen al ratón, porque van dibujados en el sprite. Se puede recuperar con un sello de iris encima si se pide en un paso aparte.
- **Mientras llega el arte:** sigue funcionando la mascota generada por código, y cada animación que llegue sustituye a la suya.
