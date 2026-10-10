export type Agente = {
  id: string
  tipo: string
  nombre: string | null
  descripcion: string
  modelo: string
  tarea: number
  inicio: number
  fin: number | null
  estado: 'en curso' | 'ok' | 'abortado' | 'error'
  tokens: number
  esfuerzo: string | null
  hereda: boolean
}

export type Tarea = { n: number; inicio: number; texto: string }

// El modelo y el esfuerzo que se da a un tipo de agente; `heredar` deja lo que el motor decida.
export type Ruta = { modelo: string; esfuerzo: string }

declare module 'claude-code' {
  interface PluginState {
    'tokens-sesion': {
      gastados: number
      contexto: number | null
      resumen: string | null
      umbral: number
      efectivo: number
      maximo: number
      sinRaton: boolean
      uso: { cpu: number; ram: number } | null
      semana: { pct: number; renueva: string | null } | null
      porModelo: { nombre: string; pct: number; renueva: string | null }[]
      agentes: Agente[]
      tareas: Tarea[]
      oculto: boolean
      rutas: Record<string, Ruta>
      tipos: string[]
      pestana: 'agentes' | 'enrutadores'
    }
  }
}
