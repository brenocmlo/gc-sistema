import test from 'node:test'
import assert from 'node:assert/strict'

import {
  atalhosDoPerfil,
  atrasosPorObra,
  execucoesPorEtapa,
  formatTaxa,
  funilComercial,
  motivosDeRejeicao,
  pendenciasDoPerfil,
  progressoDasObras,
  receitaPorMes,
  rotuloMesCurto,
  ultimos12Meses,
  secoesDoPerfil,
  taxaDeConversao,
  type ContagensDePendencia,
  type ExecucaoDoDashboard,
} from './dashboard.ts'

const HOJE = '2026-10-15'

function execucao(qtds: [number, number, number, number], obra: string, previsoes: Partial<Record<'fab' | 'ent' | 'inst' | 'med', string>> = {}): ExecucaoDoDashboard {
  const [fab, ent, inst, med] = qtds
  return {
    quantidade_total: 10,
    fab_qtd: fab,
    ent_qtd: ent,
    inst_qtd: inst,
    med_qtd: med,
    fab_previsao_fim: previsoes.fab ?? null,
    ent_previsao_fim: previsoes.ent ?? null,
    inst_previsao_fim: previsoes.inst ?? null,
    med_previsao_fim: previsoes.med ?? null,
    item: { obra: { id: obra, codigo_obra: `OBRA-${obra}`, nome: `Obra ${obra}` } },
  }
}

test('seções: cada perfil vê as frentes das telas que abre', () => {
  assert.deepEqual(secoesDoPerfil('admin'), ['comercial', 'operacao', 'financeiro'])
  assert.deepEqual(secoesDoPerfil('visualizador'), ['comercial', 'operacao', 'financeiro'])
  assert.deepEqual(secoesDoPerfil('comercial'), ['comercial'])
  assert.deepEqual(secoesDoPerfil('producao'), ['operacao'])
  assert.deepEqual(secoesDoPerfil('medicao'), ['operacao'])
  assert.deepEqual(secoesDoPerfil('financeiro'), ['financeiro'])
})

test('taxa de conversão: aprovadas sobre decididas, sem decisão é "—"', () => {
  assert.equal(taxaDeConversao(0, 0), null)
  assert.equal(formatTaxa(null), '—')
  assert.equal(taxaDeConversao(5, 3), 0.625)
  assert.equal(formatTaxa(0.625), '62,5%')
  assert.equal(formatTaxa(taxaDeConversao(1, 2)), '33,3%')
  assert.equal(formatTaxa(1), '100%')
})

test('execuções por etapa: a etapa atual, a não iniciada na fabricação, a concluída em nenhuma', () => {
  const linhas = [
    execucao([0, 0, 0, 0], 'a'),
    execucao([4, 0, 0, 0], 'a'),
    execucao([10, 4, 0, 0], 'a'),
    execucao([10, 10, 10, 2], 'b'),
    execucao([10, 10, 10, 10], 'b'),
  ]
  assert.deepEqual(execucoesPorEtapa(linhas), { fab: 2, ent: 1, inst: 0, med: 1 })
})

test('atrasos por obra: previsão vencida de etapa não concluída; vencer hoje não atrasa; a obra com mais atrasos primeiro', () => {
  const linhas = [
    execucao([4, 0, 0, 0], 'a', { fab: '2026-10-14' }),
    execucao([10, 0, 0, 0], 'a', { fab: '2026-10-01' }),
    execucao([0, 0, 0, 0], 'a', { fab: HOJE }),
    execucao([10, 10, 3, 0], 'b', { inst: '2026-10-10' }),
    execucao([10, 10, 10, 0], 'b', { med: '2026-09-30' }),
    execucao([0, 0, 0, 0], 'c', { ent: '2026-10-01' }),
  ]
  assert.deepEqual(atrasosPorObra(linhas, HOJE), [
    { obraId: 'b', codigo: 'OBRA-b', nome: 'Obra b', execucoes: 2 },
    { obraId: 'a', codigo: 'OBRA-a', nome: 'Obra a', execucoes: 1 },
    { obraId: 'c', codigo: 'OBRA-c', nome: 'Obra c', execucoes: 1 },
  ])
})

