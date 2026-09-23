// Schema e helpers puros do form de contrato. SEM 'use client' e sem React,
// pra servir Server Component, Server Action e Client Component.
//
// Mora em src/lib/ (e não ao lado do form, como proposta-form-helpers.ts)
// pelo mesmo motivo de itens-form.ts: o bloco 6.3 pede "zod espelhando as
// constraints do banco", e aqui ele é coberto por `node --test`. Reusa as
// regras já testadas de ./propostas (desconto, soma dos pct_*, 0..100 ↔ 0..1).

import { z } from 'zod'

import {
  PCT_FIELDS,
  pctFormToPayload,
  pctPayloadToForm,
  validarDesconto,
  validarSomaPct,
  validarSomaPctForm,
  type PctField,
  type PctFormValues,
} from './propostas.ts'
import type { Contrato, Proposta } from './types'

const pctSchema = z.coerce
  .number()
  .min(0, 'Mínimo 0%')
  .max(100, 'Máximo 100%')
  .default(0)

export const contratoSchema = z
  .object({
    // NOT NULL e unique por empresa (`contratos_empresa_id_numero_key`).
    numero: z.string().trim().min(1, 'Número obrigatório').max(50, 'Máximo 50 caracteres'),
    obra_id: z.string().uuid('Selecione uma obra'),
    // Opcional: o contrato pode ser lançado antes da assinatura.
    data_assinatura: z.string().optional().default(''),
    prazo_execucao: z.string().max(500, 'Máximo 500 caracteres').optional().default(''),
    descricao: z.string().max(2000, 'Máximo 2000 caracteres').optional().default(''),
    valor_total: z.coerce.number().min(0, 'Valor não pode ser negativo').default(0),
    desconto: z.coerce.number().min(0, 'Desconto não pode ser negativo').default(0),
    pct_sinal: pctSchema,
    pct_fd: pctSchema,
    pct_entrega_material: pctSchema,
    pct_medicao_instalacao: pctSchema,
    condicoes_pagamento: z.string().max(1000, 'Máximo 1000 caracteres').optional().default(''),
    observacao: z.string().max(1000, 'Máximo 1000 caracteres').optional().default(''),
  })
  .superRefine((data, ctx) => {
    // CHECK contratos_desconto_valido (20260923160000)
    const desconto = validarDesconto(
      Number(data.valor_total ?? 0),
      Number(data.desconto ?? 0),
    )
    if (!desconto.ok) {
      ctx.addIssue({ path: ['desconto'], code: 'custom', message: desconto.error })
    }

    // CHECK contratos_pct_soma — "soma pct ≤ 100%" do bloco 6.3. O erro vai no
    // último percentual porque a soma não tem campo próprio na tela.
    const soma = validarSomaPctForm(pctFromValues(data))
    if (!soma.ok) {
      ctx.addIssue({
        path: ['pct_medicao_instalacao'],
        code: 'custom',
        message: soma.error,
      })
    }
  })

export type ContratoFormValues = z.input<typeof contratoSchema>

/** Payload aceito por createContrato / updateContrato (pct_* já em fração). */
export type ContratoPayload = {
  numero: string
  obra_id: string
  data_assinatura: string | null
  prazo_execucao: string | null
  descricao: string | null
  valor_total: number
  desconto: number
  condicoes_pagamento: string | null
  observacao: string | null
} & Record<PctField, number | null>

function emptyToNull(value: string | undefined | null): string | null {
  const trimmed = (value ?? '').trim()
  return trimmed === '' ? null : trimmed
}

function pctFromValues(values: Partial<ContratoFormValues>): PctFormValues {
  return Object.fromEntries(
    PCT_FIELDS.map((f) => [f, Number(values[f] ?? 0)]),
  ) as PctFormValues
}

/** Valores do form (strings vazias, % em 0..100) → payload (nulls, frações). */
export function formValuesToPayload(values: ContratoFormValues): ContratoPayload {
  return {
    numero: (values.numero ?? '').trim(),
    obra_id: values.obra_id,
    data_assinatura: emptyToNull(values.data_assinatura),
    prazo_execucao: emptyToNull(values.prazo_execucao),
    descricao: emptyToNull(values.descricao),
    valor_total: Number(values.valor_total ?? 0),
    desconto: Number(values.desconto ?? 0),
    condicoes_pagamento: emptyToNull(values.condicoes_pagamento),
    observacao: emptyToNull(values.observacao),
    ...pctFormToPayload(pctFromValues(values)),
  }
}

