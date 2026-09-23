import test from 'node:test'
import assert from 'node:assert/strict'

import {
  dimensaoEmMetros,
  montarIngestao,
  montarItemIngestao,
  numeroBR,
  tokenConfere,
  type ItemExtraido,
} from './ingestao.ts'

const CTX = { empresaId: 'emp-1', obraId: 'obra-1', criadoPor: 'autor-uuid' }
const EM = '2026-09-23T12:00:00.000Z'
const base = {
  documentoId: 'doc-1',
  empresaId: 'emp-1',
  obraId: 'obra-1',
  numero: 'PROP-TESTE-1',
  valorTotal: 1000,
  origem: { canal: 'TELEGRAM', chatId: '123' },
}

// ---- numeroBR / dimensaoEmMetros

test('numeroBR lê formato brasileiro, zero à esquerda e number', () => {
  assert.equal(numeroBR('R$ 1.986,08'), 1986.08)
  assert.equal(numeroBR('R$120,00'), 120)
  assert.equal(numeroBR('01'), 1)
  assert.equal(numeroBR(250), 250)
  assert.equal(numeroBR('1986.08'), 1986.08)
  assert.equal(numeroBR(''), null)
  assert.equal(numeroBR('—'), null)
  assert.equal(numeroBR(null), null)
})

test('dimensaoEmMetros lê acima de 10 como milímetro', () => {
  assert.deepEqual(dimensaoEmMetros(950), { metros: 0.95, deMilimetro: true })
  assert.deepEqual(dimensaoEmMetros('2100'), { metros: 2.1, deMilimetro: true })
  assert.deepEqual(dimensaoEmMetros(1.2), { metros: 1.2, deMilimetro: false })
  assert.deepEqual(dimensaoEmMetros(null), { metros: null, deMilimetro: false })
})

// ---- montarItemIngestao: decisões 10 e 11

test('item só com valor total: unitário inferido e anotado em observacao (decisão 10)', () => {
  const r = montarItemIngestao({ numero: '12', quantidade: '02', valor_total: 'R$ 3.972,16' }, CTX)
  assert.equal(r.ok, true)
  if (!r.ok) return
  assert.equal(r.linha.valor_unit, 1986.08)
  assert.equal(r.inferido, true)
  assert.match(r.linha.observacao ?? '', /valor unitário inferido de 3972\.16 \/ 2/)
})

test('item sem nenhum dos dois valores é recusado', () => {
  const r = montarItemIngestao({ numero: '3', quantidade: 1 }, CTX)
  assert.equal(r.ok, false)
  if (!r.ok) assert.match(r.motivo, /item 3:.*sem valor unitário e sem valor total/)
})

test('item com quantidade zero é recusado, com ou sem unitário', () => {
  const sem = montarItemIngestao({ numero: '4', quantidade: 0, valor_total: 100 }, CTX)
  const com = montarItemIngestao({ numero: '5', quantidade: 0, valor_unitario: 50 }, CTX)
  assert.equal(sem.ok, false)
  assert.equal(com.ok, false)
  if (!sem.ok) assert.match(sem.motivo, /item 4: quantidade ausente ou zero/)
})

test('unidade: m² vira M2; UN vira QTD sem nota; ML e ausente viram QTD (decisão 11)', () => {
  const m2 = montarItemIngestao({ numero: '1', quantidade: 1, valor_unitario: 10, unidade: 'm²' }, CTX)
  const un = montarItemIngestao({ numero: '1', quantidade: 1, valor_unitario: 10, unidade: 'UN' }, CTX)
  const ml = montarItemIngestao({ numero: '1', quantidade: 1, valor_unitario: 10, unidade: 'ML' }, CTX)
  const nada = montarItemIngestao({ numero: '1', quantidade: 1, valor_unitario: 10 }, CTX)
  assert.ok(m2.ok && un.ok && ml.ok && nada.ok)
  if (!(m2.ok && un.ok && ml.ok && nada.ok)) return
  assert.equal(m2.linha.unidade, 'M2')
  assert.equal(un.linha.unidade, 'QTD')
  assert.equal(un.linha.observacao, null)
  assert.equal(ml.linha.unidade, 'QTD')
  assert.match(ml.linha.observacao ?? '', /\[unidade no documento: ML\]/)
  assert.equal(nada.linha.unidade, 'QTD')
  assert.equal(nada.linha.observacao, null)
})

