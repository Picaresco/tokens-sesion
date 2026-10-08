import { expect, mock, test } from 'claude-code/testing'
import type {
  JsonValue,
  On,
  ProcessSpawnChunk,
  SessionCompactInput,
  SessionCompactResult,
  SessionMessage,
  TurnUsage,
} from 'claude-code'
import type { Engine } from 'claude-code/testing'

const SURFACES = ['terminal', 'desktop'] as const
const VENTANA = 'CLAUDE_CODE_AUTO_COMPACT_WINDOW'
const PORCENTAJE = 'CLAUDE_AUTOCOMPACT_PCT_OVERRIDE'
// 2026-10-08 00:05:12 UTC
const NOW = Date.UTC(2026, 9, 8, 0, 5, 12)
const MESSAGE: SessionMessage = { role: 'user', text: 'hola', toolUses: [] }

const props = (bodyColumns: number) => ({
  hasSurvey: false,
  isWorking: false,
  maxRows: 10,
  bodyColumns,
  scroll: { offset: 0, bodyRows: 10 },
  view: {},
})

const usage = (
  input: number,
  output: number,
  cacheWrite: number,
  cacheRead: number,
): TurnUsage => ({
  model: 'test',
  input_tokens: input,
  output_tokens: output,
  cache_creation_input_tokens: cacheWrite,
  cache_read_input_tokens: cacheRead,
})

// El fondo de la cadena: lo que el motor haría debajo del mod, y lo que el mod le pidió.
const world = (
  $: Engine,
  on: On,
  stored: Record<string, unknown> = {},
  variables: Record<string, string> = {},
) => {
  const clock = mock.clock(on, { now: NOW })
  // El almacén del mod, con lo que otra sesión dejó guardado o guarde después.
  const store: Record<string, unknown> = { ...stored }
  // El entorno del proceso: de él lee el motor su ventana de compactado.
  const env: Record<string, string | undefined> = { ...variables }
  const writes: { path: string; text: string }[] = []
  const compacts: SessionCompactInput[] = []
  const toasts: string[] = []
  const registered: string[] = []
  const state = {
    cost: null as TurnUsage | null,
    index: 0,
    context: undefined as number | undefined,
    window: 1_000_000,
    // Si el lector de CPU y RAM arranca; sin él es otro sistema, donde no existe.
    reader: false,
  }
  // Lo que el lector va escribiendo, y cada vez que el mod lo lanzó.
  const pipe = {
    queue: [] as (ProcessSpawnChunk | null)[],
    wake: undefined as (() => void) | undefined,
  }
  const spawned: string[][] = []

  on('process.spawn', async function* (_$, e) {
    spawned.push([...e.argv])

    if (!state.reader) {
      throw new Error('spawn powershell.exe ENOENT')
    }

    for (;;) {
      while (pipe.queue.length === 0) {
        await new Promise<void>(resolve => {
          pipe.wake = resolve
        })
      }

      const chunk = pipe.queue.shift()

      if (chunk == null) {
        return { value: { code: 0, signal: null } }
      }

      yield chunk
    }
  })

  on('turn.step', async function* (_$, e) {
    return {
      turnId: e.turnId,
      index: e.index,
      answer: '',
      toolUses: [],
      stopReason: 'end_turn' as const,
      usage: state.cost,
    }
  })
  on('session.usage', () => ({
    value: {
      startedAt: 0,
      context: { window: state.window, tokens: state.context },
      rateLimits: [],
    },
  }))
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  // Como el motor: compacta, lanza PostCompact con el resumen y devuelve lo que queda.
  on('session.compact', async (_$, e): Promise<SessionCompactResult> => {
    compacts.push(e)
    await $.classic.PostCompact({ trigger: 'auto', compact_summary: 'RESUMEN' })

    return { messages: [MESSAGE], tokensBefore: 650_000, tokensAfter: 40_000 }
  })
  on('command.run', () => ({ text: '' }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => {
    registered.push(e.name)

    return { value: { command: e.name } }
  })
  on('store.get', (_$, e) => ({ value: store[e.key] }))
  on('store.set', (_$, e) => {
    store[e.key] = e.value

    return { value: undefined }
  })
  on('env.get', (_$, e) => ({ value: env[e.name] }))
  on('env.set', (_$, e) => {
    env[e.name] = e.value

    return { value: undefined }
  })
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }))
  on('ui.message', () => ({}))
  on('ui.fault', () => ({}))
  on('classic.PostCompact', () => ({}))
  on('fs.write', (_$, e) => {
    // El motor entrega la ruta ya resuelta contra el directorio de trabajo.
    writes.push({ path: e.path.replaceAll('\\', '/'), text: e.text })

    return { value: undefined }
  })
  on('ui.toast', (_$, e) => {
    toasts.push(JSON.stringify(e))

    return { value: undefined }
  })

  return {
    env,
    store,
    writes,
    compacts,
    toasts,
    registered,
    spawned,
    state,
    // Deja que el mod acabe lo que tenga entre manos.
    settle: () => clock.settle(),
    start: (isInteractive = true) =>
      $.session.start({ cwd: '.', surface: isInteractive ? 'terminal' : null, isInteractive }),
    // El lector escribe por una de sus salidas; `null` es su final.
    write: (text: string | null, stream: ProcessSpawnChunk['stream'] = 'stdout') => {
      pipe.queue.push(text === null ? null : { stream, text })
      pipe.wake?.()
    },
    // La persona escribe /tokens-compact con esos argumentos.
    slash: (args: string) =>
      $.command.run({
        command: 'tokens-compact',
        args,
        origin: { kind: 'composer' },
        presentation: { isFullscreen: true, columns: 120 },
      }),
    // Una petición al modelo que cuesta `cost`, del hilo principal o de un subagente.
    ask: async (cost: TurnUsage | null, agentId?: string) => {
      state.cost = cost
      const stream = $.turn.step({
        turnId: 't',
        index: state.index++,
        model: 'test',
        messageCount: 1,
        ...(agentId === undefined ? {} : { agentId }),
      })

      for await (const _chunk of stream) {
        // sin trozos: solo importa el resultado
      }

      await stream.result
    },
    // El motor mide la sesión al acabar un turno del hilo principal.
    measure: (tokens: number | undefined) =>
      $.session.measure({
        context: { window: state.window, tokens },
        rateLimits: [],
        changed: ['context'],
      }),
  }
}

