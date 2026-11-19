import type { EngineInterface, Register } from 'claude-code'

import type { Bloqueio, Item, Lembrete, Progresso } from '../types'
import { caminhos, dispensar, escreverFoco, escreverItem, escreverSituacao, garantirPastas, lerItem, lerJson, lerSituacao, lerTudo } from '../src/armazem'
import { lembreteDoTurno } from '../src/lembrete'
import { idsPorGerar, INTERVALO_PROJETOS_MS, lerPedidoProjeto, lerPontoProjeto, SISTEMA_DIA, SISTEMA_PROJETO } from '../src/projetoIA'
import type { PedidoProjeto, PontoProjeto } from '../src/projetoIA'
import type { Caminhos } from '../src/armazem'
import { enderecos, EXPIRA_MS, INTERVALO_MS, lerPedido, porTratar, resultadoDoEnvio, todosFalharam } from '../src/carteiro'
import type { Pedido, Resultado } from '../src/carteiro'
import { lerClassificacao, montarPrompt, MODELO, SISTEMA } from '../src/classificar'
import { diaLocal, juntarAoDia, registoDoTurno } from '../src/consumo'
import type { UsoDoTurno } from '../src/consumo'
import { contarAgentes, contarShells, contarTarefas, fundoDoFim, textoDoFundo, VALIDADE_STOP_MS } from '../src/fundo'
import type { StopVisto, TarefaEmFundo } from '../src/fundo'
import { barraGlobal, trabalhoGlobal } from '../src/global'
import { deFicheiroDaApp, lerFicheiroDoChat, procurarLigacao } from '../src/ligacao'
import { limparPedido } from '../src/pedido'
import { juntarSituacao } from '../src/situacao'
import type { Ligacao } from '../src/ligacao'
import { aplicarPlano, contaComoAcao, descreverFerramenta, FERRAMENTA_PLANO, resumoDosPassos } from '../src/progresso'
import {
  bloqueioDaFerramenta,
  bloqueioDePermissao,
  descreverAcao,
  FERRAMENTAS_QUE_PERGUNTAM,
  juntarAcao,
  lerResumo,
  montarPromptResumo,
  pedidosRecentes,
  resumoDevido,
  SISTEMA_RESUMO,
  ultimoTextoDoChat,
} from '../src/resumo'
import type { UltimoResumo } from '../src/resumo'

let ultimoPedido = ''
let versao = 0
// Só chats a sério entram na fila: os do terminal e os da app (têm
// ficheiro de sessão local_…). Sessões de fundo (-p, SDK, plugins) não são nenhum dos dois,
// e o chat orquestrador também fica de fora.
let temSuperficie = false
let ehChat: boolean | undefined
let tentativasChat = 0
let ligacaoConhecida: Ligacao | undefined
// Conta prompts e fins de turno, confirmados ou não: uma escrita atrasada só corre se
// nada aconteceu entretanto.
let eventos = 0
let progressoAtual: Progresso = { passos: [], ferramentas: 0 }
let ultimaEscrita = 0
// Trabalho em fundo (subagentes, workflows): o motor chama o turn.complete e o classic.Stop do mesmo fim de
// turno por uma ordem que não controlamos, por isso cada um deixa o que viu e o que chega depois completa o
// outro (ver fundo.ts e registarStop).
let inicioDoTurno = 0
let fimDoTurno = 0
let ultimoStop: StopVisto | undefined
let shellsDesde: number | undefined
// O resumo da IA enquanto o chat trabalha (src/resumo.ts): as últimas ações descritas, quando foi o último
// e se há um a correr. Recomeça em cada pedido.
let acoesRecentes: string[] = []
let ultimoResumo: UltimoResumo | undefined
let resumindo = false

function rotuloDoProjeto(cwd: string): string {
  const nome = cwd.split(/[\\/]/).filter(Boolean).pop() ?? cwd

  return /^scratch-\d{4}-\d{2}-\d{2}/.test(nome) ? 'chat rápido' : nome
}

