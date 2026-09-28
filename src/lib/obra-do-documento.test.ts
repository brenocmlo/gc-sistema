import test from 'node:test'
import assert from 'node:assert/strict'

import { identificarObra, normalizarTexto, type ObraCandidata } from './obra-do-documento.ts'

// As 3 obras do gc-dev em 25/09, mais duas para os casos de ambiguidade.
const OBRAS: ObraCandidata[] = [
  { id: 'o3', codigo_obra: 'OBRA-2025-03', nome: 'TESTE OBRA 3', cliente_nome: 'Construtora Alvorada LTDA' },
  { id: 'o1', codigo_obra: 'OBRA-2026-001', nome: 'OBRA PRF', cliente_nome: 'Auto Posto Verde' },
  { id: 'o4', codigo_obra: 'OBRA-2027-01', nome: 'TEST OBRA 4', cliente_nome: 'Mercado Bom Preço' },
  { id: 'ef', codigo_obra: 'EB-25-08-0044', nome: 'ESTAÇÃO FASHION', cliente_nome: 'EF EMPREENDIMENTOS IMOBILIARIOS SA' },
  { id: 'vv', codigo_obra: 'VV-2026-01', nome: 'Residencial Vista Verde - Bloco B', cliente_nome: 'CONSTRUTORA VISTA VERDE LTDA' },
]

test('normalizarTexto tira acento, caixa e pontuação', () => {
  assert.equal(normalizarTexto('  ESTAÇÃO  Fashion - Fachada! '), 'estacao fashion fachada')
  assert.equal(normalizarTexto(null), '')
})

test('pelo código, mesmo com o nome junto e separadores diferentes', () => {
  assert.deepEqual(identificarObra(OBRAS, { codigo: 'EB-25-08-0044' }), { ok: true, obraId: 'ef', como: 'codigo' })
  assert.deepEqual(identificarObra(OBRAS, { codigo: 'Obra: EB-25-08-0044 - ESTAÇÃO FASHION - FACHADA' }), { ok: true, obraId: 'ef', como: 'codigo' })
  assert.deepEqual(identificarObra(OBRAS, { codigo: 'obra 2025 03' }), { ok: true, obraId: 'o3', como: 'codigo' })
})

test('pelo nome, com o lido mais longo que o cadastrado (PDF de referência)', () => {
  assert.deepEqual(identificarObra(OBRAS, { nome: 'ESTAÇÃO FASHION - FACHADA' }), { ok: true, obraId: 'ef', como: 'nome' })
  assert.deepEqual(identificarObra(OBRAS, { nome: 'Residencial Vista Verde - Bloco B' }), { ok: true, obraId: 'vv', como: 'nome' })
})

test('nome igual ganha de contido', () => {
  const obras = [...OBRAS, { id: 'ef2', codigo_obra: 'EB-99', nome: 'ESTAÇÃO FASHION - FACHADA' }]
  assert.deepEqual(identificarObra(obras, { nome: 'Estação Fashion - Fachada' }), { ok: true, obraId: 'ef2', como: 'nome' })
})

test('nome curto demais não bate em tudo', () => {
  const r = identificarObra(OBRAS, { nome: 'Obra' })
  assert.equal(r.ok, false)
})

test('pelo cliente, só quando ele tem uma obra', () => {
  assert.deepEqual(identificarObra(OBRAS, { cliente: 'CONSTRUTORA VISTA VERDE LTDA - CNPJ 31.556.208/0001-14' }), { ok: true, obraId: 'vv', como: 'cliente' })
  const doisDoMesmo = [...OBRAS, { id: 'vv2', codigo_obra: 'VV-2026-02', nome: 'Residencial Vista Verde - Bloco C', cliente_nome: 'CONSTRUTORA VISTA VERDE LTDA' }]
  const r = identificarObra(doisDoMesmo, { cliente: 'CONSTRUTORA VISTA VERDE LTDA' })
  assert.equal(r.ok, false)
  if (!r.ok) {
    assert.match(r.motivo, /mais de uma obra/)
    assert.deepEqual(r.candidatas.sort(), ['vv', 'vv2'])
  }
})

test('ambíguo pelo nome vira revisão com as candidatas', () => {
  const obras = [...OBRAS, { id: 'vv2', codigo_obra: 'VV-2026-02', nome: 'Residencial Vista Verde - Bloco C' }]
  const r = identificarObra(obras, { nome: 'Residencial Vista Verde' })
  assert.equal(r.ok, false)
  if (!r.ok) assert.equal(r.candidatas.length, 2)
})

test('código ganha de nome: código de uma, nome de outra', () => {
  assert.deepEqual(identificarObra(OBRAS, { codigo: 'OBRA-2026-001', nome: 'ESTAÇÃO FASHION' }), { ok: true, obraId: 'o1', como: 'codigo' })
})

test('sem nenhuma pista, ou pista que não bate, é revisão (nunca chute)', () => {
  const vazio = identificarObra(OBRAS, {})
  assert.equal(vazio.ok, false)
  if (!vazio.ok) assert.match(vazio.motivo, /não traz o código nem o nome/)
  const nada = identificarObra(OBRAS, { codigo: 'XYZ-999', nome: 'Condomínio Inexistente' })
  assert.equal(nada.ok, false)
  if (!nada.ok) assert.match(nada.motivo, /não encontramos no sistema a obra do documento \(XYZ-999 · Condomínio Inexistente\)/)
})

test('lista de obras vazia', () => {
  assert.equal(identificarObra([], { codigo: 'EB-25-08-0044' }).ok, false)
})
