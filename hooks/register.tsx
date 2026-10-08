import { atom, read, update } from 'claude-code'
import type { EngineInterface, ModelUsage, Register, SessionRateLimit } from 'claude-code'

// Cada tramo se pinta con su color hasta `hasta` tokens de contexto, incluido; por encima del último, ROJO.
const TRAMOS = [
  { hasta: 500_000, color: '#22c55e' },
  { hasta: 650_000, color: '#a3e635' },
  { hasta: 800_000, color: '#facc15' },
  { hasta: 950_000, color: '#fb923c' },
] as const
const ROJO = '#ef4444'

// La barra va de 0 a ESCALA tokens de contexto, con una marca donde se compacta.
const ESCALA = 1_000_000
const BARRA_MAX = 40
const BARRA_MIN = 10
// Columnas que ocupan los dos textos que acompañan a la barra.
const RESERVA = 44
const MARCA = '#38bdf8'

// El umbral se cambia arrastrando la marca de la barra (o con el comando) y se guarda en el
// almacén del mod, el mismo para todas las sesiones y proyectos del usuario; 0 lo desactiva.
// Por debajo de UMBRAL_MIN el contexto vuelve a llenarse nada más compactar y el motor aborta el turno.
const COMANDO = 'tokens-compact'
const UMBRAL = 650_000
const UMBRAL_MIN = 200_000
const UMBRAL_MAX = 950_000

// Quien compacta es el motor: lo hace solo, también a mitad de un turno, cuando el contexto llega
// a su ventana de compactado menos lo que reserva, o al porcentaje de CLAUDE_AUTOCOMPACT_PCT_OVERRIDE
// si queda por debajo. El mod pone la ventana que deja ese punto en el umbral del usuario.
const VENTANA_MIN = 100_000
const VENTANA_MAX = 1_000_000
const RESERVA_SALIDA = 20_000
const RESERVA_RESUMEN = 13_000

// Uso de CPU y RAM del equipo: una lectura cada LECTURA_S segundos, y en la banda la media de las
// MEDIA últimas, cada cifra con su color hasta `hasta` por ciento, incluido; por encima, ROJO.
const LECTURA_S = 12
const MEDIA = 5
const USOS = [
  { hasta: 60, color: '#22c55e' },
  { hasta: 85, color: '#facc15' },
] as const
// Columnas que ocupan las dos cifras cuando se muestran.
const RESERVA_USO = 22
// Un solo proceso para toda la sesión, sin comillas dobles para que cruce entero como argumento.
// Cada lectura es una línea con las décimas de % de CPU del intervalo (la «utilidad» del
// Administrador de tareas; donde no existe, el tiempo de procesador) y de memoria física en uso.
// Vigila a quien lo lanzó para no quedarse huérfano, y lo deja tras FALLOS lecturas fallidas seguidas.
const FALLOS = 5
const LECTOR = [
  "$ErrorActionPreference = 'Stop';",
  "$padre = [System.Diagnostics.Process]::GetProcessById((Get-CimInstance Win32_Process -Filter ('ProcessId=' + $PID)).ParentProcessId);",
  '$a = $null;',
  '$f = 0;',
  `while (-not $padre.HasExited -and $f -lt ${FALLOS}) {`,
  // La primera lectura llega enseguida; las demás, a su ritmo.
  '$s = 1;',
  'try {',
  "$b = Get-CimInstance Win32_PerfRawData_Counters_ProcessorInformation -Filter 'Name=''_Total''';",
  'if ($a) {',
  '$o = Get-CimInstance Win32_OperatingSystem;',
  '$base = $b.PercentProcessorUtility_Base - $a.PercentProcessorUtility_Base;',
  '$dt = $b.Timestamp_Sys100NS - $a.Timestamp_Sys100NS;',
  '$cpu = if ($base -gt 0) { ($b.PercentProcessorUtility - $a.PercentProcessorUtility) / $base }',
  'elseif ($dt -gt 0) { (1 - ($b.PercentProcessorTime - $a.PercentProcessorTime) / $dt) * 100 } else { 0 };',
  '$c = [int][math]::Round([math]::Max(0, [math]::Min(100, $cpu)) * 10);',
  '$r = [int][math]::Round((1 - $o.FreePhysicalMemory / $o.TotalVisibleMemorySize) * 1000);',
  "[Console]::Out.WriteLine([string]$c + ' ' + [string]$r);",
  `$s = ${LECTURA_S}`,
  '};',
  '$a = $b;',
  '$f = 0',
  `} catch { $f++; $s = ${LECTURA_S} };`,
  'Start-Sleep -Seconds $s',
  '}',
].join(' ')