async function localDoOrquestrador($: EngineInterface, c: Caminhos): Promise<string | undefined> {
  try {
    return JSON.parse(await $.fs.read(`${c.raiz}/orquestrador.json`)).local
  } catch {
    return undefined
  }
}

// Na 1.ª mensagem de um chat novo a app ainda não escreveu o cliSessionId no seu ficheiro;
// por isso só os fins de turno contam para desistir de um chat sem ficheiro.
async function confirmarChat($: EngineInterface, sessao: string, agora: number, contaParaDesistir: boolean) {
  if (temSuperficie) return true
  if (ehChat !== undefined) return ehChat
  ligacaoConhecida = await procurarLigacao($, sessao, agora)
  if (ligacaoConhecida) {
    ehChat = ligacaoConhecida.local !== (await localDoOrquestrador($, await caminhos($)))

    return ehChat
  }
  if (contaParaDesistir && ++tentativasChat >= 2) ehChat = false

  return false
}

async function publicarBarra($: EngineInterface, c: Caminhos) {
  const agora = await $.clock.now()
  const dados = await lerTudo($, c, agora)
  const orquestrador = await localDoOrquestrador($, c)
  const itens = dados.itens.filter(item => !orquestrador || item.local !== orquestrador)
  await $.fs.write(
    `${c.raiz}/barra.json`,
    JSON.stringify({ geradaEm: agora, modelo: barraGlobal({ ...dados, itens }, agora), trabalho: trabalhoGlobal(itens, agora, dados.dispensados) }),
  )
}

async function classificar($: EngineInterface, projeto: string, pedido: string, resposta: string) {
  for (let tentativa = 0; tentativa < 2; tentativa++) {
    const r = await $.model.complete({
      model: MODELO,
      system: SISTEMA,
      prompt: montarPrompt(projeto, pedido, resposta),
      maxTokens: 1100,
    })
    const classificacao = r.isAnswered ? lerClassificacao(r.text) : undefined
    if (classificacao) return classificacao
  }

  return undefined
}

// A situação do chat (o que ficou feito, o que falta) é um extra para o gestor: não expira como o
// item da fila e um erro aqui nunca pode estragar a fila.
let pastaSituacaoPronta = false

async function guardarSituacao($: EngineInterface, c: Caminhos, item: Item, classificacao: Item['classificacao']) {
  try {
    if (!pastaSituacaoPronta) {
      await garantirPastas($, c)
      pastaSituacaoPronta = true
    }
    const anterior = await lerSituacao($, c, item.sessao)
    const situacao = juntarSituacao(anterior, { sessao: item.sessao, local: item.local, titulo: item.titulo, projeto: item.projeto }, classificacao, await $.clock.now())
    if (situacao) await escreverSituacao($, c, situacao)
  } catch {
    // sem situação deste turno: o gestor usa o resto (lista de tarefas, resumo da app)
  }
}

async function completar($: EngineInterface, c: Caminhos, item: Item, pedido: string, resposta: string, minha: number) {
  const ligacao = item.local ? undefined : await procurarLigacao($, item.sessao, item.desde)
  const classificacao = await classificar($, item.projeto, pedido, resposta)
  if (minha !== versao) return
  const completo = {
    ...item,
    local: item.local ?? ligacao?.local,
    titulo: ligacao?.titulo || item.titulo,
    classificacao,
  }
  await escreverItem($, c, completo)
  await guardarSituacao($, c, completo, classificacao)
  await guardarLembrete($, c, completo, classificacao)
  await publicarBarra($, c)
}

