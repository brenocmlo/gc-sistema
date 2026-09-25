import assert from 'node:assert/strict'
import test from 'node:test'

import {
  ETAPAS,
  etapaAtual,
  filtrarExecucoes,
  limitesDaEtapa,
  maximoDaEtapa,
  mensagemDeErroExecucao,
  progressoAgregado,
  progressoEtapa,
  progressoGeral,
  ordenarExecucoes,
  qtdsDaExecucao,
  responsaveisDe,
  statusDaEtapa,
  statusGeral,
  validarCascata,
  proximoSequencial,
  resumoPorItem,
  somaAcimaDoItem,
  validarEtapa,
  validarPrevisoes,
  etapasAtrasadas,
  etapaAtrasada,
  proximosVencimentos,
  diasEntre,
  validarQuantidadeDaExecucao,
  validarReducaoDaExecucao,
} from './execucao.ts'

test('ETAPAS segue a ordem da cascata', () => {
  assert.deepEqual([...ETAPAS], ['fab', 'ent', 'inst', 'med'])
})

test('statusDaEtapa espelha o GENERATED: 0 pendente, total concluído, meio andamento', () => {
  assert.equal(statusDaEtapa(0, 10), 'pendente')
  assert.equal(statusDaEtapa(4, 10), 'andamento')
  assert.equal(statusDaEtapa(10, 10), 'concluido')
  // Item de quantidade zero: nada a fazer, fica pendente (qtd = 0 vem antes).
  assert.equal(statusDaEtapa(0, 0), 'pendente')
  // Decimal de numeric(10,3), sem ruído de ponto flutuante.
  assert.equal(statusDaEtapa(0.1 + 0.2, 0.3), 'concluido')
})

test('validarCascata aceita a cascata em escada e a execução zerada', () => {
  assert.deepEqual(validarCascata(10, 8, 5, 2, 10), { ok: true })
  assert.deepEqual(validarCascata(0, 0, 0, 0, 10), { ok: true })
  assert.deepEqual(validarCascata(10, 10, 10, 10, 10), { ok: true })
})

test('validarCascata: cada bloqueio aponta a etapa e explica o limite', () => {
  const fab = validarCascata(11, 0, 0, 0, 10)
  assert.equal(fab.ok, false)
  assert.equal(fab.ok ? null : fab.etapa, 'fab')
  assert.match(fab.ok ? '' : fab.error, /fabricar 10: é a quantidade total do item/)

  const ent = validarCascata(12, 13, 0, 0, 20)
  assert.equal(ent.ok ? null : ent.etapa, 'ent')
  assert.equal(ent.ok ? '' : ent.error, 'Só é possível entregar 12 porque só 12 foram fabricados')

  const inst = validarCascata(12, 5, 6, 0, 20)
  assert.equal(inst.ok ? '' : inst.error, 'Só é possível instalar 5 porque só 5 foram entregues')

  const med = validarCascata(12, 5, 3, 4, 20)
  assert.equal(med.ok ? '' : med.error, 'Só é possível medir 3 porque só 3 foram instalados')
})

test('validarCascata: concordância de nenhum e de um', () => {
  const nada = validarCascata(0, 1, 0, 0, 10)
  assert.equal(nada.ok ? '' : nada.error, 'Não é possível entregar porque nenhuma unidade foi fabricada')
  const um = validarCascata(1, 2, 0, 0, 10)
  assert.equal(um.ok ? '' : um.error, 'Só é possível entregar 1 porque só 1 foi fabricado')
})

test('validarCascata: decimais em vírgula na mensagem, e mais de 3 casas recusado', () => {
  const r = validarCascata(2.5, 3, 0, 0, 10)
  assert.equal(r.ok ? '' : r.error, 'Só é possível entregar 2,5 porque só 2,5 foram fabricados')
  assert.match((validarCascata(1.2345, 0, 0, 0, 10) as { error: string }).error, /3 casas/)
})