test('pendências: só as do que o perfil faz, só com quantidade, com o link filtrado', () => {
  const c: ContagensDePendencia = {
    orcamentosPendentes: 2,
    propostasVencidas: 0,
    documentosEmRevisao: 1,
    documentosAConferir: 0,
    atrasosDeExecucao: [{ obraId: 'x', codigo: 'OBRA-x', nome: 'Obra x', execucoes: 3 }],
    documentosFinanceirosVencidos: 4,
    fdsVencidos: 1,
  }
  const chaves = (p: Parameters<typeof pendenciasDoPerfil>[0]) => pendenciasDoPerfil(p, c).map((x) => x.chave)
  assert.deepEqual(chaves('comercial'), ['orcamentos', 'revisao'])
  assert.deepEqual(chaves('producao'), ['execucao-x'])
  assert.deepEqual(chaves('medicao'), ['execucao-x'])
  assert.deepEqual(chaves('financeiro'), ['vencidos', 'fd'])
  assert.deepEqual(chaves('admin'), ['orcamentos', 'revisao', 'execucao-x', 'vencidos', 'fd'])
  assert.deepEqual(chaves('visualizador'), [])
  const exec = pendenciasDoPerfil('producao', c)[0]
  assert.equal(exec.href, '/execucao?obra=x&atrasados=1')
  assert.equal(exec.quantidade, 3)
})

test('atalhos: criar só para quem escreve, e o visualizador só consulta', () => {
  const hrefs = (p: Parameters<typeof atalhosDoPerfil>[0]) => atalhosDoPerfil(p).map((a) => a.href)
  assert.ok(hrefs('comercial').includes('/orcamentos/novo'))
  assert.ok(hrefs('financeiro').includes('/financeiro/pagamentos/novo'))
  assert.ok(!hrefs('financeiro').some((h) => h.startsWith('/orcamentos') || h.startsWith('/propostas')))
  assert.ok(!hrefs('producao').some((h) => h.startsWith('/financeiro') || h.startsWith('/fd')))
  assert.ok(!hrefs('visualizador').some((h) => h.endsWith('/novo') || h.endsWith('/nova')))
})

test('funil: conversão sobre a etapa anterior, com a anterior zerada sem conversão', () => {
  assert.deepEqual(funilComercial({ orcamentos: 20, propostas: 8, contratos: 3 }), [
    { etapa: 'Orçamentos', quantidade: 20, conversao: null },
    { etapa: 'Propostas enviadas', quantidade: 8, conversao: 40 },
    { etapa: 'Contratos', quantidade: 3, conversao: 37.5 },
  ])
  assert.equal(funilComercial({ orcamentos: 0, propostas: 0, contratos: 1 })[2].conversao, null)
})

test('receita por mês: 12 meses com virada de ano, arquivado da conversão e NF cancelada fora, em centavos', () => {
  assert.deepEqual(ultimos12Meses('2026-02-10').slice(0, 2), ['2025-03', '2025-04'])
  assert.equal(ultimos12Meses('2026-02-10').at(-1), '2026-02')
  assert.equal(rotuloMesCurto('2026-10'), 'out/26')
  const r = receitaPorMes(
    [
      { data_pagamento: '2026-10-02', valor: '100.10', origem: 'nf', parcela: null },
      { data_pagamento: '2026-10-20', valor: 0.2, origem: 'acordo', parcela: { acordo: { status: 'aberto' } } },
      { data_pagamento: '2026-10-21', valor: 999, origem: 'acordo', parcela: { acordo: { status: 'convertido_nf' } } },
      { data_pagamento: '2025-10-31', valor: 50, origem: 'avulso', parcela: null },
    ],
    [
      { data_emissao: '2026-09-05', status: 'emitida', valor_total: 300 },
      { data_emissao: '2026-09-06', status: 'cancelada', valor_total: 999 },
    ],
    '2026-10-15',
  )
  assert.equal(r.length, 12)
  assert.equal(r[0].mes, '2025-11')
  assert.deepEqual(r.at(-1), { mes: '2026-10', rotulo: 'out/26', recebido: 100.3, faturado: 0 })
  assert.equal(r.at(-2)?.faturado, 300)
  assert.equal(r.reduce((a, m) => a + m.recebido, 0), 100.3)
})

test('progresso das obras: média das etapas agregadas, a menos adiantada primeiro', () => {
  const linhas = [
    execucao([10, 10, 10, 10], 'a'),
    execucao([10, 0, 0, 0], 'a'),
    execucao([5, 0, 0, 0], 'b'),
  ]
  assert.deepEqual(progressoDasObras(linhas).map((o) => [o.obraId, o.execucoes, o.progresso]), [['b', 1, 12.5], ['a', 2, 62.5]])
})

test('motivos de rejeição: orçamentos e propostas lado a lado, o mais frequente primeiro, sem motivo à parte', () => {
  const m = motivosDeRejeicao(
    [{ motivo_rejeicao: 'preco_alto' }, { motivo_rejeicao: 'preco_alto' }, { motivo_rejeicao: null }],
    [{ motivo_rejeicao: 'prazo_curto' }, { motivo_rejeicao: 'preco_alto' }],
  )
  assert.deepEqual(m.map((x) => [x.rotulo, x.orcamentos, x.propostas]), [
    ['Preço acima do esperado', 2, 1],
    ['Prazo inviável', 0, 1],
    ['Sem motivo', 1, 0],
  ])
})
