import type { MotivoRejeicao, Proposta, PropostaStatus } from './types'

// ============================================================
// Status
// ============================================================

export const STATUS_PROPOSTA_LABELS: Record<PropostaStatus, string> = {
  rascunho: 'Rascunho',
  enviada: 'Enviada',
  aprovada: 'Aprovada',
  rejeitada: 'Rejeitada',
}

export const STATUS_PROPOSTA_OPTIONS: readonly {
  value: PropostaStatus
  label: string
}[] = (Object.keys(STATUS_PROPOSTA_LABELS) as PropostaStatus[]).map((v) => ({
  value: v,
  label: STATUS_PROPOSTA_LABELS[v],
}))

const VALID_STATUS: readonly PropostaStatus[] = Object.keys(
  STATUS_PROPOSTA_LABELS,
) as PropostaStatus[]

/** Type guard pra querystring / input externo (?status=...). */
export function isPropostaStatus(v: string): v is PropostaStatus {
  return (VALID_STATUS as readonly string[]).includes(v)
}

export function formatStatusPropostaLabel(s: PropostaStatus): string {
  return STATUS_PROPOSTA_LABELS[s]
}

/**
 * Campos que o banco exige/limpa por status (mesmo padrão de orcamentos):
 *   - enviada   → data_envio obrigatória
 *   - aprovada  → data_decisao obrigatória
 *   - rejeitada → data_decisao + motivo_rejeicao obrigatórios
 *                 (CHECK propostas_rejeitada_motivo)
 *   - qualquer outro status → motivo_rejeicao/detalhe_rejeicao DEVEM ser null
 */
export function requiresDataEnvio(s: PropostaStatus): boolean {
  return s === 'enviada'
}

export function requiresDataDecisao(s: PropostaStatus): boolean {
  return s === 'aprovada' || s === 'rejeitada'
}

export function requiresMotivoRejeicao(s: PropostaStatus): boolean {
  return s === 'rejeitada'
}

/** Rascunho é o único status em que a proposta ainda pode ser editada livremente. */
export function isEditavel(s: PropostaStatus): boolean {
  return s === 'rascunho'
}

/** Status terminais — não voltam pro funil. */
export function isFinalizada(s: PropostaStatus): boolean {
  return s === 'aprovada' || s === 'rejeitada'
}

/**
 * Transições permitidas. O banco só valida a LISTA de valores
 * (CHECK propostas.status), então o fluxo é regra de aplicação:
 *   - rascunho  → enviada
 *   - enviada   → aprovada | rejeitada | rascunho (voltar pra correção)
 *   - aprovada / rejeitada são terminais (ver isFinalizada)
 *
 * Os terminais foram confirmados com a área comercial em 2026-09-03: decisão
 * registrada não volta pro funil, correção exige proposta nova. Não é
 * placeholder — mudar aqui muda uma regra acordada.
 */
export const PROPOSTA_TRANSICOES: Record<
  PropostaStatus,
  readonly PropostaStatus[]
> = {
  rascunho: ['enviada'],
  enviada: ['aprovada', 'rejeitada', 'rascunho'],
  aprovada: [],
  rejeitada: [],
}

export function canChangePropostaStatus(
  de: PropostaStatus,
  para: PropostaStatus,
): boolean {
  if (de === para) return true
  return PROPOSTA_TRANSICOES[de].includes(para)
}

/**
 * Validade expirada é DERIVADA em runtime — não existe status 'expirada'
 * no banco (diferente de orcamentos). Só faz sentido pra proposta enviada
 * e ainda sem decisão.
 */
export function isPropostaVencida(
  p: Pick<Proposta, 'status' | 'data_validade'>,
): boolean {
  if (p.status !== 'enviada') return false
  if (!p.data_validade) return false
  return p.data_validade < new Date().toISOString().slice(0, 10)
}

/**
 * Espelha o CHECK propostas_rejeitada_motivo: motivo é obrigatório
 * quando rejeitada e proibido em qualquer outro status.
 */
