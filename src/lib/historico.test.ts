// Rodar: npm test
//
// `historico.ts` nasceu em Propostas e foi extraído quando Orçamentos passou a
// usar o mesmo formato. Quatro das cinco exportações são reexportadas por
// `propostas.ts` e já estão cobertas em `propostas.test.ts`; este arquivo cobre
// a que não é — `novaEntradaHistoricoOrcamento` —, que é justamente a que
// carrega a pegadinha do status masculino.
import assert from 'node:assert/strict'
import test from 'node:test'

import { novaEntradaHistoricoOrcamento } from './historico.ts'

test('novaEntradaHistoricoOrcamento guarda o motivo quando o destino é rejeitado', () => {
  const e = novaEntradaHistoricoOrcamento({
    de: 'enviado',
    para: 'rejeitado',
    por: 'uuid-do-profile',
    motivo_rejeicao: 'preco_alto',
    detalhe_rejeicao: 'acima do orçado',
    em: '2026-09-10T12:00:00.000Z',
  })

  assert.deepEqual(e, {
    de: 'enviado',
    para: 'rejeitado',
    em: '2026-09-10T12:00:00.000Z',
    por: 'uuid-do-profile',
    motivo_rejeicao: 'preco_alto',
    detalhe_rejeicao: 'acima do orçado',
  })
})

test('novaEntradaHistoricoOrcamento descarta o motivo quando o destino não é rejeitado', () => {
  // Mesmo critério do CHECK do banco: motivo só existe na linha rejeitada, e o
  // histórico não registra um motivo que a linha não tem.
  const e = novaEntradaHistoricoOrcamento({
    de: 'pendente',
    para: 'aprovado',
    por: 'uuid-do-profile',
    motivo_rejeicao: 'preco_alto',
    detalhe_rejeicao: 'não deveria sobrar',
  })

  assert.equal(e.motivo_rejeicao, null)
  assert.equal(e.detalhe_rejeicao, null)
})

test('o atalho de orçamento não serve pra proposta: "rejeitada" perde o motivo', () => {
  // É a pegadinha que o atalho existe pra evitar. Orçamento rejeita no
  // masculino; se este helper for usado numa proposta (que rejeita em
  // 'rejeitada'), o destino não casa com o statusDeRejeicao e o motivo é
  // descartado em silêncio — não quebra build nem tipo, só perde o registro.
  const e = novaEntradaHistoricoOrcamento({
    de: 'enviada',
    para: 'rejeitada',
    por: 'uuid-do-profile',
    motivo_rejeicao: 'prazo_curto',
  })

  assert.equal(e.motivo_rejeicao, null)
})

test('novaEntradaHistoricoOrcamento sem motivo devolve null, não undefined', () => {
  // jsonb com undefined perde a chave: a aba de histórico leria `undefined`
  // como "campo nunca existiu" em vez de "sem motivo".
  const e = novaEntradaHistoricoOrcamento({
    de: 'pendente',
    para: 'enviado',
    por: 'uuid-do-profile',
  })

  assert.equal(e.motivo_rejeicao, null)
  assert.equal(e.detalhe_rejeicao, null)
  assert.equal(Object.hasOwn(e, 'motivo_rejeicao'), true)
})

test('novaEntradaHistoricoOrcamento datestampa em ISO quando em não vem', () => {
  const antes = new Date().toISOString()
  const e = novaEntradaHistoricoOrcamento({
    de: 'pendente',
    para: 'enviado',
    por: 'uuid-do-profile',
  })

  assert.match(e.em, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  assert.ok(e.em >= antes, `${e.em} < ${antes}`)
})