const mount = ($: Engine, surface: (typeof SURFACES)[number], bodyColumns = 120) =>
  $.ui.mount({
    plugin: 'tokens-sesion',
    component: 'AbovePrompt',
    props: props(bodyColumns),
    surface,
  })

type Band = Awaited<ReturnType<typeof mount>>

// La barra tal como la dibuja su módulo de superficie, celda a celda.
const bar = async (ui: Band): Promise<string> =>
  (await ui.findAll({ type: 'Text', in: 'deslizador' })).map(cell => cell.text).join('')

const band = async ($: Engine, surface: (typeof SURFACES)[number], bodyColumns = 120) => {
  const ui = await mount($, surface, bodyColumns)
  const texts = await ui.findAll({ type: 'Text' })
  const cells = await ui.findAll({ type: 'Text', in: 'deslizador' })
  await ui.unmount()
  // Las celdas seguidas de un mismo color, juntas.
  const segments: [string, unknown][] = []

  for (const cell of cells) {
    const last = segments.at(-1)

    if (last !== undefined && last[1] === cell.props.color) {
      last[0] += cell.text
    } else {
      segments.push([cell.text, cell.props.color])
    }
  }

  return {
    context: texts.find(text => text.text.startsWith('Contexto')),
    total: texts.find(text => text.text.includes('sesión')),
    texts: texts.map(text => text.text),
    bar: cells.map(cell => cell.text).join(''),
    segments,
    // Las cifras de CPU y RAM, cada una con su color; nada mientras no hay lecturas.
    use: texts
      .filter(text => /^(CPU|RAM) /.test(text.text))
      .map(text => [text.text, text.props.color]),
  }
}

