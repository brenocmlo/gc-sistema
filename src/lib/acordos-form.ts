// Schema e helpers puros do formulário de acordo (bloco 11.2). Sem
// 'use client' e sem React, como notas-fiscais-form.ts: o zod espelha os
// CHECKs de `acordos_pagamento` e `acordo_parcelas`, e a mesma regra roda de
// novo na Server Action, sobre o payload.
//
// O acordo nasce com as parcelas (RPC criar_acordo_com_parcelas, migration
// 036). O gerador monta a lista a partir do valor total, do número de
// parcelas, do primeiro vencimento e da periodicidade; depois a pessoa ajusta
// linha a linha antes de salvar.

import { z } from 'zod'

import { isAcordoMotivo, MOTIVO_ACORDO_LABELS } from './acordos.ts'
import type { AcordoMotivo } from './types'

const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/

export const PARCELAS_MAX = 120

export const PERIODICIDADES = ['mensal', 'quinzenal', 'semanal'] as const
export type Periodicidade = (typeof PERIODICIDADES)[number]

export const PERIODICIDADE_LABELS: Record<Periodicidade, string> = {
  mensal: 'Mensal',
  quinzenal: 'Quinzenal (15 dias)',
  semanal: 'Semanal',
}

/** Vínculo do acordo: o radio. O banco guarda os dois ids (CHECK acordo_vinculo_xor). */
export const VINCULOS_ACORDO = ['nenhum', 'contrato', 'proposta'] as const
export type VinculoAcordo = (typeof VINCULOS_ACORDO)[number]

/**
 * A data `k` períodos depois de `inicio`. Mensal mantém o dia e, quando o mês
 * não tem esse dia, cai no último (31/01 → 28/02 → 31/03, porque conta sempre
 * a partir do primeiro vencimento, não do anterior).
 */
export function somarPeriodos(inicio: string, periodicidade: Periodicidade, k: number): string {
  const [a, m, d] = inicio.split('-').map(Number)
  if (periodicidade === 'mensal') {
    const mes = m - 1 + k
    const ano = a + Math.floor(mes / 12)
    const mesNoAno = ((mes % 12) + 12) % 12
    const ultimoDia = new Date(Date.UTC(ano, mesNoAno + 1, 0)).getUTCDate()
    return new Date(Date.UTC(ano, mesNoAno, Math.min(d, ultimoDia))).toISOString().slice(0, 10)
  }
  const dias = periodicidade === 'quinzenal' ? 15 : 7
  return new Date(Date.UTC(a, m - 1, d + dias * k)).toISOString().slice(0, 10)
}

export type ParcelaGerada = { data_vencimento: string; valor_previsto: number }

/**
 * As parcelas do gerador. O valor é dividido em centavos: todas recebem a
 * parte inteira, e **a última leva a sobra** (1.000,00 em 3 = 333,33 +
 * 333,33 + 333,34), para a soma bater exatamente com o total.
 */
export function gerarParcelas(g: {
  valorTotal: number
  quantidade: number
  primeiroVencimento: string
  periodicidade: Periodicidade
}): { ok: true; parcelas: ParcelaGerada[] } | { ok: false; error: string } {
  const centavos = Math.round(Number(g.valorTotal) * 100)
  const n = Number(g.quantidade)
  if (!Number.isFinite(centavos) || centavos <= 0) return { ok: false, error: 'Informe o valor total' }
  if (!Number.isInteger(n) || n < 1) return { ok: false, error: 'Informe quantas parcelas' }
  if (n > PARCELAS_MAX) return { ok: false, error: `No máximo ${PARCELAS_MAX} parcelas` }
  if (centavos < n) return { ok: false, error: 'O valor total não dá um centavo por parcela' }
  if (!DATA_ISO.test(g.primeiroVencimento ?? '')) return { ok: false, error: 'Informe o primeiro vencimento' }
  if (!(PERIODICIDADES as readonly string[]).includes(g.periodicidade)) return { ok: false, error: 'Escolha a periodicidade' }

  const base = Math.floor(centavos / n)
  return {
    ok: true,
    parcelas: Array.from({ length: n }, (_, i) => ({
      data_vencimento: somarPeriodos(g.primeiroVencimento, g.periodicidade, i),
      valor_previsto: (i === n - 1 ? centavos - base * (n - 1) : base) / 100,
    })),
  }
}