// «Depois faço», «lembra-me»: o chat sai já da espera (dispensado) e o lembrete volta, explicado em
// linguagem simples, daqui a uns dias (o gestor mostra-o na espera a partir de `quando`).
async function guardarLembrete($: EngineInterface, c: Caminhos, item: Item, classificacao: Item['classificacao']) {
  try {
    const ficheiro = `${c.lembretes}/${item.sessao}.json`
    const anterior = await lerJson<Lembrete>($, ficheiro)
    const lembrete = lembreteDoTurno(anterior, item, classificacao, await $.clock.now())
    if (!lembrete) return
    await garantirPastas($, c)
    await $.fs.write(ficheiro, JSON.stringify(lembrete))
    if (!lembrete.resolvidoEm) await dispensar($, c, item.sessao, item.desde)
  } catch {
    // sem lembrete deste turno: o chat fica na espera como sempre
  }
}

async function repetirTrabalho($: EngineInterface, pedido: string, meu: number) {
  if (eventos === meu) await marcarATrabalhar($, pedido, true)
}

async function marcarATrabalhar($: EngineInterface, pedido: string, repetida = false) {
  ultimoPedido = pedido
  if (!repetida) {
    shellsDesde = undefined
    eventos += 1
    acoesRecentes = []
    ultimoResumo = undefined
  }
  const meu = eventos
  const c = await caminhos($)
  const sessao = await $.session.id()
  const agora = await $.clock.now()
  if (!(await confirmarChat($, sessao, agora, false))) {
    if (!repetida) $.clock.after(5000, () => void repetirTrabalho($, pedido, meu))
    return
  }
  versao += 1
  const projeto = rotuloDoProjeto(await $.session.cwd())
  const anterior = await lerItem($, c, sessao)
  progressoAtual = { passos: anterior?.progresso?.passos ?? [], ferramentas: 0 }
  await escreverItem($, c, {
    ...(anterior ?? { sessao, projeto, titulo: ligacaoConhecida?.titulo || projeto, local: ligacaoConhecida?.local }),
    estado: 'a-trabalhar',
    desde: agora,
    pedido: pedido.slice(0, 300),
    progresso: progressoAtual,
  })
  await escreverFoco($, c, { sessao, em: agora })
  await publicarBarra($, c)
  void talvezResumir($)
}

// O turno acabou mas ficou trabalho a correr em fundo: o motor acorda o modelo quando acabar, por isso o chat
// continua «a trabalhar» (desde o pedido) e não pede nada a ninguém. Sem isto aparecia «à espera» de ti.
async function manterATrabalhar($: EngineInterface, c: Caminhos, sessao: string, agora: number, fundo: number) {
  versao += 1
  const projeto = rotuloDoProjeto(await $.session.cwd())
  const anterior = await lerItem($, c, sessao)
  await escreverItem($, c, {
    ...(anterior ?? { sessao, projeto, titulo: ligacaoConhecida?.titulo || projeto, local: ligacaoConhecida?.local }),
    estado: 'a-trabalhar',
    desde: anterior?.estado === 'a-trabalhar' ? anterior.desde : agora,
    progresso: { ...progressoAtual, ultima: textoDoFundo(fundo) },
  })
  await publicarBarra($, c)
}

async function agentesAtivos($: EngineInterface): Promise<number> {
  try {
    return contarAgentes(await $.agent.list())
  } catch {
    return 0
  }
}

async function marcarAEspera($: EngineInterface, resposta: string) {
  eventos += 1
  const c = await caminhos($)
  const sessao = await $.session.id()
  const agora = await $.clock.now()
  if (!(await confirmarChat($, sessao, agora, true))) return
  fimDoTurno = agora
  const fundo = fundoDoFim({ stop: ultimoStop, inicioDoTurno, agora, agentes: await agentesAtivos($), shellsDesde })
  if (fundo > 0) return manterATrabalhar($, c, sessao, agora, fundo)
  versao += 1
  const minha = versao
  const projeto = rotuloDoProjeto(await $.session.cwd())
  const anterior = await lerItem($, c, sessao)
  const item: Item = {
    sessao,
    projeto,
    titulo: anterior?.titulo ?? (ligacaoConhecida?.titulo || projeto),
    local: anterior?.local ?? ligacaoConhecida?.local,
    estado: 'a-espera',
    desde: agora,
    pedido: anterior?.pedido,
    progresso: { ...progressoAtual, bloqueio: undefined },
    tituloIA: progressoAtual.resumo?.titulo ?? anterior?.tituloIA,
  }
  await escreverItem($, c, item)
  await publicarBarra($, c)
  void completar($, c, item, ultimoPedido, resposta, minha)
}