test('pinta el contexto con su barra y el gasto de la sesión en gris', async ($, on) => {
  const { ask, state } = world($, on)

  state.context = 222_807
  for (const surface of SURFACES) {
    const { context, segments, total } = await band($, surface)
    expect(context?.text).toBe('Contexto: 222.807 tokens ')
    expect(context?.props.color).toBe('#22c55e')
    // 40 celdas de 25.000: el punto actual en la novena, la marca de compactar en 650.000.
    expect(segments).toEqual([
      ['████████', '#22c55e'],
      ['●', 'text'],
      ['░░░░░░░░░░░', '#22c55e'],
      ['░░░░░░', '#a3e635'],
      ['┃', '#38bdf8'],
      ['░░░░░', '#facc15'],
      ['░░░░░░', '#fb923c'],
      ['░░', '#ef4444'],
    ])
    expect(total?.text).toBe(' · sesión: 0')
    expect(total?.props.dimColor).toBe(true)
  }

  // En una banda estrecha la barra se queda en 10 celdas.
  expect((await band($, 'terminal', 50)).bar).toBe('██●░░░┃░░░')

  // Contexto: lo enviado en la última petición del hilo principal, caché leída incluida.
  await ask(usage(1_000, 200, 100, 50_000))
  // Un subagente gasta, pero no ocupa el contexto principal.
  await ask(usage(700, 0, 0, 9_999), 'agente-1')
  await ask(null)

  for (const surface of SURFACES) {
    const { bar, context, total } = await band($, surface)
    expect(context?.text).toBe('Contexto: 51.100 tokens ')
    expect(bar).toBe('██●' + '░'.repeat(23) + '┃' + '░'.repeat(13))
    expect(total?.text).toBe(' · sesión: 2.000')
  }
})

test('cinco colores, de verde hasta 500.000 a rojo desde 950.001', async ($, on) => {
  const { ask } = world($, on)
  const steps = [
    [0, '#22c55e'],
    [500_000, '#22c55e'],
    [500_001, '#a3e635'],
    [650_000, '#a3e635'],
    [650_001, '#facc15'],
    [800_000, '#facc15'],
    [800_001, '#fb923c'],
    [950_000, '#fb923c'],
    [950_001, '#ef4444'],
    [3_000_000, '#ef4444'],
  ] as const

  for (const [tokens, color] of steps) {
    await ask(usage(tokens, 0, 0, 0))

    for (const surface of SURFACES) {
      const { bar, context } = await band($, surface)
      expect(context?.props.color, `${tokens} en ${surface}`).toBe(color)
      expect(bar, `${tokens} en ${surface}`).toHaveLength(40)
    }
  }

  // Fuera de escala, el punto actual se queda en la última celda.
  const { bar, context } = await band($, 'terminal')
  expect(context?.text).toBe('Contexto: 3.000.000 tokens ')
  expect(bar).toBe('█'.repeat(26) + '┃' + '█'.repeat(12) + '●')
})

test('la barra pone el punto actual al principio con 0 y sobre la marca con 650.000', async ($, on) => {
  const { ask } = world($, on)

  expect((await band($, 'terminal')).bar).toBe('●' + '░'.repeat(25) + '┃' + '░'.repeat(13))

  await ask(usage(650_000, 0, 0, 0))
  expect((await band($, 'terminal')).bar).toBe('█'.repeat(26) + '●' + '░'.repeat(13))
})

test('pone la ventana de compactado del motor donde deja el umbral, sin compactar por su cuenta', async ($, on) => {
  const { ask, compacts, env, measure, slash, start } = world($, on)

  // El motor compacta 33.000 tokens antes de su ventana.
  await start()
  expect(env[VENTANA]).toBe('683000')
  expect((await slash('')).text).toContain(
    'al llegar el contexto a 650.000 tokens, también a mitad de una tarea',
  )

  expect((await slash('500000')).text).toContain('al llegar el contexto a 500.000 tokens')
  expect(env[VENTANA]).toBe('533000')

  // Lleno o no, el mod no compacta: lo hace el motor en cuanto toca, también a mitad de turno.
  await ask(usage(900_000, 0, 0, 0))
  await measure(900_000)
  expect(compacts).toHaveLength(0)
  expect(env[VENTANA]).toBe('533000')
})

