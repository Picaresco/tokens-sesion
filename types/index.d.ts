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

// Un paso del plan: `ms` es lo que lleva en curso ya cerrado y `desde`, cuándo entró en curso la última vez.
export type Paso = {
  id: string
  texto: string
  estado: 'pendiente' | 'en curso' | 'hecho'
  inicio: number | null
  fin: number | null
  ms: number
  desde: number | null
}

// Una compactación de la sesión: lo que medía el contexto antes y después, y dónde quedó su resumen.
export type Compactacion = {
  hora: number
  antes: number | null
  despues: number | null
  fichero: string | null
}

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
      pestana: 'agentes' | 'tareas' | 'enrutadores' | 'sesion'
      deAgentes: number
      cincoHoras: { pct: number; renueva: string | null } | null
      compactaciones: Compactacion[]
      nacida: number | null
      historico: string | null
      pasos: Paso[]
    }
  }
}
