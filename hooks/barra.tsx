import type { ClientModule } from 'claude-code'

// Lo que el mod le da a la barra: sus celdas sin la marca, dónde está la marca (-1 sin compactado),
// entre qué celdas se puede dejar y el umbral que corresponde a cada una, en número y en texto.
type Props = {
  celdas: { text: string; color: string }[]
  marca: number
  desde: number
  hasta: number
  valores: number[]
  textos: string[]
  color: string
}

// `drag`: la celda de la marca mientras se arrastra. `fijada`: la celda donde se soltó, que vale
// hasta que el mod devuelve props nuevas (`sobre` es la marca que traían las de entonces).
type State = { drag?: number; fijada?: number; sobre?: number }

const Barra: ClientModule<Props, State> = (props, surface) => {
  const { Box, Text } = surface.elements
  const state = surface.state ?? {}
  const quieta =
    state.fijada !== undefined && state.sobre === props.marca ? state.fijada : props.marca
  const marca = state.drag ?? quieta
  const acotar = (x: number): number => Math.max(props.desde, Math.min(props.hasta, x))

  surface.onPointer(event => {
    if (state.drag === undefined) {
      // Solo se agarra la marca: un clic en otro punto de la barra no cambia nada.
      const agarra =
        event.type === 'down' &&
        event.button === 'left' &&
        quieta >= 0 &&
        Math.abs(event.x - quieta) <= 1

      if (agarra) {
        surface.setState({ ...state, drag: acotar(event.x) })
      }
    } else if (event.type === 'move') {
      surface.setState({ ...state, drag: acotar(event.x) })
    } else if (event.type === 'up') {
      const celda = acotar(event.x)
      const umbral = props.valores[celda]

      if (umbral !== undefined) {
        surface.post({ umbral })
      }

      surface.setState({ fijada: celda, sobre: props.marca })
    }
  })

  // Al arrastrar, la cifra va a la derecha de la marca, o a su izquierda si no cabe.
  const cifra = state.drag === undefined ? '' : ` ${props.textos[marca] ?? ''} `
  const inicio =
    marca + 1 + cifra.length <= props.celdas.length ? marca + 1 : marca - cifra.length

  return (
    <Box>
      {props.celdas.map((celda, i) => {
        // En reposo el punto actual tapa la marca; al arrastrar, la marca va por delante.
        if (i === marca && (state.drag !== undefined || celda.text !== '●')) {
          return <Text color={props.color}>┃</Text>
        }

        if (i >= inicio && i < inicio + cifra.length) {
          return <Text inverse>{cifra[i - inicio]}</Text>
        }

        return <Text color={celda.color}>{celda.text}</Text>
      })}
    </Box>
  )
}

export default Barra