test('con CLAUDE_AUTOCOMPACT_PCT_OVERRIDE la ventana compensa el porcentaje y el tope baja', async ($, on) => {
  const { env, slash, start } = world($, on, {}, { [PORCENTAJE]: '80' })

  // El motor compacta al 80 % de la ventana menos 20.000: 500.000 pide 645.000.
  await start()
  await slash('500000')
  expect(env[VENTANA]).toBe('645000')
  expect((await band($, 'terminal')).bar).toBe('●' + '░'.repeat(19) + '┃' + '░'.repeat(19))

  // Con la ventana entera el motor compacta en 784.000: más no se puede.
  expect((await slash('900000')).text).toContain(
    'al llegar el contexto a 784.000 tokens (el tope de esta sesión; pedidos 900.000)',
  )
  expect(env[VENTANA]).toBe('1000000')
  const { bar } = await band($, 'terminal')
  expect(bar).toBe('●' + '░'.repeat(30) + '┃' + '░'.repeat(8))

  // La marca no pasa de ese tope: la celda 31, 775.000.
  const ui = await mount($, 'terminal')
  await ui.pointer({ type: 'down', x: 31, y: 0, button: 'left' })
  await ui.pointer({ type: 'move', x: 60, y: 0, button: 'left' })
  await ui.pointer({ type: 'up', x: 60, y: 0, button: 'left' })
  await ui.unmount()
  expect((await slash('')).text).toContain('al llegar el contexto a 775.000 tokens,')
  expect(env[VENTANA]).toBe('988750')

  // Un porcentaje que el motor no tendría en cuenta tampoco cuenta aquí.
  for (const bad of ['0', '150', 'mucho']) {
    env[PORCENTAJE] = bad
    await slash('500000')
    expect(env[VENTANA], bad).toBe('533000')
  }
})

test('con un modelo de ventana pequeña rige el tope de ese modelo', async ($, on) => {
  const { env, slash, start, state } = world($, on)

  state.window = 200_000
  await start()
  // La ventana pedida no cambia: el motor la recorta a la del modelo y compacta en 167.000.
  expect(env[VENTANA]).toBe('683000')
  expect((await slash('')).text).toContain(
    'al llegar el contexto a 167.000 tokens (el tope de esta sesión; pedidos 650.000)',
  )
  const { bar } = await band($, 'terminal')
  expect(bar).toBe('●' + '░'.repeat(5) + '┃' + '░'.repeat(33))
})

test('una compactación del motor lleva las instrucciones y su resumen se guarda', async ($, on) => {
  const { ask, compacts, toasts, writes } = world($, on)

  await ask(usage(800_000, 0, 0, 0))
  await $.session.compact({ trigger: 'auto', messages: [MESSAGE], instructions: 'la migración' })
  expect(compacts[0]?.instructions).toStartWith('la migración\n\n')
  expect(compacts[0]?.instructions).toContain('Conserva todos los puntos')
  expect(writes).toHaveLength(1)
  expect(writes[0]?.path).toEndWith('/.claude/resumenes/resumen-2026-10-08-00-05-12.md')
  expect(writes[0]?.text).toBe('RESUMEN')
  expect(toasts.join()).toContain('.claude/resumenes/resumen-2026-10-08-00-05-12.md')
  expect((await band($, 'terminal')).context?.text).toBe('Contexto: 40.000 tokens ')

  // Sin instrucciones de nadie, van las del mod, una sola vez.
  await $.session.compact({ trigger: 'manual', messages: [MESSAGE] })
  const told = compacts[1]?.instructions ?? ''
  expect(told).toStartWith('Resumen exhaustivo')
  await $.session.compact({ trigger: 'manual', messages: [MESSAGE], instructions: told })
  expect(compacts[2]?.instructions).toBe(told)

  // El resumen de un subagente no se guarda.
  const before = writes.length
  await $.classic.PostCompact({ trigger: 'auto', compact_summary: 'de un subagente', agent_id: 'a1' })
  expect(writes).toHaveLength(before)
})

