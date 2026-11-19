import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

// Lembretes (lembretes/<sessão>.json, escritos pelo mod quando a pessoa deixa algo para depois: ver
// mod/src/lembrete.ts). A partir de `quando` entram na espera do painel, explicados em linguagem simples;
// a pessoa dá-os por feitos ou adia-os. Um resolvido (voltou ao chat antes) ou feito nunca aparece.

const DIA = 86_400_000
export const MAX_ADIAR_DIAS = 30
const RE_ID = /^[0-9a-f-]{36}$/i

export const idValido = id => typeof id === 'string' && RE_ID.test(id)

export function lerLembrete(bruto) {
  if (!idValido(bruto?.id) || typeof bruto.texto !== 'string' || !bruto.texto.trim() || !Number.isFinite(bruto.quando)) return undefined

  return {
    id: bruto.id,
    sessao: typeof bruto.sessao === 'string' ? bruto.sessao : bruto.id,
    local: typeof bruto.local === 'string' ? bruto.local : '',
    projeto: String(bruto.projeto ?? ''),
    titulo: String(bruto.titulo ?? '').slice(0, 120),
    texto: bruto.texto.replace(/\s+/g, ' ').trim().slice(0, 300),
    criadoEm: Number.isFinite(bruto.criadoEm) ? bruto.criadoEm : bruto.quando,
    quando: bruto.quando,
    feitoEm: Number.isFinite(bruto.feitoEm) ? bruto.feitoEm : undefined,
    resolvidoEm: Number.isFinite(bruto.resolvidoEm) ? bruto.resolvidoEm : undefined,
  }
}

export async function lerLembretes(pasta) {
  const lista = []
  for (const nome of await readdir(pasta).catch(() => [])) {
    if (!nome.endsWith('.json')) continue
    try {
      const l = lerLembrete(JSON.parse(await readFile(join(pasta, nome), 'utf8')))
      if (l) lista.push(l)
    } catch {
      // ficheiro a meio de ser escrito: lê-se na próxima vez
    }
  }

  return lista
}

export const pendente = l => !l.feitoEm && !l.resolvidoEm

// Os que já chegaram à hora, do mais antigo para o mais recente; e quantos estão adiados para mais tarde.
export function separarLembretes(lista, agora) {
  const vivos = lista.filter(pendente)

  return {
    devidos: vivos.filter(l => l.quando <= agora).sort((a, b) => a.quando - b.quando),
    adiados: vivos.filter(l => l.quando > agora).sort((a, b) => a.quando - b.quando),
  }
}

// «feito» fecha-o; «adiar» volta daqui a `dias` (1 por omissão).
export async function aplicarLembrete(pasta, { id, acao, dias }, agora) {
  if (!idValido(id) || !['feito', 'adiar'].includes(acao)) return [400, { erro: 'pedido inválido' }]
  const caminho = join(pasta, `${id}.json`)
  let atual
  try { atual = JSON.parse(await readFile(caminho, 'utf8')) } catch { return [404, { erro: 'não existe' }] }
  const d = Number.isFinite(dias) ? Math.min(MAX_ADIAR_DIAS, Math.max(0.04, dias)) : 1
  const novo = acao === 'feito' ? { ...atual, feitoEm: agora } : { ...atual, quando: agora + d * DIA }
  await mkdir(pasta, { recursive: true })
  await writeFile(caminho, JSON.stringify(novo))

  return { ok: true }
}
