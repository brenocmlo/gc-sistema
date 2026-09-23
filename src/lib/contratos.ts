import { novaEntradaHistorico, type EntradaHistorico } from './historico.ts'
import type { ContratoStatus, MotivoRescisaoContrato } from './types'
import { MOTIVO_RESCISAO_LABELS } from './types.ts'

export const STATUS_CONTRATO_LABELS: Record<ContratoStatus, string> = {
  ativo: 'Ativo',
  suspenso: 'Suspenso',
  concluido: 'Concluído',
  rescindido: 'Rescindido',
}

export const STATUS_CONTRATO_OPTIONS: readonly {
  value: ContratoStatus
  label: string
}[] = (Object.keys(STATUS_CONTRATO_LABELS) as ContratoStatus[]).map((v) => ({
  value: v,
  label: STATUS_CONTRATO_LABELS[v],
}))

const VALID_STATUS: readonly ContratoStatus[] = Object.keys(
  STATUS_CONTRATO_LABELS,
) as ContratoStatus[]

/** Type guard pra querystring / input externo (?status=...). */
export function isContratoStatus(v: string): v is ContratoStatus {
  return (VALID_STATUS as readonly string[]).includes(v)
}

/**
 * Contrato é o pai editável dos itens só enquanto `ativo` — o equivalente do
 * `rascunho` da proposta. É a mesma regra que `trocar_numero_itens` e
 * `ajustar_valor_itens_contrato` conferem no banco (20260923161000).
 */
export function isContratoEditavel(s: ContratoStatus): boolean {
  return s === 'ativo'
}

// ============================================================
// Status (bloco 6.5)
// ============================================================

/**
 * Transições permitidas. O CHECK do banco só valida a lista de valores; o
 * fluxo é regra de aplicação, conferida pela Server Action contra o status
 * atual do banco.
 *
 *   ativo    → suspenso, concluído, rescindido
 *   suspenso → ativo (retomada), rescindido
 *   concluído e rescindido são terminais: contrato encerrado não reabre —
 *   aditivo ou retomada viram contrato novo, que é o que o 6.2 permite gerar
 *   de novo depois de uma rescisão.
 *
 * Suspenso não vai direto a concluído: encerrar um contrato parado sem
 * retomá-lo é quase sempre uma rescisão com outro nome.
 */
export const CONTRATO_TRANSICOES: Record<
  ContratoStatus,
  readonly ContratoStatus[]
> = {
  ativo: ['suspenso', 'concluido', 'rescindido'],
  suspenso: ['ativo', 'rescindido'],
  concluido: [],
  rescindido: [],
}

export function canChangeContratoStatus(
  de: ContratoStatus,
  para: ContratoStatus,
): boolean {
  if (de === para) return false
  return CONTRATO_TRANSICOES[de].includes(para)
}

/** Concluído ou rescindido: não muda mais de status nem é editável. */
export function isContratoFinalizado(s: ContratoStatus): boolean {
  return CONTRATO_TRANSICOES[s].length === 0
}

export const MOTIVO_RESCISAO_OPTIONS: readonly {
  value: MotivoRescisaoContrato
  label: string
}[] = (Object.keys(MOTIVO_RESCISAO_LABELS) as MotivoRescisaoContrato[]).map(
  (v) => ({ value: v, label: MOTIVO_RESCISAO_LABELS[v] }),
)

export function isMotivoRescisao(v: unknown): v is MotivoRescisaoContrato {
  return typeof v === 'string' && v in MOTIVO_RESCISAO_LABELS
}

/**
 * Espelha o CHECK `contratos_rescindido_motivo`: motivo obrigatório quando
 * rescindido, proibido em qualquer outro status. O `outro` exige o detalhe —
 * "Outro" sem explicação não diz nada a quem ler o contrato depois.
 */
