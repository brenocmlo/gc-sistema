// Schema e helpers puros do formulário de nota fiscal (bloco 9.2). Sem
// 'use client' e sem React, como contratos-form.ts: o zod espelha os CHECKs de
// `notas_fiscais`, e a mesma regra roda de novo na Server Action, sobre o
// payload, porque o zod do form só roda no navegador.

import { z } from 'zod'

import { isNfTipo, TIPO_NF_LABELS } from './notas-fiscais.ts'
import type { NotaFiscal, NotaFiscalTipo } from './types'

const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/

/** Vínculo da NF: o radio do formulário. O banco guarda só os dois ids. */
export const VINCULOS_NF = ['nenhum', 'contrato', 'proposta'] as const
export type VinculoNf = (typeof VINCULOS_NF)[number]

export const VINCULO_NF_LABELS: Record<VinculoNf, string> = {
  nenhum: 'Sem vínculo',
  contrato: 'Contrato',
  proposta: 'Proposta',
}

/** A chave de acesso da NF-e tem 44 dígitos. Espaços e pontos colados saem. */
export function normalizarChaveNfe(v: string | null | undefined): string {
  return (v ?? '').replace(/[\s.\-/]/g, '')
}

export function validarChaveNfe(v: string | null | undefined): string | null {
  const chave = normalizarChaveNfe(v)
  if (chave === '') return null
  if (!/^\d{44}$/.test(chave)) return 'A chave da NF-e tem 44 dígitos'
  return null
}

const TIPOS = Object.keys(TIPO_NF_LABELS) as [NotaFiscalTipo, ...NotaFiscalTipo[]]

export const notaFiscalSchema = z
  .object({
    obra_id: z.string().uuid('Selecione uma obra'),
    // numero NOT NULL; (empresa, numero, série) é único.
    numero: z.string().trim().min(1, 'Número obrigatório').max(50, 'Máximo 50 caracteres'),
    serie: z.string().trim().max(10, 'Máximo 10 caracteres').optional().default(''),
    chave_nfe: z.string().optional().default(''),
    vinculo: z.enum(VINCULOS_NF),
    contrato_id: z.string().optional().default(''),
    proposta_id: z.string().optional().default(''),
    tipo: z.enum(TIPOS, { message: 'Selecione o tipo' }),
    data_emissao: z.string().regex(DATA_ISO, 'Data de emissão obrigatória'),
    data_vencimento: z.string().optional().default(''),
    // CHECK valor_total > 0
    valor_total: z.coerce.number({ message: 'Informe o valor' }).positive('O valor tem de ser maior que zero'),
    observacao: z.string().max(1000, 'Máximo 1000 caracteres').optional().default(''),
  })
  .superRefine((d, ctx) => {
    const chave = validarChaveNfe(d.chave_nfe)
    if (chave) ctx.addIssue({ path: ['chave_nfe'], code: 'custom', message: chave })
    // CHECK nf_vinculo_xor: o radio já impede os dois; aqui, o escolhido tem de vir preenchido.
    if (d.vinculo === 'contrato' && !d.contrato_id) {
      ctx.addIssue({ path: ['contrato_id'], code: 'custom', message: 'Selecione o contrato' })
    }
    if (d.vinculo === 'proposta' && !d.proposta_id) {
      ctx.addIssue({ path: ['proposta_id'], code: 'custom', message: 'Selecione a proposta' })
    }
    if (d.data_vencimento && !DATA_ISO.test(d.data_vencimento)) {
      ctx.addIssue({ path: ['data_vencimento'], code: 'custom', message: 'Data inválida' })
    } else if (d.data_vencimento && d.data_vencimento < d.data_emissao) {
      ctx.addIssue({ path: ['data_vencimento'], code: 'custom', message: 'O vencimento não pode ser antes da emissão' })
    }
  })

export type NotaFiscalFormValues = z.input<typeof notaFiscalSchema>

/** O que createNotaFiscal / updateNotaFiscal recebem. */
export type NotaFiscalPayload = {
  obra_id: string
  numero: string
  serie: string | null
  chave_nfe: string | null
  contrato_id: string | null
  proposta_id: string | null
  tipo: NotaFiscalTipo
  data_emissao: string
  data_vencimento: string | null
  valor_total: number
  observacao: string | null
}

function vazioParaNulo(v: string | null | undefined): string | null {
  const t = (v ?? '').trim()
  return t === '' ? null : t
}

/** Form → payload: o vínculo vira os dois ids, e só o do vínculo escolhido vai preenchido. */
export function formParaPayloadNf(v: NotaFiscalFormValues): NotaFiscalPayload {
  return {
    obra_id: v.obra_id,
    numero: (v.numero ?? '').trim(),
    serie: vazioParaNulo(v.serie),
    chave_nfe: vazioParaNulo(normalizarChaveNfe(v.chave_nfe)),
    contrato_id: v.vinculo === 'contrato' ? vazioParaNulo(v.contrato_id) : null,
    proposta_id: v.vinculo === 'proposta' ? vazioParaNulo(v.proposta_id) : null,
    tipo: v.tipo as NotaFiscalTipo,
    data_emissao: v.data_emissao,
    data_vencimento: vazioParaNulo(v.data_vencimento),
    valor_total: Number(v.valor_total),
    observacao: vazioParaNulo(v.observacao),
  }
}

