import type { Classificacao, Foco, Item, Vista } from '../types'
import { inicioDaSessao, separar, VALIDADE_MS } from './janela'
import { ordenar } from './ranker'

// Um chat fechado a meio de um turno nunca chega a "a-espera"; passado este tempo deixa de contar.
export const TRABALHO_MAX_MS = 3 * 3_600_000

export type Entrada = {
  itens: Item[]
  dispensados: Record<string, number>
  foco?: Foco
  propria: string
  agora: number
}

// Um chat parado a meio do turno à espera da pessoa (pergunta, plano, permissão) conta como à espera, à
// frente: a classificação que ele traz é a do turno anterior, por isso troca-se pelo que o parou.
const parado = (item: Item) => item.estado === 'a-trabalhar' && item.progresso?.bloqueio !== undefined

function comoEspera(item: Item): Item {
  const bloqueio = item.progresso!.bloqueio!
  const classificacao: Classificacao = {
    importancia: 5,
    tipo: 'decisao',
    esforco: 'segundos',
    desbloqueia: true,
    rotulo: 'Parado à tua espera',
    cartao: { pediste: (item.pedido ?? '').slice(0, 80), fez: item.progresso?.resumo?.agora ?? '', precisa: bloqueio.texto },
  }

  return { ...item, classificacao }
}

export function montarVista({ itens, dispensados, foco, propria, agora }: Entrada): Vista {
  const validos = itens.filter(item => agora - item.desde < VALIDADE_MS).map(item => (parado(item) && agora - item.desde < TRABALHO_MAX_MS ? comoEspera(item) : item))
  // Um chat que acabou sem precisar de nada da pessoa (a IA disse precisaDeTi: false) não a chama: o gestor
  // mostra-o em «Terminou».
  const aEspera = validos.filter(
    item =>
      (item.estado === 'a-espera' || parado(item)) &&
      item.sessao !== propria &&
      dispensados[item.sessao] !== item.desde &&
      item.classificacao?.precisaDeTi !== false,
  )
  const focado = foco ? validos.find(item => item.sessao === foco.sessao) : undefined
  const focoImportancia = focado?.classificacao?.importancia
  const linhas = ordenar(aEspera, focoImportancia, agora)
  const atividade = [...validos.map(item => item.desde), ...(foco ? [foco.em] : [])]
  const { fila, antigos } = separar(linhas, inicioDaSessao(atividade, agora))

  return {
    fila,
    antigos,
    aTrabalhar: validos.filter(item => item.estado === 'a-trabalhar' && !parado(item) && agora - item.desde < TRABALHO_MAX_MS).length,
    foco:
      focado && focoImportancia !== undefined && focoImportancia >= 4
        ? { titulo: focado.titulo, importancia: focoImportancia }
        : undefined,
    calculadaEm: agora,
  }
}
