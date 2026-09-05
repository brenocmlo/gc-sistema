// Helpers puros do form de proposta. SEM 'use client' pra poder ser importado
// de Server Component (page.tsx de editar), de Server Action (actions.ts) e de
// Client Component. O componente React fica em proposta-form.tsx.
//
// As regras que valem teste (desconto <= valor_total, soma dos pct_*, conversão
// 0..100 ↔ 0..1) moram em @/lib/propostas, testadas por `node --test`. Aqui só
// o schema que as chama e a tradução form ↔ banco.

import { z } from 'zod'

import {
  PCT_FIELDS,
  pctFormToPayload,
  pctPayloadToForm,
  validarDesconto,
  validarSomaPctForm,
  type PctField,
  type PctFormValues,
} from '@/lib/propostas'
import type { Proposta } from '@/lib/types'

const pctSchema = z.coerce
  .number()
  .min(0, 'Mínimo 0%')
  .max(100, 'Máximo 100%')
  .default(0)

export const propostaSchema = z
  .object({
    // numero é NOT NULL no banco e unique por empresa, diferente de orçamento.
    numero: z.string().trim().min(1, 'Número obrigatório').max(50, 'Máximo 50 caracteres'),
    obra_id: z.string().uuid('Selecione uma obra'),
    data_emissao: z.string().min(1, 'Data de emissão obrigatória'),
    data_validade: z.string().optional().default(''),
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
    // CHECK propostas_desconto_valido
    const desconto = validarDesconto(
      Number(data.valor_total ?? 0),
      Number(data.desconto ?? 0),
    )
    if (!desconto.ok) {
      ctx.addIssue({ path: ['desconto'], code: 'custom', message: desconto.error })
    }

    // CHECK propostas_pct_soma. O erro vai no último campo de percentual
    // porque a soma não tem campo próprio na tela.
    const soma = validarSomaPctForm(pctFromValues(data))
    if (!soma.ok) {
      ctx.addIssue({
        path: ['pct_medicao_instalacao'],
        code: 'custom',
        message: soma.error,
      })
    }

    // Validade anterior à emissão não tem CHECK no banco, mas é erro de
    // digitação garantido — proposta nasceria vencida.
    if (data.data_validade && data.data_validade < data.data_emissao) {
      ctx.addIssue({
        path: ['data_validade'],
        code: 'custom',
        message: 'Validade não pode ser anterior à emissão',
      })
    }
  })

export type PropostaFormValues = z.input<typeof propostaSchema>

/** Payload aceito por createProposta / updateProposta (pct_* já em fração). */
export type PropostaPayload = {
  numero: string
  obra_id: string
  data_emissao: string
  data_validade: string | null
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

/** Só os quatro pct_* do form, como números 0..100. */
function pctFromValues(values: Partial<PropostaFormValues>): PctFormValues {
  return Object.fromEntries(
    PCT_FIELDS.map((f) => [f, Number(values[f] ?? 0)]),
  ) as PctFormValues
}

/** Valores do form (strings vazias, % em 0..100) → payload (nulls, frações). */
export function formValuesToPayload(
  values: PropostaFormValues,
): PropostaPayload {
  return {
    numero: (values.numero ?? '').trim(),
    obra_id: values.obra_id,
    data_emissao: values.data_emissao || new Date().toISOString().slice(0, 10),
    data_validade: emptyToNull(values.data_validade),
    descricao: emptyToNull(values.descricao),
    valor_total: Number(values.valor_total ?? 0),
    desconto: Number(values.desconto ?? 0),
    condicoes_pagamento: emptyToNull(values.condicoes_pagamento),
    observacao: emptyToNull(values.observacao),
    ...pctFormToPayload(pctFromValues(values)),
  }
}

/** Proposta do banco → valores iniciais do form (nulls → '', frações → %). */
export function propostaToFormValues(p: Proposta): PropostaFormValues {
  return {
    numero: p.numero,
    obra_id: p.obra_id,
    data_emissao: p.data_emissao ?? '',
    data_validade: p.data_validade ?? '',
    descricao: p.descricao ?? '',
    valor_total: p.valor_total ?? 0,
    desconto: p.desconto ?? 0,
    condicoes_pagamento: p.condicoes_pagamento ?? '',
    observacao: p.observacao ?? '',
    ...pctPayloadToForm(p),
  }
}

export function emptyFormValues(): PropostaFormValues {
  return {
    numero: '',
    obra_id: '',
    data_emissao: new Date().toISOString().slice(0, 10),
    data_validade: '',
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