test('la banda no lleva ningún aviso para el ratón: solo el contexto, la barra y la sesión', async ($, on) => {
  const { slash, start } = world($, on)

  await start()

  for (const limite of ['650000', '0']) {
    await slash(limite)

    for (const surface of SURFACES) {
      const { bar, texts } = await band($, surface)
      expect(texts.join('').replace(bar, ''), `${limite} en ${surface}`).toBe(
        'Contexto: 0 tokens  · sesión: 0',
      )
    }
  }
})

// Con el lector abierto el kit espera en cada paso a que acabe lo que el mod dejó en marcha: pocos pasos.
test('con el lector en marcha añade la media de las cinco últimas lecturas de CPU y RAM, cada una con su color', { timeoutMs: 20_000 }, async ($, on) => {
  const { settle, spawned, start, state, write } = world($, on)
  const VERDE = '#22c55e'
  const AMARILLO = '#facc15'
  const ROJO = '#ef4444'
  // Las cifras de una banda ya montada, cada una con su color, y el ancho de su barra.
  const use = async (ui: Band) =>
    (await ui.findAll({ type: 'Text' }))
      .filter(text => /^(CPU|RAM) /.test(text.text))
      .map(text => [text.text, text.props.color])
  const width = async (ui: Band) => (await bar(ui)).length

  state.reader = true
  await start()
  // Un solo proceso, y su script cruza entero como un argumento: sin comillas dobles.
  expect(spawned).toHaveLength(1)
  expect(spawned[0]?.[0]).toBe('powershell.exe')
  expect(spawned[0]?.at(-1)).not.toContain('"')

  // Cada lectura son las décimas de % de CPU y de RAM; hasta 60 verde, hasta 85 amarillo.
  const ui = await mount($, 'terminal', 100)
  write('120 600\r\n')
  expect(await use(ui)).toEqual([
    ['CPU 12%', VERDE],
    ['RAM 60%', VERDE],
  ])
  write('300 620\r\n')
  expect(await use(ui)).toEqual([
    ['CPU 21%', VERDE],
    ['RAM 61%', AMARILLO],
  ])

  // Una línea partida entre dos trozos y dos líneas en uno; lo que no es una lectura se ignora.
  write('9')
  write('aviso por la otra salida\r\n', 'stderr')
  write('00 900\r\nruido\r\n1000 1000\r\n')
  expect(await use(ui)).toEqual([
    ['CPU 58%', VERDE],
    ['RAM 78%', AMARILLO],
  ])

  // La sexta lectura saca a la primera de la media.
  write('1000 1000\r\n1000 1000\r\n')
  expect(await use(ui)).toEqual([
    ['CPU 84%', AMARILLO],
    ['RAM 90%', ROJO],
  ])
  // Las cifras ocupan 22 columnas: donde no caben, la barra se encoge para dejarles sitio.
  expect(await width(ui)).toBe(34)
  await ui.unmount()

  // En el escritorio, lo mismo, a continuación de la sesión.
  const { bar: drawn, texts } = await band($, 'desktop')
  expect(texts.join('').replace(drawn, '')).toBe(
    'Contexto: 0 tokens  · sesión: 0 · CPU 84% · RAM 90%',
  )

  // Mientras ese lector viva no se lanza otro.
  await start()
  expect(spawned).toHaveLength(1)

  // Cuando el lector acaba, la banda vuelve a ser la de siempre.
  write(null)
  await settle()
  const after = await band($, 'terminal', 100)
  expect(after.texts.join('').replace(after.bar, '')).toBe('Contexto: 0 tokens  · sesión: 0')
  expect(after.bar).toHaveLength(40)
})

test('sin lector, o en una sesión sin nadie delante, la banda va sin CPU ni RAM', async ($, on) => {
  const { spawned, start, state } = world($, on)

  // En -p y en el SDK no hay banda que mirar: ni se lanza.
  state.reader = true
  await start(false)
  expect(spawned).toHaveLength(0)

  // Donde el lector no arranca, lo intenta una vez y sigue sin él.
  state.reader = false
  await start()
  expect(spawned).toHaveLength(1)

  for (const surface of SURFACES) {
    const { bar, texts, use } = await band($, surface)
    expect(use).toEqual([])
    expect(texts.join('').replace(bar, ''), surface).toBe('Contexto: 0 tokens  · sesión: 0')
  }
})

