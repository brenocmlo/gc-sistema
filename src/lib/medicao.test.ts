import test from 'node:test'
import assert from 'node:assert/strict'

import { montarRelatorioDeMedicao, periodoPadrao, validarPeriodo, type ExecucaoParaMedicao } from './medicao.ts'

const item = (numero: number | null, descricao: string, quantidade: number) => ({
  numero, tipo: 'Janela', descricao, quantidade, unidade: 'un',
})

test('periodoPadrao vai do dia 1 do mês até hoje', () => {
  assert.deepEqual(periodoPadrao('2026-09-25'), { de: '2026-09-01', ate: '2026-09-25' })
})

test('validarPeriodo exige as duas datas, válidas e em ordem', () => {
  assert.equal(validarPeriodo('2026-09-01', '2026-09-30').ok, true)
  assert.equal(validarPeriodo('2026-09-01', '2026-09-01').ok, true, 'um dia só vale')
  assert.match((validarPeriodo('2026-09-30', '2026-09-01') as { error: string }).error, /depois da final/)
  assert.match((validarPeriodo('', '2026-09-01') as { error: string }).error, /duas datas/)
  assert.match((validarPeriodo('01/09/2026', '2026-09-01') as { error: string }).error, /duas datas/)
  assert.match((validarPeriodo('2026-02-31', '2026-03-01') as { error: string }).error, /inválida/)
})

test('medido no período soma as mudanças dentro dele; acumulado desconta as mudanças depois do fim', () => {
  const execs: ExecucaoParaMedicao[] = [{ id: 'e1', item_id: 'i1', med_qtd: 9, valor_unit: 100, item: item(1, 'Janela sala', 10) }]
  const hist = [
    { execucao_id: 'e1', data: '2026-08-20', qtd_anterior: 0, qtd_nova: 2 }, // antes: entra só no acumulado
    { execucao_id: 'e1', data: '2026-09-05', qtd_anterior: 2, qtd_nova: 5 }, // no período: +3
    { execucao_id: 'e1', data: '2026-09-30', qtd_anterior: 5, qtd_nova: 6 }, // no período (último dia): +1
    { execucao_id: 'e1', data: '2026-10-02', qtd_anterior: 6, qtd_nova: 9 }, // depois: fora do acumulado
  ]
  const r = montarRelatorioDeMedicao(execs, hist, { de: '2026-09-01', ate: '2026-09-30' })
  assert.deepEqual(r.linhas[0], {
    itemId: 'i1', numero: 1, descricao: 'Janela sala', unidade: 'un', contratada: 10,
    medidoPeriodo: 4, acumulado: 6, valorUnit: 100, valorPeriodo: 400, valorAcumulado: 600,
  })
  assert.deepEqual(r.totais, { valorPeriodo: 400, valorAcumulado: 600 })
})

test('correção para baixo no período entra negativa', () => {
  const execs: ExecucaoParaMedicao[] = [{ id: 'e1', item_id: 'i1', med_qtd: 3, valor_unit: 10, item: item(1, 'A', 10) }]
  const hist = [
    { execucao_id: 'e1', data: '2026-08-01', qtd_anterior: 0, qtd_nova: 5 },
    { execucao_id: 'e1', data: '2026-09-10', qtd_anterior: 5, qtd_nova: 3 },
  ]
  const r = montarRelatorioDeMedicao(execs, hist, { de: '2026-09-01', ate: '2026-09-30' })
  assert.equal(r.linhas[0].medidoPeriodo, -2)
  assert.equal(r.linhas[0].valorPeriodo, -20)
  assert.equal(r.linhas[0].acumulado, 3)
})

test('várias execuções de um item somam numa linha; valor unitário diferente vira null; decimais sem ruído', () => {
  const execs: ExecucaoParaMedicao[] = [
    { id: 'a', item_id: 'i1', med_qtd: 0.1, valor_unit: 10, item: item(2, 'Fachada', 1) },
    { id: 'b', item_id: 'i1', med_qtd: 0.2, valor_unit: 12, item: item(2, 'Fachada', 1) },
    { id: 'c', item_id: 'i2', med_qtd: 0, valor_unit: 50, item: item(1, 'Porta', 4) },
    { id: 'd', item_id: 'i3', med_qtd: 1, valor_unit: 5, item: item(null, 'Sem número', 1) },
  ]
  const hist = [
    { execucao_id: 'a', data: '2026-09-02', qtd_anterior: 0, qtd_nova: 0.1 },
    { execucao_id: 'b', data: '2026-09-03', qtd_anterior: 0, qtd_nova: 0.2 },
    { execucao_id: 'd', data: '2026-09-03', qtd_anterior: 0, qtd_nova: 1 },
  ]
  const r = montarRelatorioDeMedicao(execs, hist, { de: '2026-09-01', ate: '2026-09-30' })
  assert.deepEqual(r.linhas.map((l) => l.descricao), ['Porta', 'Fachada', 'Sem número'], 'por número, sem número no fim')
  const fachada = r.linhas[1]
  assert.equal(fachada.medidoPeriodo, 0.3)
  assert.equal(fachada.valorUnit, null)
  assert.equal(fachada.valorPeriodo, 3.4) // 0,1×10 + 0,2×12
  assert.equal(r.linhas[0].medidoPeriodo, 0, 'item sem medição fica na tabela com zero')
  assert.equal(r.totais.valorPeriodo, 8.4)
})

test('sem execução, relatório vazio com totais zero', () => {
  assert.deepEqual(montarRelatorioDeMedicao([], [], { de: '2026-09-01', ate: '2026-09-30' }), {
    linhas: [], totais: { valorPeriodo: 0, valorAcumulado: 0 },
  })
})
