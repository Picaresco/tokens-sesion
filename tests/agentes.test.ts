import { expect, mock, test } from 'claude-code/testing'
import type { AgentSpawnInput, On, TurnUsage } from 'claude-code'
import type { Engine } from 'claude-code/testing'

// 2026-10-10 10:00:00 UTC
const NOW = Date.UTC(2026, 9, 10, 10, 0, 0)

const dos = (n: number) => String(n).padStart(2, '0')
// La hora del equipo, como la pinta el mod.
const hora = (ms: number) => {
  const date = new Date(ms)

  return `${dos(date.getHours())}:${dos(date.getMinutes())}:${dos(date.getSeconds())}`
}

const usage = (input: number, output: number, cacheWrite: number, cacheRead: number): TurnUsage => ({
  model: 'test',
  input_tokens: input,
  output_tokens: output,
  cache_creation_input_tokens: cacheWrite,
  cache_read_input_tokens: cacheRead,
})

// El fondo de la cadena: lo que el motor haría debajo del mod, y lo que el mod le pidió.
const world = ($: Engine, on: On, stored: Record<string, unknown> = {}) => {
  const clock = mock.clock(on, { now: NOW })
  // El almacén del mod, con lo que otra sesión dejó guardado o guarde después.
  const store: Record<string, unknown> = { ...stored }
  const opened: string[] = []
  const closed: string[] = []
  // Los paneles abiertos, lo que el motor recibió al arrancar cada agente y el esfuerzo de cada petición.
  const panes = new Set<string>()
  const spawns: AgentSpawnInput[] = []
  const steps: (string | number | undefined)[] = []
  // Las herramientas que el mod registra.
  const tools: string[] = []
  const state = {
    cost: null as TurnUsage | null,
    index: 0,
    // Lo que el motor responde al arrancar un agente: su id, o una negativa.
    next: 'a1' as string | null,
    // El esfuerzo con el que el motor lanza cada petición: ninguno si el modelo no lo admite.
    effort: undefined as 'high' | undefined,
    // Los agentes que el motor lista: [id, tipo].
    listed: [] as [string, string][],
    // Las herramientas de lista de tareas que el motor ofrece al modelo, y el id de la próxima que cree.
    builtin: ['TodoWrite'] as string[],
    taskId: '1',
  }

  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  // Lo que pide la banda del mismo mod al arrancar: sin lector de CPU ni consulta de /usage.
  on('session.usage', () => ({
    value: { startedAt: 0, context: { window: 1_000_000, tokens: 0 }, rateLimits: [] },
  }))
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('env.get', () => ({ value: undefined }))
  on('env.set', () => ({ value: undefined }))
  on('process.spawn', async function* () {
    throw new Error('spawn powershell.exe ENOENT')
  })
  on('process.run', () => ({
    value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
  }))
  on('ui.toast', () => ({ value: undefined }))
  on('tool.list', () => ({
    value: ['Read', ...state.builtin].map(name => ({ name, description: '', mcp: false })),
  }))
  on('tool.register', (_$, e) => {
    tools.push(e.name)

    return { value: { tool: `mcp__tokens-sesion__${e.name}` } }
  })
  // Como el motor: cada herramienta devuelve su registro.
  on('tool.call', (_$, e) =>
    e.tool === 'TaskCreate'
      ? { result: { task: { id: state.taskId, subject: e.subject } } }
      : ({ result: {} } as never),
  )
  on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'x', scope: 'shared' as const }] }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('command.run', () => ({ text: '' }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  on('turn.step', async function* (_$, e) {
    steps.push(e.effort)

    return {
      turnId: e.turnId,
      index: e.index,
      answer: '',
      toolUses: [],
      stopReason: 'end_turn' as const,
      usage: state.cost,
    }
  })
  on('agent.spawn', (_$, e) => {
    spawns.push(e)

    return state.next === null ? { deny: 'no' } : { model: 'claude-haiku-5-5', agentId: state.next }
  })
  on('agent.offer', () => ({ isOffered: true }))
  on('agent.list', () => ({
    value: state.listed.map(([id, type]) => ({ id, type, description: '', status: 'running' as const })),
  }))
  on('store.get', (_$, e) => ({ value: store[e.key] }))
  on('store.set', (_$, e) => {
    store[e.key] = e.value

    return { value: undefined }
  })
  on('ui.panes', () => ({
    value: [...panes].map(id => ({ id, title: id, isShown: true, isFocused: false, isPlaced: true })),
  }))
  on('ui.open', (_$, e) => {
    opened.push(e.id)
    panes.add(e.id)

    return { value: { isPlaced: true as const } }
  })
  on('ui.close', (_$, e) => {
    closed.push(e.id)
    panes.delete(e.id)

    return { value: undefined }
  })

  return {
    clock,
    store,
    opened,
    closed,
    spawns,
    steps,
    tools,
    state,
    // El modelo anota su lista de tareas entera: [texto, estado] por paso.
    todo: (list: [string, 'pending' | 'in_progress' | 'completed'][], agentId?: string) =>
      $.tool.call({
        tool: 'TodoWrite',
        todos: list.map(([content, status]) => ({ content, status, activeForm: content })),
        ...(agentId === undefined ? {} : { agentId }),
      }),
    // Deja que el mod acabe lo que tenga entre manos.
    settle: () => clock.settle(),
    start: (isInteractive = true) =>
      $.session.start({ cwd: '.', surface: isInteractive ? 'terminal' : null, isInteractive }),
    // La persona envía un prompt: empieza una tarea.
    prompt: (text: string) => $.turn.start({ text, turnId: `t${state.index++}` }),
    // El modelo lanza un agente, al que el motor da el id `id` (o lo rechaza con `null`).
    spawn: (id: string | null, input: Partial<AgentSpawnInput> = {}) => {
      state.next = id

      return $.agent.spawn({
        tool_use_id: 'tu',
        prompt: 'haz algo',
        description: 'buscar hooks',
        subagentType: 'Explore',
        provider: { plugin: 'engine', tier: 'core' },
        parentModel: 'claude-opus-5-5',
        background: false,
        fork: false,
        ...input,
      })
    },
    // Una petición al modelo que cuesta `cost`, del hilo principal o de un agente.
    ask: async (cost: TurnUsage | null, agentId?: string) => {
      state.cost = cost
      const stream = $.turn.step({
        turnId: 't',
        index: state.index++,
        model: 'claude-haiku-5-5',
        messageCount: 1,
        ...(state.effort === undefined ? {} : { effort: state.effort }),
        ...(agentId === undefined ? {} : { agentId }),
      })

      for await (const _chunk of stream) {
        // sin trozos: solo importa el resultado
      }

      await stream.result
    },
    // El agente `agentId` acaba su turno.
    end: (agentId: string, reason: 'answer' | 'aborted' | 'error' = 'answer') =>
      $.turn.complete({
        answer: '',
        durationMs: 0,
        isAborted: reason === 'aborted',
        turnId: 't',
        agentId,
        reason,
      }),
    slash: (args: string) =>
      $.command.run({
        command: 'agentes',
        args,
        origin: { kind: 'composer' },
        presentation: { isFullscreen: true, columns: 160 },
      }),
  }
}

// El texto de un hijo tal como se dibuja: una cadena, o un elemento con los suyos.
const shown = (child: unknown): string =>
  typeof child === 'string'
    ? child
    : ((child as { children?: unknown[] } | null)?.children ?? []).map(shown).join('')

// Las líneas del panel, cada una con el texto de sus trozos seguido.
const lines = async ($: Engine, bodyColumns = 48): Promise<string[]> => {
  const ui = await $.ui.mount({
    plugin: 'tokens-sesion',
    component: 'Pane',
    requestId: 'agentes',
    surface: 'terminal',
    props: {
      title: 'Agentes',
      isFocused: false,
      bodyColumns,
      placement: 'dock',
      scroll: { offset: 0, bodyRows: 40 },
      view: {},
    },
  })
  const root = await ui.find({ key: 'cuerpo' })
  const drawn = (root?.children ?? []).map(shown)
  await ui.unmount()

  return drawn
}

test('sin agentes el panel lo dice y no se abre solo', async ($, on) => {
  const { start, prompt, opened } = world($, on)
  await start()
  await prompt('hola')

  expect(await lines($)).toEqual(['Sin agentes todavía.'])
  expect(opened).toEqual([])
})

test('un agente: inicio, tokens según pide al modelo, fin y duración', async ($, on) => {
  const { start, prompt, spawn, ask, end, clock, opened } = world($, on)
  await start()
  await prompt('busca   los hooks\ndel mod')
  await clock.advance(5_000)
  await spawn('a1')
  await clock.settle()

  expect(opened).toEqual(['agentes'])
  expect(await lines($)).toEqual([
    `Tarea 1 · ${hora(NOW)} · 1 agente · 0 tok`,
    'busca los hooks del mod',
    `● ${hora(NOW + 5_000)} → en curso                  0 tok`,
    '  Explore · buscar hooks · haiku-5-5',
  ])

  // La caché leída no cuenta; lo del hilo principal y lo de ids que no son agentes, tampoco.
  await ask(usage(1_000, 200, 300, 90_000), 'a1')
  await ask(usage(5_000, 5_000, 0, 0))
  await ask(usage(7_000, 0, 0, 0), 'compactacion')
  await ask(usage(10_000, 920, 0, 0), 'a1')
  expect((await lines($))[2]).toBe(`● ${hora(NOW + 5_000)} → en curso             12.420 tok`)

  await clock.advance(102_000)
  await end('a1')
  expect(await lines($)).toEqual([
    `Tarea 1 · ${hora(NOW)} · 1 agente · 12.420 tok`,
    'busca los hooks del mod',
    `✓ ${hora(NOW + 5_000)} → ${hora(NOW + 107_000)}    1m42s    12.420 tok`,
    '  Explore · buscar hooks · haiku-5-5',
  ])
})

test('agrupa por tarea, la más reciente arriba, con su total; las tareas sin agentes no salen', async ($, on) => {
  const { start, prompt, spawn, ask, end, clock } = world($, on)
  await start()
  await prompt('primera')
  await spawn('a1')
  await ask(usage(1_000, 0, 0, 0), 'a1')
  await spawn('a2', { name: 'revisor', subagentType: 'general-purpose', description: 'revisar' })
  await ask(usage(2_500, 0, 0, 0), 'a2')
  await clock.advance(30_000)
  await end('a1')
  await end('a2', 'aborted')
  await prompt('sin agentes')
  await prompt('tercera')
  await clock.advance(3_600_000 + 120_000)
  await spawn('a3')
  // Un agente en segundo plano de la primera tarea acaba después: sigue en la suya.
  await ask(usage(500, 0, 0, 0), 'a2')

  expect(await lines($)).toEqual([
    `Tarea 3 · ${hora(NOW + 30_000)} · 1 agente · 0 tok`,
    'tercera',
    `● ${hora(NOW + 3_750_000)} → en curso                  0 tok`,
    '  Explore · buscar hooks · haiku-5-5',
    ' ',
    `Tarea 1 · ${hora(NOW)} · 2 agentes · 4.000 tok`,
    'primera',
    `✓ ${hora(NOW)} → ${hora(NOW + 30_000)}      30s     1.000 tok`,
    '  Explore · buscar hooks · haiku-5-5',
    // Lo retomaron: vuelve a estar en curso y sigue sumando.
    `● ${hora(NOW)} → en curso              3.000 tok`,
    '  revisor (general-purpose) · revisar · haiku-5-5',
  ])
})

test('un arranque rechazado no deja línea, y los tokens que llegan antes del arranque se suman', async ($, on) => {
  const { start, prompt, spawn, ask } = world($, on)
  await start()
  await prompt('tarea')
  await spawn(null)
  expect(await lines($)).toEqual(['Sin agentes todavía.'])

  await ask(usage(700, 0, 0, 0), 'a9')
  await spawn('a9')
  expect((await lines($))[2]).toMatch(/→ en curso {16}700 tok$/)
})

test('según el ancho: todo en una línea, dos filas o tres', async ($, on) => {
  const { start, prompt, spawn, ask, end, clock } = world($, on)
  await start()
  await prompt('tarea')
  await spawn('a1')
  await ask(usage(18_420, 0, 0, 0), 'a1')
  await clock.advance(7_000)
  await end('a1', 'error')
  const horas = `✗ ${hora(NOW)} → ${hora(NOW + 7_000)}`

  expect((await lines($, 100)).slice(2)).toEqual([
    `${horas}       7s    18.420 tok  Explore · buscar hooks · haiku-5-5`,
  ])
  expect((await lines($, 44)).slice(2)).toEqual([
    `${horas}       7s    18.420 tok`,
    '  Explore · buscar hooks · haiku-5-5',
  ])
  expect((await lines($, 30)).slice(2)).toEqual([
    horas,
    '  7s    18.420 tok',
    '  Explore · buscar hooks · haiku-5-5',
  ])
})

test('el comando abre, cierra y vacía; cerrado no vuelve a abrirse solo', async ($, on) => {
  const { start, prompt, spawn, slash, opened, closed, settle } = world($, on)
  await start()
  await prompt('tarea')
  await spawn('a1')
  await settle()
  expect(opened).toEqual(['agentes'])
  // Abierto ya, otro agente no lo toca.
  await spawn('a2')
  await settle()
  expect(opened).toHaveLength(1)

  expect((await slash('cerrar')).text).toContain('cerrado')
  expect(closed).toContain('agentes')
  await spawn('a3')
  await settle()
  expect(opened).toHaveLength(1)

  expect((await slash('')).text).toBe('Panel de agentes abierto.')
  expect(opened).toEqual(['agentes', 'agentes'])
  expect(await lines($)).toHaveLength(2 + 3 * 2)

  expect((await slash('limpiar')).text).toBe('Registro de agentes y plan de tareas vaciados.')
  expect(await lines($)).toEqual(['Sin agentes todavía.'])
  expect((await slash('otra cosa')).text).toContain('Uso: /agentes')
})

test('en una sesión sin terminal registra pero no abre panel', async ($, on) => {
  const { start, prompt, spawn, opened } = world($, on)
  await start(false)
  await prompt('tarea')
  await spawn('a1')

  expect(opened).toEqual([])
  expect(await lines($)).toHaveLength(4)
})

// La pestaña Enrutadores tal como se dibuja.
const routes = async <P extends 'terminal' | 'mobile'>($: Engine, surface: P, bodyColumns = 48) => {
  await $.command.run({
    command: 'agentes',
    args: 'rutas',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 160 },
  })

  return $.ui.mount({
    plugin: 'tokens-sesion',
    component: 'Pane',
    requestId: 'agentes',
    surface,
    props: {
      title: 'Agentes',
      isFocused: false,
      bodyColumns,
      placement: 'dock',
      scroll: { offset: 0, bodyRows: 40 },
      view: {},
    },
  })
}

