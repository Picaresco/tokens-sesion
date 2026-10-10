# Plugin-Work — mod de Claude Code

Una banda sobre el prompt que enseña **cuánto contexto llevas**, hace que la sesión
**se compacte sola donde tú marques** (también a mitad de una tarea larga) y **guarda
el resumen** de cada compactación. Y un **panel lateral con los subagentes** de cada
tarea (inicio, fin y tokens) donde eliges **con qué modelo y esfuerzo** arranca cada tipo.

```
Contexto: 222.807 tokens ████████●░░░░░░░░░░░░░░░░░┃░░░░░░░░░░░░░ · sesión: 2.431.870 · CPU 23% · RAM 61%
Semana:   80% usado      ████████████████████████████████░░░░░░░░ · se renueva vie 9, 22:00
```

## El problema que resuelve

Con una ventana de un millón de tokens el contexto crece sin que se vea, y cada
petición lo vuelve a enviar entero. El compactado automático de Claude Code salta
casi al final de la ventana, cuando la sesión ya es cara y lenta, y el resumen que
deja no se guarda en ningún sitio.

Este mod pone la cifra delante, deja elegir el punto de compactado arrastrando una
marca y archiva cada resumen en el proyecto.

## Instalación

En el prompt de una sesión de Claude Code en el terminal:

```
/plugin install tokens-sesion --marketplace Picaresco/Plugin-Work
```

Responde `y` para añadir el marketplace y elige el ámbito (el de usuario lo deja
activo en todos tus proyectos). No hace falta reiniciar.

Desde la línea de comandos, lo mismo en dos pasos:

```
claude plugin marketplace add Picaresco/Plugin-Work
claude plugin install tokens-sesion@tokens-sesion
```

El plugin se llama `tokens-sesion` (el nombre con el que nació, cuando solo era la banda);
el repositorio, `Plugin-Work`. Probado con Claude Code 2.1.296.

## Qué enseña la banda

| Parte | Qué es |
|---|---|
| `Contexto: N tokens` | Lo que ocupa ahora la conversación: lo que se envía al modelo en cada petición. Verde hasta 500.000, lima hasta 650.000, amarillo hasta 800.000, naranja hasta 950.000 y rojo por encima |
| Barra | De 0 a 1.000.000 de tokens, con los mismos colores. `●` es el punto actual y `┃` el umbral en el que se compacta |
| `sesión: N` | Gasto acumulado de la sesión: entrada, salida y escritura de caché, subagentes incluidos. La caché leída no cuenta |
| `CPU n% · RAM n%` | Uso de todo el equipo: media de las 5 últimas lecturas, una cada 12 segundos. Verde hasta 60 %, amarillo hasta 85 %, rojo por encima. Solo en Windows |
| `Semana: n% usado` | Segunda línea: el límite semanal de tu plan, con su barra bajo la de contexto y cuándo se renueva, en la hora de tu equipo. Mismos colores que CPU y RAM. Si el modelo que estás usando tiene un límite semanal propio (como Fable), enseña ese, con su nombre: `Semana Fable: n% usado`; con los demás modelos, el de todos. Solo en planes de suscripción |

En terminales estrechos las barras se encogen.

## Compactado automático

Al llegar el contexto al umbral, el motor de Claude Code compacta la conversación y
**sigue con lo que estaba haciendo**: no espera a que termine el turno, así que
también actúa en tareas largas y con subagentes. El mod:

- le indica al motor dónde compactar (el umbral que hayas elegido),
- añade a cada compactación la instrucción de conservar peticiones, decisiones,
  ficheros tocados, errores resueltos y tareas pendientes,
- guarda el resumen en `<proyecto>/.claude/resumenes/resumen-<fecha UTC>.md`, también
  el de las compactaciones manuales (`/compact`), y avisa con la ruta.

### Cambiar el umbral

- **Con el ratón**: arrastra la marca `┃` de la barra. Mientras la mueves enseña la
  cifra; al soltarla queda guardada y se aplica al momento.
- **Con un comando**: `/tokens-compact 850000`. Sin argumentos muestra el umbral
  actual y `/tokens-compact 0` lo desactiva: el motor vuelve a compactar donde lo hace por su cuenta.

El umbral va de 200.000 a 950.000 tokens (650.000 al instalar) y se guarda para
todas tus sesiones y proyectos.

## Panel de agentes

Un panel lateral con dos pestañas, que se eligen con los botones de arriba (o con las
teclas `1` y `2` cuando el panel tiene el teclado):

```
[ Agentes ]  [ Enrutadores ]
────────────────────────────────────────────────
Tarea 3 · 12:30:58 · 2 agentes · 21.520 tok
busca los hooks del mod y revisa los tests
✓ 12:31:05 → 12:32:47    1m42s    18.420 tok
  Explore · buscar hooks · haiku-5-5 · low
● 12:31:06 → en curso              3.100 tok
  revisor (general-purpose) · revisar tests · opus-5-5
```