/** Contrato do banco → valores iniciais do form (nulls → '', frações → %). */
export function contratoToFormValues(c: Contrato): ContratoFormValues {
  return {
    numero: c.numero,
    obra_id: c.obra_id,
    data_assinatura: c.data_assinatura ?? '',
    prazo_execucao: c.prazo_execucao ?? '',
    descricao: c.descricao ?? '',
    valor_total: c.valor_total ?? 0,
    desconto: c.desconto ?? 0,
    condicoes_pagamento: c.condicoes_pagamento ?? '',
    observacao: c.observacao ?? '',
    ...pctPayloadToForm(c),
  }
}

/**
 * Bloco 6.2: o form de "Gerar contrato" nasce com os valores, os pct_* e as
 * condições da proposta. O número NÃO é copiado — contrato e proposta têm
 * numerações próprias, e copiar levaria a pessoa a salvar um número de
 * proposta como número de contrato. Com itens, o valor já vem como a soma
 * deles, que é o que o contrato vai ter.
 */
export function propostaToContratoFormValues(
  p: Proposta,
  somaItens: number | null,
): ContratoFormValues {
  return {
    numero: '',
    obra_id: p.obra_id,
    data_assinatura: new Date().toISOString().slice(0, 10),
    prazo_execucao: '',
    descricao: p.descricao ?? '',
    valor_total: somaItens ?? p.valor_total ?? 0,
    desconto: p.desconto ?? 0,
    condicoes_pagamento: p.condicoes_pagamento ?? '',
    observacao: p.observacao ?? '',
    ...pctPayloadToForm(p),
  }
}

export function emptyContratoFormValues(): ContratoFormValues {
  return {
    numero: '',
    obra_id: '',
    data_assinatura: '',
    prazo_execucao: '',
    descricao: '',
    valor_total: 0,
    desconto: 0,
    condicoes_pagamento: '',
    observacao: '',
    pct_sinal: 0,
    pct_fd: 0,
    pct_entrega_material: 0,
    pct_medicao_instalacao: 0,
  }
}

/**
 * A mesma regra do schema, sobre o PAYLOAD (pct_* já em fração), para a
 * Server Action repetir por conta própria: o zod do form só roda no
 * navegador, e a action é um POST que qualquer um chama. Espelha os CHECKs
 * de `contratos`: número obrigatório, valor e desconto não negativos,
 * `contratos_desconto_valido`, cada pct entre 0 e 1 e `contratos_pct_soma`.
 */
export function validarPayloadContrato(
  p: Partial<ContratoPayload> | null | undefined,
): { ok: true } | { ok: false; error: string } {
  if (!p || typeof p !== 'object') return { ok: false, error: 'Dados do contrato ausentes' }
  if (!(p.numero ?? '').toString().trim()) return { ok: false, error: 'Número obrigatório' }
  if ((p.numero ?? '').toString().trim().length > 50) {
    return { ok: false, error: 'Número com mais de 50 caracteres' }
  }
  if (!p.obra_id) return { ok: false, error: 'Selecione uma obra' }

  const valor = Number(p.valor_total ?? 0)
  const desconto = Number(p.desconto ?? 0)
  if (!Number.isFinite(valor) || !Number.isFinite(desconto)) {
    return { ok: false, error: 'Valor ou desconto inválido' }
  }
  const d = validarDesconto(valor, desconto)
  if (!d.ok) return d

  for (const f of PCT_FIELDS) {
    const v = p[f]
    if (v === null || v === undefined) continue
    if (!Number.isFinite(v) || v < 0 || v > 1) {
      return { ok: false, error: 'Cada percentual tem de ficar entre 0% e 100%' }
    }
  }
  const soma = validarSomaPct(p)
  if (!soma.ok) return { ok: false, error: soma.error }
  return { ok: true }
}
