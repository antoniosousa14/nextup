import type { Bloqueio, Passo, Resumo } from '../types'
import { limparPedido } from './pedido'

// Enquanto um chat trabalha, a IA (Haiku) resume-o em linguagem simples para o gestor: um título que
// explique o trabalho (os nomes dos chats esquecem-se), o que está a fazer neste momento e o que vai
// precisar da pessoa. Corre no máximo a cada INTERVALO_RESUMO_MS e logo que o passo do plano muda.
export const INTERVALO_RESUMO_MS = 30_000
export const MAX_ACOES = 8
export const MAX_PEDIDOS = 4

export const SISTEMA_RESUMO = `Resumes, para a pessoa que manda num chat de trabalho, o que esse chat está a fazer agora, enquanto trabalha sozinho.
Responde só com JSON, sem texto à volta, neste formato:
{"titulo":"até 8 palavras","agora":"até 14 palavras","precisa":"até 12 palavras"}
titulo explica o trabalho todo para a pessoa o reconhecer sem se lembrar do nome do chat: começa pelo objeto e diz o objetivo (ex.: «NextUp: mostrar no painel o que cada chat faz»). Tira-o do que a pessoa pediu e do que o chat está de facto a fazer (pedidos, plano, ações, texto), nunca de suposições. Se houver título anterior, repete-o igual só se bater certo com isso; se não bater, escreve um novo.
agora é o que o chat está a fazer neste preciso momento, em linguagem simples, sem nomes de ferramentas (nada de Bash, Grep, browser_batch): o que está a ler, a mudar, a testar ou a decidir, e porquê.
precisa é o que vai precisar da pessoa neste trabalho (decidir, aprovar, testar à mão, dar um acesso) e quando; se não vai precisar de nada até acabar, escreve «Nada por agora».
Escreve em português de Portugal, sem rodeios.`

export type EntradaResumo = {
  projeto: string
  tituloAnterior?: string
  // Os últimos pedidos da pessoa neste chat, do mais antigo para o mais recente (o último é o deste turno).
  pedidos: string[]
  passos: Passo[]
  acoes: string[]
  ultimoTexto: string
}

const MARCA = { completed: '[x]', in_progress: '[>]', pending: '[ ]' } as const

export function montarPromptResumo(e: EntradaResumo): string {
  const plano = e.passos.length ? e.passos.map(p => `${MARCA[p.estado]} ${p.texto}`).join('\n') : '(sem plano)'
  const acoes = e.acoes.length ? e.acoes.map(a => `- ${a}`).join('\n') : '(ainda nenhuma)'

  return [
    `Projeto: ${e.projeto}`,
    `Título anterior: ${e.tituloAnterior || '(nenhum)'}`,
    `Últimos pedidos da pessoa (o último é o de agora):\n${e.pedidos.length ? e.pedidos.map(p => `- ${p}`).join('\n') : '(nenhum)'}`,
    `Plano do chat ([x] feito, [>] a fazer agora):\n${plano}`,
    `Últimas ações (da mais antiga para a mais recente):\n${acoes}`,
    `Última coisa que o chat escreveu (no início do turno é a resposta ao pedido anterior):\n${e.ultimoTexto.slice(-1500) || '(nada)'}`,
  ].join('\n\n')
}

const limpo = (v: unknown, max: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max)

export function lerResumo(texto: string, em: number): Resumo | undefined {
  const inicio = texto.indexOf('{')
  const fim = texto.lastIndexOf('}')
  if (inicio < 0 || fim <= inicio) return undefined
  let bruto: Record<string, unknown>
  try {
    bruto = JSON.parse(texto.slice(inicio, fim + 1))
  } catch {
    return undefined
  }
  const titulo = limpo(bruto.titulo, 80)
  const agora = limpo(bruto.agora, 140)
  if (!titulo || !agora) return undefined

  return { titulo, agora, precisa: limpo(bruto.precisa, 120) || 'Nada por agora', em }
}