**Agentes** es el registro de los subagentes de la sesión, agrupados por tarea (cada
prompt tuyo que lanza alguno), la más reciente arriba: hora de inicio, hora de fin,
duración y tokens, que suben en vivo, con el total de la tarea. `●` en curso, `✓`
terminado, `✗` abortado o con error. Los tokens se cuentan igual que `sesión:` en la banda.

**Enrutadores** es una tabla con una fila por tipo de agente (los de Claude Code, los
de tus plugins y los tuyos) y otra para «Los demás». En cada fila eliges el **modelo**
(heredar, haiku, sonnet, opus, fable) y el **esfuerzo** (heredar, low, medium, high,
xhigh, max) con el que arrancan los agentes de ese tipo. `[ Recomendados ]` pone una
tabla de partida y `[ Todo heredar ]` lo deja como si no hubiera enrutado. Se aplica al
momento y se guarda para todas tus sesiones y proyectos.

- El modelo es un alias: lo resuelve Claude Code a su versión actual.
- La tabla manda sobre el modelo que pida la llamada. Para una excepción, pon esa fila
  en «heredar».
- Un fork y los agentes de un workflow heredan siempre: Claude Code no deja cambiarlos.
- El esfuerzo solo se cambia en los modelos que lo admiten.

El panel se abre solo con el primer agente de la sesión si el terminal es ancho (desde
144 columnas). Con `/agentes` se abre a cualquier ancho, `/agentes rutas` lo abre en
Enrutadores, `/agentes cerrar` lo cierra y `/agentes limpiar` vacía el registro. Si lo
cierras, no vuelve a abrirse solo hasta que lo pidas. El registro dura lo que la sesión.

## Qué toca en tu equipo

- **Una variable de entorno del proceso**, `CLAUDE_CODE_AUTO_COMPACT_WINDOW`, solo
  mientras dura la sesión. No modifica `settings.json`.
- **Ficheros de resumen** en `.claude/resumenes/` del proyecto. Si no los quieres en
  tu repositorio, añade esa carpeta a `.gitignore`.
- **Una consulta a Claude Code** (`claude -p /usage --safe-mode --no-session-persistence`) al
  arrancar la sesión y, como mucho, cada 5 minutos: de ahí sale el límite semanal propio de cada
  modelo. Tarda unos 3 segundos, no llama al modelo, no carga tus plugins ni servidores MCP y no
  guarda sesión. Si tu plan no tiene límites por modelo, se hace una sola vez.
- **El modelo y el esfuerzo de los subagentes**, solo de los tipos a los que se lo pongas en
  la pestaña Enrutadores. Con todo en «heredar» (así viene) no cambia nada.
- **Un `powershell.exe` oculto por sesión** (unos 85 MB) que lee el uso de CPU y RAM
  por WMI. Se cierra con la sesión. No sale nada del equipo: no hay red ni telemetría.

## Límites

- Los textos están en español.
- La barra está pensada para ventanas de un millón de tokens. Con un modelo de
  200.000 el motor compacta como muy tarde en 167.000 y la marca se queda ahí.
- Si tienes `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE`, el motor compacta antes: el mod lo
  compensa y la marca no pasa del tope que resulte.
- Por debajo de 200.000 no se puede bajar: con el umbral cerca de lo que ocupa una
  sesión recién compactada, el motor entra en bucle y aborta el turno.
- El punto exacto de compactado sale de las reservas que usa el motor en la versión
  2.1.293. Si una versión posterior las cambia, la marca puede desviarse unos miles
  de tokens.
- El límite de todos los modelos llega con la primera respuesta de cada sesión; el propio de un
  modelo se lee del texto de `/usage` y puede ir hasta 5 minutos por detrás. Si una versión de
  Claude Code cambia ese texto, la línea vuelve a enseñar el de todos los modelos.
- CPU y RAM solo se muestran en Windows y en sesiones interactivas. En macOS y Linux
  el resto de la banda funciona igual.

## Desinstalar

```
claude plugin uninstall tokens-sesion@tokens-sesion
claude plugin marketplace remove tokens-sesion
```

## Desarrollo

Es un plugin de *function hooks*: `hooks/register.tsx` es el módulo (la banda y el panel
de agentes: Claude Code carga un solo módulo por plugin), `hooks/barra.tsx`
la barra que recibe el ratón y `types/index.d.ts` el contrato de su estado.

```
claude plugin validate .
claude plugin test .
claude --plugin-dir .
```

## Licencia

MIT. Ver [LICENSE](LICENSE).
