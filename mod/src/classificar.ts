import type { Classificacao, Esforco, Falta, Importancia, TipoEspera } from '../types'

export const MODELO = 'claude-haiku-5-5'

const TIPOS: TipoEspera[] = ['aprovacao', 'decisao', 'revisao', 'info']
const ESFORCOS: Esforco[] = ['segundos', 'minutos', 'longo']

export const SISTEMA = `Classificas o que um chat de trabalho precisa da pessoa, agora que acabou um turno, e resumes onde o trabalho está.
Responde só com JSON, sem texto à volta, neste formato:
{"importancia":1,"tipo":"aprovacao|decisao|revisao|info","esforco":"segundos|minutos|longo","desbloqueia":true,"rotulo":"até 4 palavras","cartao":{"pediste":"até 10 palavras","fez":"até 10 palavras","precisa":"até 18 palavras"},"feito":["até 10 palavras"],"falta":[{"texto":"até 10 palavras","prioridade":1}],"lembrete":null,"precisaDeTi":true,"resumoFim":"1 a 2 frases"}
importancia vai de 1 a 5 e é da tarefa concreta, não do projeto: produção, dados de clientes, prazos e bloqueios sobem; estilo, curiosidade e informação descem.
desbloqueia é true quando a resposta da pessoa põe o chat a trabalhar outra vez.
esforco é o tempo que a pessoa demora a responder.
feito é o que ficou concluído neste turno (não o que foi só tentado), no máximo 3 coisas; [] se nada ficou concluído.
falta é o que ainda falta fazer neste trabalho, no máximo 4 coisas, da mais para a menos importante agora, incluindo o que só a pessoa pode fazer; [] se nada falta. prioridade vai de 1 a 5: 5 é para já (bloqueia, tem prazo ou é produção), 1 pode esperar.
lembrete é só para quando a própria pessoa, no pedido, deixou algo para mais tarde: disse que faz depois, pediu para a lembrarem ou adiou uma decisão. Que o chat precise dela não chega (isso já fica na espera). Nesse caso {"texto":"1 a 2 frases simples","dias":2}; senão null. texto fala com a pessoa por «tu», diz o que ficou por fazer, em que projeto e porque importa, sem nomes de ficheiros, comandos nem jargão (ex.: «Ficaste de escolher a música dos anúncios da loja online: grátis da Meta ou paga da Epidemic. Sem isso os vídeos não saem.»). dias: 1 se disse amanhã, 7 se disse para a semana, 2 se não disse quando; no máximo 30.
cartao.precisa é uma instrução concreta, a falar com a pessoa por «tu», do que ela tem de fazer para o chat avançar (ex.: «Escolhe entre a música grátis da Meta e a paga da Epidemic Sound»; «Testa no telemóvel a página das datas e diz se está bem»), sem jargão nem nomes de ficheiros.
precisaDeTi é true só quando o chat parou porque precisa de algo da pessoa para continuar ou acabar (uma resposta, uma decisão, uma aprovação, um teste à mão, um acesso). É false quando terminou o que lhe pediram e só fica a informar, mesmo que o trabalho todo ainda tenha mais partes por fazer.
resumoFim fala com a pessoa por «tu», em 1 a 2 frases simples e sem jargão, para ela se situar sem abrir o chat: começa pelo trabalho em si (o que o chat estava a fazer e para quê), depois diz onde ficou e, se o trabalho todo ainda tem mais partes, o que falta (ex.: «Estava a adaptar o site da clínica ao telemóvel. Ficou pronta a página das datas-limite; faltam a do calendário e a das notificações.»).
Escreve em português de Portugal.`

export function montarPrompt(projeto: string, pedido: string, resposta: string): string {
  return `Projeto: ${projeto}\n\nPedido da pessoa:\n${pedido.slice(0, 2000)}\n\nÚltima resposta do chat:\n${resposta.slice(-4000)}`
}

const limitarPrioridade = (n: number): Importancia => Math.min(5, Math.max(1, Math.round(n))) as Importancia

function lerFeito(bruto: unknown): string[] {
  if (!Array.isArray(bruto)) return []

  return bruto.map(x => String(x ?? '').replace(/\s+/g, ' ').trim().slice(0, 100)).filter(Boolean).slice(0, 3)
}

function lerFalta(bruto: unknown): Falta[] {
  if (!Array.isArray(bruto)) return []
  const lista: Falta[] = []
  for (const x of bruto) {
    const texto = String((x as { texto?: unknown } | undefined)?.texto ?? (typeof x === 'string' ? x : '')).replace(/\s+/g, ' ').trim().slice(0, 100)
    if (!texto) continue
    const prioridade = Number((x as { prioridade?: unknown } | undefined)?.prioridade)
    lista.push({ texto, prioridade: limitarPrioridade(Number.isFinite(prioridade) ? prioridade : 3) })
  }

  return lista.slice(0, 4)
}

function lerLembrete(bruto: unknown): { texto: string; dias: number } | null {
  const texto = String((bruto as { texto?: unknown } | null | undefined)?.texto ?? '').replace(/\s+/g, ' ').trim().slice(0, 300)
  if (!texto) return null
  const dias = Number((bruto as { dias?: unknown }).dias)

  return { texto, dias: Number.isFinite(dias) ? Math.min(30, Math.max(0.5, dias)) : 2 }
}

export function lerClassificacao(texto: string): Classificacao | undefined {
  const inicio = texto.indexOf('{')
  const fim = texto.lastIndexOf('}')
  if (inicio < 0 || fim <= inicio) return undefined
  let bruto: Record<string, any>
  try {
    bruto = JSON.parse(texto.slice(inicio, fim + 1))
  } catch {
    return undefined
  }
  const importancia = Math.round(Number(bruto.importancia))
  if (!Number.isFinite(importancia)) return undefined
  const cartao = bruto.cartao ?? {}

  return {
    importancia: Math.min(5, Math.max(1, importancia)) as Importancia,
    tipo: TIPOS.includes(bruto.tipo) ? bruto.tipo : 'info',
    esforco: ESFORCOS.includes(bruto.esforco) ? bruto.esforco : 'minutos',
    desbloqueia: bruto.desbloqueia === true,
    rotulo: String(bruto.rotulo ?? '').slice(0, 40),
    cartao: {
      pediste: String(cartao.pediste ?? '').slice(0, 80),
      fez: String(cartao.fez ?? '').slice(0, 80),
      precisa: String(cartao.precisa ?? '').slice(0, 160),
    },
    // Só vêm se o modelo os devolveu: sem eles a situação do chat fica como estava.
    ...(Array.isArray(bruto.feito) ? { feito: lerFeito(bruto.feito) } : {}),
    ...(Array.isArray(bruto.falta) ? { falta: lerFalta(bruto.falta) } : {}),
    lembrete: lerLembrete(bruto.lembrete),
    ...(typeof bruto.precisaDeTi === 'boolean' ? { precisaDeTi: bruto.precisaDeTi } : {}),
    ...(bruto.resumoFim ? { resumoFim: String(bruto.resumoFim).replace(/\s+/g, ' ').trim().slice(0, 300) } : {}),
  }
}