/** A soma das parcelas, em centavos exatos (o "valor total do acordo"). */
export function totalDasParcelas(parcelas: readonly { valor_previsto: number | string }[]): number {
  return parcelas.reduce((acc, p) => acc + Math.round(Number(p.valor_previsto) * 100), 0) / 100
}

const MOTIVOS = Object.keys(MOTIVO_ACORDO_LABELS) as [AcordoMotivo, ...AcordoMotivo[]]

const parcelaSchema = z.object({
  data_vencimento: z.string().regex(DATA_ISO, 'Vencimento obrigatório'),
  // CHECK valor_previsto > 0
  valor_previsto: z.coerce.number({ message: 'Informe o valor' }).positive('Maior que zero'),
  observacao: z.string().max(500, 'Máximo 500 caracteres').optional().default(''),
})

export const acordoSchema = z
  .object({
    obra_id: z.string().uuid('Selecione uma obra'),
    descricao: z.string().trim().min(3, 'Descreva o acordo').max(200, 'Máximo 200 caracteres'),
    motivo: z.union([z.enum(MOTIVOS), z.literal('')]).optional().default(''),
    periodo_ref: z.string().trim().max(50, 'Máximo 50 caracteres').optional().default(''),
    data_abertura: z.string().regex(DATA_ISO, 'Data de abertura obrigatória'),
    vinculo: z.enum(VINCULOS_ACORDO),
    contrato_id: z.string().optional().default(''),
    proposta_id: z.string().optional().default(''),
    observacao: z.string().max(1000, 'Máximo 1000 caracteres').optional().default(''),
    parcelas: z.array(parcelaSchema).min(1, 'Gere ou adicione ao menos uma parcela').max(PARCELAS_MAX, `No máximo ${PARCELAS_MAX} parcelas`),
  })
  .superRefine((d, ctx) => {
    // CHECK acordo_vinculo_xor: o radio já impede os dois; aqui, o escolhido tem de vir preenchido.
    if (d.vinculo === 'contrato' && !d.contrato_id) ctx.addIssue({ path: ['contrato_id'], code: 'custom', message: 'Selecione o contrato' })
    if (d.vinculo === 'proposta' && !d.proposta_id) ctx.addIssue({ path: ['proposta_id'], code: 'custom', message: 'Selecione a proposta' })
  })

export type AcordoFormValues = z.input<typeof acordoSchema>

export type AcordoPayload = {
  obra_id: string
  descricao: string
  motivo: AcordoMotivo | null
  periodo_ref: string | null
  data_abertura: string
  contrato_id: string | null
  proposta_id: string | null
  observacao: string | null
  parcelas: { data_vencimento: string; valor_previsto: number; observacao: string | null }[]
}

function vazioParaNulo(v: string | null | undefined): string | null {
  const t = (v ?? '').trim()
  return t === '' ? null : t
}

export function acordoVazioFormValues(hoje: string): AcordoFormValues {
  return {
    obra_id: '',
    descricao: '',
    motivo: '',
    periodo_ref: '',
    data_abertura: hoje,
    vinculo: 'nenhum',
    contrato_id: '',
    proposta_id: '',
    observacao: '',
    parcelas: [],
  }
}

/** Form → payload: o vínculo vira os dois ids, só o escolhido preenchido. */
export function formParaPayloadAcordo(v: AcordoFormValues): AcordoPayload {
  return {
    obra_id: v.obra_id,
    descricao: (v.descricao ?? '').trim(),
    motivo: v.motivo && isAcordoMotivo(v.motivo) ? v.motivo : null,
    periodo_ref: vazioParaNulo(v.periodo_ref),
    data_abertura: v.data_abertura,
    contrato_id: v.vinculo === 'contrato' ? vazioParaNulo(v.contrato_id) : null,
    proposta_id: v.vinculo === 'proposta' ? vazioParaNulo(v.proposta_id) : null,
    observacao: vazioParaNulo(v.observacao),
    parcelas: (v.parcelas ?? []).map((p) => ({
      data_vencimento: p.data_vencimento,
      valor_previsto: Number(p.valor_previsto),
      observacao: vazioParaNulo(p.observacao),
    })),
  }
}

