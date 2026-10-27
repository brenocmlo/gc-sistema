import assert from 'node:assert/strict'
import test from 'node:test'

import {
  cascataDaExecucao,
  chaveDeImportacao,
  codigoDeObraDoNome,
  conferenciaDaMedicao,
  contratosDaImportacao,
  dataDaPlanilha,
  datasDoFd,
  formaDePagamento,
  nomeCanonicoDoCliente,
  numeroDaPlanilha,
  numeroDoContratoImportado,
  observacaoComMarca,
  statusContratoDaObra,
  statusNfDaPlanilha,
  statusObraDaPlanilha,
  statusPropostaDaPlanilha,
  unidadeDoFd,
  unidadeDoItem,
} from './importacao.ts'

test('decisão 1: caixa e acento já juntam; nome diferente só pela tabela de equivalências', () => {
  assert.equal(nomeCanonicoDoCliente('  ESTAÇÃO   FASHION '), 'ESTAÇÃO FASHION')
  const eq = { 'Estação Fashion': ['EF EMPREENDIMENTOS IMOBILIARIOS'] }
  assert.equal(nomeCanonicoDoCliente('ESTAÇÃO FASHION', eq), 'Estação Fashion')
  assert.equal(nomeCanonicoDoCliente('estacao fashion', eq), 'Estação Fashion')
  assert.equal(nomeCanonicoDoCliente('EF Empreendimentos Imobiliários', eq), 'Estação Fashion')
  assert.equal(nomeCanonicoDoCliente('Outro Cliente', eq), 'Outro Cliente')
})

test('número da planilha: Excel, BR, US, moeda, porcentagem e vazio', () => {
  assert.equal(numeroDaPlanilha(1234.5), 1234.5)
  assert.equal(numeroDaPlanilha('R$ 1.234,56'), 1234.56)
  assert.equal(numeroDaPlanilha('1,234.56'), 1234.56)
  assert.equal(numeroDaPlanilha('627.959,83'), 627959.83)
  assert.equal(numeroDaPlanilha('30%'), 0.3)
  assert.equal(numeroDaPlanilha('12'), 12)
  assert.equal(numeroDaPlanilha(''), null)
  assert.equal(numeroDaPlanilha('-'), null)
  assert.equal(numeroDaPlanilha('abc'), null)
})

test('data da planilha: Date, série do Excel, dd/mm/aaaa e inválida', () => {
  assert.equal(dataDaPlanilha(new Date(Date.UTC(2026, 2, 15))), '2026-03-15')
  assert.equal(dataDaPlanilha(46096), '2026-03-15')
  assert.equal(dataDaPlanilha('15/03/2026'), '2026-03-15')
  assert.equal(dataDaPlanilha('5/3/26'), '2026-03-05')
  assert.equal(dataDaPlanilha('31/02/2026'), null)
  assert.equal(dataDaPlanilha(''), null)
})

test('status de NF e de proposta pelo texto da planilha', () => {
  assert.equal(statusNfDaPlanilha('Paga'), 'paga')
  assert.equal(statusNfDaPlanilha('Atrasada'), 'emitida')
  assert.equal(statusNfDaPlanilha('Em aberto'), 'emitida')
  assert.equal(statusNfDaPlanilha('Cancelada'), 'cancelada')
  assert.equal(statusNfDaPlanilha('???'), null)
  assert.equal(statusPropostaDaPlanilha('Aprovada'), 'aprovada')
  assert.equal(statusPropostaDaPlanilha('Fechada'), 'aprovada')
  assert.equal(statusPropostaDaPlanilha('Em negociação'), 'enviada')
  assert.equal(statusPropostaDaPlanilha('Perdida'), 'rejeitada')
  assert.equal(statusPropostaDaPlanilha(''), null)
})

