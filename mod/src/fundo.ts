// Trabalho que fica a correr em fundo quando o turno principal de um chat acaba (subagentes, workflows).
// O chat parece parado, porque o modelo já respondeu, mas não está à tua espera: quando a tarefa acabar o
// motor acorda o modelo com o resultado. Sem isto o NextUp punha o chat em «à espera» (e, se o dispensavas,
// ele desaparecia de vez do painel enquanto os agentes trabalhavam).

// O que o motor entrega no Stop (`background_tasks`) e o que usamos dele. O tipo do motor não é exportado.
export type TarefaEmFundo = { type: string; status?: string }

// O que `$.agent.list()` devolve de cada agente, idem.
export type AgenteListado = { status: string }

// O Stop deste fim de turno: quando chegou e quantas tarefas que contam trazia.
export type StopVisto = { em: number; tarefas: number; shells: number }

// Conta sempre o que acaba por voltar ao chat com um resultado. Um monitor em fundo pode correr para sempre
// com o chat à tua espera, e esconder um chat que precisa de ti é pior do que mostrá-lo à espera sem precisar.
export const TIPOS_QUE_CONTAM: readonly string[] = ['subagent', 'workflow']

// Um shell em fundo (um build, um script) conta, mas só durante este tempo desde que o vimos: passado isto
// assume-se um servidor que corre para sempre e o chat volta a aparecer à tua espera.
export const SHELL_MAX_MS = 10 * 60_000

// Um agente está a trabalhar enquanto não começou, está a correr ou está parado numa tarefa sua. `idle` (entre
// turnos, à espera de uma mensagem) e os que acabaram não contam.
const ESTADOS_ATIVOS: readonly string[] = ['pending', 'running', 'waiting']

// Um Stop só vale para o turno que começou antes dele e se for recente: o de um turno anterior ficou para trás.
export const VALIDADE_STOP_MS = 60_000

export const contaComoTrabalho = (tarefa: TarefaEmFundo): boolean =>
  typeof tarefa?.type === 'string' && TIPOS_QUE_CONTAM.includes(tarefa.type.toLowerCase())

export const contarTarefas = (tarefas?: readonly TarefaEmFundo[]): number => (tarefas ?? []).filter(contaComoTrabalho).length

export const contarShells = (tarefas?: readonly TarefaEmFundo[]): number =>
  (tarefas ?? []).filter(t => typeof t?.type === 'string' && t.type.toLowerCase() === 'shell').length

export const contarAgentes =(agentes?: readonly AgenteListado[]): number =>
  (agentes ?? []).filter(agente => ESTADOS_ATIVOS.includes(agente?.status)).length

export function stopDoTurno(stop: StopVisto | undefined, inicioDoTurno: number, agora: number): StopVisto | undefined {
  return stop && stop.em >= inicioDoTurno && agora - stop.em < VALIDADE_STOP_MS ? stop : undefined
}

// Quanto trabalho em fundo havia quando o turno acabou: o do Stop deste turno ou os agentes que o motor lista
// como ativos, o que for mais (um subagente aparece nos dois; um workflow só no Stop).
// `shellsDesde` é quando os shells em fundo foram vistos pela primeira vez (sem eles, undefined).
export function fundoDoFim(entrada: { stop?: StopVisto; inicioDoTurno: number; agora: number; agentes: number; shellsDesde?: number }): number {
  const stop = stopDoTurno(entrada.stop, entrada.inicioDoTurno, entrada.agora)
  const shellsContam = entrada.shellsDesde !== undefined && entrada.agora - entrada.shellsDesde < SHELL_MAX_MS
  const firmes = Math.max(stop?.tarefas ?? 0, entrada.agentes)

  return firmes + (shellsContam ? (stop?.shells ?? 0) : 0)
}

export const textoDoFundo = (n: number): string => (n === 1 ? 'a aguardar 1 tarefa em fundo' : `a aguardar ${n} tarefas em fundo`)