test('la tabla tiene una fila por tipo del motor, por cada tipo ofrecido y la de los demás', async ($, on) => {
  const { start } = world($, on)
  await start()
  await $.agent.offer({
    agent: 'superpowers:code-reviewer',
    description: 'revisa',
    source: 'plugin',
    provider: { plugin: 'superpowers', tier: 'user' },
  })
  await $.agent.offer({
    agent: 'Explore',
    description: 'busca',
    source: 'built-in',
    provider: { plugin: 'engine', tier: 'core' },
  })

  const ui = await routes($, 'terminal')
  const selects = await ui.findAll({ type: 'Select' })
  expect(selects.map(select => select.key)).toEqual(
    ['Explore', 'Plan', 'general-purpose', 'claude', 'claude-code-guide', 'superpowers:code-reviewer', '*'].flatMap(
      tipo => [`modelo:${tipo}`, `esfuerzo:${tipo}`],
    ),
  )
  expect(selects.every(select => select.props.value === 'heredar')).toBe(true)
  expect((await ui.find({ key: 'modelo:Plan' }))?.props.options).toEqual(
    ['heredar', 'haiku', 'sonnet', 'opus', 'fable'].map(value => ({ value })),
  )
  expect((await ui.find({ key: 'esfuerzo:Plan' }))?.props.options).toEqual(
    ['heredar', 'low', 'medium', 'high', 'xhigh', 'max'].map(value => ({ value })),
  )
  expect(await ui.find({ type: 'Text', text: 'Los demás' })).toBeDefined()
  await ui.unmount()
})

