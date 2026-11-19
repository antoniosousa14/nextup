import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { montarEstado } from '../lib/estado.mjs'
import { aplicarLembrete, lerLembrete, lerLembretes, separarLembretes } from '../lib/lembretes.mjs'
import { anexarPontos, entradaDoProjeto, escreverPedidos, hashDe, idDoFicheiro, lerPontos } from '../lib/pontoIA.mjs'

const D = 86_400_000
const agora = 100 * D
const ID = '11111111-2222-3333-4444-555555555555'
const ID2 = '66666666-2222-3333-4444-555555555555'
const lembrete = (extra = {}) => ({ id: ID, sessao: ID, local: 'local_a', projeto: 'loja', titulo: 'Loja: checkout', texto: 'Ficaste de testar o checkout.', criadoEm: agora - 3 * D, quando: agora - D, ...extra })

test('lembrete: só aceita o que tem id, texto e hora', () => {
  assert.equal(lerLembrete({ ...lembrete(), id: 'x' }), undefined)
  assert.equal(lerLembrete({ ...lembrete(), texto: ' ' }), undefined)
  assert.equal(lerLembrete(lembrete()).texto, 'Ficaste de testar o checkout.')
})

test('separa os que chegaram à hora dos adiados; feitos e resolvidos não contam', () => {
  const lista = [lembrete(), lembrete({ id: ID2, quando: agora + D }), lembrete({ feitoEm: 1 }), lembrete({ resolvidoEm: 1 })]
  const { devidos, adiados } = separarLembretes(lista, agora)
  assert.equal(devidos.length, 1)
  assert.equal(adiados.length, 1)
})

test('lembrete devido entra na espera depois dos urgentes, com o texto da IA', () => {
  const urgente = { sessao: 'su', local: 'local_u', titulo: 'u', projeto: 'p', estado: 'a-espera', desde: agora - D, classificacao: { importancia: 5, cartao: {} } }
  const barra = { modelo: { vazia: false, chips: [{ sessao: 'su', local: 'local_u', desde: agora - D, texto: 'p · u' }], extra: [] }, trabalho: [] }
  const e = montarEstado({ itens: [urgente], barra, agora, meiaNoite: agora, lembretes: [lembrete(), lembrete({ id: ID2, quando: agora + D })] })
  assert.deepEqual(e.espera.map(x => [x.numero, x.tipo || 'chat']), [[1, 'chat'], [2, 'lembrete']])
  assert.equal(e.espera[1].precisa, 'Ficaste de testar o checkout.')
  assert.equal(e.espera[1].titulo, 'Loja: checkout')
  assert.equal(e.espera[1].lembrete.id, ID)
  assert.equal(e.numeros.adiados, 1)
})

test('feito e adiar escrevem no ficheiro; pedido estranho é recusado', async () => {
  const pasta = await mkdtemp(join(tmpdir(), 'lembretes-'))
  try {
    await writeFile(join(pasta, `${ID}.json`), JSON.stringify(lembrete()))
    assert.deepEqual(await aplicarLembrete(pasta, { id: ID, acao: 'adiar', dias: 2 }, agora), { ok: true })
    assert.equal(JSON.parse(await readFile(join(pasta, `${ID}.json`), 'utf8')).quando, agora + 2 * D)
    await aplicarLembrete(pasta, { id: ID, acao: 'feito' }, agora)
    const [l] = await lerLembretes(pasta)
    assert.equal(l.feitoEm, agora)
    assert.equal((await aplicarLembrete(pasta, { id: '../x', acao: 'feito' }, agora))[0], 400)
    assert.equal((await aplicarLembrete(pasta, { id: ID2, acao: 'feito' }, agora))[0], 404)
  } finally {
    await rm(pasta, { recursive: true, force: true })
  }
})

const projeto = (extra = {}) => ({
  id: 'grupo:1', nome: 'Loja', caminho: 'Trabalho / Loja', dispensado: false,
  principal: { titulo: 'Loja: checkout', estado: 'espera', pedi: 'corrige o checkout', respondeu: 'Corrigi o erro do cartão.', precisa: 'Testar um pagamento', plano: { feitos: 2, total: 3, atual: 'Testar', faltam: ['Publicar'] } },
  outros: [],
  feito: [{ texto: 'Erro do cartão corrigido' }],
  porFazer: [{ texto: 'Testar um pagamento', tuaVez: true }],
  ...extra,
})

