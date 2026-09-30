import test from 'node:test'
import assert from 'node:assert/strict'

import {
  formParaPayloadNf,
  mensagemDeErroNf,
  nfVaziaFormValues,
  normalizarChaveNfe,
  notaFiscalSchema,
  validarChaveNfe,
  validarPayloadNf,
  type NotaFiscalFormValues,
  type NotaFiscalPayload,
} from './notas-fiscais-form.ts'

const OBRA = '11111111-1111-4111-8111-111111111111'
const CT = '22222222-2222-4222-8222-222222222222'
const PR = '33333333-3333-4333-8333-333333333333'
const CHAVE = '35260912345678000190550020000000061234567890'

const base = (x: Partial<NotaFiscalFormValues> = {}): NotaFiscalFormValues => ({
  ...nfVaziaFormValues('2026-09-28'),
  obra_id: OBRA, numero: '123', tipo: 'medicao', valor_total: 1000, ...x,
})
const erros = (v: NotaFiscalFormValues) => {
  const r = notaFiscalSchema.safeParse(v)
  return r.success ? {} : Object.fromEntries(r.error.issues.map((i) => [i.path.join('.'), i.message]))
}

test('form vazio nasce com emissão hoje e sem vínculo; obrigatórios acusam', () => {
  const v = nfVaziaFormValues('2026-09-28')
  assert.equal(v.data_emissao, '2026-09-28')
  assert.equal(v.vinculo, 'nenhum')
  const e = erros(v)
  assert.equal(e.obra_id, 'Selecione uma obra')
  assert.equal(e.numero, 'Número obrigatório')
  assert.equal(e.tipo, 'Selecione o tipo')
  assert.ok(e.valor_total)
})

test('valor tem de ser maior que zero (CHECK valor_total > 0)', () => {
  assert.equal(erros(base({ valor_total: 0 })).valor_total, 'O valor tem de ser maior que zero')
  assert.equal(erros(base({ valor_total: -5 })).valor_total, 'O valor tem de ser maior que zero')
  assert.deepEqual(erros(base()), {})
})

test('vínculo: o escolhido tem de vir preenchido, e o payload leva só ele (XOR)', () => {
  assert.equal(erros(base({ vinculo: 'contrato' })).contrato_id, 'Selecione o contrato')
  assert.equal(erros(base({ vinculo: 'proposta' })).proposta_id, 'Selecione a proposta')
  // Trocou de contrato para proposta sem limpar: o payload descarta o contrato.
  const p = formParaPayloadNf(base({ vinculo: 'proposta', contrato_id: CT, proposta_id: PR }))
  assert.equal(p.contrato_id, null)
  assert.equal(p.proposta_id, PR)
  const semVinculo = formParaPayloadNf(base({ vinculo: 'nenhum', contrato_id: CT, proposta_id: PR }))
  assert.deepEqual([semVinculo.contrato_id, semVinculo.proposta_id], [null, null])
})

test('chave da NF-e: 44 dígitos, espaços e pontos colados saem, vazia vira null', () => {
  assert.equal(validarChaveNfe(''), null)
  assert.equal(validarChaveNfe(CHAVE), null)
  assert.equal(normalizarChaveNfe('3526 0912 3456.7800-0190'), '35260912345678000190')
  assert.equal(validarChaveNfe('123'), 'A chave da NF-e tem 44 dígitos')
  assert.equal(validarChaveNfe(`${CHAVE.slice(0, 43)}X`), 'A chave da NF-e tem 44 dígitos')
  assert.equal(erros(base({ chave_nfe: '123' })).chave_nfe, 'A chave da NF-e tem 44 dígitos')
  assert.equal(formParaPayloadNf(base({ chave_nfe: ' ' })).chave_nfe, null)
  assert.equal(formParaPayloadNf(base({ chave_nfe: CHAVE.replace(/(\d{4})/g, '$1 ') })).chave_nfe, CHAVE)
})

test('vencimento não pode ser antes da emissão; série e observação vazias viram null', () => {
  assert.equal(erros(base({ data_vencimento: '2026-09-27' })).data_vencimento, 'O vencimento não pode ser antes da emissão')
  assert.deepEqual(erros(base({ data_vencimento: '2026-09-28' })), {})
  const p = formParaPayloadNf(base({ serie: '  ', observacao: '' }))
  assert.deepEqual([p.serie, p.observacao, p.data_vencimento], [null, null, null])
})

test('validarPayloadNf repete a regra na action, inclusive os dois vínculos juntos', () => {
  const ok: NotaFiscalPayload = formParaPayloadNf(base())
  assert.deepEqual(validarPayloadNf(ok), { ok: true })
  assert.match((validarPayloadNf({ ...ok, contrato_id: CT, proposta_id: PR }) as { error: string }).error, /nunca dos dois/)
  assert.match((validarPayloadNf({ ...ok, valor_total: 0 }) as { error: string }).error, /maior que zero/)
  assert.match((validarPayloadNf({ ...ok, valor_total: 10.555 }) as { error: string }).error, /2 casas/)
  assert.match((validarPayloadNf({ ...ok, tipo: 'boleto' as never }) as { error: string }).error, /Tipo/)
  assert.match((validarPayloadNf({ ...ok, numero: ' ' }) as { error: string }).error, /Número/)
  assert.match((validarPayloadNf({ ...ok, chave_nfe: '1' }) as { error: string }).error, /44 dígitos/)
  assert.match((validarPayloadNf({ ...ok, data_vencimento: '2026-01-01' }) as { error: string }).error, /antes da emissão/)
  assert.match((validarPayloadNf(null) as { error: string }).error, /ausentes/)
})

test('mensagemDeErroNf traduz as constraints do banco', () => {
  assert.match(mensagemDeErroNf('duplicate key value violates unique constraint "idx_nfs_chave_nfe_unique"'), /chave de NF-e/)
  assert.match(mensagemDeErroNf('duplicate key value violates unique constraint "idx_notas_numero_serie_unique"'), /número e série/)
  assert.match(mensagemDeErroNf('violates check constraint "nf_vinculo_xor"'), /nunca dos dois/)
  assert.match(mensagemDeErroNf('violates foreign key constraint "nf_contrato_fk"'), /mesma obra/)
  assert.equal(mensagemDeErroNf('outro erro'), 'outro erro')
})
