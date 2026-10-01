// Regras puras dos pagamentos (sprint 10). Sem React: serve Server Component,
// Server Action, rota de export e `node --test`.

import { numeroComSerie } from './notas-fiscais.ts'
import type { PagamentoForma, PagamentoListItem, PagamentoOrigem } from './types'

export const ORIGEM_PAGAMENTO_LABELS: Record<PagamentoOrigem, string> = {
  nf: 'NF',
  acordo: 'Acordo',
  avulso: 'Avulso',
}

export const ORIGEM_PAGAMENTO_OPTIONS: readonly { value: PagamentoOrigem; label: string }[] = (
  Object.keys(ORIGEM_PAGAMENTO_LABELS) as PagamentoOrigem[]
).map((v) => ({ value: v, label: ORIGEM_PAGAMENTO_LABELS[v] }))

export function isPagamentoOrigem(v: string): v is PagamentoOrigem {
  return v in ORIGEM_PAGAMENTO_LABELS
}

export const FORMA_PAGAMENTO_LABELS: Record<PagamentoForma, string> = {
  pix: 'Pix',
  ted: 'TED',
  boleto: 'Boleto',
  cartao: 'Cartão',
  deposito: 'Depósito',
  dinheiro: 'Dinheiro',
  cheque: 'Cheque',
  outro: 'Outro',
}

export const FORMA_PAGAMENTO_OPTIONS: readonly { value: PagamentoForma; label: string }[] = (
  Object.keys(FORMA_PAGAMENTO_LABELS) as PagamentoForma[]
).map((v) => ({ value: v, label: FORMA_PAGAMENTO_LABELS[v] }))

export function isPagamentoForma(v: string): v is PagamentoForma {
  return v in FORMA_PAGAMENTO_LABELS
}

/** A forma para a tela; o banco aceita forma nula (pagamento antigo, ou lançado sem ela). */
export function rotuloForma(forma: string | null | undefined): string {
  if (!forma) return '—'
  return isPagamentoForma(forma) ? FORMA_PAGAMENTO_LABELS[forma] : forma
}

/**
 * A coluna Documento: a NF com série, ou o acordo com o número da parcela. O
 * avulso não tem documento. Se o JOIN vier nulo (RLS, ou a NF apagada por quem
 * pode), mostra só a origem, para a linha não parecer avulsa.
 */
export function documentoDoPagamento(p: {
  origem: PagamentoListItem['origem']
  nota: { numero: string; serie: string | null } | null
  parcela: PagamentoListItem['parcela']
}): string {
  if (p.origem === 'nf') return p.nota ? `NF ${numeroComSerie(p.nota.numero, p.nota.serie)}` : 'NF'
  if (p.origem === 'acordo') {
    if (!p.parcela) return 'Acordo'
    const acordo = p.parcela.acordo?.descricao ?? 'Acordo'
    return `${acordo} · parcela ${p.parcela.numero_parcela}`
  }
  return '—'
}

/** Soma em centavos exatos (numeric(14,2) chega como number ou string). */
export function totalDosPagamentos(pagamentos: readonly { valor: number | string }[] | null | undefined): number {
  const centavos = (pagamentos ?? []).reduce((acc, p) => acc + Math.round(Number(p.valor) * 100), 0)
  return centavos / 100
}

/**
 * Por que o pagamento não pode ser estornado, ou null se pode. Estornar é
 * excluir o pagamento (o trigger recalcula o status da NF ou da parcela), e é
 * só do admin, como a exclusão de NF (9.4). O pagamento de NF cancelada fica
 * como histórico: o 9.4 congelou a nota, e o trigger não recalcula o status
 * dela.
 */
export function motivoParaNaoEstornar(
  perfil: string,
  notaStatus: string | null | undefined,
): string | null {
  if (perfil !== 'admin') return 'Só o admin estorna pagamentos'
  if (notaStatus === 'cancelada') return 'Pagamento de nota fiscal cancelada fica como histórico'
  return null
}

/** O que muda ao estornar, para o aviso do diálogo. */
export function avisoDoEstorno(origem: PagamentoOrigem): string {
  if (origem === 'nf') return 'O status da nota fiscal é recalculado: ela pode voltar a emitida ou a paga parcialmente.'
  if (origem === 'acordo') return 'O status da parcela é recalculado: ela pode voltar a pendente ou a paga parcialmente.'
  return 'O pagamento avulso sai do total recebido da obra.'
}