test('el modelo elegido para un tipo se pone al arrancar sus agentes y se guarda para otras sesiones', async ($, on) => {
  const { start, prompt, spawn, spawns, store, settle } = world($, on)
  await start()
  await prompt('tarea')
  const ui = await routes($, 'terminal')
  await ui.select({ key: 'modelo:Explore', value: 'haiku' })
  await ui.select({ key: 'esfuerzo:*', value: 'high' })
  await ui.select({ key: 'modelo:*', value: 'sonnet' })
  await settle()

  expect(store.rutas).toEqual({
    Explore: { modelo: 'haiku', esfuerzo: 'heredar' },
    '*': { modelo: 'sonnet', esfuerzo: 'high' },
  })
  expect((await ui.find({ key: 'modelo:Explore' }))?.props.value).toBe('haiku')

  await spawn('a1')
  // Manda sobre el modelo que pida la llamada.
  await spawn('a2', { model: 'opus' })
  // Un tipo sin fila propia va por la de los demás.
  await spawn('a3', { subagentType: 'mi-agente' })
  // A un fork y a los agentes de un workflow no se les cambia.
  await spawn('a4', { subagentType: 'fork', fork: true })
  await spawn('a5', { workflow: { runId: 'wf_1', agentIndex: 1 }, model: 'opus' })
  expect(spawns.map(input => input.model)).toEqual(['haiku', 'haiku', 'sonnet', undefined, 'opus'])

  // El tipo nuevo ya tiene fila; el fork, no.
  const keys = (await ui.findAll({ type: 'Select' })).map(select => select.key)
  expect(keys).toContain('modelo:mi-agente')
  expect(keys).not.toContain('modelo:fork')

  // Volver a heredar las dos cosas quita la fila de lo guardado.
  await ui.select({ key: 'modelo:Explore', value: 'heredar' })
  await settle()
  expect(store.rutas).toEqual({ '*': { modelo: 'sonnet', esfuerzo: 'high' } })
  await ui.unmount()
})

