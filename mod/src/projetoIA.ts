// O ponto de situação de cada projeto, escrito pela IA em texto corrido, como um assistente que explica à
// pessoa onde ficou tudo. O gestor junta o material de cada projeto (o que cada chat fez, o que falta, o
// que espera da pessoa) e deixa-o em projetos-ia/<id>.pedido.json com um `hash`; o mod, que tem acesso ao
// modelo, escreve a resposta em projetos-ia/<id>.json com o mesmo `hash`. Um pedido cujo hash já tem
// resposta não se gera outra vez.

export const MAX_POR_RONDA = 3
// Um chat que está a gerar um projeto marca-o com <id>.a-gerar.json; os outros chats esperam este tempo.
export const RESERVA_MS = 90_000
export const INTERVALO_PROJETOS_MS = 20_000

export const SISTEMA_PROJETO = `És o assistente pessoal de uma pessoa que trabalha em vários projetos com chats de IA. Explicas-lhe, de forma muito simples, o ponto de situação de UM projeto, para ela perceber sem pensar onde ficou tudo.
Responde só com JSON, sem texto à volta, neste formato:
{"ponto":"2 a 4 frases","tuaVez":"1 frase ou vazio","aSeguir":"1 frase ou vazio","feito":"2 a 3 frases","falta":"1 a 3 frases ou vazio"}
ponto: texto corrido, a falar com a pessoa por «tu». Diz o que é o projeto (numa palavra de contexto), o que já está resolvido e onde é que o trabalho parou exatamente. Sem listas, sem tópicos.
tuaVez: o que a pessoa tem de fazer agora para o projeto andar, como uma instrução concreta («Escolhe entre a música grátis da Meta e a Epidemic Sound»). Vazio se não depende dela.
aSeguir: o que vem a seguir no projeto depois disso, numa frase. Vazio se está tudo feito.
feito: o que já está feito no projeto todo, em texto corrido (2 a 3 frases), juntando o que é parecido e dizendo para que serve, sem listas.
falta: tudo o que ainda falta, em texto corrido (1 a 3 frases), do mais importante para o menos, dizendo o que depende da pessoa; vazio se nada falta.
Regras: linguagem do dia a dia, sem nomes de ficheiros, funções, comandos, ferramentas, siglas técnicas nem nomes de chats; traduz o técnico para o que significa («a página de pagamentos já aceita cartões» e não «o checkout.ts valida o PAN»). O que vem marcado «[a pessoa já fez isto]» está resolvido: conta-o como feito e não o voltes a pedir; se já nada depende dela, tuaVez fica vazio e diz no ponto que da parte dela está tudo em dia. Não inventes nada que não esteja no material, nem expliques o que uma coisa é se o material não o disser. Português de Portugal.`

// O resumo do dia: o ponto de situação de tudo, no topo do painel (pedido «dia», tipo 'dia').
export const SISTEMA_DIA = `És o assistente pessoal de uma pessoa que trabalha com vários chats de IA ao mesmo tempo. Fazes-lhe o ponto de situação de TUDO, para ela saber, sem pensar, o que fazer e não se esquecer de nada.
Responde só com JSON, sem texto à volta, neste formato:
{"ponto":"3 a 5 frases","tuaVez":"1 frase","aSeguir":"","feito":"","falta":""}
ponto: texto corrido a falar com a pessoa por «tu». Começa pelo que precisa dela e é mais importante; depois o que acabou e ficou para ela ver; o que está a andar sozinho; e no fim os projetos esquecidos e os lembretes. Agrupa o que é parecido, diz o nome dos projetos, sem listas nem tópicos.
tuaVez: a primeira coisa que ela deve fazer agora, como uma instrução concreta, com o nome do projeto. Se nada depende dela, diz que pode descansar ou pegar num projeto esquecido.
Regras: linguagem do dia a dia, sem nomes de ficheiros, comandos, ferramentas nem siglas técnicas; não inventes nada que não esteja no material. Português de Portugal.`

export type PedidoProjeto = { id: string; hash: string; em: number; entrada: string; tipo?: 'dia' }
export type PontoProjeto = { id: string; hash: string; em: number; ponto: string; tuaVez: string; aSeguir: string; feito: string; falta: string }

const limpo = (v: unknown, max: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max)

export function lerPedidoProjeto(texto: string): PedidoProjeto | undefined {
  try {
    const b = JSON.parse(texto)
    if (typeof b?.id !== 'string' || typeof b.hash !== 'string' || typeof b.entrada !== 'string' || !b.entrada.trim()) return undefined

    return { id: b.id, hash: b.hash, em: Number(b.em) || 0, entrada: b.entrada.slice(0, 12_000), ...(b.tipo === 'dia' ? { tipo: 'dia' as const } : {}) }
  } catch {
    return undefined
  }
}

export function lerPontoProjeto(texto: string, pedido: { id: string; hash: string }, em: number): PontoProjeto | undefined {
  const inicio = texto.indexOf('{')
  const fim = texto.lastIndexOf('}')
  if (inicio < 0 || fim <= inicio) return undefined
  let b: Record<string, unknown>
  try {
    b = JSON.parse(texto.slice(inicio, fim + 1))
  } catch {
    return undefined
  }
  const ponto = limpo(b.ponto, 700)
  if (!ponto) return undefined

  return {
    id: pedido.id,
    hash: pedido.hash,
    em,
    ponto,
    tuaVez: limpo(b.tuaVez, 220),
    aSeguir: limpo(b.aSeguir, 220),
    feito: limpo(b.feito, 600),
    falta: limpo(b.falta, 600),
  }
}

// Os ids que têm pedido por responder (sem resposta com o mesmo hash) e que nenhum chat está a gerar.
export function idsPorGerar(
  pedidos: readonly PedidoProjeto[],
  hashFeito: ReadonlyMap<string, string>,
  reservas: ReadonlyMap<string, number>,
  agora: number,
): PedidoProjeto[] {
  return pedidos
    .filter(p => hashFeito.get(p.id) !== p.hash && !(agora - (reservas.get(p.id) ?? -Infinity) < RESERVA_MS))
    .sort((a, b) => b.em - a.em)
    .slice(0, MAX_POR_RONDA)
}