export function validarMotivoRejeicao(
  status: PropostaStatus,
  motivo: MotivoRejeicao | null,
): { ok: true } | { ok: false; error: string } {
  if (requiresMotivoRejeicao(status) && !motivo) {
    return { ok: false, error: 'Informe o motivo da rejeição' }
  }
  if (!requiresMotivoRejeicao(status) && motivo) {
    return {
      ok: false,
      error: 'Motivo de rejeição só se aplica a proposta rejeitada',
    }
  }
  return { ok: true }
}

// ============================================================
// Percentuais de pagamento (pct_*)
// ============================================================

/**
 * Os quatro pct_* de propostas. Guardados no banco como fração 0..1
 * (numeric(5,4)) — a UI trabalha em % (0..100), então converta nas bordas
 * com `pctToFraction` / `fractionToPct`.
 */
export const PCT_FIELDS = [
  'pct_sinal',
  'pct_fd',
  'pct_entrega_material',
  'pct_medicao_instalacao',
] as const

export type PctField = (typeof PCT_FIELDS)[number]

export const PCT_LABELS: Record<PctField, string> = {
  pct_sinal: 'Sinal',
  pct_fd: 'FD',
  pct_entrega_material: 'Entrega de material',
  pct_medicao_instalacao: 'Medição / instalação',
}

export type PctValues = Partial<Record<PctField, number | null>>

/** Soma das frações informadas (nulls contam como 0), igual ao COALESCE do CHECK. */
export function somaPct(values: PctValues): number {
  return PCT_FIELDS.reduce((acc, f) => acc + (values[f] ?? 0), 0)
}

// numeric(5,4) → 4 casas decimais. Arredondamos antes de comparar pra
// evitar falso positivo de float (ex: 0.1 + 0.2 = 0.30000000000000004).
function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000
}

export type PctValidacao =
  | { ok: true; soma: number; restante: number }
  | { ok: false; soma: number; restante: number; error: string }

/**
 * Espelha os CHECKs do banco:
 *   - propostas_pct_soma: soma dos coalesce(pct_*) <= 1.0
 *   - cada pct_* between 0 and 1
 *
 * `restante` é o que sobra pra "condicoes_pagamento" livre (0 = 100% coberto).
 */
export function validarSomaPct(values: PctValues): PctValidacao {
  const soma = round4(somaPct(values))
  const restante = round4(1 - soma)

  const foraDaFaixa = PCT_FIELDS.filter((f) => {
    const v = values[f]
    return v != null && (v < 0 || v > 1)
  })

  if (foraDaFaixa.length > 0) {
    return {
      ok: false,
      soma,
      restante,
      error: `Percentual inválido em ${foraDaFaixa
        .map((f) => PCT_LABELS[f])
        .join(', ')}: cada parcela precisa estar entre 0% e 100%.`,
    }
  }

  if (soma > 1) {
    return {
      ok: false,
      soma,
      restante,
      error: `A soma das parcelas é ${formatPct(soma)} e não pode passar de 100%.`,
    }
  }

  return { ok: true, soma, restante }
}

/** Fração ainda não alocada nos pct_* (0 = 100% coberto). */
export function pctRestante(values: PctValues): number {
  return round4(1 - somaPct(values))
}

/** Soma fecha exatamente 100%? (soma < 1 é válida no banco, mas incompleta) */
export function isPctCompleto(values: PctValues): boolean {
  return pctRestante(values) === 0
}

/** % da UI (0..100) → fração do banco (0..1). */
export function pctToFraction(pct: number | null | undefined): number | null {
  if (pct == null || Number.isNaN(pct)) return null
  return round4(pct / 100)
}

/** Fração do banco (0..1) → % da UI (0..100). */
export function fractionToPct(fraction: number | null | undefined): number {
  if (fraction == null || Number.isNaN(fraction)) return 0
  return Math.round(fraction * 10_000) / 100
}

/** Formata uma fração 0..1 como "12,5%". */
export function formatPct(fraction: number | null | undefined): string {
  return `${fractionToPct(fraction).toLocaleString('pt-BR', {
    maximumFractionDigits: 2,
  })}%`
}

/** Base de rateio: valor_final é generated no banco (valor_total - desconto). */
export function valorBaseProposta(
  p: Pick<Proposta, 'valor_total' | 'desconto' | 'valor_final'>,
): number {
  return p.valor_final ?? (p.valor_total ?? 0) - (p.desconto ?? 0)
}

