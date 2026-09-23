/**
 * Histórico de transições de status, append-only, guardado numa coluna jsonb.
 *
 * Nasceu em Propostas (bloco 4.6) e foi extraído pra cá quando Orçamentos
 * precisou do mesmo — o formato era "pra copiar", e código copiado é código que
 * diverge. Genérico no tipo de status: cada entidade passa o seu.
 *
 * Quem grava: a Server Action de mudança de status, no mesmo `update` do
 * status, pra não existir janela em que o status mudou e o registro não.
 * Quem lê: a aba Histórico da tela de detalhe.
 */
import type { MotivoRejeicao } from './types'

/** Uma transição registrada. `por` é o uuid do profile que mudou. */
export type EntradaHistorico<S extends string = string> = {
  de: S
  para: S
  em: string
  por: string
  motivo_rejeicao: MotivoRejeicao | null
  detalhe_rejeicao: string | null
}

/**
 * Monta a entrada. `statusDeRejeicao` diz qual valor, naquela entidade, é o
 * status de rejeição — 'rejeitada' em propostas, 'rejeitado' em orçamentos.
 * Motivo só é guardado quando o destino é esse status, mesmo critério do CHECK
 * do banco: o histórico não registra um motivo que a linha não tem.
 */
export function novaEntradaHistorico<S extends string>(input: {
  de: S
  para: S
  por: string
  statusDeRejeicao: S
  motivo_rejeicao?: MotivoRejeicao | null
  detalhe_rejeicao?: string | null
  em?: string
}): EntradaHistorico<S> {
  const rejeitou = input.para === input.statusDeRejeicao
  return {
    de: input.de,
    para: input.para,
    em: input.em ?? new Date().toISOString(),
    por: input.por,
    motivo_rejeicao: rejeitou ? (input.motivo_rejeicao ?? null) : null,
    detalhe_rejeicao: rejeitou ? (input.detalhe_rejeicao ?? null) : null,
  }
}

/**
 * Acrescenta a entrada ao histórico existente. Tolera `null` e valor fora do
 * formato (jsonb aceita o que foi gravado antes do CHECK de lista) tratando
 * como lista vazia — perder o append por causa de um registro velho seria pior
 * que perder o registro velho.
 */
export function appendHistorico<S extends string>(
  atual: unknown,
  entrada: EntradaHistorico<S>,
): EntradaHistorico<S>[] {
  const lista = Array.isArray(atual) ? (atual as EntradaHistorico<S>[]) : []
  return [...lista, entrada]
}

/** Mais recente primeiro, para a aba de histórico. */
export function historicoOrdenado<S extends string = string>(
  atual: unknown,
): EntradaHistorico<S>[] {
  const lista = Array.isArray(atual) ? (atual as EntradaHistorico<S>[]) : []
  return [...lista].sort((a, b) => (a.em < b.em ? 1 : a.em > b.em ? -1 : 0))
}

/**
 * Atalho pra orçamentos: o status de rejeição lá é masculino (`rejeitado`),
 * contra `rejeitada` em propostas. Errar isso não quebra o build — só faz o
 * histórico deixar de gravar o motivo —, então cada entidade tem o seu atalho
 * em vez de o chamador lembrar da string.
 */
export function novaEntradaHistoricoOrcamento(input: {
  de: string
  para: string
  por: string
  motivo_rejeicao?: MotivoRejeicao | null
  detalhe_rejeicao?: string | null
  em?: string
}): EntradaHistorico {
  return novaEntradaHistorico({ ...input, statusDeRejeicao: 'rejeitado' })
}