// El límite semanal del plan (todos los modelos) va en una segunda línea, con su barra bajo la de
// contexto. RESERVA_SEMANA: las columnas de su etiqueta y de cuándo se renueva.
const LIMITE_SEMANAL = 'seven_day'
const RESERVA_SEMANA = 54
const DIAS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'] as const
// El límite semanal propio de un modelo (el de Fable, donde el plan lo tiene) no llega a los mods:
// se le pregunta a Claude Code con su `/usage`, en un proceso aparte que no carga nada del usuario
// ni guarda la sesión, y que no llama al modelo. Si algún día lo hiciera, que sea al más barato.
const CONSULTA = [
  'claude',
  '-p',
  '/usage',
  '--safe-mode',
  '--no-session-persistence',
  '--model',
  'haiku',
] as const
const CONSULTA_MS = 30_000
// Con cada respuesta del hilo principal, si la última consulta tiene ya este tiempo, se repite.
const REFRESCO_MS = 5 * 60_000
const DIA_MS = 24 * 60 * 60_000
// Las renovaciones de `/usage` se llevan al múltiplo de 5 minutos más cercano.
const REDONDEO_MS = 5 * 60_000
// «Current week (Fable): 12% used · resets Oct 9, 10pm (Europe/Madrid)»
const LINEA_USO = /^Current week \((.+?)\): (\d+(?:\.\d+)?)% used(?: · resets ([^(\n]+?))?(?: \(.*\))?\s*$/gm
const TODOS = 'all models'
const MESES = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

const CARPETA = '.claude/resumenes'
const INSTRUCCIONES =
  'Resumen exhaustivo para continuar la sesión sin perder nada. Conserva todos los puntos: ' +
  'el objetivo y cada petición del usuario, las decisiones tomadas y su porqué, los ficheros ' +
  'creados o modificados con sus rutas, los comandos y resultados relevantes, los errores y ' +
  'cómo se resolvieron, las tareas pendientes y el paso exacto por el que se iba.'

const gastados = atom({ plugin: 'tokens-sesion', key: 'gastados' } as const, 0)
const contexto = atom({ plugin: 'tokens-sesion', key: 'contexto' } as const, null)
const resumen = atom({ plugin: 'tokens-sesion', key: 'resumen' } as const, null)
// El umbral que quiere el usuario, y el que rige en esta sesión con su modelo y su entorno.
const umbral = atom({ plugin: 'tokens-sesion', key: 'umbral' } as const, UMBRAL)
const efectivo = atom({ plugin: 'tokens-sesion', key: 'efectivo' } as const, UMBRAL)
const maximo = atom({ plugin: 'tokens-sesion', key: 'maximo' } as const, UMBRAL_MAX)
// La superficie no pudo con la barra que recibe el ratón: se dibuja la fija.
const sinRaton = atom({ plugin: 'tokens-sesion', key: 'sinRaton' } as const, false)
// La media de CPU y RAM en %, o null mientras no hay lecturas (otro sistema, sin lector).
const uso = atom({ plugin: 'tokens-sesion', key: 'uso' } as const, null)

// El límite semanal: % usado y cuándo se renueva; null hasta que el motor lo da con una respuesta.
const semana = atom({ plugin: 'tokens-sesion', key: 'semana' } as const, null)

// Los límites semanales propios de un modelo, por el nombre que les da `/usage` («Fable»).
const porModelo = atom({ plugin: 'tokens-sesion', key: 'porModelo' } as const, [])

// Las últimas lecturas del lector, en décimas de %, y si hay uno en marcha.
let lecturas: { cpu: number; ram: number }[] = []
let leyendo = false
// La consulta de los límites por modelo: si hay quien mire la banda, cuándo fue la última, si hay
// una en marcha y si ya no merece repetirla en esta sesión (falló, o el plan no tiene ninguno).
let interactiva = false
let consultado = 0
let consultando = false
let sinConsulta = false

// La caché leída no cuenta: es el mismo contexto releído en cada petición.
const gasto = (usage: ModelUsage): number =>
  usage.input_tokens + usage.output_tokens + usage.cache_creation_input_tokens

// Lo que la petición envió al modelo: la misma medida que da `$.session.usage()`.
const enviado = (usage: ModelUsage): number =>
  usage.input_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens

const colorDe = (tokens: number): string =>
  TRAMOS.find(tramo => tokens <= tramo.hasta)?.color ?? ROJO

const conPuntos = (tokens: number): string =>
  String(tokens).replace(/\B(?=(\d{3})+(?!\d))/g, '.')

const colorUso = (pct: number): string => USOS.find(tramo => pct <= tramo.hasta)?.color ?? ROJO

// La media, en % entero, de unas lecturas en décimas.
const media = (decimas: number[]): number =>
  Math.round(decimas.reduce((sum, value) => sum + value, 0) / decimas.length / 10)

// «vie 9, 22:00», en la hora del equipo.
const cuando = (iso: string): string | null => {
  const date = new Date(iso)

  if (Number.isNaN(date.getTime())) {
    return null
  }

  const hora = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`

  return `${DIAS[date.getDay()] ?? ''} ${date.getDate()}, ${hora}`
}

const vale = (value: unknown): value is number =>
  value === 0 ||
  (typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= UMBRAL_MIN &&
    value <= UMBRAL_MAX)

// `rige` es el umbral de esta sesión; queda por debajo del pedido cuando el modelo o el entorno no dan más.
const estado = (limite: number, rige: number): string =>
  limite === 0
    ? `Compactado automático desactivado. Actívalo con /${COMANDO} ${UMBRAL}.`
    : `Compactado automático al llegar el contexto a ${conPuntos(rige)} tokens` +
      (rige < limite ? ` (el tope de esta sesión; pedidos ${conPuntos(limite)})` : '') +
      ', también a mitad de una tarea. Cámbialo arrastrando la marca ┃ de la barra.'

// El porcentaje de CLAUDE_AUTOCOMPACT_PCT_OVERRIDE, si el motor lo va a tener en cuenta.
const porcentaje = (text: string | undefined): number | null => {
  const value = text === undefined ? NaN : parseFloat(text)

  return value > 0 && value <= 100 ? value : null
}

// Los tokens de contexto con los que el motor compacta para una ventana: su misma cuenta.
const umbralDe = (ventana: number, pct: number | null): number => {
  const util = ventana - RESERVA_SALIDA
  const base = util - RESERVA_RESUMEN

  return pct === null ? base : Math.min(Math.floor((util * pct) / 100), base)
}

// La ventana más pequeña con la que el motor compacta en `limite` o más.
const ventanaDe = (limite: number, pct: number | null): number => {
  const base = limite + RESERVA_SALIDA + RESERVA_RESUMEN
  const porPct = pct === null ? 0 : Math.ceil((limite * 100) / pct) + RESERVA_SALIDA

  return Math.min(VENTANA_MAX, Math.max(VENTANA_MIN, base, porPct))
}

// La celda de la barra en la que cae una cantidad de tokens.
const celdaDe = (tokens: number, ancho: number): number =>
  Math.min(ancho - 1, Math.floor((tokens * ancho) / ESCALA))

// El umbral que deja la marca en una celda: su borde izquierdo, redondeado al millar de arriba.
const valorDe = (celda: number, ancho: number): number =>
  Math.ceil((celda * ESCALA) / ancho / 1_000) * 1_000

// La barra celda a celda, sin la marca: lo recorrido lleno, el resto tenue y el punto actual.
const celdas = (tokens: number, ancho: number): { text: string; color: string }[] => {
  const actual = celdaDe(tokens, ancho)

  return Array.from({ length: ancho }, (_, i) => ({
    text: i === actual ? '●' : i < actual ? '█' : '░',
    color: i === actual ? 'text' : colorDe(((i + 1) * ESCALA) / ancho),
  }))
}

const guardar = async ($: EngineInterface, text: string): Promise<string> => {
  const stamp = new Date(await $.clock.now())
    .toISOString()
    .slice(0, 19)
    .replace(/[T:]/g, '-')
  const file = `${CARPETA}/resumen-${stamp}.md`
  await $.fs.write(file, text)
  await update($, resumen, () => file)

  return file
}

// Lleva el umbral al motor: la ventana de compactado de este proceso, sin tocar los ajustes del usuario.
const aplicar = async ($: EngineInterface): Promise<void> => {
  const limite = await read($, umbral)
  const pct = porcentaje(await $.env.get('CLAUDE_AUTOCOMPACT_PCT_OVERRIDE'))
  // El motor nunca compacta más tarde de lo que da la ventana del modelo.
  const modelo = Math.min(VENTANA_MAX, (await $.session.usage()).context.window)
  const tope = Math.max(UMBRAL_MIN, Math.min(UMBRAL_MAX, umbralDe(modelo, pct)))
  await update($, maximo, () => tope)

  if (limite === 0) {
    await $.env.set('CLAUDE_CODE_AUTO_COMPACT_WINDOW', undefined)
    await update($, efectivo, () => 0)

    return
  }

  const ventana = ventanaDe(limite, pct)
  await $.env.set('CLAUDE_CODE_AUTO_COMPACT_WINDOW', String(ventana))
  await update($, efectivo, () => Math.min(limite, umbralDe(Math.min(ventana, modelo), pct)))
}

// El umbral guardado manda sobre el de la sesión: otra sesión pudo cambiarlo.
const cargar = async ($: EngineInterface): Promise<void> => {
  const saved = await $.store.get('umbral')
  const limite = vale(saved) ? saved : UMBRAL
  await update($, umbral, () => limite)
  await aplicar($)
}

const fijar = async ($: EngineInterface, limite: number): Promise<void> => {
  await $.store.set('umbral', limite)
  await update($, umbral, () => limite)
  await aplicar($)
}

// De los límites que da el motor, el semanal; sin él (otro plan, o aún sin respuestas), nada.
const limitar = async ($: EngineInterface, limits: readonly SessionRateLimit[]): Promise<void> => {
  const found = limits.find(limit => limit.kind === LIMITE_SEMANAL)
  const value = found ? { pct: found.percentUsed, renueva: found.resetsAt ?? null } : null
  await update($, semana, () => value)
}

// El instante de un «Oct 9, 10pm» o un «4:59am» de `/usage`, que vienen en la hora del equipo.
const instante = (text: string, now: number): string | null => {
  const found = /^(?:([A-Za-z]{3})[a-z]* (\d{1,2}), )?(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i.exec(text.trim())

  if (!found) {
    return null
  }

  const hoy = new Date(now)
  const mes = found[1] === undefined ? hoy.getMonth() : MESES.indexOf(found[1].toLowerCase())

  if (mes < 0) {
    return null
  }

  const dia = found[2] === undefined ? hoy.getDate() : Number(found[2])
  const horas = (Number(found[3]) % 12) + (found[5]?.toLowerCase() === 'pm' ? 12 : 0)
  const date = new Date(hoy.getFullYear(), mes, dia, horas, Number(found[4] ?? 0))

  // Una renovación nunca queda atrás: sin fecha es la de mañana; con ella, la del año que viene.
  if (found[1] === undefined && date.getTime() < now) {
    date.setDate(date.getDate() + 1)
  } else if (date.getTime() < now - DIA_MS) {
    date.setFullYear(date.getFullYear() + 1)
  }

  // `/usage` da unas veces «10pm» y otras «9:59pm» para la misma renovación.
  return new Date(Math.round(date.getTime() / REDONDEO_MS) * REDONDEO_MS).toISOString()
}

// Los límites semanales por modelo que hay en la salida de `/usage`; null si no es lo esperado.
const porModeloDe = (
  text: string,
  now: number,
): { nombre: string; pct: number; renueva: string | null }[] | null => {
  const found = [...text.matchAll(LINEA_USO)]

  if (found.length === 0) {
    return null
  }

  return found
    .filter(line => line[1]?.toLowerCase() !== TODOS)
    .map(line => ({
      nombre: line[1] ?? '',
      pct: Number(line[2]),
      renueva: line[3] === undefined ? null : instante(line[3], now),
    }))
}

// Pone al día los límites por modelo. Lo que falla una vez no se reintenta en la sesión, y donde
// el plan no tiene ninguno tampoco se vuelve a preguntar.
const consultar = async ($: EngineInterface): Promise<void> => {
  if (!interactiva || sinConsulta || consultando) {
    return
  }

  const now = await $.clock.now()

  if (consultado !== 0 && now - consultado < REFRESCO_MS) {
    return
  }

  consultando = true
  consultado = now

  try {
    const done = await $.process.run([...CONSULTA], { stdin: '', timeoutMs: CONSULTA_MS })
    const limits = done.exitCode === 0 ? porModeloDe(done.stdout, now) : null
    sinConsulta = limits === null || limits.length === 0
    await update($, porModelo, () => limits ?? [])
  } catch {
    sinConsulta = true
  }

  consultando = false
}

// Lee al lector mientras viva: el bucle es la vida del proceso, que acaba con él o con el mod.
const leer = async ($: EngineInterface): Promise<void> => {
  if (leyendo) {
    return
  }

  let resto = ''
  lecturas = []
  leyendo = true

  try {
    const lector = $.process.spawn({
      argv: ['powershell.exe', '-NoProfile', '-NoLogo', '-NonInteractive', '-Command', LECTOR],
    })

    for await (const { stream, text } of lector) {
      if (stream !== 'stdout') {
        continue
      }

      // Un trozo acaba donde acabó la escritura: una línea puede venir partida.
      const lines = (resto + text).split('\n')
      resto = lines.pop() ?? ''

      for (const line of lines) {
        const found = /^(\d+) (\d+)\s*$/.exec(line)

        if (found) {
          lecturas = [...lecturas, { cpu: Number(found[1]), ram: Number(found[2]) }].slice(-MEDIA)
          const medido = { cpu: media(lecturas.map(l => l.cpu)), ram: media(lecturas.map(l => l.ram)) }
          await update($, uso, () => medido)
        }
      }
    }
  } catch {
    // Sin lector (otro sistema, o no arranca) la banda va sin esas cifras.
  }

  leyendo = false
  await update($, uso, () => null)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'tokens-compact',
      description: 'Umbral de tokens de contexto con el que se compacta la sesión',
      argumentHint: '[tokens | 0]',
    })
    await cargar($)
    // Al recargar el mod a media sesión el motor ya los tiene.
    await limitar($, (await $.session.usage()).rateLimits)
    const started = await next(e)

    // Solo donde hay alguien mirando la banda.
    interactiva = e.isInteractive
    consultado = 0
    sinConsulta = false

    if (e.isInteractive) {
      leer($).catch(() => undefined)
      consultar($).catch(() => undefined)
    }

    return started
  })

  on('command.run', { command: 'tokens-compact' }, async ($, e) => {
    const typed = e.args.trim()

    if (typed === '') {
      await cargar($)
    } else {
      const value = Number(typed.replace(/[.\s_]/g, ''))

      if (!vale(value)) {
        return {
          text: `«${typed}» no vale: un número de ${conPuntos(UMBRAL_MIN)} a ${conPuntos(UMBRAL_MAX)}, o 0 para desactivarlo.`,
        }
      }

      await fijar($, value)
    }

    return { text: estado(await read($, umbral), await read($, efectivo)) }
  })

  // La barra avisa de dónde se soltó la marca. Viene de código: se comprueba como cualquier entrada.
  on('ui.message', async ($, e, next) => {
    const data = e.data

    if (typeof data === 'object' && data !== null && 'umbral' in data) {
      const limite = data.umbral

      if (limite !== 0 && vale(limite)) {
        await fijar($, limite)
        const rige = await read($, efectivo)
        $.ui.toast(`Compactado automático a los ${conPuntos(rige)} tokens de contexto`)
      }
    }

    return next(e)
  })

  on('ui.fault', async ($, e, next) => {
    await update($, sinRaton, () => true)

    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    const response = yield* next(e)
    const usage = response.usage

    if (usage) {
      const spent = gasto(usage)
      await update($, gastados, total => total + spent)

      if (e.agentId === undefined) {
        const sent = enviado(usage)
        await update($, contexto, () => sent)
      }
    }

    if (e.agentId === undefined) {
      consultar($).catch(() => undefined)
    }

    return response
  })

  on('session.measure', async ($, e, next) => {
    const tokens = e.context.tokens

    if (tokens !== undefined) {
      await update($, contexto, () => tokens)
    }

    await limitar($, e.rateLimits)
    // Otra sesión pudo mover el umbral, y esta cambiar de modelo.
    await cargar($)

    return next(e)
  })

  on('session.compact', async ($, e, next) => {
    const instructions = e.instructions?.includes(INSTRUCCIONES)
      ? e.instructions
      : [e.instructions, INSTRUCCIONES].filter(Boolean).join('\n\n')
    const done = await next({ ...e, instructions })

    if (e.agentId === undefined && e.trigger !== 'precompute' && done.skip === undefined) {
      const after = done.tokensAfter
      await update($, contexto, () => after ?? null)
    }

    return done
  })

  on('classic.PostCompact', async ($, e, next) => {
    if (e.agent_id === undefined) {
      // Hasta la siguiente respuesta, el contexto es el que diga el motor.
      await update($, contexto, () => null)
      const file = await guardar($, e.compact_summary)
      $.ui.toast(`Resumen de la sesión guardado en ${file}`)
    }

    return next(e)
  })

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear' || e.reason === 'resume') {
      await update($, gastados, () => 0)
      await update($, contexto, () => null)
      await update($, resumen, () => null)
    }

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) {
      return next(e)
    }

    const tokens = (await read($, contexto)) ?? (await $.session.usage()).context.tokens ?? 0
    const total = await read($, gastados)
    const rige = await read($, efectivo)
    const tope = await read($, maximo)
    const medido = await read($, uso)
    // Con un modelo que tiene su propio límite semanal se enseña ese; con los demás, el de todos.
    const propios = e.props.maxRows >= 2 ? await read($, porModelo) : []
    const modelo = propios.length === 0 ? '' : (await $.session.model()).toLowerCase()
    const propio = propios.find(limit => modelo.includes(limit.nombre.toLowerCase()))
    const limite = e.props.maxRows >= 2 ? (propio ?? (await read($, semana))) : null
    const reserva = Math.max(
      RESERVA + (medido === null ? 0 : RESERVA_USO),
      limite === null ? 0 : RESERVA_SEMANA,
    )
    const ancho = Math.max(BARRA_MIN, Math.min(BARRA_MAX, e.props.bodyColumns - reserva))
    const titulo = `Contexto: ${conPuntos(tokens)} tokens `
    const usado = limite === null ? 0 : Math.round(limite.pct)
    const tituloSemana = propio
      ? `Semana ${propio.nombre}: ${usado}% usado `
      : `Semana:   ${usado}% usado `
    // Con las dos líneas, sus barras empiezan en la misma columna.
    const largo = limite === null ? 0 : Math.max(titulo.length, tituloSemana.length)
    const llenas = Math.max(0, Math.min(ancho, Math.round((usado * ancho) / 100)))
    const renueva = limite === null || limite.renueva === null ? null : cuando(limite.renueva)
    const marca = rige === 0 ? -1 : celdaDe(rige, ancho)
    const barra = celdas(tokens, ancho)
    const indices = barra.map((_, i) => i)
    const table = $.ui.resolve(e)
    const { Box, Text } = table
    // Solo el terminal y el escritorio tienen regiones que reciban el ratón.
    const conRaton =
      (e.surface === 'terminal' || e.surface === 'desktop') && !(await read($, sinRaton))
    const Client = conRaton && 'Client' in table ? table.Client : undefined

    const linea = (
      <Box>
        <Text color={colorDe(tokens)}>{titulo.padEnd(largo)}</Text>
        {Client === undefined ? (
          barra.map((celda, i) =>
            i === marca && celda.text !== '●' ? (
              <Text color={MARCA}>┃</Text>
            ) : (
              <Text color={celda.color}>{celda.text}</Text>
            ),
          )
        ) : (
          <Client
            key="deslizador"
            module="./barra.tsx"
            width={ancho}
            height={1}
            props={{
              celdas: barra,
              marca,
              desde: Math.ceil((UMBRAL_MIN * ancho) / ESCALA),
              hasta: Math.floor((tope * ancho) / ESCALA),
              valores: indices.map(i => valorDe(i, ancho)),
              textos: indices.map(i => conPuntos(valorDe(i, ancho))),
              color: MARCA,
            }}
          />
        )}
        <Text dimColor> · sesión: {conPuntos(total)}</Text>
        {medido !== null && <Text dimColor> · </Text>}
        {medido !== null && <Text color={colorUso(medido.cpu)}>CPU {medido.cpu}%</Text>}
        {medido !== null && <Text dimColor> · </Text>}
        {medido !== null && <Text color={colorUso(medido.ram)}>RAM {medido.ram}%</Text>}
      </Box>
    )

    if (limite === null) {
      return linea
    }

    return (
      <Box flexDirection="column">
        {linea}
        <Box>
          <Text color={colorUso(usado)}>{tituloSemana.padEnd(largo)}</Text>
          <Text color={colorUso(usado)}>{'█'.repeat(llenas) + '░'.repeat(ancho - llenas)}</Text>
          {renueva !== null && <Text dimColor> · se renueva {renueva}</Text>}
        </Box>
      </Box>
    )
  })
}
