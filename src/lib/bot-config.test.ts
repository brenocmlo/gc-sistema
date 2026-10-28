import assert from 'node:assert/strict'
import { test } from 'node:test'

import { acoesDoGrupo, acoesDoPedido, ordenarPedidos, rotuloSituacaoContato, type PedidoAcessoListItem } from './bot-config.ts'

const pedido = (id: string, status: PedidoAcessoListItem['status'], created_at: string): PedidoAcessoListItem => ({
  id, nome: id, telegram_username: null, telegram_user_id: '12345', status, created_at, grupo: null,
})

test('acoesDoGrupo', () => {
  assert.deepEqual(acoesDoGrupo('PENDENTE'), { liberar: true, bloquear: true })
  assert.deepEqual(acoesDoGrupo('LIBERADO'), { liberar: false, bloquear: true })
  assert.deepEqual(acoesDoGrupo('BLOQUEADO'), { liberar: true, bloquear: false })
})

test('acoesDoPedido', () => {
  assert.deepEqual(acoesDoPedido('PENDENTE'), { permitir: true, recusar: true })
  assert.deepEqual(acoesDoPedido('RECUSADO'), { permitir: true, recusar: false })
  assert.deepEqual(acoesDoPedido('APROVADO'), { permitir: false, recusar: false })
})

test('ordenarPedidos: pendentes primeiro, depois o mais recente, sem mutar', () => {
  const entrada = [
    pedido('a', 'APROVADO', '2026-10-05'),
    pedido('b', 'PENDENTE', '2026-10-01'),
    pedido('c', 'RECUSADO', '2026-10-07'),
    pedido('d', 'PENDENTE', '2026-10-03'),
  ]
  assert.deepEqual(ordenarPedidos(entrada).map((p) => p.id), ['d', 'b', 'c', 'a'])
  assert.equal(entrada[0].id, 'a')
})

test('rotuloSituacaoContato', () => {
  assert.equal(rotuloSituacaoContato(true), 'Ativo')
  assert.equal(rotuloSituacaoContato(false), 'Desativado')
})