// O Stop do fim de turno traz o trabalho em fundo que o motor conhece (agentes, workflows, shells...). Se o
// turn.complete ainda não passou, fica guardado para ele; se já passou e deixou o chat «à espera», desfaz-se isso.
async function registarStop($: EngineInterface, tarefas: readonly TarefaEmFundo[] | undefined) {
  const agora = await $.clock.now()
  const shells = contarShells(tarefas)
  if (shells === 0) shellsDesde = undefined
  else shellsDesde ??= agora
  ultimoStop = { em: agora, tarefas: contarTarefas(tarefas), shells }
  const n = fundoDoFim({ stop: ultimoStop, inicioDoTurno, agora, agentes: 0, shellsDesde })
  if (n === 0 || inicioDoTurno === 0 || fimDoTurno < inicioDoTurno) return
  const c = await caminhos($)
  const sessao = await $.session.id()
  const atual = await lerItem($, c, sessao)
  if (!atual || atual.estado !== 'a-espera' || atual.desde < inicioDoTurno || agora - atual.desde > VALIDADE_STOP_MS) return
  await manterATrabalhar($, c, sessao, agora, n)
}

// Todos os chats registam o consumo (os limites são da conta), também o orquestrador e as
// sessões de fundo: a pasta pode ainda não existir num chat aberto antes desta versão do mod.
let pastasProntas = false

async function registarConsumo($: EngineInterface, uso: UsoDoTurno | undefined) {
  const c = await caminhos($)
  const em = await $.clock.now()
  const { rateLimits } = await $.session.usage()
  const registo = registoDoTurno({ em, sessao: await $.session.id(), uso, limites: rateLimits })
  if (!registo) return
  if (!pastasProntas) {
    await garantirPastas($, c)
    pastasProntas = true
  }
  const ficheiro = `${c.consumo}/${diaLocal(em)}.json`
  const atual = await $.fs.read(ficheiro).catch(() => undefined)
  await $.fs.write(ficheiro, juntarAoDia(atual, registo))
}

// Carteiro: só o chat orquestrador entrega as mensagens que o gestor deixa em saida/. Cada chat
// verifica se é ele (pelo ficheiro da app do local_ de orquestrador.json) e, se não for, volta a
// ver de 5 em 5 min, para o caso de orquestrador.json mudar.
let carteiro = { ativo: false, vistoEm: 0 }
let aEntregar = false

async function souOrquestrador($: EngineInterface): Promise<boolean> {
  const local = await localDoOrquestrador($, await caminhos($))
  if (!local) return false
  const ficheiro = await lerFicheiroDoChat($, local)

  return Boolean(ficheiro && deFicheiroDaApp(ficheiro, await $.session.id()))
}

async function escreverResultado($: EngineInterface, c: Caminhos, id: string, resultados: Resultado[]) {
  await $.fs.write(`${c.saida}/${id}.resultado.json`, JSON.stringify({ em: await $.clock.now(), resultados }))
}

// Tenta cada endereço do chat até um entregar; o motivo que fica é o da última tentativa.
async function enviarA($: EngineInterface, pedido: Pedido, local: string): Promise<Resultado> {
  let ultimo: Resultado = { local, entregue: false, motivo: 'sem endereço' }
  for (const to of enderecos(pedido, local)) {
    try {
      ultimo = resultadoDoEnvio(local, await $.session.send({ to, text: pedido.texto }))
    } catch (erro) {
      ultimo = { local, entregue: false, motivo: String((erro as Error)?.message ?? erro).slice(0, 300) }
    }
    if (ultimo.entregue) break
  }

  return ultimo
}

