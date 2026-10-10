import test from 'node:test'
import assert from 'node:assert/strict'

import {
  cardsDaEmpresa,
  contaNoRecebido,
  contasAReceber,
  faixaDoVencimento,
  faturadoPorObra,
  inicioDoPeriodo,
  linhasPorObra,
  normalizarPeriodo,
  recebidoPorObra,
  resumoPorFaixa,
  somaDoMapa,
  somarDias,
  type NfDaEmpresa,
  type PagamentoDaEmpresa,
  type ParcelaDaEmpresa,
} from './financeiro-empresa.ts'

const HOJE = '2026-10-15'

test('período: o mês corrente por padrão, e o que não é período conhecido também', () => {
  assert.equal(normalizarPeriodo(''), 'mes')
  assert.equal(normalizarPeriodo('xyz'), 'mes')
  assert.equal(normalizarPeriodo('tudo'), 'tudo')
  assert.equal(inicioDoPeriodo('mes', HOJE), '2026-10-01')
  assert.equal(inicioDoPeriodo('30d', HOJE), '2026-09-15')
  assert.equal(inicioDoPeriodo('90d', '2026-03-01'), '2025-12-01')
  assert.equal(inicioDoPeriodo('ano', HOJE), '2026-01-01')
  assert.equal(inicioDoPeriodo('tudo', HOJE), null)
  assert.equal(somarDias('2026-12-25', 7), '2027-01-01')
})

test('faturado e recebido por obra: período, NF cancelada fora, arquivado da conversão fora, em centavos', () => {
  const nfs = [
    { obra_id: 'a', status: 'emitida' as const, data_emissao: '2026-10-02', valor_total: '100.10' },
    { obra_id: 'a', status: 'paga' as const, data_emissao: '2026-09-30', valor_total: 50 },
    { obra_id: 'a', status: 'cancelada' as const, data_emissao: '2026-10-03', valor_total: 999 },
    { obra_id: 'b', status: 'paga_parcialmente' as const, data_emissao: '2026-10-05', valor_total: '0.20' },
  ]
  assert.deepEqual(Array.from(faturadoPorObra(nfs, '2026-10-01')), [['a', 100.1], ['b', 0.2]])
  assert.deepEqual(Array.from(faturadoPorObra(nfs, null)), [['a', 150.1], ['b', 0.2]])

  const pg = (obra: string, data: string, valor: number, origem: string, status?: string): PagamentoDaEmpresa => ({
    obra_id: obra, data_pagamento: data, valor, origem, parcela: status ? { acordo: { status: status as never } } : null,
  })
  const pagamentos = [pg('a', '2026-10-01', 10.1, 'nf'), pg('a', '2026-09-30', 5, 'avulso'), pg('a', '2026-10-02', 7, 'acordo', 'convertido_nf'), pg('b', '2026-10-09', 0.2, 'acordo', 'aberto')]
  assert.equal(contaNoRecebido(pagamentos[2]), false)
  const rec = recebidoPorObra(pagamentos, '2026-10-01')
  assert.deepEqual(Array.from(rec), [['a', 10.1], ['b', 0.2]])
  assert.equal(somaDoMapa(rec), 10.3)
  assert.deepEqual(Array.from(recebidoPorObra(pagamentos, null)), [['a', 15.1], ['b', 0.2]])
})

test('tabela por obra: saldo e % da view, obra sem movimento fora, maior saldo primeiro', () => {
  const linhas = linhasPorObra(
    [
      { obra_id: 'a', codigo_obra: 'OBRA-1', obra_nome: 'A', total_recebido: 250, total_a_receber: 1000, saldo_pendente: 750 },
      { obra_id: 'b', codigo_obra: 'OBRA-2', obra_nome: 'B', total_recebido: '1000', total_a_receber: '1000', saldo_pendente: '0' },
      { obra_id: 'c', codigo_obra: 'OBRA-3', obra_nome: 'C', total_recebido: 0, total_a_receber: 0, saldo_pendente: 0 },
      { obra_id: 'd', codigo_obra: 'OBRA-4', obra_nome: 'D', total_recebido: 30, total_a_receber: 0, saldo_pendente: -30 },
    ],
    new Map([['a', 400]]),
    new Map([['a', 100]]),
  )
  assert.deepEqual(linhas.map((l) => [l.codigo, l.faturado, l.recebido, l.saldo, l.pctRecebido]), [
    ['OBRA-1', 400, 100, 750, 25],
    ['OBRA-2', 0, 0, 0, 100],
    ['OBRA-4', 0, 0, -30, null],
  ])
})

