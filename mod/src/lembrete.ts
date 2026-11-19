import type { Classificacao, Item, Lembrete } from '../types'

const DIA = 86_400_000

// O lembrete de um chat depois de um turno: um novo quando a IA viu algo adiado (substitui o anterior desse
// chat); o anterior dado por resolvido quando a pessoa voltou ao chat e já nada ficou para depois; ou nada a
// escrever (sem classificação, ou sem lembrete pendente).
export function lembreteDoTurno(
  anterior: Lembrete | undefined,
  item: Pick<Item, 'sessao' | 'local' | 'projeto' | 'titulo' | 'tituloIA'>,
  classificacao: Classificacao | undefined,
  agora: number,
): Lembrete | undefined {
  if (!classificacao) return undefined
  const pedido = classificacao.lembrete
  if (pedido) {
    return {
      id: item.sessao,
      sessao: item.sessao,
      local: item.local,
      projeto: item.projeto,
      titulo: item.tituloIA || item.titulo,
      texto: pedido.texto,
      criadoEm: agora,
      quando: agora + pedido.dias * DIA,
    }
  }
  if (anterior && !anterior.feitoEm && !anterior.resolvidoEm) return { ...anterior, resolvidoEm: agora }

  return undefined
}
