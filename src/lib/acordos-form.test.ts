import test from 'node:test'
import assert from 'node:assert/strict'

import {
  acordoSchema,
  acordoVazioFormValues,
  formParaPayloadAcordo,
  gerarParcelas,
  mensagemDeErroAcordo,
  somarPeriodos,
  totalDasParcelas,
  validarParcelaPayload,
  validarPayloadAcordo,
  type AcordoPayload,
} from './acordos-form.ts'

const OBRA = '11111111-1111-4111-8111-111111111111'
const CT = '22222222-2222-4222-8222-222222222222'
const PR = '33333333-3333-4333-8333-333333333333'

test('somarPeriodos: mensal mantém o dia e cai no último dia do mês curto; quinzenal e semanal somam dias', () => {
  assert.equal(somarPeriodos('2026-01-31', 'mensal', 1), '2026-02-28')
  assert.equal(somarPeriodos('2026-01-31', 'mensal', 2), '2026-03-31', 'conta a partir do primeiro, não do anterior')
  assert.equal(somarPeriodos('2026-11-15', 'mensal', 3), '2027-02-15', 'vira o ano')
  assert.equal(somarPeriodos('2028-01-31', 'mensal', 1), '2028-02-29', 'ano bissexto')
  assert.equal(somarPeriodos('2026-10-21', 'quinzenal', 2), '2026-11-20')
  assert.equal(somarPeriodos('2026-12-28', 'semanal', 1), '2027-01-04')
})

test('gerarParcelas: a última leva a sobra dos centavos, e a soma bate com o total', () => {
  const r = gerarParcelas({ valorTotal: 1000, quantidade: 3, primeiroVencimento: '2026-10-21', periodicidade: 'mensal' })
  assert.ok(r.ok)
  if (!r.ok) return
  assert.deepEqual(r.parcelas.map((p) => p.valor_previsto), [333.33, 333.33, 333.34])
  assert.deepEqual(r.parcelas.map((p) => p.data_vencimento), ['2026-10-21', '2026-11-21', '2026-12-21'])
  assert.equal(totalDasParcelas(r.parcelas), 1000)
  const um = gerarParcelas({ valorTotal: 0.1, quantidade: 3, primeiroVencimento: '2026-10-21', periodicidade: 'semanal' })
  assert.ok(um.ok && totalDasParcelas(um.parcelas) === 0.1 && um.parcelas[2].valor_previsto === 0.04)
})

test('gerarParcelas recusa o que não dá para gerar', () => {
  const base = { valorTotal: 1000, quantidade: 3, primeiroVencimento: '2026-10-21', periodicidade: 'mensal' as const }
  assert.match((gerarParcelas({ ...base, valorTotal: 0 }) as { error: string }).error, /valor total/)
  assert.match((gerarParcelas({ ...base, quantidade: 0 }) as { error: string }).error, /quantas parcelas/)
  assert.match((gerarParcelas({ ...base, quantidade: 121 }) as { error: string }).error, /120/)
  assert.match((gerarParcelas({ ...base, valorTotal: 0.02 }) as { error: string }).error, /centavo/)
  assert.match((gerarParcelas({ ...base, primeiroVencimento: '' }) as { error: string }).error, /primeiro vencimento/)
})

test('zod: obrigatórios, ao menos uma parcela e o vínculo escolhido preenchido', () => {
  const erros = (v: object) => {
    const r = acordoSchema.safeParse(v)
    return r.success ? {} : Object.fromEntries(r.error.issues.map((i) => [i.path.join('.'), i.message]))
  }
  const vazio = erros(acordoVazioFormValues('2026-10-21'))
  assert.equal(vazio.obra_id, 'Selecione uma obra')
  assert.equal(vazio.descricao, 'Descreva o acordo')
  assert.equal(vazio.parcelas, 'Gere ou adicione ao menos uma parcela')
  const ok = { ...acordoVazioFormValues('2026-10-21'), obra_id: OBRA, descricao: 'Sinal novembro', parcelas: [{ data_vencimento: '2026-11-01', valor_previsto: 100 }] }
  assert.deepEqual(erros(ok), {})
  assert.equal(erros({ ...ok, vinculo: 'contrato' }).contrato_id, 'Selecione o contrato')
  assert.equal(erros({ ...ok, parcelas: [{ data_vencimento: '2026-11-01', valor_previsto: 0 }] })['parcelas.0.valor_previsto'], 'Maior que zero')
  assert.equal(erros({ ...ok, motivo: 'outros' }).motivo !== undefined, true, 'motivo fora do CHECK')
})

test('o payload leva só o vínculo escolhido e as parcelas na ordem', () => {
  const v = { ...acordoVazioFormValues('2026-10-21'), obra_id: OBRA, descricao: ' Sinal ', motivo: 'sinal', vinculo: 'proposta', contrato_id: CT, proposta_id: PR,
    parcelas: [{ data_vencimento: '2026-11-01', valor_previsto: '100.5', observacao: '  ' }] }
  const p = formParaPayloadAcordo(v as never)
  assert.deepEqual([p.descricao, p.motivo, p.contrato_id, p.proposta_id], ['Sinal', 'sinal', null, PR])
  assert.deepEqual(p.parcelas, [{ data_vencimento: '2026-11-01', valor_previsto: 100.5, observacao: null }])
})

test('validarPayloadAcordo e as mensagens das constraints', () => {
  const ok: AcordoPayload = { obra_id: OBRA, descricao: 'Sinal', motivo: 'sinal', periodo_ref: null, data_abertura: '2026-10-21',
    contrato_id: null, proposta_id: null, observacao: null, parcelas: [{ data_vencimento: '2026-11-01', valor_previsto: 100, observacao: null }] }
  assert.deepEqual(validarPayloadAcordo(ok), { ok: true })
  const recusa = (p: Partial<AcordoPayload>) => { const r = validarPayloadAcordo({ ...ok, ...p }); return r.ok ? 'PASSOU' : r.error }
  assert.match(recusa({ contrato_id: CT, proposta_id: PR }), /nunca dos dois/)
  assert.match(recusa({ parcelas: [] }), /ao menos uma parcela/)
  assert.match(recusa({ parcelas: [{ data_vencimento: '2026-11-01', valor_previsto: 10.001, observacao: null }] }), /Parcela 1: no máximo 2 casas/)
  assert.match(recusa({ motivo: 'outros' as never }), /Motivo/)
  assert.match(mensagemDeErroAcordo('violates check constraint "acordo_vinculo_xor"'), /nunca dos dois/)
  assert.match(mensagemDeErroAcordo('new row violates row-level security policy for table "acordos_pagamento"'), /permissão/)
})

test('validarParcelaPayload, para adicionar e editar parcela no detalhe', () => {
  assert.deepEqual(validarParcelaPayload({ data_vencimento: '2026-11-01', valor_previsto: 10, observacao: null }), { ok: true })
  const erro = (p: object) => { const r = validarParcelaPayload(p as never); return r.ok ? 'PASSOU' : r.error }
  assert.match(erro({ data_vencimento: '01/11/2026', valor_previsto: 10 }), /Vencimento/)
  assert.match(erro({ data_vencimento: '2026-11-01', valor_previsto: 0 }), /maior que zero/)
  assert.match(erro({ data_vencimento: '2026-11-01', valor_previsto: 1.001 }), /2 casas/)
})
