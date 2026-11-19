export type Importancia = 1 | 2 | 3 | 4 | 5
export type TipoEspera = 'aprovacao' | 'decisao' | 'revisao' | 'info'
export type Esforco = 'segundos' | 'minutos' | 'longo'

// O que ainda falta fazer num chat, com a prioridade de agora (5 = para já, 1 = pode esperar).
export type Falta = { texto: string; prioridade: Importancia }

export type Classificacao = {
  importancia: Importancia
  tipo: TipoEspera
  esforco: Esforco
  desbloqueia: boolean
  rotulo: string
  cartao: { pediste: string; fez: string; precisa: string }
  // O que ficou concluído neste turno e o que ainda falta: alimentam a situação do projeto.
  feito?: string[]
  falta?: Falta[]
  // Algo que ficou para depois (a pessoa disse «depois faço», «lembra-me»…): volta daqui a `dias`.
  lembrete?: { texto: string; dias: number } | null
  // false quando o chat acabou o turno sem precisar de nada da pessoa: vai para «Terminou», não para a espera.
  precisaDeTi?: boolean
  // 1 a 2 frases simples: o que o turno terminou e o que ainda falta no trabalho todo.
  resumoFim?: string
}

// Um lembrete (lembretes/<sessão>.json): escrito pelo mod quando a IA vê que algo ficou para depois;
// o gestor mostra-o na espera a partir de `quando` e marca `feitoEm` ou adia. `resolvidoEm`: a pessoa
// voltou ao chat antes e o assunto deixou de estar pendente.
export type Lembrete = {
  id: string
  sessao: string
  local?: string
  projeto: string
  titulo: string
  texto: string
  criadoEm: number
  quando: number
  feitoEm?: number
  resolvidoEm?: number
}

export type Feito = { texto: string; em: number }

// A situação de um chat (situacao/<sessão>.json): ao contrário do item da fila não expira, e o
// que ficou feito acumula-se de turno para turno. O gestor junta-as por projeto.
export type Situacao = {
  sessao: string
  local?: string
  titulo: string
  projeto: string
  em: number
  feito: Feito[]
  falta: Falta[]
}

export type EstadoItem = 'a-trabalhar' | 'a-espera'

export type Passo = { texto: string; estado: 'pending' | 'in_progress' | 'completed' }

// O resumo da IA enquanto o chat trabalha (src/resumo.ts) e o que o parou à espera da pessoa a meio do
// turno (uma pergunta, um plano, uma permissão).
export type Resumo = { titulo: string; agora: string; precisa: string; em: number }
export type Bloqueio = { texto: string; desde: number }

export type Progresso = { passos: Passo[]; ferramentas: number; ultima?: string; resumo?: Resumo; bloqueio?: Bloqueio }

export type Item = {
  sessao: string
  local?: string
  titulo: string
  projeto: string
  estado: EstadoItem
  desde: number
  classificacao?: Classificacao
  pedido?: string
  progresso?: Progresso
  // O título que a IA deu ao trabalho (fica de turno para turno; o nome do chat é o `titulo`).
  tituloIA?: string
}

export type Trabalho = {
  sessao: string
  local?: string
  titulo: string
  projeto: string
  desde: number
  pedido: string
  feitos: number
  total: number
  atual?: string
  ferramentas: number
  ultima?: string
  tituloIA?: string
  agora?: string
  precisa?: string
  resumoEm?: number
  bloqueio?: Bloqueio
}

export type Foco = { sessao: string; em: number }

export type Linha = {
  sessao: string
  local?: string
  titulo: string
  projeto: string
  desde: number
  classificacao?: Classificacao
  pontos: number
  silenciado: boolean
}

export type Vista = {
  fila: Linha[]
  antigos: Linha[]
  aTrabalhar: number
  foco?: { titulo: string; importancia: number }
  calculadaEm: number
}