/** Valor em R$ de uma parcela pct_* sobre o valor_final da proposta. */
export function valorParcela(
  valorFinal: number | null | undefined,
  fraction: number | null | undefined,
): number {
  const base = valorFinal ?? 0
  return Math.round(base * (fraction ?? 0) * 100) / 100
}

/**
 * Quebra o valor_final da proposta nas parcelas pct_* informadas.
 * Parcelas em 0/null são omitidas. Se sobrar percentual, entra como
 * `restante` pra UI decidir se mostra "a combinar".
 */
export function parcelasDaProposta(
  p: Pick<Proposta, 'valor_final' | PctField>,
): {
  parcelas: { field: PctField; label: string; fracao: number; valor: number }[]
  restante: number
  valorRestante: number
} {
  const parcelas = PCT_FIELDS.filter((f) => (p[f] ?? 0) > 0).map((f) => ({
    field: f,
    label: PCT_LABELS[f],
    fracao: p[f] ?? 0,
    valor: valorParcela(p.valor_final, p[f]),
  }))

  const restante = pctRestante(p)

  return {
    parcelas,
    restante,
    valorRestante: valorParcela(p.valor_final, restante),
  }
}

// ============================================================
// Busca da listagem
// ============================================================

/** O que a listagem precisa de cada obra pra resolver a busca. */
export type ObraBuscaRef = {
  id: string
  nome: string
  codigo_obra: string
  cliente_id: string
}

/**
 * Resolve a busca por nome de obra e nome de cliente em IDs de obra.
 *
 * Propostas não tem `cliente_id` (o cliente vem por obra, ver
 * `PropostaListItem`), então não existe `.or()` que alcance o nome do cliente
 * numa consulta só: a listagem resolve os IDs antes, igual orçamentos já faz
 * com cliente. A diferença é que aqui o passo de obra é feito em memória,
 * reusando a lista que a página já carregou pro select de obra — só o match de
 * cliente custa uma consulta.
 *
 * `clienteIds` são os clientes que casaram com o termo; passe vazio quando
 * nenhum casou.
 */
export function obraIdsDaBusca(
  obras: readonly ObraBuscaRef[],
  busca: string,
  clienteIds: readonly string[] = [],
): string[] {
  const termo = busca.trim().toLowerCase()
  if (!termo) return []

  const clientes = new Set(clienteIds)

  return obras
    .filter(
      (o) =>
        o.nome.toLowerCase().includes(termo) ||
        o.codigo_obra.toLowerCase().includes(termo) ||
        clientes.has(o.cliente_id),
    )
    .map((o) => o.id)
}

// ============================================================
// Regras do formulário (bloco 4.4)
// ============================================================

/**
 * Espelha o CHECK propostas_desconto_valido (`desconto <= valor_total`) e os
 * dois `check (>= 0)` das colunas. Fica aqui, e não no schema zod, pra ser
 * testável por `node --test` — o schema chama esta função no superRefine.
 */
export function validarDesconto(
  valorTotal: number,
  desconto: number,
): { ok: true } | { ok: false; error: string } {
  if (!Number.isFinite(valorTotal) || valorTotal < 0) {
    return { ok: false, error: 'Valor total não pode ser negativo' }
  }
  if (!Number.isFinite(desconto) || desconto < 0) {
    return { ok: false, error: 'Desconto não pode ser negativo' }
  }
  if (round2(desconto) > round2(valorTotal)) {
    return { ok: false, error: 'Desconto não pode ser maior que o valor total' }
  }
  return { ok: true }
}

// numeric(14,2) → duas casas. Mesmo motivo do round4: comparar float cru
// recusaria um desconto igual ao total que o banco aceitaria.
function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/** Valor final que o banco vai gerar (`valor_total - desconto`). */
export function calcularValorFinal(
  valorTotal: number,
  desconto: number,
): number {
  return round2((valorTotal || 0) - (desconto || 0))
}

/** Os quatro pct_* como o form os carrega: percentuais 0..100. */
export type PctFormValues = Record<PctField, number>

/** Form (0..100) → payload do banco (frações 0..1). */
export function pctFormToPayload(
  values: PctFormValues,
): Record<PctField, number | null> {
  return Object.fromEntries(
    PCT_FIELDS.map((f) => [f, pctToFraction(values[f])]),
  ) as Record<PctField, number | null>
}