test('validarCascata recusa negativo e não número, na etapa certa', () => {
  const neg = validarCascata(5, -1, 0, 0, 10)
  assert.equal(neg.ok ? null : neg.etapa, 'ent')
  assert.match(neg.ok ? '' : neg.error, /negativa/)
  const nan = validarCascata(5, 0, Number.NaN, 0, 10)
  assert.equal(nan.ok ? null : nan.etapa, 'inst')
})

test('limitesDaEtapa: o máximo é a etapa anterior, o mínimo é a seguinte', () => {
  const q = { fab: 10, ent: 6, inst: 4, med: 1 }
  assert.deepEqual(limitesDaEtapa('fab', q, 12), { min: 6, max: 12 })
  assert.deepEqual(limitesDaEtapa('ent', q, 12), { min: 4, max: 10 })
  assert.deepEqual(limitesDaEtapa('inst', q, 12), { min: 1, max: 6 })
  assert.deepEqual(limitesDaEtapa('med', q, 12), { min: 0, max: 4 })
})

test('maximoDaEtapa é o "concluir etapa"', () => {
  const q = { fab: 10, ent: 6, inst: 0, med: 0 }
  assert.equal(maximoDaEtapa('fab', q, 12), 12)
  assert.equal(maximoDaEtapa('inst', q, 12), 6)
})

test('progressoEtapa e progressoGeral', () => {
  assert.equal(progressoEtapa(5, 10), 50)
  assert.equal(progressoEtapa(1, 3), 33.33)
  assert.equal(progressoEtapa(3, 0), 0)
  // Cada etapa pesa igual: metade fabricado e nada mais é 12,5%.
  assert.equal(progressoGeral({ fab: 5, ent: 0, inst: 0, med: 0 }, 10), 12.5)
  assert.equal(progressoGeral({ fab: 10, ent: 10, inst: 10, med: 10 }, 10), 100)
})

test('progressoAgregado soma quantidades e totais de várias execuções', () => {
  const linhas = [
    { quantidade_total: 10, fab_qtd: 10, ent_qtd: 5, inst_qtd: 0, med_qtd: 0 },
    { quantidade_total: 30, fab_qtd: 10, ent_qtd: 5, inst_qtd: 5, med_qtd: 0 },
  ]
  assert.deepEqual(progressoAgregado(linhas), { fab: 50, ent: 25, inst: 12.5, med: 0 })
  assert.deepEqual(progressoAgregado([]), { fab: 0, ent: 0, inst: 0, med: 0 })
  assert.deepEqual(qtdsDaExecucao(linhas[0]), { fab: 10, ent: 5, inst: 0, med: 0 })
})

test('mensagemDeErroExecucao traduz os CHECKs da cascata e as outras constraints', () => {
  assert.match(mensagemDeErroExecucao('violates check constraint "execucao_ent_qtd_check"'), /fabricado/)
  assert.match(mensagemDeErroExecucao('violates check constraint "execucao_med_qtd_check"'), /instalado/)
  assert.match(mensagemDeErroExecucao('duplicate key value violates unique constraint "idx_execucao_item_sequencial"'), /sequencial/)
  assert.match(mensagemDeErroExecucao('apenas admin ou financeiro pode alterar valor_unit em execucao'), /financeiro/)
  assert.equal(mensagemDeErroExecucao('outro erro'), 'outro erro')
})

// ------------------------------------------------------------
// Listagem por obra (7.2)
// ------------------------------------------------------------

function linha(numero: number | null, q: [number, number, number, number], total = 10, extra: Record<string, unknown> = {}) {
  return {
    quantidade_total: total,
    fab_qtd: q[0], ent_qtd: q[1], inst_qtd: q[2], med_qtd: q[3],
    fab_responsavel: null, ent_responsavel: null, inst_responsavel: null, med_responsavel: null,
    sequencial: 1,
    item: { numero, descricao: `Janela ${numero}`, tipo: 'Esquadria' },
    ...extra,
  }
}

