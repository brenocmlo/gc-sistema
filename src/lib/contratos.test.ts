import assert from 'node:assert/strict'
import test from 'node:test'

import {
  STATUS_CONTRATO_OPTIONS,
  canChangeContratoStatus,
  isContratoEditavel,
  isContratoFinalizado,
  isContratoStatus,
  mensagemDeErroContrato,
  novaEntradaHistoricoContrato,
  validarRescisao,
} from './contratos.ts'

test('isContratoStatus aceita só os quatro status do CHECK', () => {
  for (const s of ['ativo', 'suspenso', 'concluido', 'rescindido']) {
    assert.equal(isContratoStatus(s), true, s)
  }
  // Status de outras entidades, e a grafia com acento, não passam.
  for (const s of ['aprovada', 'rascunho', 'concluída', 'ATIVO', '']) {
    assert.equal(isContratoStatus(s), false, s)
  }
})

test('STATUS_CONTRATO_OPTIONS lista os quatro status, na ordem do ciclo', () => {
  assert.deepEqual(
    STATUS_CONTRATO_OPTIONS.map((o) => o.value),
    ['ativo', 'suspenso', 'concluido', 'rescindido'],
  )
  assert.equal(STATUS_CONTRATO_OPTIONS[2].label, 'Concluído')
})

test('isContratoEditavel: só ativo deixa mexer nos itens', () => {
  assert.equal(isContratoEditavel('ativo'), true)
  assert.equal(isContratoEditavel('suspenso'), false)
  assert.equal(isContratoEditavel('concluido'), false)
  assert.equal(isContratoEditavel('rescindido'), false)
})

test('transições: ativo sai para os três, suspenso só volta ou rescinde', () => {
  assert.equal(canChangeContratoStatus('ativo', 'suspenso'), true)
  assert.equal(canChangeContratoStatus('ativo', 'concluido'), true)
  assert.equal(canChangeContratoStatus('ativo', 'rescindido'), true)
  assert.equal(canChangeContratoStatus('suspenso', 'ativo'), true)
  assert.equal(canChangeContratoStatus('suspenso', 'rescindido'), true)
  assert.equal(canChangeContratoStatus('suspenso', 'concluido'), false)
  // Mesmo status não é transição: não gera entrada de histórico.
  assert.equal(canChangeContratoStatus('ativo', 'ativo'), false)
})

test('concluído e rescindido são terminais', () => {
  for (const de of ['concluido', 'rescindido'] as const) {
    for (const para of ['ativo', 'suspenso', 'concluido', 'rescindido'] as const) {
      assert.equal(canChangeContratoStatus(de, para), false, `${de}→${para}`)
    }
    assert.equal(isContratoFinalizado(de), true)
  }
  assert.equal(isContratoFinalizado('ativo'), false)
  assert.equal(isContratoFinalizado('suspenso'), false)
})

test('validarRescisao espelha o CHECK contratos_rescindido_motivo', () => {
  assert.deepEqual(validarRescisao('rescindido', 'inadimplencia', null), { ok: true })
  assert.equal(validarRescisao('rescindido', null, null).ok, false)
  assert.equal(validarRescisao('rescindido', 'calote', null).ok, false)
  // Motivo fora de rescindido é recusado, como no banco.
  assert.equal(validarRescisao('suspenso', 'inadimplencia', null).ok, false)
  assert.deepEqual(validarRescisao('suspenso', null, null), { ok: true })
})

test('validarRescisao: "outro" exige o detalhe', () => {
  assert.equal(validarRescisao('rescindido', 'outro', '').ok, false)
  assert.equal(validarRescisao('rescindido', 'outro', '   ').ok, false)
  assert.deepEqual(validarRescisao('rescindido', 'outro', 'Obra embargada'), { ok: true })
})

test('novaEntradaHistoricoContrato guarda o motivo só na rescisão', () => {
  const r = novaEntradaHistoricoContrato({
    de: 'ativo', para: 'rescindido', por: 'u1',
    motivo_rescisao: 'acordo_partes', detalhe_rescisao: 'distrato assinado',
    em: '2026-09-23T10:00:00.000Z',
  })
  assert.deepEqual(r, {
    de: 'ativo', para: 'rescindido', em: '2026-09-23T10:00:00.000Z', por: 'u1',
    motivo_rejeicao: null, detalhe_rejeicao: null,
    motivo_rescisao: 'acordo_partes', detalhe_rescisao: 'distrato assinado',
  })
  const s = novaEntradaHistoricoContrato({
    de: 'ativo', para: 'suspenso', por: 'u1', motivo_rescisao: 'outro', detalhe_rescisao: 'x',
  })
  assert.equal(s.motivo_rescisao, null)
  assert.equal(s.detalhe_rescisao, null)
  assert.equal(s.motivo_rejeicao, null)
})

test('mensagemDeErroContrato traduz as constraints e as mensagens da função', () => {
  assert.equal(
    mensagemDeErroContrato('duplicate key value violates unique constraint "contratos_empresa_id_numero_key"'),
    'Já existe um contrato com esse número',
  )
  assert.match(mensagemDeErroContrato('contrato_ja_gerado_da_proposta'), /vigente/)
  assert.match(mensagemDeErroContrato('new row violates check constraint "contratos_desconto_valido"'), /Desconto/)
  assert.equal(mensagemDeErroContrato('erro qualquer'), 'erro qualquer')
})