/** Banco (frações 0..1) → form (0..100). */
export function pctPayloadToForm(p: PctValues): PctFormValues {
  return Object.fromEntries(
    PCT_FIELDS.map((f) => [f, fractionToPct(p[f])]),
  ) as PctFormValues
}

/**
 * `validarSomaPct` para valores da UI. Converte antes de validar, porque o
 * CHECK do banco fala em fração e o form fala em porcentagem — validar 0..100
 * direto contra o limite 1.0 reprovaria tudo.
 */
export function validarSomaPctForm(values: PctFormValues): PctValidacao {
  return validarSomaPct(pctFormToPayload(values))
}

/**
 * Traduz a violação de constraint do Postgres pro que a pessoa precisa fazer.
 * Sem isso a mais provável (número repetido) chega como "duplicate key value
 * violates unique constraint propostas_empresa_id_numero_key".
 */
export function mensagemDeErroProposta(raw: string): string {
  if (raw.includes('propostas_empresa_id_numero_key')) {
    return 'Já existe uma proposta com esse número'
  }
  if (raw.includes('propostas_desconto_valido')) {
    return 'Desconto não pode ser maior que o valor total'
  }
  if (raw.includes('propostas_pct_soma')) {
    return 'A soma das parcelas não pode passar de 100%'
  }
  if (raw.includes('propostas_rejeitada_motivo')) {
    return 'Motivo de rejeição só se aplica a proposta rejeitada'
  }
  if (raw.includes('propostas_obra_fk')) {
    return 'Obra inválida para esta empresa'
  }
  // ON DELETE RESTRICT: obra com proposta não é deletável.
  if (raw.includes('violates foreign key constraint') && raw.includes('propostas')) {
    return 'Existe registro vinculado a esta proposta'
  }
  return raw
}

// ============================================================
// Histórico de transições (bloco 4.6)
// ============================================================

/**
 * Uma entrada do jsonb `propostas.historico`, gravado pela migration
 * 20260905180000_propostas_historico.sql. Append-only: cada mudança de status
 * acrescenta uma entrada, nada é reescrito.
 */
export type EntradaHistorico = {
  de: PropostaStatus
  para: PropostaStatus
  em: string
  por: string
  motivo_rejeicao: MotivoRejeicao | null
  detalhe_rejeicao: string | null
}

export function novaEntradaHistorico(input: {
  de: PropostaStatus
  para: PropostaStatus
  por: string
  motivo_rejeicao?: MotivoRejeicao | null
  detalhe_rejeicao?: string | null
  em?: string
}): EntradaHistorico {
  return {
    de: input.de,
    para: input.para,
    em: input.em ?? new Date().toISOString(),
    por: input.por,
    // Motivo só faz sentido quando o destino é rejeitada — mesmo critério do
    // CHECK propostas_rejeitada_motivo, pra o histórico não guardar um motivo
    // que a linha não tem.
    motivo_rejeicao:
      input.para === 'rejeitada' ? (input.motivo_rejeicao ?? null) : null,
    detalhe_rejeicao:
      input.para === 'rejeitada' ? (input.detalhe_rejeicao ?? null) : null,
  }
}

/**
 * Acrescenta a entrada ao histórico existente. Tolera `null` e valor fora do
 * formato (jsonb aceita qualquer coisa que tenha sido gravada antes do CHECK
 * `propostas_historico_lista`) tratando como lista vazia — perder o append por
 * causa de um registro velho seria pior que perder o registro velho.
 */
export function appendHistorico(
  atual: unknown,
  entrada: EntradaHistorico,
): EntradaHistorico[] {
  const lista = Array.isArray(atual) ? (atual as EntradaHistorico[]) : []
  return [...lista, entrada]
}

/** Mais recente primeiro, para a aba de histórico da tela de detalhe. */
export function historicoOrdenado(atual: unknown): EntradaHistorico[] {
  const lista = Array.isArray(atual) ? (atual as EntradaHistorico[]) : []
  return [...lista].sort((a, b) => (a.em < b.em ? 1 : a.em > b.em ? -1 : 0))
}