test('etapaAtual é a primeira etapa não concluída; tudo concluído é null', () => {
  assert.equal(etapaAtual(linha(1, [0, 0, 0, 0])), 'fab')
  assert.equal(etapaAtual(linha(1, [10, 3, 0, 0])), 'ent')
  assert.equal(etapaAtual(linha(1, [10, 10, 10, 9])), 'med')
  assert.equal(etapaAtual(linha(1, [10, 10, 10, 10])), null)
})

test('statusGeral: nada fabricado é pendente, tudo medido é concluído', () => {
  assert.equal(statusGeral(linha(1, [0, 0, 0, 0])), 'pendente')
  assert.equal(statusGeral(linha(1, [1, 0, 0, 0])), 'andamento')
  assert.equal(statusGeral(linha(1, [10, 10, 10, 10])), 'concluido')
  // Item de quantidade zero não aparece como concluído.
  assert.equal(statusGeral(linha(1, [0, 0, 0, 0], 0)), 'pendente')
})

test('filtrarExecucoes por etapa, status, responsável e busca sem acento', () => {
  const linhas = [
    linha(1, [0, 0, 0, 0]),
    linha(2, [10, 4, 0, 0], 10, { ent_responsavel: 'João' }),
    linha(3, [10, 10, 10, 10], 10, { item: { numero: 3, descricao: 'Porta de correr', tipo: 'Porta' } }),
  ]
  assert.deepEqual(filtrarExecucoes(linhas, { etapa: 'ent' }).map((l) => l.item?.numero), [2])
  assert.deepEqual(filtrarExecucoes(linhas, { status: 'concluido' }).map((l) => l.item?.numero), [3])
  assert.deepEqual(filtrarExecucoes(linhas, { responsavel: 'João' }).map((l) => l.item?.numero), [2])
  assert.deepEqual(filtrarExecucoes(linhas, { busca: 'CORRER' }).map((l) => l.item?.numero), [3])
  assert.deepEqual(filtrarExecucoes(linhas, { busca: 'esquadria' }).map((l) => l.item?.numero), [1, 2])
  assert.equal(filtrarExecucoes(linhas, {}).length, 3)
})

test('responsaveisDe junta as quatro etapas, sem repetir e em ordem', () => {
  const linhas = [
    linha(1, [0, 0, 0, 0], 10, { fab_responsavel: 'Maria', med_responsavel: 'Ana' }),
    linha(2, [0, 0, 0, 0], 10, { ent_responsavel: ' Maria ', inst_responsavel: 'Ângelo' }),
  ]
  assert.deepEqual(responsaveisDe(linhas), ['Ana', 'Ângelo', 'Maria'])
})

test('ordenarExecucoes por número: sequencial desempata e sem número vai ao fim', () => {
  const linhas = [linha(3, [0, 0, 0, 0]), linha(null, [0, 0, 0, 0]), linha(1, [0, 0, 0, 0], 10, { sequencial: 2 }), linha(1, [0, 0, 0, 0])]
  const r = ordenarExecucoes(linhas, 'numero').map((l) => `${l.item?.numero}/${l.sequencial}`)
  assert.deepEqual(r, ['1/1', '1/2', '3/1', 'null/1'])
})

test('ordenarExecucoes por atraso: etapa mais cedo primeiro, depois menor progresso nela', () => {
  const linhas = [
    linha(1, [10, 10, 10, 10]), // concluída: por último
    linha(2, [10, 10, 2, 0]), // parada na instalação
    linha(3, [8, 0, 0, 0]), // fabricação a 80%
    linha(4, [2, 0, 0, 0]), // fabricação a 20%: a mais atrasada
  ]
  assert.deepEqual(ordenarExecucoes(linhas, 'atraso').map((l) => l.item?.numero), [4, 3, 2, 1])
  // Não muda o array de entrada.
  assert.deepEqual(linhas.map((l) => l.item?.numero), [1, 2, 3, 4])
})

// ------------------------------------------------------------
// Apontamento (7.3)
// ------------------------------------------------------------

