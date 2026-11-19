import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

// O ponto de situação de cada projeto escrito pela IA (mod/src/projetoIA.ts). O gestor não tem acesso ao
// modelo: junta o material de cada projeto num texto, e só quando esse texto muda (outro `hash`) deixa um
// pedido em projetos-ia/<id>.pedido.json; o mod de um chat aberto responde em projetos-ia/<id>.json.
// O material não leva horas nem «há N dias», para o hash só mudar quando muda alguma coisa a sério.

const MAX_CAMPO = 500
const limpo = (t, max = MAX_CAMPO) => String(t ?? '').replace(/\s+/g, ' ').trim().slice(0, max)
const ESTADO = { trabalho: 'a trabalhar agora', espera: 'à espera da pessoa', parado: 'parado' }

// Os nomes dos ficheiros vêm do id do grupo do Claude: só letras, algarismos, «-» e «_».
export const idDoFicheiro = id => String(id ?? '').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 80)

// Sobe quando o formato da resposta da IA muda: o hash muda e todos os projetos são pedidos de novo.
const VERSAO = 2

export function entradaDoProjeto(p) {
  const linhas = [`Projeto: ${limpo(p.nome, 120)} (${limpo(p.caminho, 160)})`]
  const chats = [p.principal, ...(p.outros ?? [])].filter(Boolean)
  chats.forEach((c, i) => {
    linhas.push('', `Chat ${i + 1} (${ESTADO[c.estado] ?? c.estado}${i === 0 ? ', o mais recente' : ''}): ${limpo(c.titulo, 120)}`)
    if (c.pedi) linhas.push(`- A pessoa pediu: ${limpo(c.pedi)}`)
    if (c.respondeu) linhas.push(`- O chat respondeu por último: ${limpo(c.respondeu, 700)}`)
    if (c.precisa) linhas.push(`- Precisa da pessoa: ${limpo(c.precisa)}`)
    if (c.plano?.total) {
      linhas.push(`- Plano: ${c.plano.feitos} de ${c.plano.total} passos feitos${c.plano.atual ? `; parou em «${limpo(c.plano.atual, 160)}»` : ''}`)
      for (const t of (c.plano.faltam ?? []).slice(0, 4)) linhas.push(`  - por fazer: ${limpo(t, 160)}`)
    }
  })
  if (p.feito?.length) {
    linhas.push('', 'Já ficou feito (do mais recente para o mais antigo):')
    for (const f of p.feito.slice(0, 8)) linhas.push(`- ${limpo(f.texto, 160)}${f.origem === 'pessoa' ? ' [a pessoa já fez isto]' : ''}`)
  }
  if (p.porFazer?.length) {
    linhas.push('', 'Ainda falta (do mais para o menos importante):')
    for (const f of p.porFazer.slice(0, 8)) linhas.push(`- ${limpo(f.texto, 160)}${f.tuaVez ? ' [depende da pessoa]' : ''}`)
  }

  return linhas.join('\n')
}

// FNV-1a de 32 bits: chega para saber se o material mudou.
export function hashDe(texto) {
  let h = 0x811c9dc5
  for (let i = 0; i < texto.length; i++) {
    h ^= texto.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }

  return h.toString(16).padStart(8, '0')
}

export async function lerPontos(pasta) {
  const mapa = new Map()
  for (const nome of await readdir(pasta).catch(() => [])) {
    if (!nome.endsWith('.json') || nome.endsWith('.pedido.json') || nome.endsWith('.a-gerar.json')) continue
    try {
      const r = JSON.parse(await readFile(join(pasta, nome), 'utf8'))
      if (typeof r?.id === 'string' && typeof r.ponto === 'string') mapa.set(r.id, r)
    } catch {
      // ficheiro a meio de ser escrito: lê-se na próxima vez
    }
  }

  return mapa
}