test('número não inteiro vira null, com o original em observacao', () => {
  const r = montarItemIngestao({ numero: '1.1', quantidade: 1, valor_unitario: 10 }, CTX)
  assert.ok(r.ok)
  if (!r.ok) return
  assert.equal(r.linha.numero, null)
  assert.match(r.linha.observacao ?? '', /\[item no documento: 1\.1\]/)
  const zero = montarItemIngestao({ numero: '09', quantidade: 1, valor_unitario: 10 }, CTX)
  assert.ok(zero.ok && zero.linha.numero === 9)
})

test('a linha nunca leva valor_total nem area_m2 (colunas geradas)', () => {
  const r = montarItemIngestao({ numero: '1', quantidade: 2, valor_unitario: 10, valor_total: 20, largura: 1, altura: 2 }, CTX)
  assert.ok(r.ok)
  if (!r.ok) return
  assert.equal('valor_total' in r.linha, false)
  assert.equal('area_m2' in r.linha, false)
})

test('papel inconsistente (1 × 500 ≠ 1.500): grava o unitário e registra o total impresso', () => {
  const r = montarItemIngestao({ numero: '7', quantidade: 1, valor_unitario: 500, valor_total: 1500 }, CTX)
  assert.ok(r.ok)
  if (!r.ok) return
  assert.equal(r.linha.valor_unit, 500)
  assert.match(r.linha.observacao ?? '', /\[total no documento: 1500\]/)
})

test('observacao do documento é preservada e recebe as notas no fim', () => {
  const r = montarItemIngestao({ numero: '1', quantidade: 2, valor_total: 20, observacao: 'vidro temperado' }, CTX)
  assert.ok(r.ok && r.linha.observacao?.startsWith('vidro temperado ['))
})

// ---- montarIngestao

test('ingestão feliz: proposta em rascunho, autor, histórico de origem e rastro do documento', () => {
  const r = montarIngestao({ ...base, itens: [{ numero: '1', quantidade: 2, valor_unitario: 500, valor_total: 1000 }] }, 'autor-uuid', EM)
  assert.equal(r.ok, true)
  if (!r.ok) return
  assert.equal(r.proposta.status, 'rascunho')
  assert.equal(r.proposta.created_by, 'autor-uuid')
  assert.deepEqual(r.proposta.historico, [
    { de: 'rascunho', para: 'rascunho', em: EM, por: 'autor-uuid', motivo_rejeicao: null, detalhe_rejeicao: null },
  ])
  assert.match(r.proposta.observacao, /\[automação · TELEGRAM · documento doc-1\]/)
  assert.equal(r.itens.length, 1)
  assert.equal(r.itens[0].obra_id, 'obra-1')
  assert.deepEqual(r.avisos, [])
})

test('campos obrigatórios ausentes são recusados, listando quais', () => {
  const r = montarIngestao({ valorTotal: 10 }, 'autor-uuid')
  assert.equal(r.ok, false)
  if (!r.ok) assert.match(r.error, /documentoId, empresaId, obraId, numero/)
})

test('soma de percentuais acima de 100% é recusada', () => {
  const r = montarIngestao({ ...base, pct: { sinal: 60, fd: 50 } }, 'autor-uuid')
  assert.equal(r.ok, false)
  if (!r.ok) assert.match(r.error, /não pode passar de 100%/)
})

test('percentuais válidos viram fração', () => {
  const r = montarIngestao({ ...base, pct: { sinal: 20, fd: 50, entregaMaterial: 20, medicaoInstalacao: 10 } }, 'autor-uuid')
  assert.ok(r.ok)
  if (r.ok) assert.deepEqual([r.proposta.pct_sinal, r.proposta.pct_fd, r.proposta.pct_entrega_material, r.proposta.pct_medicao_instalacao], [0.2, 0.5, 0.2, 0.1])
})

test('desconto maior que o total é recusado', () => {
  const r = montarIngestao({ ...base, desconto: 2000 }, 'autor-uuid')
  assert.equal(r.ok, false)
})

test('um item sem conserto recusa a ingestão inteira — nada de proposta meio gravada', () => {
  const r = montarIngestao({ ...base, itens: [{ numero: '1', quantidade: 1, valor_unitario: 10 }, { numero: '2', quantidade: 0 }] }, 'autor-uuid')
  assert.equal(r.ok, false)
  if (!r.ok) assert.match(r.error, /item 2/)
})

test('número de item repetido no documento: o segundo vira null, com nota', () => {
  const r = montarIngestao({ ...base, itens: [
    { numero: '1', quantidade: 1, valor_unitario: 500 },
    { numero: '1', quantidade: 1, valor_unitario: 500 },
  ] }, 'autor-uuid')
  assert.ok(r.ok)
  if (!r.ok) return
  assert.equal(r.itens[0].numero, 1)
  assert.equal(r.itens[1].numero, null)
  assert.match(r.itens[1].observacao ?? '', /repetido/)
})

