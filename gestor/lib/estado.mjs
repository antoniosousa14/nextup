import { caminhos, montarArvore, SEM_GRUPO, vazia } from './organizacao.mjs'

const H = 3_600_000

// Igual ao do mod: um "a trabalhar" com mais de 3 h é de um chat fechado a meio de um turno
// (mod/src/vista.ts, TRABALHO_MAX_MS).
export const TRABALHO_MAX_MS = 3 * H

export function meiaNoiteLocal(agora) {
  const d = new Date(agora)

  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

// Um item (à espera ou a trabalhar) cuja sessão do CLI a app já largou depois de ele começar está morto: a
// pessoa fez /clear nesse chat (acabou com aquilo), ou fechou-o a meio do turno e o mod nunca escreveu o fim.
// Sai do painel e da pílula; o chat só volta com um pedido novo (outra sessão do CLI, outro item).
export const itemMorto = (sessao, t) => (sessao?.clisSaidos?.[t.sessao] ?? -1) >= t.desde
export const trabalhoMorto = itemMorto

// Um chat que acabou o turno precisa de ti? A IA di-lo (precisaDeTi); os itens de antes disso deduzem-se do
// «precisa» do cartão («Nada de ti agora…»). Sem classificação ainda, conta como à espera.
const NADA = /^\s*(nada|nenhum|sem nada)\b/i
export const precisaDeTi = c => c?.precisaDeTi ?? !NADA.test(c?.cartao?.precisa ?? '')

// «Terminou»: chats que acabaram sem precisar de ti, com o que fizeram e o que ainda falta. Saem com um turno
// novo, um /clear, ao arrumar, ou passado este tempo.
export const TERMINOU_MAX_MS = 2 * 24 * H

function porChave(lista, chave) {
  const mapa = new Map()
  for (const x of lista ?? []) if (x?.[chave]) mapa.set(x[chave], x)

  return mapa
}

// Junta as sessões da app (todos os chats) com a fila do mod (itens + barra.json) na vista do painel.
// A ordem da espera é a da IA (barra.json); as dispensas filtram-se aqui porque o barra.json só é
// reescrito no próximo turno de algum chat (a barra faz o mesmo). A árvore é a dos grupos da barra
// lateral do Claude (`grupos`, `atribuicoes`), com as pastas-mãe do gestor (`organizacao`).
export function montarEstado({ sessoes = [], itens = [], barra, dispensados = {}, agora, meiaNoite, organizacao = vazia(), grupos = [], atribuicoes = {}, erroGrupos, foco, orquestrador, lembretes = [] }) {
  const sessaoDe = porChave(sessoes, 'local')
  const itemDe = porChave(itens, 'sessao')
  const modelo = barra?.modelo?.vazia === false ? barra.modelo : undefined
  const chips = [...(modelo?.chips ?? []), ...(modelo?.extra ?? [])]

  // Um chat arquivado na app deixa de contar, mesmo que o mod ainda tenha o item (dura 7 dias).
  const arquivado = local => sessaoDe.get(local)?.arquivado === true

  // O título que a IA deu ao trabalho de cada chat (o mod escreve-o enquanto o chat trabalha): os nomes dos
  // chats esquecem-se, este diz o que é. O nome do chat fica em `nomeChat`, para o achar na barra lateral.
  const tituloIA = new Map()
  for (const i of [...itens].sort((a, b) => a.desde - b.desde)) if (i.local && i.tituloIA) tituloIA.set(i.local, i.tituloIA)
  const tituloDe = (local, item) => item?.tituloIA || tituloIA.get(local) || ''

  const importanciaDe = chip => itemDe.get(chip.sessao)?.classificacao?.importancia ?? 3

  // O mod esconde do barra.json o chat onde a pessoa escreveu por último (o foco: já o está a ver), mas o
  // gestor serve para ver tudo o que espera por ela: esse chat entra aqui pela ordem da importância. Um item
  // de uma sessão do CLI que o /clear deixou para trás (há outro mais novo do mesmo chat) não conta.
  const doFoco = itemDe.get(foco)
  const chipDoFoco = doFoco && doFoco.estado === 'a-espera' && Number.isFinite(doFoco.desde)
    && doFoco.local !== orquestrador && !arquivado(doFoco.local) && dispensados[doFoco.sessao] !== doFoco.desde
    && !itemMorto(sessaoDe.get(doFoco.local), doFoco)
    && !chips.some(chip => chip.sessao === doFoco.sessao)
    && !itens.some(i => i.local === doFoco.local && i.sessao !== doFoco.sessao && i.desde > doFoco.desde)
    ? { sessao: doFoco.sessao, local: doFoco.local, desde: doFoco.desde, texto: `${doFoco.projeto ?? ''} · ${doFoco.titulo ?? ''}`, silenciado: false }
    : undefined
  const comFoco = [...chips]
  if (chipDoFoco) {
    const antes = comFoco.findIndex(chip => importanciaDe(chip) < importanciaDe(chipDoFoco))
    comFoco.splice(antes === -1 ? comFoco.length : antes, 0, chipDoFoco)
  }

  let espera = comFoco
    .filter(chip => dispensados[chip.sessao] !== chip.desde && !arquivado(chip.local) && !itemMorto(sessaoDe.get(chip.local), chip)
      && precisaDeTi(itemDe.get(chip.sessao)?.classificacao)
      // Um chat parado a meio do turno vem do «a trabalhar» (abaixo), com o que o parou; a classificação dele é velha.
      && itemDe.get(chip.sessao)?.estado !== 'a-trabalhar')
    .map((chip, i) => {
      const s = sessaoDe.get(chip.local)
      const c = itemDe.get(chip.sessao)?.classificacao
      const importancia = c?.importancia ?? 3

      return {
        numero: i + 1,
        sessao: chip.sessao,
        local: chip.local ?? '',
        titulo: tituloDe(chip.local, itemDe.get(chip.sessao)) || (s?.titulo ?? itemDe.get(chip.sessao)?.titulo ?? chip.texto),
        nomeChat: s?.titulo ?? itemDe.get(chip.sessao)?.titulo ?? '',
        projeto: s?.projeto ?? itemDe.get(chip.sessao)?.projeto ?? '',
        cwd: s?.cwd ?? '',
        desde: chip.desde,
        rotulo: c?.rotulo ?? '',
        precisa: c?.cartao?.precisa ?? s?.precisa ?? '',
        // O que estava a fazer: o resumo do fim do turno da IA (ou, nos itens antigos, o «fez» do cartão).
        resumo: c?.resumoFim || c?.cartao?.fez || '',
        // A IA ainda está a ler o fim do turno (a classificação demora uns segundos).
        aLer: !c && agora - chip.desde < 2 * 60_000,
        // O que lhe pediste, para o cartão nunca ficar vazio quando a IA não classificou o turno.
        pedido: String(itemDe.get(chip.sessao)?.pedido ?? '').slice(0, 300),
        pediste: c?.cartao?.pediste ?? '',
        fez: c?.cartao?.fez ?? '',
        importancia,
        tipo: c?.tipo ?? '',
        esforco: c?.esforco ?? '',
        desbloqueia: c?.desbloqueia ?? false,
        silenciado: chip.silenciado === true,
        urgente: importancia >= 4 && chip.silenciado !== true,
      }
    })

  // Lembretes que chegaram à hora (lib/lembretes.mjs): entram na espera logo a seguir aos urgentes, com o
  // texto da IA a explicar o que ficou por fazer. Os de chats arquivados não contam.
  const devidos = lembretes
    .filter(l => !l.feitoEm && !l.resolvidoEm && l.quando <= agora && !arquivado(l.local))
    .sort((a, b) => a.quando - b.quando)
    .map(l => {
      const s = sessaoDe.get(l.local)

      return {
        sessao: l.sessao, local: l.local ?? '', titulo: tituloDe(l.local) || l.titulo || s?.titulo || l.projeto,
        nomeChat: s?.titulo ?? '', projeto: s?.projeto ?? l.projeto, cwd: s?.cwd ?? '', desde: l.quando,
        rotulo: 'Lembrete', precisa: l.texto, resumo: '', pediste: '', fez: '', importancia: 3, tipo: 'lembrete', esforco: '',
        desbloqueia: false, silenciado: false, urgente: false, lembrete: { id: l.id, criadoEm: l.criadoEm },
      }
    })
  if (devidos.length) {
    const depois = espera.findIndex(x => !x.urgente)
    espera.splice(depois === -1 ? espera.length : depois, 0, ...devidos)
    espera.forEach((x, i) => { x.numero = i + 1 })
  }
  // O último item de cada chat: se acabou sem precisar de ti, vai para «Terminou».
  const ultimoDoChat = new Map()
  for (const i of [...itens].sort((a, b) => a.desde - b.desde)) if (i.local) ultimoDoChat.set(i.local, i)
  const terminados = [...ultimoDoChat.values()]
    .filter(i => i.estado === 'a-espera' && i.classificacao && !precisaDeTi(i.classificacao) && agora - i.desde < TERMINOU_MAX_MS
      && dispensados[i.sessao] !== i.desde && !arquivado(i.local) && i.local !== orquestrador && !itemMorto(sessaoDe.get(i.local), i))
    .sort((a, b) => b.desde - a.desde)
    .map(i => {
      const s = sessaoDe.get(i.local)
      const c = i.classificacao
      const falta = (c.falta ?? []).map(f => f.texto).filter(Boolean)
      const antigo = [c.cartao?.fez, falta.length ? `Falta: ${falta.slice(0, 2).join('; ')}` : ''].filter(Boolean).join('. ')

      return {
        sessao: i.sessao, local: i.local, titulo: tituloDe(i.local, i) || s?.titulo || i.titulo, nomeChat: s?.titulo ?? i.titulo,
        projeto: s?.projeto ?? i.projeto, cwd: s?.cwd ?? '', desde: i.desde,
        resumo: c.resumoFim || antigo, fez: c.cartao?.fez ?? '', falta,
      }
    })

  const adiados = lembretes.filter(l => !l.feitoEm && !l.resolvidoEm && l.quando > agora && !arquivado(l.local)).length

  // Dispensar um "a trabalhar" (para quando fica preso) vale só para esse turno: um turno novo traz-o de volta.
  let trabalho = (barra?.trabalho ?? [])
    .filter(t => agora - t.desde < TRABALHO_MAX_MS && !arquivado(t.local) && dispensados[t.sessao] !== t.desde && !trabalhoMorto(sessaoDe.get(t.local), t))
    .map(t => {
      const s = sessaoDe.get(t.local)

      return {
        ...t,
        local: t.local ?? '',
        titulo: t.tituloIA || tituloDe(t.local) || (s?.titulo ?? t.titulo),
        nomeChat: s?.titulo ?? t.titulo,
        projeto: s?.projeto ?? t.projeto ?? '',
        cwd: s?.cwd ?? '',
        passos: itemDe.get(t.sessao)?.progresso?.passos ?? [],
      }
    })

  // Parado a meio do turno à tua espera (uma pergunta, o plano, uma permissão): sai do «a trabalhar» e entra na
  // espera, à frente de tudo, com o que o parou.
  // Os chats com o mod de antes escreviam a ferramenta em vez do que ela pede.
  const textoDoBloqueio = texto => (/^Dar permissão: ExitPlanMode:?\s*$/.test(texto) ? 'Aprovar o plano que o chat propôs'
    : /^Dar permissão: AskUserQuestion:?\s*$/.test(texto) ? 'Responder a uma pergunta do chat' : texto.replace(/:\s*$/, ''))
  const parados = trabalho.filter(t => t.bloqueio)
  if (parados.length) {
    trabalho = trabalho.filter(t => !t.bloqueio)
    espera = [...parados.map(t => ({
      sessao: t.sessao, local: t.local, titulo: t.titulo, nomeChat: t.nomeChat, projeto: t.projeto, cwd: t.cwd,
      desde: t.bloqueio.desde, rotulo: 'Parado à tua espera', precisa: textoDoBloqueio(t.bloqueio.texto), resumo: t.agora ?? '', pediste: t.pedido ?? '', fez: t.agora ?? '',
      importancia: 5, tipo: 'decisao', esforco: 'segundos', desbloqueia: true, silenciado: false, urgente: true, parado: true,
    })), ...espera.filter(x => !parados.some(t => t.sessao === x.sessao))]
    espera.forEach((x, i) => { x.numero = i + 1 })
  }

  const vivas = sessoes.filter(s => !s.arquivado)
  const esperaDe = porChave(espera, 'local')
  const aTrabalhar = new Set(trabalho.map(t => t.local))

  // O que a IA disse do último turno de cada chat (em vez do resumo técnico da app, muitas vezes em inglês).
  const ultimoIA = new Map()
  for (const i of [...itens].sort((a, b) => a.desde - b.desde)) if (i.local && i.classificacao) ultimoIA.set(i.local, i.classificacao)
  const agoraDe = new Map(trabalho.map(t => [t.local, t.agora]))

  // Recentes: todos os chats abertos, do último a que chegou uma mensagem para o mais antigo.
  const recentes = [...vivas]
    .sort((a, b) => b.mensagemEm - a.mensagemEm)
    .map(s => ({
      local: s.local, titulo: tituloDe(s.local) || s.titulo, nomeChat: s.titulo, projeto: s.projeto, cwd: s.cwd, criadoEm: s.criadoEm,
      atividadeEm: s.atividadeEm, mensagemEm: s.mensagemEm,
      resumo: agoraDe.get(s.local) || ultimoIA.get(s.local)?.resumoFim || ultimoIA.get(s.local)?.cartao?.fez || s.resumo,
      precisa: esperaDe.get(s.local)?.precisa || (ultimoIA.get(s.local) ? (precisaDeTi(ultimoIA.get(s.local)) ? ultimoIA.get(s.local).cartao?.precisa ?? '' : '') : s.precisa),
      espera: esperaDe.has(s.local), trabalho: aTrabalhar.has(s.local),
    }))

  const arvore = montarArvore({ org: organizacao, grupos, atribuicoes, chats: recentes })
  const nomes = caminhos(arvore)
  const existe = new Set(grupos.map(g => g.id))
  const comGrupo = x => {
    const grupo = existe.has(atribuicoes[x.local]) ? atribuicoes[x.local] : SEM_GRUPO

    return { ...x, grupo, caminho: nomes.get(grupo) ?? 'Sem grupo' }
  }

  return {
    geradoEm: agora,
    numeros: {
      espera: espera.length,
      adiados,
      terminados: terminados.length,
      urgentes: espera.filter(e => e.urgente).length,
      esperaMaisAntiga: espera.length ? Math.min(...espera.map(e => e.desde)) : null,
      trabalho: trabalho.length,
      turnosHoje: itens.filter(item => item.desde >= meiaNoite).length,
      ativosHoje: vivas.filter(s => s.atividadeEm >= meiaNoite).length,
      chats: vivas.length,
    },
    espera: espera.map(comGrupo),
    trabalho: trabalho.map(comGrupo),
    terminados: terminados.map(comGrupo),
    recentes: recentes.map(comGrupo),
    arvore,
    organizacao: {
      erroGrupos: erroGrupos ?? null,
      pastas: organizacao.pastas.map(p => ({ id: p.id, nome: p.nome, pai: p.pai, caminho: nomes.get(p.id) ?? p.nome })),
      grupos: grupos.map(g => ({
        id: g.id, nome: organizacao.nomes?.[g.id] ?? g.nome, nomeClaude: g.nome, pasta: organizacao.grupos[g.id] ?? null,
        escondido: (organizacao.ocultos ?? []).includes(g.id), caminho: nomes.get(g.id) ?? g.nome,
      })),
    },
  }
}