// Junta a cada projeto o seu ponto de situação (`ia`, ou null) e diz se está desatualizado (a IA ainda
// não leu a última mudança). Devolve os pedidos a escrever: os projetos cujo material mudou desde o último
// pedido (`pedidos`: Map id → hash já pedido). Os dispensados não pedem nada.
export function anexarPontos(projetos, pontos, pedidos = new Map()) {
  const novos = []
  for (const p of projetos) {
    const id = idDoFicheiro(p.id)
    const entrada = entradaDoProjeto(p)
    const hash = hashDe(`v${VERSAO}\n${entrada}`)
    const r = pontos.get(id)
    p.ia = r ? { ponto: r.ponto, tuaVez: r.tuaVez ?? '', aSeguir: r.aSeguir ?? '', feito: r.feito ?? '', falta: r.falta ?? '', em: r.em ?? 0, desatualizado: r.hash !== hash } : null
    if (!p.dispensado && r?.hash !== hash && pedidos.get(id) !== hash) novos.push({ id, hash, entrada })
  }

  return novos
}

export async function escreverPedidos(pasta, novos, pedidos, agora) {
  if (!novos.length) return
  await mkdir(pasta, { recursive: true })
  for (const n of novos) {
    await writeFile(join(pasta, `${n.id}.pedido.json`), JSON.stringify({ id: n.id, hash: n.hash, em: agora, entrada: n.entrada, ...(n.tipo ? { tipo: n.tipo } : {}) }))
    pedidos.set(n.id, n.hash)
  }
}

// O material do resumo do dia: o que espera por ti, o que acabou, o que está a trabalhar (só o título: o
// «agora» muda de 30 em 30 s e faria a IA reescrever sem parar), os lembretes e os projetos que pedem a tua
// vez ou estão esquecidos. Sem horas, para o hash só mudar quando muda alguma coisa a sério.
export function entradaDoDia(e, projetos = []) {
  const linhas = []
  const bloco = (titulo, itens) => {
    if (!itens.length) return
    linhas.push('', titulo)
    for (const i of itens) linhas.push(`- ${i}`)
  }
  bloco('À espera da pessoa (do mais importante para o menos):', (e.espera ?? []).slice(0, 8).map(x =>
    `${limpo(x.titulo, 120)}: ${limpo(x.precisa, 200) || 'ver a resposta'}${x.parado ? ' (parado a meio, à espera dela agora)' : x.lembrete ? ' (lembrete do que ela deixou para depois)' : ''}`))
  bloco('Acabaram sem precisar dela (para ela ver):', (e.terminados ?? []).slice(0, 6).map(x => `${limpo(x.titulo, 120)}: ${limpo(x.resumo, 240)}`))
  bloco('A trabalhar sozinhos agora:', (e.trabalho ?? []).slice(0, 6).map(x => limpo(x.titulo, 120)))
  bloco('Projetos em que é a vez dela:', projetos.filter(p => !p.dispensado && !p.semImportancia && p.ia?.tuaVez).slice(0, 6)
    .map(p => `${limpo(p.nome, 80)}: ${limpo(p.ia.tuaVez, 200)}`))
  bloco('Projetos esquecidos (parados há uma semana ou mais, com coisas por fazer):', projetos.filter(p => p.esquecido).slice(0, 6)
    .map(p => `${limpo(p.nome, 80)}${p.ia?.aSeguir ? `: ${limpo(p.ia.aSeguir, 200)}` : ''}`))
  if (e.numeros?.adiados) linhas.push('', `Lembretes guardados para mais tarde: ${e.numeros.adiados}`)
  if (!linhas.length) linhas.push('Nada à espera, nada a trabalhar, nenhum projeto esquecido.')

  return linhas.join('\n').trim()
}

// O pedido do dia, se o material mudou desde o último. Devolve o que escrever (ou nada).
export function pedidoDoDia(e, projetos, pontos, pedidos) {
  const entrada = entradaDoDia(e, projetos)
  const hash = hashDe(`dia\n${entrada}`)
  const r = pontos.get('dia')
  if (r?.hash === hash || pedidos.get('dia') === hash) return []

  return [{ id: 'dia', hash, entrada, tipo: 'dia' }]
}