export type UltimoResumo = { em: number; passo?: string; acoes: number }

// Há resumo novo quando ainda não houve nenhum neste turno, quando o passo do plano mudou ou, havendo
// ações novas, quando já passou o intervalo.
export function resumoDevido(ultimo: UltimoResumo | undefined, agora: number, passo: string | undefined, acoes: number): boolean {
  if (!ultimo) return true
  if (acoes <= ultimo.acoes) return false
  if (passo !== ultimo.passo) return true

  return agora - ultimo.em >= INTERVALO_RESUMO_MS
}

// Para a IA: a descrição que o chat deu à ação (o Bash traz uma) vale mais do que o comando.
export function descreverAcao(ferramenta: string, entrada: Record<string, unknown>): string {
  const nome = ferramenta.startsWith('mcp__') ? (ferramenta.split('__').pop() ?? ferramenta) : ferramenta
  const caminho = typeof entrada.file_path === 'string' ? entrada.file_path.split(/[\\/]/).pop() : undefined
  const detalhe = [entrada.description, caminho, entrada.command, entrada.pattern, entrada.url, entrada.query, entrada.prompt].find(
    v => typeof v === 'string' && v.trim() !== '',
  ) as string | undefined

  return limpo(`${nome}: ${detalhe ?? ''}`, 160)
}

export function juntarAcao(acoes: string[], acao: string): string[] {
  return [...acoes, acao].slice(-MAX_ACOES)
}

// Ferramentas que param o chat à espera de uma resposta da pessoa, a meio do turno.
export const FERRAMENTAS_QUE_PERGUNTAM = new Set(['AskUserQuestion', 'ExitPlanMode'])

export function bloqueioDaFerramenta(ferramenta: string, entrada: Record<string, unknown>, desde: number): Bloqueio | undefined {
  if (ferramenta === 'ExitPlanMode') return { texto: 'Aprovar o plano que o chat propôs', desde }
  if (ferramenta !== 'AskUserQuestion') return undefined
  const perguntas = Array.isArray(entrada.questions) ? entrada.questions : []
  const primeira = limpo((perguntas[0] as { question?: unknown } | undefined)?.question, 110)

  return { texto: primeira ? `Responder: ${primeira}` : 'Responder a uma pergunta do chat', desde }
}

// A app pede «permissão» também para as perguntas e para o plano: aí mostra-se a pergunta, não a ferramenta.
export function bloqueioDePermissao(ferramenta: string, entrada: unknown, desde: number): Bloqueio {
  const dados = (entrada ?? {}) as Record<string, unknown>
  const pergunta = bloqueioDaFerramenta(String(ferramenta), dados, desde)
  if (pergunta) return pergunta
  const acao = descreverAcao(String(ferramenta), dados).replace(/:\s*$/, '')

  return { texto: `Dar permissão: ${acao}`.slice(0, 130), desde }
}

// O último texto que o chat escreveu (a mensagem do assistente mais recente que tem texto).
export function ultimoTextoDoChat(mensagens: readonly { role: string; text: string }[]): string {
  for (const m of [...mensagens].reverse()) if (m.role === 'assistant' && m.text.trim()) return m.text

  return ''
}

// Os últimos pedidos da pessoa (mensagens de utilizador com texto, sem os blocos que a app injeta), cada um
// cortado; o pedido deste turno entra no fim se ainda não estiver na transcrição.
export function pedidosRecentes(mensagens: readonly { role: string; text: string }[], atual: string): string[] {
  const corta = (t: string) => limpo(limparPedido(t), 400)
  const lista = mensagens.filter(m => m.role === 'user').map(m => corta(m.text)).filter(Boolean)
  const agora = corta(atual)
  if (agora && lista.at(-1) !== agora) lista.push(agora)

  return lista.slice(-MAX_PEDIDOS)
}
