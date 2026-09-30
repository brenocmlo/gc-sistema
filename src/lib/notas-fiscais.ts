// Regras puras das notas fiscais (sprint 9). Sem React: serve Server
// Component, Server Action, rota de export e `node --test`.

import type { NotaFiscalStatus, NotaFiscalTipo } from './types'

export const STATUS_NF_LABELS: Record<NotaFiscalStatus, string> = {
  emitida: 'Emitida',
  paga_parcialmente: 'Paga parcialmente',
  paga: 'Paga',
  cancelada: 'Cancelada',
}

/**
 * O que a tela mostra: os 4 status do banco, e "vencida", que NÃO é coluna —
 * é calculada em runtime (como o atraso da execução no 7.5): NF emitida ou
 * paga parcialmente com vencimento antes de hoje.
 */
export type SituacaoNf = NotaFiscalStatus | 'vencida'

export const SITUACAO_NF_LABELS: Record<SituacaoNf, string> = {
  ...STATUS_NF_LABELS,
  vencida: 'Vencida',
}

export const SITUACAO_NF_CLASSES: Record<SituacaoNf, string> = {
  emitida: 'bg-blue-100 text-blue-700 border-blue-200',
  paga_parcialmente: 'bg-yellow-100 text-yellow-700 border-yellow-200',
  paga: 'bg-green-100 text-green-700 border-green-200',
  cancelada: 'bg-gray-100 text-gray-600 border-gray-200',
  vencida: 'bg-red-100 text-red-700 border-red-200',
}

export const SITUACAO_NF_OPTIONS: readonly { value: SituacaoNf; label: string }[] = (
  ['emitida', 'vencida', 'paga_parcialmente', 'paga', 'cancelada'] as const
).map((v) => ({ value: v, label: SITUACAO_NF_LABELS[v] }))

export function isSituacaoNf(v: string): v is SituacaoNf {
  return v in SITUACAO_NF_LABELS
}

export const TIPO_NF_LABELS: Record<NotaFiscalTipo, string> = {
  sinal: 'Sinal',
  entrega_material: 'Entrega de material',
  medicao: 'Medição',
  instalacao: 'Instalação',
  fat_direto: 'Faturamento direto',
  outro: 'Outro',
}

export const TIPO_NF_OPTIONS: readonly { value: NotaFiscalTipo; label: string }[] = (
  Object.keys(TIPO_NF_LABELS) as NotaFiscalTipo[]
).map((v) => ({ value: v, label: TIPO_NF_LABELS[v] }))

export function isNfTipo(v: string): v is NotaFiscalTipo {
  return v in TIPO_NF_LABELS
}

/** Status que ainda esperam recebimento: são os que podem vencer. */
const EM_ABERTO: readonly NotaFiscalStatus[] = ['emitida', 'paga_parcialmente']

/** A situação da tela: vencida sobrepõe emitida e paga parcialmente. Vencer hoje ainda não é vencida. */
export function situacaoDaNf(
  nf: { status: NotaFiscalStatus; data_vencimento: string | null },
  hoje: string,
): SituacaoNf {
  if (EM_ABERTO.includes(nf.status) && nf.data_vencimento && nf.data_vencimento < hoje) return 'vencida'
  return nf.status
}

/**
 * O filtro de situação vira condição no banco. "vencida" é runtime, mas dá
 * para filtrar no servidor com as mesmas regras de `situacaoDaNf`; emitida e
 * paga parcialmente, pelo mesmo motivo, excluem as vencidas.
 */
export type FiltroSituacao =
  | { status: NotaFiscalStatus[]; vencimentoAntesDe?: string; naoVencidaEm?: string }

export function filtroDaSituacao(situacao: SituacaoNf, hoje: string): FiltroSituacao {
  if (situacao === 'vencida') return { status: [...EM_ABERTO], vencimentoAntesDe: hoje }
  if (EM_ABERTO.includes(situacao)) return { status: [situacao], naoVencidaEm: hoje }
  return { status: [situacao] }
}

/** "123" ou "123 / 1": o número com a série, quando há. */
export function numeroComSerie(numero: string, serie: string | null | undefined): string {
  const s = (serie ?? '').trim()
  return s ? `${numero} / ${s}` : numero
}

/** Soma dos pagamentos da NF, em centavos exatos (o "Recebido" da listagem). */
export function recebidoDaNf(pagamentos: readonly { valor: number | string }[] | null | undefined): number {
  const centavos = (pagamentos ?? []).reduce((acc, p) => acc + Math.round(Number(p.valor) * 100), 0)
  return centavos / 100
}

/**
 * Regra 6 do CONTEXT: NF cancelada é terminal. Não edita, não exclui, não
 * recebe pagamento — e os triggers de status não a sobrescrevem.
 */
export function isNfEditavel(status: NotaFiscalStatus): boolean {
  return status !== 'cancelada'
}

// ============================================================
// Cancelamento e exclusão (bloco 9.4)
// ============================================================

export const MOTIVO_CANCELAMENTO_MAX = 1000

/** Motivo obrigatório (CHECK nf_cancelada_motivo), aparado, até 1000 caracteres. */
export function validarMotivoCancelamento(
  motivo: unknown,
): { ok: true; motivo: string } | { ok: false; error: string } {
  const m = typeof motivo === 'string' ? motivo.trim() : ''
  if (m.length < 5) return { ok: false, error: 'Descreva o motivo do cancelamento (pelo menos 5 caracteres)' }
  if (m.length > MOTIVO_CANCELAMENTO_MAX) return { ok: false, error: `Motivo com mais de ${MOTIVO_CANCELAMENTO_MAX} caracteres` }
  return { ok: true, motivo: m }
}

/**
 * Excluir: só admin (a policy de delete), nunca a cancelada (terminal: fica
 * como registro fiscal) e nunca com pagamento (a FK pagamentos_nota_fk é
 * restrict — e apagar esconderia dinheiro recebido).
 */
export function motivoParaNaoExcluir(
  nf: { status: NotaFiscalStatus; qtdPagamentos: number },
  perfil: string,
): string | null {
  if (perfil !== 'admin') return 'Só o admin exclui nota fiscal'
  if (nf.status === 'cancelada') return 'Nota fiscal cancelada não é excluída: fica como registro'
  if (nf.qtdPagamentos > 0) return 'Nota fiscal com pagamento não pode ser excluída; cancele, se for o caso'
  return null
}