test('ponto da IA: material sem horas, id seguro, hash estável', () => {
  const t = entradaDoProjeto(projeto())
  assert.ok(t.includes('Projeto: Loja'))
  assert.ok(t.includes('Testar um pagamento [depende da pessoa]'))
  assert.ok(t.includes('2 de 3 passos'))
  assert.equal(hashDe(t), hashDe(entradaDoProjeto(projeto())))
  assert.notEqual(hashDe(t), hashDe(entradaDoProjeto(projeto({ feito: [] }))))
  assert.equal(idDoFicheiro('grupo:1/../x'), 'grupo_1____x')
})

test('ponto da IA: pede só o que mudou, uma vez, e anexa o que há', async () => {
  const pasta = await mkdtemp(join(tmpdir(), 'pontos-'))
  try {
    const p = projeto()
    const pedidos = new Map()
    const novos = anexarPontos([p], new Map(), pedidos)
    assert.equal(novos.length, 1)
    assert.equal(p.ia, null)
    await escreverPedidos(pasta, novos, pedidos, agora)
    assert.equal(anexarPontos([projeto()], new Map(), pedidos).length, 0)
    const hash = novos[0].hash
    await writeFile(join(pasta, 'grupo_1.json'), JSON.stringify({ id: 'grupo_1', hash, em: agora, ponto: 'Está quase.', tuaVez: 'Testa um pagamento.', aSeguir: '' }))
    const q = projeto()
    assert.equal(anexarPontos([q], await lerPontos(pasta), new Map()).length, 0)
    assert.deepEqual(q.ia, { ponto: 'Está quase.', tuaVez: 'Testa um pagamento.', aSeguir: '', feito: '', falta: '', em: agora, desatualizado: false })
    const mudou = projeto({ feito: [] })
    assert.equal(anexarPontos([mudou], await lerPontos(pasta), pedidos).length, 1)
    assert.equal(mudou.ia.desatualizado, true)
    assert.equal(anexarPontos([projeto({ dispensado: true, feito: [] })], new Map(), new Map()).length, 0)
  } finally {
    await rm(pasta, { recursive: true, force: true })
  }
})

test('resumo do dia: material com espera, terminados, trabalho e projetos; só pede quando muda', async () => {
  const { entradaDoDia, pedidoDoDia } = await import('../lib/pontoIA.mjs')
  const e = {
    espera: [{ titulo: 'Loja: checkout', precisa: 'Testa um pagamento', parado: true }],
    terminados: [{ titulo: 'Site: blog', resumo: 'Ficou pronto o blog.' }],
    trabalho: [{ titulo: 'App: login', agora: 'muda sempre' }],
    numeros: { adiados: 2 },
  }
  const projetos = [{ nome: 'Faculdade', esquecido: true, ia: { aSeguir: 'Entregar o relatório' } }]
  const t = entradaDoDia(e, projetos)
  assert.ok(t.includes('Loja: checkout: Testa um pagamento (parado a meio'))
  assert.ok(t.includes('Site: blog: Ficou pronto o blog.'))
  assert.ok(t.includes('- App: login') && !t.includes('muda sempre'))
  assert.ok(t.includes('Faculdade: Entregar o relatório'))
  assert.ok(t.includes('Lembretes guardados para mais tarde: 2'))
  const pedidos = new Map()
  const [p] = pedidoDoDia(e, projetos, new Map(), pedidos)
  assert.equal(p.tipo, 'dia')
  pedidos.set('dia', p.hash)
  assert.equal(pedidoDoDia(e, projetos, new Map(), pedidos).length, 0)
  assert.equal(pedidoDoDia(e, projetos, new Map([['dia', { hash: p.hash }]]), new Map()).length, 0)
  assert.ok(entradaDoDia({}).includes('Nada à espera'))
})