test('forma de pagamento e unidades', () => {
  assert.equal(formaDePagamento('PIX'), 'pix')
  assert.equal(formaDePagamento('Transferência'), 'ted')
  assert.equal(formaDePagamento('Cartão de crédito'), 'cartao')
  assert.equal(formaDePagamento('permuta'), 'outro')
  assert.equal(unidadeDoItem('m²'), 'M2')
  assert.equal(unidadeDoItem('UN'), 'QTD')
  assert.equal(unidadeDoItem(''), 'QTD')
  assert.equal(unidadeDoItem('litro'), null)
  assert.equal(unidadeDoFd('Kg'), 'KG')
  assert.equal(unidadeDoFd('peças'), 'PC')
  assert.equal(unidadeDoFd('caixa'), 'OUTRO')
  assert.equal(unidadeDoFd(''), null)
})

test('decisão 3: o instalado foi fabricado e entregue; a medição começa em zero', () => {
  const r = cascataDaExecucao({ total: 10, fabricada: null, instalada: 6 })
  assert.equal(r.ok, true)
  if (r.ok) {
    assert.deepEqual(r.cascata, { fab: 6, ent: 6, inst: 6, med: 0 })
    assert.equal(r.ajustes.length, 2)
  }
  const comFab = cascataDaExecucao({ total: 10, fabricada: 8, instalada: 6 })
  assert.ok(comFab.ok && comFab.cascata.fab === 8 && comFab.cascata.ent === 6)
  const zerada = cascataDaExecucao({ total: 4 })
  assert.ok(zerada.ok && zerada.cascata.fab === 0 && zerada.ajustes.length === 0)
})

test('decisão 3: o que não cabe na cascata é recusado com o motivo, sem inventar número', () => {
  assert.deepEqual(cascataDaExecucao({ total: 5, instalada: 6 }), { ok: false, motivo: 'instalada (6) maior que o total do item (5)' })
  assert.deepEqual(cascataDaExecucao({ total: 5, fabricada: 7, instalada: 1 }), { ok: false, motivo: 'fabricada (7) maior que o total do item (5)' })
  assert.deepEqual(cascataDaExecucao({ total: 5, instalada: 2, medida: 3 }), { ok: false, motivo: 'medida (3) maior que a instalada (2)' })
  assert.equal(cascataDaExecucao({ total: 5, instalada: -1 }).ok, false)
})

test('chave de importação: estável, sem caixa nem acento, e diferente para outra linha', () => {
  const a = chaveDeImportacao('pagamento', ['NF 12', '2026-03-15', 1000])
  assert.equal(a, chaveDeImportacao('pagamento', ['nf  12', '2026-03-15', '1000']))
  assert.notEqual(a, chaveDeImportacao('pagamento', ['NF 12', '2026-03-16', 1000]))
  assert.match(a, /^pagamento-[0-9a-f]{8}$/)
  assert.equal(observacaoComMarca({ texto: ' obs ', link: 'https://drive/x', chave: a }), `obs\nArquivo: https://drive/x\n[importacao:${a}]`)
  assert.equal(observacaoComMarca({ chave: a }), `[importacao:${a}]`)
})

test('código de obra a partir do nome', () => {
  assert.equal(codigoDeObraDoNome('Estação Fashion – Bloco 2'), 'LEGADO-ESTACAO-FASHION-BLOCO-2')
  assert.equal(codigoDeObraDoNome(''), '')
})

test('decisão 2: status da obra pela planilha, e o do contrato a partir dele', () => {
  assert.equal(statusObraDaPlanilha('Em andamento'), 'ativa')
  assert.equal(statusObraDaPlanilha('ATIVA'), 'ativa')
  assert.equal(statusObraDaPlanilha('Concluída'), 'concluida')
  assert.equal(statusObraDaPlanilha('Finalizada'), 'concluida')
  assert.equal(statusObraDaPlanilha('Paralisada'), 'suspensa')
  assert.equal(statusObraDaPlanilha('Cancelada'), 'cancelada')
  assert.equal(statusObraDaPlanilha(''), null)
  assert.equal(statusObraDaPlanilha('???'), null)
  assert.equal(statusContratoDaObra('concluida'), 'concluido')
  assert.equal(statusContratoDaObra('ativa'), 'ativo')
  assert.equal(statusContratoDaObra('suspensa'), 'ativo')
  assert.equal(statusContratoDaObra(null), 'ativo')
})