test('el esfuerzo elegido va en cada petición del agente, donde el modelo lo admite', async ($, on) => {
  const { start, prompt, spawn, ask, steps, state, settle } = world($, on, {
    rutas: { Explore: { modelo: 'heredar', esfuerzo: 'low' }, roto: { modelo: 'gpt', esfuerzo: 'low' } },
  })
  await start()
  await prompt('tarea')
  await spawn('a1')
  await spawn('a2', { subagentType: 'Plan' })

  state.effort = 'high'
  await ask(usage(100, 0, 0, 0), 'a1')
  await ask(usage(100, 0, 0, 0), 'a2')
  // El hilo principal y los ids que no son agentes van como iban.
  await ask(usage(100, 0, 0, 0))
  await ask(usage(100, 0, 0, 0), 'compactacion')
  // Un modelo sin esfuerzo no recibe ninguno.
  state.effort = undefined
  await ask(usage(100, 0, 0, 0), 'a1')
  // La primera petición de un agente puede salir antes de que su arranque quede anotado: el tipo lo da el motor.
  state.effort = 'high'
  state.listed = [['a7', 'Explore'], ['a8', 'fork']]
  await ask(usage(100, 0, 0, 0), 'a7')
  await ask(usage(100, 0, 0, 0), 'a8')
  // A los agentes de un workflow tampoco se les cambia el esfuerzo.
  await spawn('a9', { workflow: { runId: 'wf_1', agentIndex: 1 } })
  await ask(usage(100, 0, 0, 0), 'a9')
  expect(steps).toEqual(['low', 'high', 'high', 'high', undefined, 'low', 'high', 'high'])

  const drawn = await lines($)
  expect(drawn[3]).toBe('  Explore · buscar hooks · haiku-5-5')
  expect(drawn[5]).toBe('  Plan · buscar hooks · haiku-5-5 · high')

  // Lo guardado que hoy no se puede elegir no cuenta.
  const ui = await routes($, 'terminal')
  expect((await ui.find({ key: 'esfuerzo:Explore' }))?.props.value).toBe('low')
  expect(await ui.find({ key: 'modelo:roto' })).toBeUndefined()
  await settle()
  await ui.unmount()
})

