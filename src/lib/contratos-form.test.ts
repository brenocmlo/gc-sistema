import assert from 'node:assert/strict'
import test from 'node:test'

import {
  contratoSchema,
  emptyContratoFormValues,
  formValuesToPayload,
  propostaToContratoFormValues,
  validarPayloadContrato,
  type ContratoFormValues,
} from './contratos-form.ts'
import type { Proposta } from './types'

const OBRA = '11111111-1111-4111-8111-111111111111'

function valido(extra: Partial<ContratoFormValues> = {}): ContratoFormValues {
  return {
    ...emptyContratoFormValues(),
    numero: 'CT-2026-001',
    obra_id: OBRA,
    valor_total: 1000,
    desconto: 100,
    pct_sinal: 30,
    pct_fd: 70,
    ...extra,
  }
}

/** Mensagens do zod por campo, pra conferir onde o erro cai. */
function erros(values: ContratoFormValues): Record<string, string> {
  const r = contratoSchema.safeParse(values)
  if (r.success) return {}
  return Object.fromEntries(r.error.issues.map((i) => [i.path.join('.'), i.message]))
}

test('contratoSchema aceita o contrato mínimo válido', () => {
  assert.deepEqual(erros(valido()), {})
  // Data de assinatura e prazo são opcionais: contrato lançado antes de assinar.
  assert.deepEqual(erros(valido({ data_assinatura: '', prazo_execucao: '' })), {})
})

test('contratoSchema: número obrigatório (NOT NULL) e obra obrigatória (FK)', () => {
  assert.equal(erros(valido({ numero: '   ' })).numero, 'Número obrigatório')
  assert.equal(erros(valido({ numero: 'x'.repeat(51) })).numero, 'Máximo 50 caracteres')
  assert.equal(erros(valido({ obra_id: '' })).obra_id, 'Selecione uma obra')
})

test('contratoSchema espelha contratos_desconto_valido e os >= 0', () => {
  assert.match(erros(valido({ desconto: 1001 })).desconto, /maior que o valor total/)
  // Igual ao total é aceito, como no banco (desconto <= valor_total).
  assert.deepEqual(erros(valido({ desconto: 1000 })), {})
  assert.ok(erros(valido({ valor_total: -1, desconto: 0 })).valor_total)
  assert.ok(erros(valido({ desconto: -1 })).desconto)
})

test('contratoSchema espelha contratos_pct_soma: soma até 100%, erro no último percentual', () => {
  assert.deepEqual(erros(valido({ pct_sinal: 30, pct_fd: 30, pct_entrega_material: 20, pct_medicao_instalacao: 20 })), {})
  const e = erros(valido({ pct_sinal: 50, pct_fd: 40, pct_entrega_material: 20 }))
  assert.match(e.pct_medicao_instalacao, /100%/)
  // Cada percentual isolado: CHECK pct between 0 and 1.
  assert.equal(erros(valido({ pct_sinal: 101, pct_fd: 0 })).pct_sinal, 'Máximo 100%')
  assert.equal(erros(valido({ pct_sinal: -1 })).pct_sinal, 'Mínimo 0%')
})

test('formValuesToPayload: % vira fração, texto vazio vira null', () => {
  const p = formValuesToPayload(valido({ descricao: '  ', prazo_execucao: '45 dias', data_assinatura: '' }))
  assert.equal(p.pct_sinal, 0.3)
  assert.equal(p.pct_fd, 0.7)
  assert.equal(p.descricao, null)
  assert.equal(p.data_assinatura, null)
  assert.equal(p.prazo_execucao, '45 dias')
  assert.equal(p.numero, 'CT-2026-001')
})

test('validarPayloadContrato repete a regra do schema sobre o payload do servidor', () => {
  const ok = formValuesToPayload(valido())
  assert.deepEqual(validarPayloadContrato(ok), { ok: true })
  assert.equal(validarPayloadContrato({ ...ok, numero: '' }).ok, false)
  assert.equal(validarPayloadContrato({ ...ok, obra_id: '' }).ok, false)
  assert.equal(validarPayloadContrato({ ...ok, desconto: 2000 }).ok, false)
  assert.equal(validarPayloadContrato({ ...ok, pct_sinal: 0.5, pct_fd: 0.6 }).ok, false)
  assert.equal(validarPayloadContrato({ ...ok, pct_sinal: 1.5, pct_fd: 0 }).ok, false)
  assert.equal(validarPayloadContrato({ ...ok, valor_total: Number.NaN }).ok, false)
  assert.equal(validarPayloadContrato(null).ok, false)
})

// Pendência do 6.2: o helper do "Gerar contrato" só era conferido pelo navegador.
function proposta(extra: Partial<Proposta> = {}): Proposta {
  return {
    numero: 'PROP-2026-008',
    obra_id: OBRA,
    descricao: 'Esquadrias',
    valor_total: 10000,
    desconto: 800,
    pct_sinal: 0.3,
    pct_fd: 0.2,
    pct_entrega_material: null,
    pct_medicao_instalacao: 0.5,
    condicoes_pagamento: 'boleto',
    observacao: 'obs da proposta',
    ...extra,
  } as Proposta
}

test('propostaToContratoFormValues: número em branco, obra e textos da proposta, assinatura hoje', () => {
  const v = propostaToContratoFormValues(proposta(), null)
  assert.equal(v.numero, '')
  assert.equal(v.obra_id, OBRA)
  assert.equal(v.descricao, 'Esquadrias')
  assert.equal(v.condicoes_pagamento, 'boleto')
  assert.equal(v.observacao, 'obs da proposta')
  assert.equal(v.prazo_execucao, '')
  assert.equal(v.data_assinatura, new Date().toISOString().slice(0, 10))
})

test('propostaToContratoFormValues: percentuais de fração para 0..100, nulo vira 0', () => {
  const v = propostaToContratoFormValues(proposta(), null)
  assert.equal(v.pct_sinal, 30)
  assert.equal(v.pct_fd, 20)
  assert.equal(v.pct_entrega_material, 0)
  assert.equal(v.pct_medicao_instalacao, 50)
})

test('propostaToContratoFormValues: com itens, o valor é a soma deles; sem itens, o da proposta', () => {
  assert.equal(propostaToContratoFormValues(proposta(), 7500).valor_total, 7500)
  assert.equal(propostaToContratoFormValues(proposta(), null).valor_total, 10000)
  assert.equal(propostaToContratoFormValues(proposta(), null).desconto, 800)
})

test('propostaToContratoFormValues: textos nulos da proposta viram string vazia', () => {
  const v = propostaToContratoFormValues(
    proposta({ descricao: null, condicoes_pagamento: null, observacao: null }),
    null,
  )
  assert.equal(v.descricao, '')
  assert.equal(v.condicoes_pagamento, '')
  assert.equal(v.observacao, '')
})

test('propostaToContratoFormValues: o resultado com número preenchido passa no schema', () => {
  const v = { ...propostaToContratoFormValues(proposta(), null), numero: 'CT-2026-010' }
  assert.equal(contratoSchema.safeParse(v).success, true)
})