test('decisão 2: número do contrato importado — a coluna da planilha vence o CT-<proposta>', () => {
  assert.equal(numeroDoContratoImportado('P-12'), 'CT-P-12')
  assert.equal(numeroDoContratoImportado(' P-12 ', '  '), 'CT-P-12')
  assert.equal(numeroDoContratoImportado('P-12', ' 045/2026 '), '045/2026')
  assert.equal(numeroDoContratoImportado('P-12', null, 'C'), 'CP-12')
})

test('decisão 2: um contrato por obra com aprovada; principal pela data, depois valor, depois número', () => {
  const ps = [
    { numero: 'P3', obra: 'A', status: 'aprovada', data_emissao: '2026-03-01', valor_total: 900 },
    { numero: 'P1', obra: 'A', status: 'aprovada', data_emissao: '2026-02-01', valor_total: 100 },
    { numero: 'P2', obra: 'A', status: 'enviada', data_emissao: '2026-01-01', valor_total: 5000 },
    { numero: 'P10', obra: 'B', status: 'aprovada', data_emissao: '2026-02-01', valor_total: 100 },
    { numero: 'P9', obra: 'B', status: 'aprovada', data_emissao: '2026-02-01', valor_total: 100 },
    { numero: 'P8', obra: 'B', status: 'aprovada', data_emissao: '2026-02-01', valor_total: 300 },
    { numero: 'P7', obra: 'B', status: 'aprovada', data_emissao: null, valor_total: 9999 },
    { numero: 'P5', obra: 'C', status: 'rejeitada', data_emissao: '2026-02-01', valor_total: 100 },
  ]
  const c = contratosDaImportacao(ps)
  assert.deepEqual(c.map((x) => [x.obra, x.principal.numero, x.aditivos.map((a) => a.numero)]), [
    ['A', 'P1', ['P3']],
    ['B', 'P8', ['P9', 'P10', 'P7']],
  ])
  assert.deepEqual(contratosDaImportacao(ps, ['valor_desc']).map((x) => x.principal.numero), ['P3', 'P7'])
  assert.deepEqual(contratosDaImportacao([]), [])
})

test('decisão 5: o corte do FD usa lançamento ou pagamento, nunca o vencimento', () => {
  assert.deepEqual(datasDoFd({ lancamento: '2026-11-01', vencimento: '2026-12-01' }), { data: '2026-11-01', dataDoCorte: '2026-11-01', soVencimento: false })
  assert.deepEqual(datasDoFd({ vencimento: '2026-12-01', pagamento: '2026-11-05' }), { data: '2026-12-01', dataDoCorte: '2026-11-05', soVencimento: false })
  assert.deepEqual(datasDoFd({ vencimento: '2026-12-01' }), { data: '2026-12-01', dataDoCorte: null, soVencimento: true })
  assert.deepEqual(datasDoFd({}), { data: null, dataDoCorte: null, soVencimento: false })
})

test('decisão 3: NF de medição sem medição vira aviso; acima do instalado, divergência', () => {
  assert.deepEqual(conferenciaDaMedicao({ nfMedicao: 0, somaMedida: 0, instaladoValor: 0 }), [])
  assert.deepEqual(conferenciaDaMedicao({ nfMedicao: 1000, somaMedida: 2, instaladoValor: 1000 }), [])
  assert.deepEqual(conferenciaDaMedicao({ nfMedicao: 1000, somaMedida: 0, instaladoValor: 5000 }).map((x) => x.tipo), ['aviso'])
  assert.deepEqual(conferenciaDaMedicao({ nfMedicao: 2250, somaMedida: 0, instaladoValor: 0 }).map((x) => x.tipo), ['aviso', 'divergencia'])
  assert.deepEqual(conferenciaDaMedicao({ nfMedicao: 1000.005, somaMedida: 1, instaladoValor: 1000 }), [])
})