async function entregarPedidos($: EngineInterface, agora: number) {
  const c = await caminhos($)
  const { novos, interrompidos } = porTratar(await $.fs.list(c.saida).catch(() => []), agora)
  for (const id of interrompidos) {
    const pedido = lerPedido(await $.fs.read(`${c.saida}/${id}.json`).catch(() => ''), id)
    await escreverResultado($, c, id, todosFalharam(pedido?.para ?? [], 'ficou a meio (o orquestrador fechou); não foi reenviado'))
  }
  const proprio = await localDoOrquestrador($, c)
  for (const id of novos) {
    const pedido = lerPedido(await $.fs.read(`${c.saida}/${id}.json`).catch(() => ''), id)
    if (!pedido) {
      await escreverResultado($, c, id, [])
      continue
    }
    if (agora - pedido.em > EXPIRA_MS) {
      await escreverResultado($, c, id, todosFalharam(pedido.para, 'expirou: o orquestrador não o apanhou em 30 min'))
      continue
    }
    await $.fs.write(`${c.saida}/${id}.a-enviar.json`, JSON.stringify({ em: agora }))
    const resultados: Resultado[] = []
    for (const local of pedido.para) {
      if (local === proprio) {
        resultados.push({ local, entregue: false, motivo: 'é o próprio orquestrador' })
        continue
      }
      resultados.push(await enviarA($, pedido, local))
    }
    await escreverResultado($, c, id, resultados)
  }
}

async function correrCarteiro($: EngineInterface) {
  if (aEntregar) return
  const agora = await $.clock.now()
  if (!carteiro.ativo) {
    if (carteiro.vistoEm && agora - carteiro.vistoEm < 5 * 60_000) return
    carteiro = { ativo: await souOrquestrador($), vistoEm: agora }
    if (!carteiro.ativo) return
  }
  aEntregar = true
  try {
    await entregarPedidos($, agora)
  } finally {
    aEntregar = false
  }
}

// O progresso vive em memória e vai para o ficheiro no máximo a cada 5 s (de imediato
// quando a lista de tarefas muda); o fim do turno escreve-o sempre.
async function registarFerramenta($: EngineInterface, ferramenta: string, entrada: Record<string, unknown>) {
  if (!temSuperficie && ehChat !== true) return
  const meu = eventos
  const plano = ferramenta === FERRAMENTA_PLANO
  if (plano) {
    progressoAtual = { ...progressoAtual, passos: aplicarPlano(progressoAtual.passos, entrada) }
  }
  // Uma ferramenta que acabou (também a pergunta ou a permissão que parou o chat) tira o bloqueio.
  const desbloqueou = !plano && progressoAtual.bloqueio !== undefined
  if (!plano && contaComoAcao(ferramenta)) {
    acoesRecentes = juntarAcao(acoesRecentes, descreverAcao(ferramenta, entrada))
    progressoAtual = {
      ...progressoAtual,
      ferramentas: progressoAtual.ferramentas + 1,
      ultima: descreverFerramenta(ferramenta, entrada),
      bloqueio: undefined,
    }
  } else if (desbloqueou) {
    progressoAtual = { ...progressoAtual, bloqueio: undefined }
  }
  void talvezResumir($)
  const agora = await $.clock.now()
  if (!plano && !desbloqueou && agora - ultimaEscrita < 5000) return
  ultimaEscrita = agora
  const c = await caminhos($)
  const atual = await lerItem($, c, await $.session.id())
  if (!atual || atual.estado !== 'a-trabalhar' || meu !== eventos) return
  await escreverItem($, c, { ...atual, progresso: progressoAtual })
  await publicarBarra($, c)
}

