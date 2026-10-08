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
    }
  }
}
