import { expect, test } from 'claude-code/testing'

import { lerClassificacao } from '../src/classificar'
import { lembreteDoTurno } from '../src/lembrete'
import { idsPorGerar, lerPedidoProjeto, lerPontoProjeto, MAX_POR_RONDA, RESERVA_MS } from '../src/projetoIA'
import type { PedidoProjeto } from '../src/projetoIA'
import type { Classificacao } from '../types'

const pedido = (id: string, hash = 'h1', em = 1): PedidoProjeto => ({ id, hash, em, entrada: 'material' })

test('pedido sem entrada não serve', () => {
  expect(lerPedidoProjeto('{"id":"a","hash":"h","entrada":"  "}')).toBe(undefined)
  expect(lerPedidoProjeto('lixo')).toBe(undefined)
  expect(lerPedidoProjeto('{"id":"a","hash":"h","em":5,"entrada":"x"}')?.em).toBe(5)
})

test('ponto do projeto lê-se com o hash do pedido', () => {
  const p = lerPontoProjeto('ok {"ponto":"Está quase.","tuaVez":"Escolhe a música","aSeguir":""}', { id: 'a', hash: 'h9' }, 3)
  expect(p?.ponto).toBe('Está quase.')
  expect(p?.tuaVez).toBe('Escolhe a música')
  expect(p?.hash).toBe('h9')
  expect(lerPontoProjeto('{"ponto":""}', { id: 'a', hash: 'h' }, 1)).toBe(undefined)
})

test('só se gera o que mudou e ninguém está a gerar', () => {
  const feitos = new Map([['a', 'h1'], ['b', 'velho']])
  const reservas = new Map([['c', 1000]])
  const ids = idsPorGerar([pedido('a'), pedido('b'), pedido('c')], feitos, reservas, 1000 + RESERVA_MS - 1).map(p => p.id)
  expect(ids.join()).toBe('b')
  expect(idsPorGerar([pedido('c')], feitos, reservas, 1000 + RESERVA_MS).length).toBe(1)
})

test('no máximo umas poucas por ronda, as mais recentes primeiro', () => {
  const muitos = Array.from({ length: MAX_POR_RONDA + 2 }, (_, i) => pedido(`p${i}`, 'h', i))
  const ids = idsPorGerar(muitos, new Map(), new Map(), 0).map(p => p.id)
  expect(ids.length).toBe(MAX_POR_RONDA)
  expect(ids[0]).toBe(`p${MAX_POR_RONDA + 1}`)
})

const base: Classificacao = {
  importancia: 3,
  tipo: 'info',
  esforco: 'minutos',
  desbloqueia: false,
  rotulo: '',
  cartao: { pediste: '', fez: '', precisa: '' },
}
const item = { sessao: 's1', local: 'local_1', projeto: 'loja', titulo: 'Chat 1', tituloIA: 'Loja: checkout' }
const DIA = 86_400_000

test('lembrete novo volta daqui a N dias, com o título da IA', () => {
  const l = lembreteDoTurno(undefined, item, { ...base, lembrete: { texto: 'Ficaste de testar o checkout.', dias: 2 } }, 10)
  expect(l?.quando).toBe(10 + 2 * DIA)
  expect(l?.titulo).toBe('Loja: checkout')
  expect(l?.resolvidoEm).toBe(undefined)
})

test('voltar ao chat sem nada adiado resolve o lembrete pendente', () => {
  const anterior = lembreteDoTurno(undefined, item, { ...base, lembrete: { texto: 'x', dias: 1 } }, 0)
  expect(lembreteDoTurno(anterior, item, { ...base, lembrete: null }, 5)?.resolvidoEm).toBe(5)
  expect(lembreteDoTurno({ ...anterior!, feitoEm: 3 }, item, { ...base, lembrete: null }, 5)).toBe(undefined)
  expect(lembreteDoTurno(anterior, item, undefined, 5)).toBe(undefined)
})

test('classificação lê o lembrete e limita os dias', () => {
  const json = (l: string) => `{"importancia":3,"tipo":"info","esforco":"minutos","lembrete":${l}}`
  expect(lerClassificacao(json('{"texto":"Ficaste de ver isto","dias":90}'))?.lembrete?.dias).toBe(30)
  expect(lerClassificacao(json('{"texto":"x"}'))?.lembrete?.dias).toBe(2)
  expect(lerClassificacao(json('null'))?.lembrete).toBe(null)
})

test('classificação lê precisaDeTi e o resumo do fim', () => {
  const c = lerClassificacao('{"importancia":2,"precisaDeTi":false,"resumoFim":"Ficou pronta a página.  Falta o resto."}')
  expect(c?.precisaDeTi).toBe(false)
  expect(c?.resumoFim).toBe('Ficou pronta a página. Falta o resto.')
  expect(lerClassificacao('{"importancia":2}')?.precisaDeTi).toBe(undefined)
})

test('ponto do projeto traz o feito e o que falta em texto corrido', () => {
  const p = lerPontoProjeto('{"ponto":"x","feito":"A loja aceita cartões.","falta":"Falta testar."}', { id: 'a', hash: 'h' }, 1)
  expect(p?.feito).toBe('A loja aceita cartões.')
  expect(p?.falta).toBe('Falta testar.')
})

test('o pedido do dia traz o tipo', () => {
  expect(lerPedidoProjeto('{"id":"dia","hash":"h","entrada":"x","tipo":"dia"}')?.tipo).toBe('dia')
  expect(lerPedidoProjeto('{"id":"p","hash":"h","entrada":"x","tipo":"outro"}')?.tipo).toBe(undefined)
})