// O chat parou a meio do turno à espera da pessoa (pergunta, plano, permissão): vai já para o painel.
async function definirBloqueio($: EngineInterface, bloqueio: Bloqueio | undefined) {
  if (!bloqueio || (!temSuperficie && ehChat !== true)) return
  progressoAtual = { ...progressoAtual, bloqueio }
  const c = await caminhos($)
  const atual = await lerItem($, c, await $.session.id())
  if (!atual || atual.estado !== 'a-trabalhar') return
  await escreverItem($, c, { ...atual, progresso: progressoAtual })
  await publicarBarra($, c)
}

// Pede à IA o título explicativo, o que o chat está a fazer agora e o que vai precisar da pessoa. Nunca
// mais do que um de cada vez; um resumo que chega depois de o turno acabar deita-se fora.
async function talvezResumir($: EngineInterface) {
  if (resumindo || (!temSuperficie && ehChat !== true)) return
  const agora = await $.clock.now()
  const passo = resumoDosPassos(progressoAtual.passos).atual
  if (!resumoDevido(ultimoResumo, agora, passo, progressoAtual.ferramentas)) return
  resumindo = true
  const meu = eventos
  ultimoResumo = { em: agora, passo, acoes: progressoAtual.ferramentas }
  try {
    const c = await caminhos($)
    const sessao = await $.session.id()
    const atual = await lerItem($, c, sessao)
    if (!atual || atual.estado !== 'a-trabalhar') return
    // O nome do chat fica de fora: a app inventa-o e pode estar errado (o título colava-se a ele).
    const lidas = (await $.session.messages().catch(() => [])) as unknown
    const mensagens = Array.isArray(lidas) ? (lidas as { role: string; text: string }[]) : []
    const r = await $.model.complete({
      model: MODELO,
      system: SISTEMA_RESUMO,
      prompt: montarPromptResumo({
        projeto: atual.projeto,
        tituloAnterior: progressoAtual.resumo?.titulo ?? atual.tituloIA,
        pedidos: pedidosRecentes(mensagens, atual.pedido ?? ultimoPedido),
        passos: progressoAtual.passos,
        acoes: acoesRecentes,
        ultimoTexto: ultimoTextoDoChat(mensagens),
      }),
      maxTokens: 300,
      timeoutMs: 20_000,
    })
    const resumo = r.isAnswered ? lerResumo(r.text, await $.clock.now()) : undefined
    if (!resumo || meu !== eventos) return
    progressoAtual = { ...progressoAtual, resumo }
    const depois = await lerItem($, c, sessao)
    if (!depois || depois.estado !== 'a-trabalhar' || meu !== eventos) return
    await escreverItem($, c, { ...depois, tituloIA: resumo.titulo, progresso: progressoAtual })
    await publicarBarra($, c)
  } catch {
    // sem resumo desta vez: o painel mostra o passo do plano e a última ferramenta
  } finally {
    resumindo = false
  }
}

// O ponto de situação dos projetos (src/projetoIA.ts): o gestor deixa os pedidos, qualquer chat aberto os
// responde. Um de cada vez neste chat; a reserva evita que dois chats gerem o mesmo projeto.
let aGerarProjetos = false