export function validarRescisao(
  status: ContratoStatus,
  motivo: unknown,
  detalhe: string | null | undefined,
): { ok: true } | { ok: false; error: string } {
  if (status !== 'rescindido') {
    if (motivo) {
      return { ok: false, error: 'Motivo de rescisão só se aplica a contrato rescindido' }
    }
    return { ok: true }
  }
  if (!motivo) return { ok: false, error: 'Informe o motivo da rescisão' }
  if (!isMotivoRescisao(motivo)) return { ok: false, error: 'Motivo de rescisão inválido' }
  if (motivo === 'outro' && !(detalhe ?? '').trim()) {
    return { ok: false, error: 'Descreva o motivo quando escolher "Outro"' }
  }
  return { ok: true }
}

// ============================================================
// Histórico (bloco 6.5)
// ============================================================

/**
 * Mesmo formato de propostas e orçamentos (`./historico`), mais os dois
 * campos da rescisão. `motivo_rejeicao`/`detalhe_rejeicao` ficam nulos —
 * contrato não tem rejeição —, e é por isso que a aba Histórico lê as duas
 * famílias de campo.
 */
export type EntradaHistoricoContrato = EntradaHistorico<ContratoStatus> & {
  motivo_rescisao: MotivoRescisaoContrato | null
  detalhe_rescisao: string | null
}

export function novaEntradaHistoricoContrato(input: {
  de: ContratoStatus
  para: ContratoStatus
  por: string
  motivo_rescisao?: MotivoRescisaoContrato | null
  detalhe_rescisao?: string | null
  em?: string
}): EntradaHistoricoContrato {
  // statusDeRejeicao aponta pra um valor que contrato nunca tem: os campos de
  // rejeição saem sempre nulos.
  const base = novaEntradaHistorico<ContratoStatus | '__sem_rejeicao__'>({
    de: input.de,
    para: input.para,
    por: input.por,
    em: input.em,
    statusDeRejeicao: '__sem_rejeicao__',
  }) as EntradaHistorico<ContratoStatus>
  const rescindiu = input.para === 'rescindido'
  return {
    ...base,
    motivo_rescisao: rescindiu ? (input.motivo_rescisao ?? null) : null,
    detalhe_rescisao: rescindiu ? (input.detalhe_rescisao ?? null) : null,
  }
}

// ============================================================
// Erros do banco
// ============================================================

/** Constraint do Postgres → o que a pessoa precisa fazer. */
export function mensagemDeErroContrato(raw: string): string {
  if (raw.includes('contratos_empresa_id_numero_key')) {
    return 'Já existe um contrato com esse número'
  }
  if (raw.includes('contratos_desconto_valido')) {
    return 'Desconto não pode ser maior que o valor total'
  }
  if (raw.includes('contratos_pct_soma')) {
    return 'A soma das parcelas não pode passar de 100%'
  }
  if (raw.includes('contratos_rescindido_motivo')) {
    return 'Motivo de rescisão só se aplica a contrato rescindido'
  }
  if (raw.includes('contratos_obra_fk')) {
    return 'Obra inválida para esta empresa'
  }
  if (raw.includes('contratos_proposta_fk')) {
    return 'A proposta de origem tem de ser da mesma obra do contrato'
  }
  // Mensagens da função gerar_contrato_de_proposta (20260923162000).
  if (raw.includes('contrato_ja_gerado_da_proposta')) {
    return 'Já existe um contrato vigente gerado desta proposta'
  }
  if (raw.includes('contrato_proposta_nao_aprovada')) {
    return 'Só proposta aprovada gera contrato'
  }
  if (raw.includes('contrato_proposta_nao_encontrada')) {
    return 'Proposta não encontrada (ou sem permissão)'
  }
  if (raw.includes('contrato_numero_obrigatorio')) {
    return 'Número do contrato obrigatório'
  }
  if (raw.includes('contrato_soma_abaixo_do_desconto')) {
    return 'A soma dos itens da proposta é menor que o desconto. Reduza o desconto ou gere sem copiar os itens.'
  }
  if (raw.includes('violates foreign key constraint') && raw.includes('contratos')) {
    return 'Existe registro vinculado a este contrato'
  }
  return raw
}