test('validarEtapa: acima do máximo explica pela etapa anterior', () => {
  const q = { fab: 12, ent: 0, inst: 0, med: 0 }
  assert.deepEqual(validarEtapa('ent', 12, q, 20), { ok: true })
  const r = validarEtapa('ent', 13, q, 20)
  assert.equal(r.ok ? '' : r.error, 'Só é possível entregar 12 porque só 12 foram fabricados')
  assert.match((validarEtapa('fab', 21, q, 20) as { error: string }).error, /quantidade total do item/)
})

test('validarEtapa: abaixo do mínimo explica na etapa que a pessoa mexeu', () => {
  const q = { fab: 10, ent: 6, inst: 1, med: 0 }
  const r = validarEtapa('fab', 4, q, 10)
  assert.equal(r.ok ? '' : r.error, 'Não é possível baixar a fabricação para 4: já foram entregues 6')
  const um = validarEtapa('ent', 0, q, 10)
  assert.equal(um.ok ? '' : um.error, 'Não é possível baixar a entrega para 0: já foi instalado 1')
})

test('validarEtapa recusa não número, negativo e mais de 3 casas', () => {
  const q = { fab: 0, ent: 0, inst: 0, med: 0 }
  assert.equal(validarEtapa('fab', Number.NaN, q, 10).ok, false)
  assert.equal(validarEtapa('fab', -1, q, 10).ok, false)
  assert.equal(validarEtapa('fab', 1.0001, q, 10).ok, false)
})

// ------------------------------------------------------------
// Várias execuções por item (7.4)
// ------------------------------------------------------------

test('proximoSequencial: 1 para o primeiro, maior + 1 depois (buraco não é reaproveitado)', () => {
  assert.equal(proximoSequencial([]), 1)
  assert.equal(proximoSequencial([1, 2]), 3)
  assert.equal(proximoSequencial([1, 3]), 4)
})

test('validarQuantidadeDaExecucao: cabe no que sobra do item', () => {
  assert.deepEqual(validarQuantidadeDaExecucao(4, 10, [6]), { ok: true })
  const passou = validarQuantidadeDaExecucao(5, 10, [6])
  assert.equal(passou.ok ? '' : passou.error, 'Só cabem 4 nesta execução: o item tem 10 e as outras execuções já somam 6')
  const cheio = validarQuantidadeDaExecucao(1, 10, [10])
  assert.match(cheio.ok ? '' : cheio.error, /já está todo distribuído/)
  assert.equal(validarQuantidadeDaExecucao(0, 10, []).ok, false)
  assert.equal(validarQuantidadeDaExecucao(2.0001, 10, []).ok, false)
  // Decimais somam sem ruído: 0,1 + 0,2 deixa 0,7 de um item de 1.
  assert.deepEqual(validarQuantidadeDaExecucao(0.7, 1, [0.1, 0.2]), { ok: true })
})

test('validarReducaoDaExecucao: não abaixo do que já foi fabricado', () => {
  assert.deepEqual(validarReducaoDaExecucao(5, { fab: 5, ent: 0, inst: 0, med: 0 }), { ok: true })
  const r = validarReducaoDaExecucao(4, { fab: 5, ent: 2, inst: 0, med: 0 })
  assert.equal(r.ok ? '' : r.error, 'Já foram fabricados 5 nesta execução; a quantidade dela não pode ficar abaixo disso')
})

test('resumoPorItem conta e soma por item, e somaAcimaDoItem acusa o excesso', () => {
  const r = resumoPorItem([
    { item_id: 'a', quantidade_total: 6, item: { quantidade: 10 } },
    { item_id: 'a', quantidade_total: 4, item: { quantidade: 10 } },
    { item_id: 'b', quantidade_total: 3, item: { quantidade: 2 } },
  ])
  assert.deepEqual(r.get('a'), { execucoes: 2, soma: 10, quantidadeDoItem: 10 })
  assert.equal(somaAcimaDoItem(r.get('a')!), false)
  assert.equal(somaAcimaDoItem(r.get('b')!), true)
})

// ------------------------------------------------------------
// Previsões e atrasos (7.5)
// ------------------------------------------------------------