test('contas a receber: as faixas (vencer hoje não é vencida), só documento com saldo e acordo aberto', () => {
  assert.equal(faixaDoVencimento('2026-10-14', HOJE), 'vencidas')
  assert.equal(faixaDoVencimento(HOJE, HOJE), 'hoje')
  assert.equal(faixaDoVencimento('2026-10-22', HOJE), '7dias')
  assert.equal(faixaDoVencimento('2026-10-23', HOJE), '30dias')
  assert.equal(faixaDoVencimento('2026-11-14', HOJE), '30dias')
  assert.equal(faixaDoVencimento('2026-11-15', HOJE), 'depois')
  assert.equal(faixaDoVencimento(null, HOJE), 'sem_vencimento')

  const nf = (id: string, status: string, venc: string | null, valor: number, pagos: number[] = []): NfDaEmpresa => ({
    id, obra_id: 'a', numero: id, serie: '1', status: status as never, data_emissao: '2026-09-01', data_vencimento: venc, valor_total: valor, pagamentos: pagos.map((v) => ({ valor: v })),
  })
  const parcela = (id: string, venc: string, valor: number, status: string, acordoStatus: string, pagos: number[] = []): ParcelaDaEmpresa => ({
    id, numero_parcela: 1, data_vencimento: venc, valor_previsto: valor, status: status as never, pagamentos: pagos.map((v) => ({ valor: v })),
    acordo: { id: `ac-${id}`, descricao: `Acordo ${id}`, obra_id: 'b', status: acordoStatus as never },
  })
  const contas = contasAReceber(
    [nf('N1', 'emitida', '2026-10-01', 300), nf('N2', 'paga_parcialmente', HOJE, 500, [200]), nf('N3', 'paga', '2026-10-01', 100, [100]), nf('N4', 'cancelada', '2026-10-01', 100), nf('N5', 'emitida', null, 80)],
    [parcela('P1', '2026-10-20', 120.5, 'pendente', 'aberto'), parcela('P2', '2026-10-01', 90, 'pendente', 'quitado'), parcela('P3', '2026-12-01', 60, 'paga_parcialmente', 'aberto', [10])],
    HOJE,
  )
  assert.deepEqual(contas.map((c) => [c.documento, c.faixa, c.saldo, c.destinoId]), [
    ['NF N1 / 1', 'vencidas', 300, 'N1'],
    ['NF N2 / 1', 'hoje', 300, 'N2'],
    ['Acordo P1 · parcela 1', '7dias', 120.5, 'ac-P1'],
    ['Acordo P3 · parcela 1', 'depois', 50, 'ac-P3'],
    ['NF N5 / 1', 'sem_vencimento', 80, 'N5'],
  ])
  const faixas = resumoPorFaixa(contas)
  assert.deepEqual(faixas.vencidas, { faixa: 'vencidas', total: 300, quantidade: 1 })
  assert.equal(faixas['30dias'].quantidade, 0)

  const cards = cardsDaEmpresa(
    [{ obra_id: 'a', codigo_obra: 'O', obra_nome: 'O', total_recebido: 0, total_a_receber: 0, saldo_pendente: '700.10' }, { obra_id: 'b', codigo_obra: 'P', obra_nome: 'P', total_recebido: 0, total_a_receber: 0, saldo_pendente: -0.1 }],
    42,
    faixas,
  )
  assert.deepEqual(cards, { aReceber: 700, recebidoNoPeriodo: 42, atrasado: 300, previsto30: 420.5 })
})