test('la marca de compactar se arrastra con el ratón y el umbral queda guardado', async ($, on) => {
  const { env, slash, start, toasts } = world($, on)

  await start()

  for (const surface of SURFACES) {
    await slash('650000')
    const ui = await mount($, surface)
    const rest = '●' + '░'.repeat(25) + '┃' + '░'.repeat(13)
    expect(await bar(ui), surface).toBe(rest)

    // Un clic lejos de la marca no cambia nada.
    await ui.pointer({ type: 'down', x: 10, y: 0, button: 'left' })
    await ui.pointer({ type: 'move', x: 14, y: 0, button: 'left' })
    await ui.pointer({ type: 'up', x: 14, y: 0, button: 'left' })
    expect(await bar(ui), surface).toBe(rest)
    expect(env[VENTANA], surface).toBe('683000')

    // Se agarra la marca (celda 26) y se lleva a la 30: mientras, enseña la cifra.
    await ui.pointer({ type: 'down', x: 26, y: 0, button: 'left' })
    await ui.pointer({ type: 'move', x: 30, y: 0, button: 'left' })
    expect(await bar(ui), surface).toBe('●' + '░'.repeat(29) + '┃' + ' 750.000 ')
    // Hasta soltarla no cambia nada en el motor.
    expect(env[VENTANA], surface).toBe('683000')
    await ui.pointer({ type: 'up', x: 30, y: 0, button: 'left' })
    expect(await bar(ui), surface).toBe('●' + '░'.repeat(29) + '┃' + '░'.repeat(9))
    expect((await slash('')).text, surface).toContain('al llegar el contexto a 750.000 tokens')
    // Al soltarla, la ventana del motor la sigue al momento, sin esperar al fin del turno.
    expect(env[VENTANA], surface).toBe('783000')

    // No sale de los límites: 200.000 por la izquierda y 950.000 por la derecha.
    await ui.pointer({ type: 'down', x: 31, y: 0, button: 'left' })
    await ui.pointer({ type: 'move', x: -5, y: 0, button: 'left' })
    expect(await bar(ui), surface).toBe('●' + '░'.repeat(7) + '┃' + ' 200.000 ' + '░'.repeat(22))
    await ui.pointer({ type: 'up', x: -5, y: 0, button: 'left' })
    expect((await slash('')).text, surface).toContain('al llegar el contexto a 200.000 tokens')

    await ui.pointer({ type: 'down', x: 8, y: 0, button: 'left' })
    await ui.pointer({ type: 'move', x: 60, y: 0, button: 'left' })
    // Pegada a la derecha, la cifra va a la izquierda de la marca.
    expect(await bar(ui), surface).toBe('●' + '░'.repeat(28) + ' 950.000 ' + '┃' + '░')
    await ui.pointer({ type: 'up', x: 60, y: 0, button: 'left' })
    expect((await slash('')).text, surface).toContain('al llegar el contexto a 950.000 tokens')
    expect(env[VENTANA], surface).toBe('983000')
    await ui.unmount()
  }

  expect(toasts.join()).toContain('750.000')
})

test('lo que llega de la barra se comprueba: un umbral que no vale no se guarda', async ($, on) => {
  const { slash } = world($, on)
  const ui = await mount($, 'terminal')

  const bads: JsonValue[] = [
    { umbral: 0 },
    { umbral: 50 },
    { umbral: 150_000 },
    { umbral: '700000' },
    { otro: 700_000 },
    'x',
  ]

  for (const bad of bads) {
    await ui.post(bad)
  }

  expect((await slash('')).text).toContain('al llegar el contexto a 650.000 tokens')
  await ui.post({ umbral: 700_000 })
  expect((await slash('')).text).toContain('al llegar el contexto a 700.000 tokens')
  await ui.unmount()
})