test('los botones ponen las rutas recomendadas o lo dejan todo heredado; al pie, los tokens por modelo', async ($, on) => {
  const { start, prompt, spawn, ask, store, settle } = world($, on)
  await start()
  await prompt('tarea')
  const ui = await routes($, 'terminal')
  expect(await ui.find({ type: 'Text', text: 'Sin agentes todavía.' })).toBeDefined()

  await ui.press({ key: 'recomendadas' })
  await settle()
  expect(store.rutas).toEqual({
    Explore: { modelo: 'haiku', esfuerzo: 'low' },
    Plan: { modelo: 'opus', esfuerzo: 'high' },
    'general-purpose': { modelo: 'sonnet', esfuerzo: 'medium' },
    'claude-code-guide': { modelo: 'haiku', esfuerzo: 'low' },
  })
  expect((await ui.find({ key: 'modelo:Plan' }))?.props.value).toBe('opus')

  await spawn('a1')
  await ask(usage(51_200, 0, 0, 0), 'a1')
  expect(await ui.find({ type: 'Text', text: 'haiku-5-5 51.200' })).toBeDefined()

  await ui.press({ key: 'heredar' })
  await settle()
  expect(store.rutas).toEqual({})
  expect((await ui.find({ key: 'modelo:Plan' }))?.props.value).toBe('heredar')
  await ui.unmount()
})

