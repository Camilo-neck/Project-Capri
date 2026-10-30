# Comandos y atajos

Generado desde `backend/app/commands.json` (`/ayuda` en su barra muestra lo mismo). Se escriben en cualquier
mayúscula, con o sin tilde, en español o inglés.

## Capri

- `/escondete [on|off]` (alias: `/hide`): Se esconde (on) o vuelve (off). Sin nada: lo contrario de lo que esté.
  - por voz → `/escondete on`: «escóndete», «ocúltate», «desaparece», «hide», «hide yourself», «go away»
- `/vuelve` (alias: `/show`, `/back`): Vuelve si estaba escondida (lo mismo que /escondete off).
  - por voz → `/vuelve`: «vuelve», «sal», «aparece», «ven», «come back», «come out», «show yourself», «show up»
- `/cierra` (alias: `/quit`): Cierra Capri y apaga Ollama (vuelve a arrancar al abrirla).
  - por voz → `/cierra`: «ciérrate», «cierra capri», «apágate», «close capri», «close yourself», «quit capri», «shut down capri», «goodbye capri»

## Pantalla

- `/mira [pregunta]` (alias: `/look`): Captura la pantalla en la que estás y te dice qué ve (o responde tu pregunta sobre ella).
  - por voz → `/mira`: «mira la pantalla», «mira mi pantalla», «mira esto», «qué ves», «qué hay en pantalla», «look at the screen», «look at my screen», «what do you see», «what's on my screen», «whats on my screen»

## Memoria

- `/olvida <algo>|todo` (alias: `/forget`): Olvida lo que recuerda de algo, o todo (todo, everything o all). Te pregunta antes.
  - por voz → `/olvida todo`: «olvida todo», «olvídalo todo», «forget everything», «forget it all», «forget all»
- `/recordatorios` (alias: `/reminders`): Los recordatorios pendientes, con un botón para cancelar cada uno.
  - por voz → `/recordatorios`: «qué recordatorios tengo», «mis recordatorios», «mis alarmas», «what are my reminders», «my reminders»

## Modos

- `/nomolestes [on|off]` (alias: `/dnd`): No molestar: no habla por su cuenta (on) o vuelve a hacerlo (off). Sin nada: lo contrario de lo que esté.
  - por voz → `/nomolestes on`: «no molestes», «no me molestes», «no molestar», «modo no molestar», «do not disturb», «don't disturb me», «dont disturb me», «dnd»
  - por voz → `/nomolestes off`: «ya puedes molestarme», «puedes molestarme», «quita el no molestar», «quita no molestar», «you can disturb me», «disturb me again», «dnd off»
- `/claude <pregunta>|on|off`: Modo Claude: on u off le enseña o no lo que hace Claude Code; con una pregunta, se la hace a la sesión abierta (solo lectura, tras tu clic).
  - por voz → `/claude on`: «modo claude on», «activa el modo claude», «claude mode on», «turn on claude mode»
  - por voz → `/claude off`: «modo claude off», «desactiva el modo claude», «claude mode off», «turn off claude mode»

## Ayuda

- `/ayuda [grupo]` (alias: `/help`): Esta lista. Con un grupo (capri, pantalla, memoria, modos, voz) solo ese.
  - por voz → `/ayuda`: «qué comandos hay», «qué comandos tienes», «comandos», «what commands are there», «what are your commands», «commands»

## Atajos globales (`[atajos]` en `config.toml`)

Una regla: `Ctrl+Alt` para hablarle, `Ctrl+Alt+Shift` para lo demás.

| Atajo | Qué hace |
|---|---|
| `Ctrl+Alt+Space` | escribirle |
| `Ctrl+Alt+V` | escuchar: la siguiente frase es para ella (si habla, la corta) |
| `Ctrl+Alt+Shift+M` | mirar la pantalla |
| `Ctrl+Alt+Shift+D` | no molestar |
| `Ctrl+Alt+Shift+A` | apariencia: original, pixel, cámara |
| `Ctrl+Alt+Shift+T` | traerla (o despertarla, o que vuelva) |

## Rutinas

`[rutinas.<nombre>]` en `config.toml`: una frase suya que abre programas y pone música. «Modo chamba» viene hecha.