async function gerarProjetos($: EngineInterface) {
  if (aGerarProjetos || (!temSuperficie && ehChat !== true)) return
  aGerarProjetos = true
  try {
    const c = await caminhos($)
    const nomes = (await $.fs.list(c.projetosIA).catch(() => [])).filter(e => e.kind === 'file').map(e => e.name)
    const pedidos: PedidoProjeto[] = []
    const feitos = new Map<string, string>()
    const reservas = new Map<string, number>()
    for (const nome of nomes) {
      const caminho = `${c.projetosIA}/${nome}`
      if (nome.endsWith('.pedido.json')) {
        const p = lerPedidoProjeto(await $.fs.read(caminho).catch(() => ''))
        if (p) pedidos.push(p)
      } else if (nome.endsWith('.a-gerar.json')) {
        const r = await lerJson<{ id: string; em: number }>($, caminho)
        if (r?.id) reservas.set(r.id, r.em)
      } else if (nome.endsWith('.json')) {
        const r = await lerJson<PontoProjeto>($, caminho)
        // Uma resposta no formato antigo (sem «feito» e «falta» em texto) gera-se outra vez.
        if (r?.id && typeof r.feito === 'string') feitos.set(r.id, r.hash)
      }
    }
    const agora = await $.clock.now()
    for (const pedido of idsPorGerar(pedidos, feitos, reservas, agora)) {
      await $.fs.write(`${c.projetosIA}/${pedido.id}.a-gerar.json`, JSON.stringify({ id: pedido.id, em: agora }))
      const sistema = pedido.tipo === 'dia' ? SISTEMA_DIA : SISTEMA_PROJETO
      const r = await $.model.complete({ model: MODELO, system: sistema, prompt: pedido.entrada, maxTokens: 700, timeoutMs: 30_000 })
      const ponto = r.isAnswered ? lerPontoProjeto(r.text, pedido, await $.clock.now()) : undefined
      if (ponto) await $.fs.write(`${c.projetosIA}/${pedido.id}.json`, JSON.stringify(ponto))
    }
  } catch {
    // tenta-se outra vez na próxima ronda
  } finally {
    aGerarProjetos = false
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await garantirPastas($, await caminhos($)).catch(() => undefined)
    // Os chats do terminal contam como chats a sério; os da app provam-no pelo ficheiro de sessão.
    // A pílula e o gestor (bar/, gestor/) leem o barra.json que publicarBarra escreve.
    temSuperficie = e.surface === 'terminal'
    $.clock.every(INTERVALO_MS, () => void correrCarteiro($).catch(() => undefined))
    $.clock.every(INTERVALO_PROJETOS_MS, () => void gerarProjetos($))

    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    await marcarATrabalhar($, limparPedido(e.text ?? '')).catch(() => undefined)

    return next(e)
  })

  // Cada turno do chat (também o que o trabalho em fundo acorda, que não passa por prompt.submit) marca aqui o
  // seu começo: o Stop de um turno anterior não vale para o fim deste.
  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) inicioDoTurno = await $.clock.now().catch(() => inicioDoTurno)

    return next(e)
  })

  // O motor vai pedir à pessoa permissão para uma ferramenta: o chat fica parado até ela responder.
  on('classic.PermissionRequest', async ($, e, next) => {
    if (e.agent_id === undefined) {
      await definirBloqueio($, bloqueioDePermissao(e.tool_name, e.tool_input, await $.clock.now())).catch(() => undefined)
    }

    return next(e)
  })

  on('classic.Stop', async ($, e, next) => {
    if (e.agent_id === undefined) await registarStop($, e.background_tasks).catch(() => undefined)

    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const entrada = e as unknown as Record<string, unknown>
    const ferramenta = String(e.tool)
    if (entrada.agentId === undefined && FERRAMENTAS_QUE_PERGUNTAM.has(ferramenta)) {
      await definirBloqueio($, bloqueioDaFerramenta(ferramenta, entrada, await $.clock.now())).catch(() => undefined)
    }
    const resultado = await next(e)
    if (entrada.agentId === undefined) void registarFerramenta($, String(e.tool), entrada).catch(() => undefined)

    return resultado
  })

  on('turn.complete', async ($, e, next) => {
    const resultado = await next(e)
    if (e.agentId === undefined && !e.isAborted) await marcarAEspera($, e.answer).catch(() => undefined)
    if (e.agentId === undefined) void registarConsumo($, e.usage).catch(() => undefined)

    return resultado
  })
}