test('datas em formato brasileiro viram ISO', () => {
  const r = montarIngestao({ ...base, dataEmissao: '03/08/2026', dataValidade: '2026-09-02' }, 'autor-uuid')
  assert.ok(r.ok && r.proposta.data_emissao === '2026-08-03' && r.proposta.data_validade === '2026-09-02')
})

test('soma dos itens divergente do total gera aviso, não recusa', () => {
  const r = montarIngestao({ ...base, valorTotal: 1000, itens: [{ numero: '1', quantidade: 1, valor_unitario: 700 }] }, 'autor-uuid')
  assert.ok(r.ok)
  if (r.ok) assert.match(r.avisos.join(' '), /soma dos itens \(700\.00\) difere do total do documento \(1000\.00\)/)
})

// ---- gabarito real: EB-25-08-0048 (docs/automacao/fase-5-extracao-itens-status-entrega.md, 3.1)

test('PDF de referência EB-25-08-0048: 16 itens, 7 inferidos, item 13 em metros', () => {
  const sem = (n: string, loc: string, vt: number): ItemExtraido => ({ numero: n, linha: 'MERCADO', acabamento: 'BRANCO', localizacao: loc, quantidade: 1, valor_unitario: null, valor_total: vt })
  const com = (n: string, q: number | string, vu: number | string, vt: number | string, extra: ItemExtraido = {}): ItemExtraido => ({ numero: n, linha: 'SUPREMA', acabamento: 'BRANCO', quantidade: q, valor_unitario: vu, valor_total: vt, ...extra })
  const itens: ItemExtraido[] = [
    sem('1', 'CASTRO E SILVA/INTERNO', 9975), sem('2', 'CASTRO E SILVA', 2175), sem('3', 'CASTRO E SILVA', 31575),
    sem('4', 'RESTAURANTE', 18000), sem('5', 'G. SAMPAIO C/ CASTRO E SILVA', 38750.98), sem('6', 'CASTRO E SILVA', 3500),
    { ...com('7', 1, 500, 1500), linha: 'MERCADO' }, sem('8', 'SETOR AMARELO', 2400),
    { ...com('9', 13, 'R$120,00', 'R$1.560,00'), linha: 'MERCADO', tipo: 'FC09' },
    com('10', '01', 250, 250), com('11', '01', 1700, 1700), com('12', '02', '1.986,08', '3.972,16'),
    com('13', '01', 1881.7, 1881.7, { largura: 950, altura: 2100, acabamento: 'PINTURA BRANCO BRILHANTE' }),
    com('14', '01', 1680.52, 1680.52), com('15', '01', 1661.81, 1661.81), com('16', '01', 1074.02, 1074.02),
  ]
  const r = montarIngestao({ ...base, numero: 'EB-25-08-0048', valorTotal: 'R$ 121.656,19', itens }, 'autor-uuid')
  assert.ok(r.ok)
  if (!r.ok) return
  assert.equal(r.itens.length, 16)
  assert.deepEqual(r.itens.map((i) => i.numero), Array.from({ length: 16 }, (_, i) => i + 1))
  assert.equal(r.itens.filter((i) => /inferido/.test(i.observacao ?? '')).length, 7)
  assert.deepEqual([r.itens[12].largura, r.itens[12].altura], [0.95, 2.1])
  assert.equal(r.itens[11].valor_unit, 1986.08)
  assert.match(r.itens[6].observacao ?? '', /\[total no documento: 1500\]/)
  // item 7 impresso como 1 × 500 = 1.500: a soma fica R$ 1.000 abaixo (0,8%),
  // dentro da tolerância de 1% — sem aviso de divergência.
  assert.equal(r.somaItens, 120656.19)
  assert.ok(r.avisos.some((a) => /7 itens tiveram o valor unitário calculado/.test(a)))
  assert.ok(!r.avisos.some((a) => /difere/.test(a)))
})

// ---- token

test('tokenConfere: só o token exato passa', () => {
  assert.equal(tokenConfere('abc123', 'abc123'), true)
  assert.equal(tokenConfere('abc124', 'abc123'), false)
  assert.equal(tokenConfere('abc', 'abc123'), false)
  assert.equal(tokenConfere(null, 'abc123'), false)
  assert.equal(tokenConfere('abc123', undefined), false)
})
