import { expect, test } from 'claude-code/testing'

import { contarAgentes, contarShells, contarTarefas, fundoDoFim, SHELL_MAX_MS, stopDoTurno, textoDoFundo, VALIDADE_STOP_MS } from '../src/fundo'

const SEG = 1000

test('contam os subagentes e os workflows em fundo, não os servidores nem os monitores', () => {
  const tarefas = [
    { type: 'subagent', status: 'running' },
    { type: 'workflow', status: 'running' },
    { type: 'shell', status: 'running' },
    { type: 'monitor', status: 'running' },
    { type: 'MCP task', status: 'running' },
  ]
  expect(contarTarefas(tarefas)).toBe(2)
})

test('o tipo não depende de maiúsculas e entradas estranhas são ignoradas', () => {
  expect(contarTarefas([{ type: 'Subagent' }, { type: 'WORKFLOW' }])).toBe(2)
  expect(contarTarefas([{ type: undefined as unknown as string }, null as unknown as { type: string }])).toBe(0)
  expect(contarTarefas(undefined)).toBe(0)
  expect(contarTarefas([])).toBe(0)
})

test('um agente conta enquanto não começou, corre ou espera numa tarefa sua', () => {
  const estados = ['pending', 'running', 'waiting', 'idle', 'completed', 'failed', 'killed']
  expect(contarAgentes(estados.map(status => ({ status })))).toBe(3)
  expect(contarAgentes(undefined)).toBe(0)
})

test('um Stop de antes de o turno começar ou de há mais de um minuto não vale', () => {
  const stop = { em: 100 * SEG, tarefas: 2, shells: 0 }
  expect(stopDoTurno(stop, 90 * SEG, 105 * SEG)).toBe(stop)
  expect(stopDoTurno(stop, 101 * SEG, 105 * SEG)).toBeUndefined()
  expect(stopDoTurno(stop, 90 * SEG, 100 * SEG + VALIDADE_STOP_MS)).toBeUndefined()
  expect(stopDoTurno(undefined, 90 * SEG, 105 * SEG)).toBeUndefined()
})

test('o trabalho em fundo é o maior entre o Stop deste turno e os agentes ativos', () => {
  const stop = { em: 100 * SEG, tarefas: 2, shells: 0 }
  expect(fundoDoFim({ stop, inicioDoTurno: 90 * SEG, agora: 101 * SEG, agentes: 0 })).toBe(2)
  expect(fundoDoFim({ stop, inicioDoTurno: 90 * SEG, agora: 101 * SEG, agentes: 3 })).toBe(3)
  expect(fundoDoFim({ stop: undefined, inicioDoTurno: 90 * SEG, agora: 101 * SEG, agentes: 1 })).toBe(1)
})

test('sem trabalho em fundo o chat fica à espera, mesmo com um Stop velho', () => {
  const velho = { em: 10 * SEG, tarefas: 4, shells: 0 }
  expect(fundoDoFim({ stop: velho, inicioDoTurno: 90 * SEG, agora: 101 * SEG, agentes: 0 })).toBe(0)
  expect(fundoDoFim({ stop: undefined, inicioDoTurno: 0, agora: 101 * SEG, agentes: 0 })).toBe(0)
})

test('o texto fala em tarefas no singular e no plural', () => {
  expect(textoDoFundo(1)).toBe('a aguardar 1 tarefa em fundo')
  expect(textoDoFundo(2)).toBe('a aguardar 2 tarefas em fundo')
})

test('um shell em fundo conta só durante 10 min desde que foi visto', () => {
  const stop = { em: 100 * SEG, tarefas: 0, shells: 1 }
  const base = { stop, inicioDoTurno: 90 * SEG, agora: 101 * SEG, agentes: 0 }
  expect(fundoDoFim({ ...base, shellsDesde: 100 * SEG })).toBe(1)
  expect(fundoDoFim({ ...base, shellsDesde: 101 * SEG - SHELL_MAX_MS })).toBe(0)
  expect(fundoDoFim(base)).toBe(0)
  expect(contarShells([{ type: 'shell' }, { type: 'monitor' }, { type: 'subagent' }])).toBe(1)
})
