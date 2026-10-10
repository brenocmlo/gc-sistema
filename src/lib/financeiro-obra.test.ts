import test from 'node:test'
import assert from 'node:assert/strict'

import {
  atrasadoDaObra,
  blocosFinanceiros,
  linhaDaNf,
  linhaDoTempo,
  parcelasEmAberto,
  rotuloDoMes,
  type AcordoDaObra,
  type PagamentoDaObra,
} from './financeiro-obra.ts'

const HOJE = '2026-10-15'

test('blocos: os números das views, em centavos exatos (numeric chega como string)', () => {
  const b = blocosFinanceiros('10000.10', { total_recebido: '3000.20', saldo_pendente: '1999.9', total_acordos_convertidos_arquivado: '0' }, { total_faturado: '5000', total_fd_aceito: '700.05' }, 120)
  assert.deepEqual(b, { contratado: 10000.1, faturado: 5000, recebido: 3000.2, aReceber: 1999.9, atrasado: 120, fdDescontado: 700.05 })
  assert.deepEqual(blocosFinanceiros(null, null, null, 0), { contratado: 0, faturado: 0, recebido: 0, aReceber: 0, atrasado: 0, fdDescontado: 0 })
})

test('linha da NF: recebido, saldo e situação; paga e cancelada sem saldo; vencer hoje não é vencida', () => {
  const nf = (status: string, venc: string | null, valor: number, pagos: number[]) => ({
    id: 'n', numero: '10', serie: '1', tipo: 'sinal', status: status as never, data_emissao: '2026-09-01', data_vencimento: venc, valor_total: valor,
    pagamentos: pagos.map((v) => ({ valor: v })),
  })
  const parcial = linhaDaNf(nf('paga_parcialmente', '2026-10-01', 1000, [300.1, 0.2]), HOJE)
  assert.equal(parcial.recebido, 300.3)
  assert.equal(parcial.saldo, 699.7)
  assert.equal(parcial.situacao, 'vencida')
  assert.equal(linhaDaNf(nf('emitida', HOJE, 500, []), HOJE).situacao, 'emitida')
  assert.equal(linhaDaNf(nf('paga', '2026-10-01', 500, [500]), HOJE).saldo, 0)
  assert.equal(linhaDaNf(nf('cancelada', '2026-10-01', 500, [100]), HOJE).saldo, 0)
})

test('parcelas em aberto: só do acordo aberto, sem paga e cancelada, por vencimento; e o atrasado', () => {
  const p = (id: string, n: number, venc: string, valor: number, status: string, pagos: number[] = []) => ({
    id, numero_parcela: n, data_vencimento: venc, valor_previsto: valor, status: status as never, pagamentos: pagos.map((v) => ({ valor: v })),
  })
  const acordos: AcordoDaObra[] = [
    { id: 'a', descricao: 'Sinal', status: 'aberto', parcelas: [p('a1', 1, '2026-10-20', 500, 'pendente'), p('a2', 2, '2026-09-30', 500, 'paga_parcialmente', [200]), p('a3', 3, '2026-08-01', 100, 'paga', [100]), p('a4', 4, '2026-08-01', 100, 'cancelada')] },
    { id: 'b', descricao: 'Quitado', status: 'quitado', parcelas: [p('b1', 1, '2026-01-01', 900, 'pendente')] },
  ]
  const abertas = parcelasEmAberto(acordos, HOJE)
  assert.deepEqual(abertas.map((x) => [x.id, x.situacao, x.saldo]), [['a2', 'atrasada', 300], ['a1', 'pendente', 500]])

  const nfs = [linhaDaNf({ id: 'n', numero: '1', serie: null, tipo: 'sinal', status: 'emitida', data_emissao: '2026-09-01', data_vencimento: '2026-10-01', valor_total: 1000.01, pagamentos: [] }, HOJE)]
  assert.equal(atrasadoDaObra(nfs, abertas), 1300.01)
  assert.equal(atrasadoDaObra([], []), 0)
})

test('linha do tempo: por mês, do mais recente, com o acumulado; o arquivado da conversão fica de fora', () => {
  const pg = (id: string, data: string, valor: number, origem: 'nf' | 'acordo' | 'avulso', statusAcordo?: string): PagamentoDaObra => ({
    id, data_pagamento: data, origem, forma: 'pix', valor,
    nota: origem === 'nf' ? { numero: '7', serie: '1', status: 'paga' } : null,
    parcela: origem === 'acordo' ? { numero_parcela: 1, acordo: { descricao: 'Sinal', status: statusAcordo as never } } : null,
  })
  const meses = linhaDoTempo([
    pg('1', '2026-08-05', 100, 'nf'),
    pg('2', '2026-09-10', 200.1, 'avulso'),
    pg('3', '2026-09-20', 50, 'acordo', 'aberto'),
    pg('4', '2026-09-25', 999, 'acordo', 'convertido_nf'),
  ])
  assert.deepEqual(meses.map((m) => [m.mes, m.total, m.acumulado]), [['2026-09', 250.1, 350.1], ['2026-08', 100, 100]])
  assert.deepEqual(meses[0].pagamentos.map((p) => [p.id, p.documento]), [['3', 'Sinal · parcela 1'], ['2', '—']])
  assert.equal(meses[1].pagamentos[0].documento, 'NF 7 / 1')
  assert.deepEqual(linhaDoTempo([]), [])
  assert.equal(rotuloDoMes('2026-09'), 'Setembro de 2026')
  assert.equal(rotuloDoMes('2026-03'), 'Março de 2026')
})