export function nfVaziaFormValues(hoje: string): NotaFiscalFormValues {
  return {
    obra_id: '',
    numero: '',
    serie: '',
    chave_nfe: '',
    vinculo: 'nenhum',
    contrato_id: '',
    proposta_id: '',
    tipo: '' as NotaFiscalTipo,
    data_emissao: hoje,
    data_vencimento: '',
    valor_total: '' as unknown as number,
    observacao: '',
  }
}

/** NF do banco → valores do form (edição, 9.3). */
export function nfParaFormValues(nf: NotaFiscal): NotaFiscalFormValues {
  return {
    obra_id: nf.obra_id,
    numero: nf.numero,
    serie: nf.serie ?? '',
    chave_nfe: nf.chave_nfe ?? '',
    vinculo: nf.contrato_id ? 'contrato' : nf.proposta_id ? 'proposta' : 'nenhum',
    contrato_id: nf.contrato_id ?? '',
    proposta_id: nf.proposta_id ?? '',
    tipo: nf.tipo,
    data_emissao: nf.data_emissao,
    data_vencimento: nf.data_vencimento ?? '',
    valor_total: nf.valor_total,
    observacao: nf.observacao ?? '',
  }
}

/**
 * A regra do schema sobre o PAYLOAD, para a Server Action repetir: o POST
 * pode vir de qualquer lugar, com os dois vínculos preenchidos.
 */
export function validarPayloadNf(
  p: Partial<NotaFiscalPayload> | null | undefined,
): { ok: true } | { ok: false; error: string } {
  if (!p || typeof p !== 'object') return { ok: false, error: 'Dados da nota fiscal ausentes' }
  if (!p.obra_id) return { ok: false, error: 'Selecione uma obra' }
  const numero = (p.numero ?? '').toString().trim()
  if (!numero) return { ok: false, error: 'Número obrigatório' }
  if (numero.length > 50) return { ok: false, error: 'Número com mais de 50 caracteres' }
  if ((p.serie ?? '').toString().length > 10) return { ok: false, error: 'Série com mais de 10 caracteres' }
  const chave = validarChaveNfe(p.chave_nfe)
  if (chave) return { ok: false, error: chave }
  if (p.contrato_id && p.proposta_id) {
    return { ok: false, error: 'A nota fiscal é de um contrato OU de uma proposta, nunca dos dois' }
  }
  if (!p.tipo || !isNfTipo(p.tipo)) return { ok: false, error: 'Tipo de nota fiscal inválido' }
  if (!p.data_emissao || !DATA_ISO.test(p.data_emissao)) return { ok: false, error: 'Data de emissão obrigatória' }
  if (p.data_vencimento) {
    if (!DATA_ISO.test(p.data_vencimento)) return { ok: false, error: 'Data de vencimento inválida' }
    if (p.data_vencimento < p.data_emissao) return { ok: false, error: 'O vencimento não pode ser antes da emissão' }
  }
  const valor = Number(p.valor_total)
  if (!Number.isFinite(valor) || valor <= 0) return { ok: false, error: 'O valor tem de ser maior que zero' }
  if (Math.round(valor * 100) !== valor * 100 && Math.abs(Math.round(valor * 100) - valor * 100) > 1e-6) {
    return { ok: false, error: 'O valor tem no máximo 2 casas decimais' }
  }
  return { ok: true }
}

/** Constraint do Postgres → mensagem da tela. */
export function mensagemDeErroNf(raw: string): string {
  if (raw.includes('idx_nfs_chave_nfe_unique')) return 'Já existe uma nota fiscal com essa chave de NF-e'
  if (raw.includes('idx_notas_numero_serie_unique')) return 'Já existe uma nota fiscal com esse número e série'
  if (raw.includes('nf_vinculo_xor')) return 'A nota fiscal é de um contrato OU de uma proposta, nunca dos dois'
  if (raw.includes('nf_contrato_fk')) return 'O contrato tem de ser da mesma obra da nota fiscal'
  if (raw.includes('nf_proposta_fk')) return 'A proposta tem de ser da mesma obra da nota fiscal'
  if (raw.includes('nf_obra_fk')) return 'Obra inválida para esta empresa'
  if (raw.includes('notas_fiscais_valor_total_check')) return 'O valor tem de ser maior que zero'
  if (raw.includes('notas_fiscais_tipo_check')) return 'Tipo de nota fiscal inválido'
  if (raw.includes('nf_cancelada_motivo')) return 'Nota fiscal cancelada precisa do motivo'
  if (raw.includes('nf_cancelada_imutavel')) return 'Nota fiscal cancelada não pode ser alterada'
  if (raw.includes('pagamento_nf_cancelada')) return 'Nota fiscal cancelada não recebe pagamento'
  if (raw.includes('pagamentos_nota_fk')) return 'Nota fiscal com pagamento não pode ser excluída'
  return raw
}
