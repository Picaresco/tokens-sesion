# tokens-sesion — mod de Claude Code

Una banda sobre el prompt que enseña **cuánto contexto llevas**, hace que la sesión
**se compacte sola donde tú marques** (también a mitad de una tarea larga) y **guarda
el resumen** de cada compactación.

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
/plugin install tokens-sesion --marketplace Picaresco/tokens-sesion
```

Responde `y` para añadir el marketplace y elige el ámbito (el de usuario lo deja
activo en todos tus proyectos). No hace falta reiniciar.

Desde la línea de comandos, lo mismo en dos pasos:

```
claude plugin marketplace add Picaresco/tokens-sesion
claude plugin install tokens-sesion@tokens-sesion
```

Probado con Claude Code 2.1.293.

## Qué enseña la banda

| Parte | Qué es |
|---|---|
| `Contexto: N tokens` | Lo que ocupa ahora la conversación: lo que se envía al modelo en cada petición. Verde hasta 500.000, lima hasta 650.000, amarillo hasta 800.000, naranja hasta 950.000 y rojo por encima |
| Barra | De 0 a 1.000.000 de tokens, con los mismos colores. `●` es el punto actual y `┃` el umbral en el que se compacta |
| `sesión: N` | Gasto acumulado de la sesión: entrada, salida y escritura de caché, subagentes incluidos. La caché leída no cuenta |
| `CPU n% · RAM n%` | Uso de todo el equipo: media de las 5 últimas lecturas, una cada 12 segundos. Verde hasta 60 %, amarillo hasta 85 %, rojo por encima. Solo en Windows |
| `Semana: n% usado` | Segunda línea: el límite semanal de tu plan (todos los modelos), con su barra bajo la de contexto y cuándo se renueva, en la hora de tu equipo. Mismos colores que CPU y RAM. Aparece con la primera respuesta de cada sesión y solo en planes de suscripción |

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

## Qué toca en tu equipo

- **Una variable de entorno del proceso**, `CLAUDE_CODE_AUTO_COMPACT_WINDOW`, solo
  mientras dura la sesión. No modifica `settings.json`.
- **Ficheros de resumen** en `.claude/resumenes/` del proyecto. Si no los quieres en
  tu repositorio, añade esa carpeta a `.gitignore`.
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
- Del plan solo se enseña el límite semanal de todos los modelos: el semanal por modelo no
  llega a los mods.
- CPU y RAM solo se muestran en Windows y en sesiones interactivas. En macOS y Linux
  el resto de la banda funciona igual.

## Desinstalar

```
claude plugin uninstall tokens-sesion@tokens-sesion
claude plugin marketplace remove tokens-sesion
```

## Desarrollo

Es un plugin de *function hooks*: `hooks/register.tsx` es el módulo, `hooks/barra.tsx`
la barra que recibe el ratón y `types/index.d.ts` el contrato de su estado.

```
claude plugin validate .
claude plugin test .
claude --plugin-dir .
```

## Licencia

MIT. Ver [LICENSE](LICENSE).
