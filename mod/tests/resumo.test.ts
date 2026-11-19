import { expect, test } from 'claude-code/testing'

import {
  bloqueioDaFerramenta,
  bloqueioDePermissao,
  descreverAcao,
  INTERVALO_RESUMO_MS,
  juntarAcao,
  lerResumo,
  MAX_ACOES,
  MAX_PEDIDOS,
  montarPromptResumo,
  pedidosRecentes,
  resumoDevido,
  ultimoTextoDoChat,
} from '../src/resumo'

test('lê o resumo da IA mesmo com texto à volta', () => {
  const r = lerResumo('Aqui vai: {"titulo":" Loja:  corrigir checkout ","agora":"A testar o pagamento","precisa":""} fim', 7)
  expect(r?.titulo).toBe('Loja: corrigir checkout')
  expect(r?.agora).toBe('A testar o pagamento')
  expect(r?.precisa).toBe('Nada por agora')
  expect(r?.em).toBe(7)
})

test('resumo sem título ou sem «agora» não serve', () => {
  expect(lerResumo('{"titulo":"x"}', 1)).toBe(undefined)
  expect(lerResumo('não é json', 1)).toBe(undefined)
})

test('primeiro resumo do turno é sempre devido', () => {
  expect(resumoDevido(undefined, 0, undefined, 0)).toBe(true)
})

test('sem ações novas não se repete', () => {
  expect(resumoDevido({ em: 0, passo: 'A', acoes: 3 }, 10 * INTERVALO_RESUMO_MS, 'B', 3)).toBe(false)
})

test('passo novo com ações novas pede resumo logo', () => {
  expect(resumoDevido({ em: 0, passo: 'A', acoes: 3 }, 1000, 'B', 4)).toBe(true)
})

test('mesmo passo espera pelo intervalo', () => {
  expect(resumoDevido({ em: 0, passo: 'A', acoes: 3 }, INTERVALO_RESUMO_MS - 1, 'A', 9)).toBe(false)
  expect(resumoDevido({ em: 0, passo: 'A', acoes: 3 }, INTERVALO_RESUMO_MS, 'A', 9)).toBe(true)
})

test('a descrição da ação vale mais do que o comando', () => {
  expect(descreverAcao('Bash', { command: 'npm test', description: 'Correr os testes' })).toBe('Bash: Correr os testes')
  expect(descreverAcao('Read', { file_path: 'C:\\a\\b\\app.js' })).toBe('Read: app.js')
  expect(descreverAcao('mcp__Claude_Browser__navigate', { url: 'http://x' })).toBe('navigate: http://x')
})

test('guarda só as últimas ações', () => {
  let acoes: string[] = []
  for (let i = 0; i < MAX_ACOES + 3; i++) acoes = juntarAcao(acoes, String(i))
  expect(acoes.length).toBe(MAX_ACOES)
  expect(acoes.at(-1)).toBe(String(MAX_ACOES + 2))
})

test('pergunta e plano param o chat', () => {
  const b = bloqueioDaFerramenta('AskUserQuestion', { questions: [{ question: 'Que cor?' }] }, 5)
  expect(b?.texto).toBe('Responder: Que cor?')
  expect(b?.desde).toBe(5)
  expect(bloqueioDaFerramenta('ExitPlanMode', {}, 1)?.texto).toBe('Aprovar o plano que o chat propôs')
  expect(bloqueioDaFerramenta('Bash', { command: 'ls' }, 1)).toBe(undefined)
})

test('permissão diz o que vai correr', () => {
  expect(bloqueioDePermissao('Bash', { command: 'git push', description: 'Enviar para o GitHub' }, 1).texto).toBe(
    'Dar permissão: Bash: Enviar para o GitHub',
  )
})

test('último texto é o da mensagem do assistente mais recente com texto', () => {
  const t = ultimoTextoDoChat([
    { role: 'assistant', text: 'antigo' },
    { role: 'user', text: 'olá' },
    { role: 'assistant', text: 'novo' },
    { role: 'assistant', text: '  ' },
  ])
  expect(t).toBe('novo')
})

test('prompt leva o plano marcado e o título anterior', () => {
  const p = montarPromptResumo({
    projeto: 'loja',
    tituloAnterior: 'Loja: checkout',
    pedidos: ['corrige o checkout'],
    passos: [
      { texto: 'Ler', estado: 'completed' },
      { texto: 'Corrigir', estado: 'in_progress' },
    ],
    acoes: ['Read: app.js'],
    ultimoTexto: 'Encontrei o erro',
  })
  expect(p.includes('[x] Ler')).toBe(true)
  expect(p.includes('[>] Corrigir')).toBe(true)
  expect(p.includes('Título anterior: Loja: checkout')).toBe(true)
  expect(p.includes('- corrige o checkout')).toBe(true)
  expect(p.includes('Nome do chat')).toBe(false)
})

test('pedidos recentes: só os da pessoa, limpos, com o deste turno no fim', () => {
  const p = pedidosRecentes(
    [
      { role: 'user', text: 'um' },
      { role: 'assistant', text: 'ok' },
      { role: 'user', text: '' },
      { role: 'user', text: '<system-reminder>x</system-reminder> dois' },
    ],
    'três',
  )
  expect(p.join('|')).toBe('um|dois|três')
  expect(pedidosRecentes([{ role: 'user', text: 'três' }], 'três').join('|')).toBe('três')
  expect(pedidosRecentes(['a', 'b', 'c', 'd', 'e'].map(text => ({ role: 'user', text })), '').length).toBe(MAX_PEDIDOS)
})

test('permissão pedida para uma pergunta mostra a pergunta; sem pormenor não fica «:» no fim', () => {
  expect(bloqueioDePermissao('AskUserQuestion', { questions: [{ question: 'Que versão?' }] }, 1).texto).toBe('Responder: Que versão?')
  expect(bloqueioDePermissao('WebFetch', {}, 1).texto).toBe('Dar permissão: WebFetch')
})