/** A regra do schema sobre o PAYLOAD, para a Server Action repetir. */
export function validarPayloadAcordo(p: Partial<AcordoPayload> | null | undefined): { ok: true } | { ok: false; error: string } {
  if (!p || typeof p !== 'object') return { ok: false, error: 'Dados do acordo ausentes' }
  if (!p.obra_id) return { ok: false, error: 'Selecione uma obra' }
  const descricao = (p.descricao ?? '').toString().trim()
  if (descricao.length < 3) return { ok: false, error: 'Descreva o acordo' }
  if (descricao.length > 200) return { ok: false, error: 'Descrição com mais de 200 caracteres' }
  if (p.motivo != null && !isAcordoMotivo(p.motivo)) return { ok: false, error: 'Motivo inválido' }
  if ((p.periodo_ref ?? '').length > 50) return { ok: false, error: 'Período de referência com mais de 50 caracteres' }
  if (!p.data_abertura || !DATA_ISO.test(p.data_abertura)) return { ok: false, error: 'Data de abertura obrigatória' }
  if (p.contrato_id && p.proposta_id) return { ok: false, error: 'O acordo é de um contrato OU de uma proposta, nunca dos dois' }
  if ((p.observacao ?? '').length > 1000) return { ok: false, error: 'Observação com mais de 1000 caracteres' }
  const parcelas = Array.isArray(p.parcelas) ? p.parcelas : []
  if (parcelas.length === 0) return { ok: false, error: 'O acordo precisa de ao menos uma parcela' }
  if (parcelas.length > PARCELAS_MAX) return { ok: false, error: `No máximo ${PARCELAS_MAX} parcelas` }
  for (let i = 0; i < parcelas.length; i++) {
    const parc = parcelas[i]
    if (!parc || !DATA_ISO.test(parc.data_vencimento ?? '')) return { ok: false, error: `Parcela ${i + 1}: vencimento inválido` }
    const v = Number(parc.valor_previsto)
    if (!Number.isFinite(v) || v <= 0) return { ok: false, error: `Parcela ${i + 1}: o valor tem de ser maior que zero` }
    if (Math.abs(Math.round(v * 100) - v * 100) > 1e-6) return { ok: false, error: `Parcela ${i + 1}: no máximo 2 casas decimais` }
  }
  return { ok: true }
}

/** Constraint do Postgres → mensagem da tela. */
export function mensagemDeErroAcordo(raw: string): string {
  if (raw.includes('acordo_vinculo_xor')) return 'O acordo é de um contrato OU de uma proposta, nunca dos dois'
  if (raw.includes('acordo_contrato_fk')) return 'O contrato tem de ser da mesma obra do acordo'
  if (raw.includes('acordo_proposta_fk')) return 'A proposta tem de ser da mesma obra do acordo'
  if (raw.includes('acordo_obra_fk')) return 'Obra inválida para esta empresa'
  if (raw.includes('acordo_sem_parcelas')) return 'O acordo precisa de ao menos uma parcela'
  if (raw.includes('acordo_parcelas_demais')) return `No máximo ${PARCELAS_MAX} parcelas`
  if (raw.includes('acordo_sem_empresa')) return 'Perfil sem empresa'
  if (raw.includes('acordo_parcelas_valor_previsto_check')) return 'Parcela com valor zero ou negativo'
  if (raw.includes('acordos_pagamento_motivo_check')) return 'Motivo inválido'
  if (raw.includes('acordo_nao_aberto')) return 'Só acordo aberto é convertido em nota fiscal'
  if (raw.includes('acordo_nao_encontrado')) return 'Acordo não encontrado'
  if (raw.includes('row-level security')) return 'Sem permissão pra criar acordos'
  return raw
}

/** Uma parcela adicionada ou editada no detalhe do acordo (11.3). */
export type ParcelaPayload = { data_vencimento: string; valor_previsto: number; observacao: string | null }

export function validarParcelaPayload(p: Partial<ParcelaPayload> | null | undefined): { ok: true } | { ok: false; error: string } {
  if (!p || typeof p !== 'object') return { ok: false, error: 'Dados da parcela ausentes' }
  if (!DATA_ISO.test(p.data_vencimento ?? '')) return { ok: false, error: 'Vencimento inválido' }
  const v = Number(p.valor_previsto)
  if (!Number.isFinite(v) || v <= 0) return { ok: false, error: 'O valor tem de ser maior que zero' }
  if (Math.abs(Math.round(v * 100) - v * 100) > 1e-6) return { ok: false, error: 'O valor tem no máximo 2 casas decimais' }
  if ((p.observacao ?? '').length > 500) return { ok: false, error: 'Observação com mais de 500 caracteres' }
  return { ok: true }
}