test('en una superficie sin regiones que reciban el ratón dibuja la barra fija', async ($, on) => {
  const { ask } = world($, on)

  await ask(usage(222_807, 0, 0, 0))
  const ui = await $.ui.mount({
    plugin: 'tokens-sesion',
    component: 'AbovePrompt',
    props: props(120),
    surface: 'vscode',
  })
  const cells = (await ui.findAll({ type: 'Text' })).filter(text => /^[█░●┃]$/.test(text.text))
  expect(await ui.find({ type: 'Client' })).toBeUndefined()
  expect(cells.map(cell => cell.text).join('')).toBe(
    '█'.repeat(8) + '●' + '░'.repeat(17) + '┃' + '░'.repeat(13),
  )
  expect(cells[26]?.props.color).toBe('#38bdf8')
  await ui.unmount()
})

test('con otro umbral guardado se mueven la marca y la ventana del motor', async ($, on) => {
  const { ask, env, measure, start, store } = world($, on, { umbral: 850_000 })

  await start()
  await ask(usage(700_000, 0, 0, 0))
  expect((await band($, 'terminal')).bar).toBe(
    '█'.repeat(28) + '●' + '░'.repeat(5) + '┃' + '░'.repeat(5),
  )
  expect(env[VENTANA]).toBe('883000')

  // Otra sesión lo cambia: esta lo recoge al acabar el turno.
  store.umbral = 300_000
  await measure(700_000)
  expect(env[VENTANA]).toBe('333000')
  expect((await band($, 'terminal')).bar).toBe(
    '█'.repeat(12) + '┃' + '█'.repeat(15) + '●' + '░'.repeat(11),
  )

  // Uno guardado que ya no vale deja el de fábrica.
  store.umbral = 100_000
  await measure(700_000)
  expect(env[VENTANA]).toBe('683000')
})

test('con el umbral a 0 no hay marca y la ventana vuelve a ser la del motor', async ($, on) => {
  const { ask, env, slash, start } = world($, on, { umbral: 0 }, { [VENTANA]: '683000' })

  await start()
  expect(env[VENTANA]).toBeUndefined()
  await ask(usage(900_000, 0, 0, 0))
  expect((await band($, 'terminal')).bar).toBe('█'.repeat(36) + '●' + '░'.repeat(3))

  // Al activarlo vuelve la ventana.
  await slash('650000')
  expect(env[VENTANA]).toBe('683000')
})

test('/tokens-compact enseña el umbral, lo cambia y lo guarda, y rechaza lo que no vale', async ($, on) => {
  const { ask, env, measure, registered, slash, start } = world($, on)

  await start()
  expect(registered).toEqual(['tokens-compact'])
  expect((await slash('')).text).toContain('al llegar el contexto a 650.000 tokens')

  // La banda cambia al momento, sin esperar a recargar.
  expect((await slash('850.000')).text).toContain('al llegar el contexto a 850.000 tokens')
  expect((await band($, 'terminal')).bar).toBe('●' + '░'.repeat(33) + '┃' + '░'.repeat(5))

  for (const bad of ['50', '199999', '950001', 'mucho', '700000.5x']) {
    expect((await slash(bad)).text, bad).toContain('no vale')
  }

  // Queda guardado: al acabar el turno se relee del almacén y sigue siendo 850.000.
  await ask(usage(700_000, 0, 0, 0))
  await measure(700_000)
  expect((await slash('')).text).toContain('al llegar el contexto a 850.000 tokens')
  expect(env[VENTANA]).toBe('883000')

  expect((await slash(' 0 ')).text).toContain('desactivado')
  expect((await band($, 'terminal')).bar).toBe('█'.repeat(28) + '●' + '░'.repeat(11))
  expect(env[VENTANA]).toBeUndefined()
})

test('/clear pone los contadores a cero', async ($, on) => {
  const { ask } = world($, on)

  await ask(usage(600_000, 0, 0, 0))
  await $.session.end({ reason: 'prompt_input_exit', sessionId: 's', resume: { id: 's' } })
  let drawn = await band($, 'terminal')
  expect(drawn.context?.text).toBe('Contexto: 600.000 tokens ')
  expect(drawn.total?.text).toBe(' · sesión: 600.000')

  await $.session.end({ reason: 'clear', sessionId: 's', resume: { id: 's' } })
  drawn = await band($, 'terminal')
  expect(drawn.context?.text).toBe('Contexto: 0 tokens ')
  expect(drawn.total?.text).toBe(' · sesión: 0')
})
