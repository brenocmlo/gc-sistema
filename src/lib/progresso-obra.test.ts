import test from 'node:test'
import assert from 'node:assert/strict'

import { itensContratados, progressoItensDaObra } from './progresso-obra.ts'

const item = (id: string, quantidade: number, vinculo: { proposta?: string; contrato?: string }) => ({
  id, quantidade, proposta_id: vinculo.proposta ?? null, contrato_id: vinculo.contrato ?? null,
})

test('contrato gerado da proposta: conta só os itens do contrato (o defeito parava em 50%)', () => {
  const itens = [
    item('p1', 10, { proposta: 'P' }), item('p2', 10, { proposta: 'P' }),
    item('c1', 10, { contrato: 'C' }), item('c2', 10, { contrato: 'C' }),
  ]
  const contratos = [{ id: 'C', status: 'ativo', proposta_origem_id: 'P' }]
  const propostas = [{ id: 'P', status: 'aprovada' }]
  const tudoMedido = [{ item_id: 'c1', med_qtd: 10 }, { item_id: 'c2', med_qtd: 10 }]
  assert.deepEqual(Array.from(itensContratados(itens, contratos, propostas)).sort(), ['c1', 'c2'])
  assert.equal(progressoItensDaObra(itens, contratos, propostas, tudoMedido), 100)
  assert.equal(progressoItensDaObra(itens, contratos, propostas, [{ item_id: 'c1', med_qtd: 5 }]), 25)
})

test('sem contrato: conta os itens da proposta aprovada; rascunho e rejeitada não contam', () => {
  const itens = [item('a', 4, { proposta: 'A' }), item('r', 6, { proposta: 'R' }), item('x', 9, { proposta: 'X' })]
  const propostas = [{ id: 'A', status: 'aprovada' }, { id: 'R', status: 'rascunho' }, { id: 'X', status: 'rejeitada' }]
  assert.equal(progressoItensDaObra(itens, [], propostas, []), 0, 'contratado sem medição é 0%, não "sem dados"')
  assert.equal(progressoItensDaObra(itens, [], propostas, [{ item_id: 'a', med_qtd: 1 }]), 25)
})

test('contrato rescindido sai; a proposta de origem volta a contar, como no valor da obra', () => {
  const itens = [item('p1', 8, { proposta: 'P' }), item('c1', 8, { contrato: 'C' })]
  const contratos = [{ id: 'C', status: 'rescindido', proposta_origem_id: 'P' }]
  const propostas = [{ id: 'P', status: 'aprovada' }]
  assert.deepEqual(Array.from(itensContratados(itens, contratos, propostas)), ['p1'])
  assert.equal(progressoItensDaObra(itens, contratos, propostas, [{ item_id: 'c1', med_qtd: 8 }]), 0, 'medição de item fora do contratado não conta')
})

test('contrato vigente e outra proposta aprovada ainda sem contrato: os dois contam', () => {
  const itens = [item('c1', 30, { contrato: 'C' }), item('b1', 10, { proposta: 'B' })]
  const contratos = [{ id: 'C', status: 'ativo', proposta_origem_id: null }]
  const propostas = [{ id: 'B', status: 'aprovada' }]
  assert.equal(progressoItensDaObra(itens, contratos, propostas, [{ item_id: 'c1', med_qtd: 30 }]), 75)
})

test('vários contratos vigentes somam (seed antigo, antes da regra de um por obra)', () => {
  const itens = [item('c1', 52, { contrato: 'C1' }), item('c2', 1, { contrato: 'C2' }), item('c3', 2, { contrato: 'C3' })]
  const contratos = [
    { id: 'C1', status: 'ativo', proposta_origem_id: null },
    { id: 'C2', status: 'suspenso', proposta_origem_id: null },
    { id: 'C3', status: 'concluido', proposta_origem_id: null },
  ]
  assert.equal(progressoItensDaObra(itens, contratos, [], [{ item_id: 'c1', med_qtd: 10 }]), 18.18)
})

test('null quando não há contratado: só rascunho, item sem vínculo ou quantidade zero', () => {
  assert.equal(progressoItensDaObra([], [], [], []), null)
  assert.equal(progressoItensDaObra([item('r', 5, { proposta: 'R' })], [], [{ id: 'R', status: 'rascunho' }], []), null)
  assert.equal(progressoItensDaObra([item('s', 5, {})], [], [], []), null)
  assert.equal(
    progressoItensDaObra([item('c', 0, { contrato: 'C' })], [{ id: 'C', status: 'ativo', proposta_origem_id: null }], [], []),
    null,
  )
})

test('quantidade e medição em string (numeric do PostgREST) e várias execuções por item', () => {
  const itens = [{ id: 'c1', quantidade: '3.000', proposta_id: null, contrato_id: 'C' }]
  const contratos = [{ id: 'C', status: 'ativo', proposta_origem_id: null }]
  const med = [{ item_id: 'c1', med_qtd: '1.000' }, { item_id: 'c1', med_qtd: null }]
  assert.equal(progressoItensDaObra(itens, contratos, [], med), 33.33)
})