test('en el móvil, sin selectores, la tabla se lee', async ($, on) => {
  const { start } = world($, on, { rutas: { '*': { modelo: 'sonnet', esfuerzo: 'heredar' } } })
  await start()
  const ui = await routes($, 'mobile')

  expect(await ui.findAll({ type: 'Select' })).toEqual([])
  expect(await ui.find({ type: 'Text', text: 'Explore: sonnet · heredar' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Los demás: sonnet · heredar' })).toBeDefined()
  await ui.unmount()
})

test('un solo panel con sus pestañas: el botón de cada una enseña la suya, y /agentes rutas abre en Enrutadores', async ($, on) => {
  const { start, prompt, spawn, slash, opened, closed, settle } = world($, on)
  await start()
  await settle()
  expect(closed).toEqual([])
  await prompt('tarea')
  await spawn('a1')
  await settle()
  expect(opened).toEqual(['agentes'])

  const ui = await $.ui.mount({
    plugin: 'tokens-sesion',
    component: 'Pane',
    requestId: 'agentes',
    surface: 'terminal',
    props: {
      title: 'Agentes',
      isFocused: false,
      bodyColumns: 48,
      placement: 'dock',
      scroll: { offset: 0, bodyRows: 40 },
      view: {},
    },
  })
  const tabs = async () =>
    (await ui.findAll({ type: 'Button' }))
      .filter(button => button.key?.startsWith('pestana:'))
      .map(button => [button.props.label, button.props.variant])

  expect(await tabs()).toEqual([
    ['Agentes', 'primary'],
    ['Tareas', 'secondary'],
    ['Enrutadores', 'secondary'],
  ])
  expect(await ui.find({ type: 'Text', text: 'Tarea 1' })).toBeDefined()
  expect(await ui.findAll({ type: 'Select' })).toEqual([])

  await ui.press({ key: 'pestana:enrutadores' })
  await settle()
  expect(await tabs()).toEqual([
    ['Agentes', 'secondary'],
    ['Tareas', 'secondary'],
    ['Enrutadores', 'primary'],
  ])
  expect(await ui.find({ type: 'Text', text: 'Tarea 1' })).toBeUndefined()
  expect(await ui.find({ key: 'modelo:Explore' })).toBeDefined()

  await ui.press({ key: 'pestana:agentes' })
  await settle()
  expect(await ui.find({ type: 'Text', text: 'Tarea 1' })).toBeDefined()

  // El comando abre el mismo panel en la pestaña pedida; sin argumentos, en la que estaba.
  await slash('rutas')
  expect(await ui.find({ key: 'modelo:Explore' })).toBeDefined()
  await slash('')
  expect(await ui.find({ key: 'modelo:Explore' })).toBeDefined()
  expect(opened).toEqual(['agentes', 'agentes', 'agentes'])
  await ui.unmount()
})

// La pestaña Tareas tal como se dibuja, línea a línea.
const plan = async ($: Engine, bodyColumns = 48): Promise<string[]> => {
  await $.command.run({
    command: 'agentes',
    args: 'tareas',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 160 },
  })

  return lines($, bodyColumns)
}

const hhmm = (ms: number) => hora(ms).slice(0, 5)

test('sin plan la pestaña Tareas lo dice', async ($, on) => {
  const { start } = world($, on)
  await start()

  expect(await plan($)).toEqual(['Sin plan todavía.', 'Aparece cuando Claude reparte el trabajo en pasos.'])
})

test('la lista de tareas del motor se ve con sus tres estados, la hora y lo que tardó cada paso', async ($, on) => {
  const { start, clock, todo } = world($, on)
  await start()
  await todo([
    ['Leer el código', 'in_progress'],
    ['Escribir la pestaña', 'pending'],
    ['Probar', 'pending'],
  ])
  expect(await plan($)).toEqual([
    '░'.repeat(20) + ' 0/3',
    '✓ 0 hechas · ● 1 en curso · ○ 2 pendientes',
    ' ',
    '● Leer el código',
    `  ${hhmm(NOW)} → en curso`,
    '○ Escribir la pestaña',
    '○ Probar',
  ])

  await clock.advance(125_000)
  await todo([
    ['Leer el código', 'completed'],
    ['Escribir la pestaña', 'in_progress'],
    ['Probar', 'pending'],
  ])
  await clock.advance(60_000)
  // Lo que anota un subagente en su propia lista no es el plan.
  await todo([['cosa del subagente', 'in_progress']], 'a1')
  // Un paso que vuelve a pendiente guarda lo que llevaba; uno hecho sin pasar por en curso no tiene duración.
  await todo([
    ['Leer el código', 'completed'],
    ['Escribir la pestaña', 'pending'],
    ['Probar', 'completed'],
  ])

  expect(await plan($)).toEqual([
    '█'.repeat(13) + '░'.repeat(7) + ' 2/3 · 3m05s',
    '✓ 2 hechas · ● 0 en curso · ○ 1 pendientes',
    ' ',
    '✓ Leer el código',
    `  ${hhmm(NOW)} → ${hhmm(NOW + 125_000)}   2m05s`,
    '○ Escribir la pestaña',
    '  pausado  1m00s',
    '✓ Probar',
    `  hecho ${hhmm(NOW + 185_000)}`,
  ])

  // Con sitio, el paso y su tiempo van en una fila.
  expect((await plan($, 100))[3]).toBe(
    `✓ Leer el código ${`${hhmm(NOW)} → ${hhmm(NOW + 125_000)}   2m05s`.padStart(23)}`,
  )
})

test('cada estado va con su color: verde lo hecho, amarillo lo que está en curso y gris lo pendiente', async ($, on) => {
  const { start, todo, slash } = world($, on)
  await start()
  await todo([
    ['uno', 'completed'],
    ['dos', 'in_progress'],
    ['tres', 'pending'],
  ])
  await slash('tareas')
  const ui = await $.ui.mount({
    plugin: 'tokens-sesion',
    component: 'Pane',
    requestId: 'agentes',
    surface: 'terminal',
    props: {
      title: 'Agentes',
      isFocused: false,
      bodyColumns: 48,
      placement: 'dock',
      scroll: { offset: 0, bodyRows: 40 },
      view: {},
    },
  })
  const color = async (text: string) =>
    (await ui.findAll({ type: 'Text' })).find(one => one.text === text)?.props

  expect(await color('uno')).toMatchObject({ color: 'success', strikethrough: true })
  expect(await color('dos')).toMatchObject({ color: 'warning', bold: true })
  expect(await color('tres')).toMatchObject({ color: 'inactive' })
  expect(
    (await ui.findAll({ type: 'Button' }))
      .filter(button => button.key?.startsWith('pestana:'))
      .map(button => [button.props.label, button.props.variant]),
  ).toEqual([
    ['Agentes', 'secondary'],
    ['Tareas', 'primary'],
    ['Enrutadores', 'secondary'],
  ])
  await ui.unmount()
})

test('las tareas creadas y actualizadas de una en una también forman el plan', async ($, on) => {
  const { start, clock, state, slash } = world($, on)
  await start()
  state.taskId = '7'
  await $.tool.call({ tool: 'TaskCreate', subject: 'Migrar la base', description: 'x' })
  state.taskId = '8'
  await $.tool.call({ tool: 'TaskCreate', subject: 'Avisar al equipo', description: 'x' })
  await $.tool.call({ tool: 'TaskUpdate', taskId: '7', status: 'in_progress' })
  await clock.advance(42_000)
  await $.tool.call({ tool: 'TaskUpdate', taskId: '7', status: 'completed', subject: 'Migrar la base de datos' })
  await $.tool.call({ tool: 'TaskUpdate', taskId: '8', status: 'deleted' })
  // Una tarea de antes de cargar el mod entra con su primera actualización.
  await $.tool.call({ tool: 'TaskUpdate', taskId: '3', status: 'in_progress' })

  expect((await plan($)).slice(3)).toEqual([
    '✓ Migrar la base de datos',
    `  ${hhmm(NOW)} → ${hhmm(NOW + 42_000)}     42s`,
    '● Tarea 3',
    `  ${hhmm(NOW + 42_000)} → en curso`,
  ])

  expect((await slash('limpiar')).text).toBe('Registro de agentes y plan de tareas vaciados.')
  expect((await plan($))[0]).toBe('Sin plan todavía.')
})

test('donde el modelo no tiene lista de tareas, el mod le da la herramienta del plan y se lo dice en el prompt', async ($, on) => {
  const { start, state, tools, clock } = world($, on)
  state.builtin = []
  await start()
  expect(tools).toEqual(['plan'])

  const compose = (offered: string[]) =>
    $.prompt.compose({
      model: 'claude-opus-5-5',
      promptModel: 'claude-opus-5-5',
      surfaces: ['terminal'],
      tools: offered,
      outputStyle: null,
      traits: [],
    })
  expect((await compose(['Read', 'mcp__tokens-sesion__plan'])).sections.map(section => section.id)).toEqual([
    'intro',
    'tokens-sesion:plan',
  ])
  expect((await compose(['Read'])).sections.map(section => section.id)).toEqual(['intro'])

  const call = (pasos: unknown) => $.tool.call({ tool: 'mcp__tokens-sesion__plan', pasos })
  expect((await call([{ texto: 'Medir', estado: 'en_curso' }, { texto: 'Arreglar', estado: 'pendiente' }])).result).toBe(
    'Plan guardado: 0 de 2 pasos hechos.',
  )
  await clock.advance(9_000)
  await call([{ texto: 'Medir', estado: 'hecho' }, { texto: 'Arreglar', estado: 'en_curso' }])
  // Lo que no vale no se guarda, y el modelo lee por qué.
  expect((await call([{ texto: 'Medir', estado: 'casi' }])).result).toContain('No guardado')
  expect((await call('todo')).result).toContain('No guardado')

  expect((await plan($)).slice(3)).toEqual([
    '✓ Medir',
    `  ${hhmm(NOW)} → ${hhmm(NOW + 9_000)}      9s`,
    '● Arreglar',
    `  ${hhmm(NOW + 9_000)} → en curso`,
  ])
})

test('con la lista de tareas del motor, o sin nadie delante, no se añade la herramienta del plan', async ($, on) => {
  const first = world($, on)
  await first.start()
  expect(first.tools).toEqual([])

  first.state.builtin = []
  await first.start(false)
  expect(first.tools).toEqual([])
})