const HOJE = '2026-09-23'

test('etapaAtrasada: previsão passada e etapa não concluída; vencer hoje ainda não é atraso', () => {
  const e = linha(1, [4, 0, 0, 0], 10, { fab_previsao_fim: '2026-09-20', ent_previsao_fim: HOJE })
  assert.equal(etapaAtrasada(e, 'fab', HOJE), true)
  assert.equal(etapaAtrasada(e, 'ent', HOJE), false)
  assert.equal(etapaAtrasada(e, 'inst', HOJE), false)
  // Concluída não atrasa, mesmo com a previsão no passado.
  const feita = linha(2, [10, 0, 0, 0], 10, { fab_previsao_fim: '2026-09-01' })
  assert.equal(etapaAtrasada(feita, 'fab', HOJE), false)
  assert.deepEqual(etapasAtrasadas(linha(3, [0, 0, 0, 0], 10, { fab_previsao_fim: '2026-09-01', med_previsao_fim: '2026-09-02' }), HOJE), ['fab', 'med'])
})

test('filtro "só atrasados" e a ordem por atraso com a previsão vencida primeiro', () => {
  const linhas = [
    linha(1, [2, 0, 0, 0]), // fabricação a 20%, sem previsão
    linha(2, [10, 10, 2, 0], 10, { inst_previsao_fim: '2026-09-10' }), // instalação vencida há mais tempo
    linha(3, [9, 0, 0, 0], 10, { fab_previsao_fim: '2026-09-20' }), // fabricação vencida
    linha(4, [10, 10, 10, 10], 10, { med_previsao_fim: '2026-09-01' }), // concluída: não atrasa
  ]
  assert.deepEqual(filtrarExecucoes(linhas, { atrasados: true, hoje: HOJE }).map((l) => l.item?.numero), [2, 3])
  assert.deepEqual(ordenarExecucoes(linhas, 'atraso', HOJE).map((l) => l.item?.numero), [2, 3, 1, 4])
})

test('proximosVencimentos: janela de hoje a +7 dias, sem as vencidas e sem as concluídas', () => {
  const linhas = [
    linha(1, [0, 0, 0, 0], 10, { fab_previsao_fim: '2026-09-25' }),
    linha(2, [0, 0, 0, 0], 10, { fab_previsao_fim: HOJE, ent_previsao_fim: '2026-09-30' }),
    linha(3, [0, 0, 0, 0], 10, { fab_previsao_fim: '2026-10-01' }), // 8 dias: fora
    linha(4, [0, 0, 0, 0], 10, { fab_previsao_fim: '2026-09-22' }), // vencida: fora
    linha(5, [10, 0, 0, 0], 10, { fab_previsao_fim: '2026-09-24' }), // concluída: fora
  ]
  const v = proximosVencimentos(linhas, HOJE)
  assert.deepEqual(v.map((x) => `${x.execucao.item?.numero}:${x.etapa}:${x.dias}`), ['2:fab:0', '1:fab:2', '2:ent:7'])
  assert.equal(diasEntre(HOJE, '2026-10-01'), 8)
  assert.equal(diasEntre(HOJE, '2026-09-22'), -1)
})

test('validarPrevisoes: datas válidas e na ordem da cascata, sem contar as vazias', () => {
  assert.deepEqual(validarPrevisoes({ fab: '2026-10-01', ent: null, inst: '2026-10-10', med: '2026-10-10' }), { ok: true })
  const fora = validarPrevisoes({ fab: '2026-10-10', ent: '2026-10-01', inst: null, med: null })
  assert.equal(fora.ok ? '' : fora.error, 'A previsão de entrega não pode ser antes da de fabricação')
  // A comparação pula a etapa vazia: instalação contra fabricação.
  assert.equal(validarPrevisoes({ fab: '2026-10-10', ent: null, inst: '2026-10-05', med: null }).ok, false)
  assert.equal(validarPrevisoes({ fab: '10/10/2026', ent: null, inst: null, med: null }).ok, false)
})
