import test from 'node:test'
import assert from 'node:assert/strict'

import ExcelJS from 'exceljs'

import {
  COLUNAS_IMPORTACAO,
  INSTRUCOES_TEMPLATE,
  validarPlanilha,
} from './itens-form.ts'
import { lerPlanilhaItens, valorDaCelula } from './itens-planilha.ts'

const TITULOS = COLUNAS_IMPORTACAO.map((c) => c.titulo)

/** Monta um .xlsx em memória: linhas cruas, primeira aba. */
async function xlsx(linhas: unknown[][]): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Itens')
  for (const l of linhas) ws.addRow(l)
  const buf = await wb.xlsx.writeBuffer()
  return buf as ArrayBuffer
}

/** Uma linha na ordem de COLUNAS_IMPORTACAO a partir de um objeto parcial. */
function linha(v: Record<string, unknown>): unknown[] {
  return COLUNAS_IMPORTACAO.map((c) => v[c.chave] ?? null)
}

/**
 * Reproduz o layout que `buildWorkbook` (src/lib/excel-export.ts) produz para
 * a rota /api/template/itens: instruções, uma linha em branco, cabeçalho e a
 * linha de exemplo. Se a rota mudar o layout, a camada runtime acusa (ela
 * baixa o template real); aqui se prova que o parser entende este formato.
 */
async function templateComLinhas(extras: Record<string, unknown>[]): Promise<ArrayBuffer> {
  const exemplo = Object.fromEntries(COLUNAS_IMPORTACAO.map((c) => [c.chave, c.exemplo]))
  return xlsx([
    ...INSTRUCOES_TEMPLATE.map((i) => [i]),
    [],
    TITULOS,
    linha(exemplo),
    ...extras.map(linha),
  ])
}

test('valorDaCelula desembrulha fórmula, rich text e hiperlink', () => {
  assert.equal(valorDaCelula({ formula: '2*2', result: 4 }), 4)
  assert.equal(valorDaCelula({ richText: [{ text: 'Jan' }, { text: 'ela' }] }), 'Janela')
  assert.equal(valorDaCelula({ text: 'link', hyperlink: 'http://x' }), 'link')
  assert.equal(valorDaCelula('  apara  '), 'apara')
  assert.equal(valorDaCelula(null), '')
  assert.equal(valorDaCelula(undefined), '')
})

test('lê o template com instruções no topo e acha o cabeçalho', async () => {
  const r = await lerPlanilhaItens(
    await templateComLinhas([{ numero: 2, tipo: 'Porta', quantidade: 1, unidade: 'QTD', valor_unit: 100 }]),
  )
  assert.equal(r.ok, true)
  if (r.ok) {
    assert.equal(r.linhas.length, 2, 'exemplo + a linha preenchida')
    assert.equal(r.linhas[1].tipo, 'Porta')
  }
})

test('a linha de exemplo do template é RECUSADA no preview', async () => {
  // Antes da marca [EXEMPLO] ela era válida e virava item de verdade.
  const r = await lerPlanilhaItens(
    await templateComLinhas([{ numero: 2, tipo: 'Porta', quantidade: 1, unidade: 'QTD', valor_unit: 100 }]),
  )
  assert.equal(r.ok, true)
  if (!r.ok) return
  const v = validarPlanilha(r.linhas, [])
  assert.equal(v[0].ok, false)
  if (!v[0].ok) assert.match(v[0].erros.join(' '), /linha de exemplo/)
  assert.equal(v[1].ok, true, 'a linha preenchida pela pessoa passa')
})

test('coluna movida no Excel não desalinha a leitura', async () => {
  const ordemTrocada = [...TITULOS].reverse()
  const valores: Record<string, unknown> = { numero: 7, tipo: 'Box', quantidade: 3, unidade: 'M2', valor_unit: 50 }
  const porTitulo = Object.fromEntries(COLUNAS_IMPORTACAO.map((c) => [c.titulo, valores[c.chave] ?? null]))
  const r = await lerPlanilhaItens(await xlsx([ordemTrocada, ordemTrocada.map((t) => porTitulo[t])]))
  assert.equal(r.ok, true)
  if (r.ok) {
    assert.equal(r.linhas[0].tipo, 'Box')
    assert.equal(r.linhas[0].quantidade, 3)
    assert.equal(r.linhas[0].unidade, 'M2')
  }
})

test('fórmula na quantidade chega como número, e passa na validação', async () => {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Itens')
  ws.addRow(TITULOS)
  const r2 = ws.addRow(linha({ tipo: 'Janela', unidade: 'QTD', valor_unit: 10 }))
  const colQtd = COLUNAS_IMPORTACAO.findIndex((c) => c.chave === 'quantidade') + 1
  r2.getCell(colQtd).value = { formula: '2*3', result: 6 }
  const r = await lerPlanilhaItens((await wb.xlsx.writeBuffer()) as ArrayBuffer)
  assert.equal(r.ok, true)
  if (!r.ok) return
  assert.equal(r.linhas[0].quantidade, 6)
  const v = validarPlanilha(r.linhas, [])
  assert.equal(v[0].ok, true)
})

test('rich text na descrição vira texto corrido', async () => {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Itens')
  ws.addRow(TITULOS)
  const r2 = ws.addRow(linha({ quantidade: 1, unidade: 'QTD' }))
  const colDesc = COLUNAS_IMPORTACAO.findIndex((c) => c.chave === 'descricao') + 1
  r2.getCell(colDesc).value = { richText: [{ text: 'Vidro ' }, { font: { bold: true }, text: 'temperado' }] }
  const r = await lerPlanilhaItens((await wb.xlsx.writeBuffer()) as ArrayBuffer)
  assert.equal(r.ok && r.linhas[0].descricao, 'Vidro temperado')
})

test('linha totalmente vazia no meio é ignorada, não vira erro', async () => {
  const r = await lerPlanilhaItens(
    await xlsx([
      TITULOS,
      linha({ quantidade: 1, unidade: 'QTD' }),
      [],
      linha({ quantidade: 2, unidade: 'QTD' }),
    ]),
  )
  assert.equal(r.ok && r.linhas.length, 2)
})

test('sem o cabeçalho, a leitura é recusada com o nome da coluna esperada', async () => {
  const r = await lerPlanilhaItens(await xlsx([['qualquer'], ['coisa']]))
  assert.equal(r.ok, false)
  if (!r.ok) assert.match(r.erro, /Nº/)
})

test('coluna faltando é recusada citando qual falta', async () => {
  const semValor = TITULOS.filter((t) => t !== 'Valor unitário')
  const r = await lerPlanilhaItens(await xlsx([semValor, semValor.map(() => 1)]))
  assert.equal(r.ok, false)
  if (!r.ok) assert.match(r.erro, /Valor unitário/)
})

test('planilha só com cabeçalho é recusada', async () => {
  const r = await lerPlanilhaItens(await xlsx([TITULOS]))
  assert.equal(r.ok, false)
  if (!r.ok) assert.match(r.erro, /nenhuma linha preenchida/)
})

test('arquivo que não é xlsx é recusado sem estourar', async () => {
  const r = await lerPlanilhaItens(new TextEncoder().encode('isto não é uma planilha').buffer as ArrayBuffer)
  assert.equal(r.ok, false)
  if (!r.ok) assert.match(r.erro, /não é uma planilha/)
})

test('500 linhas são lidas e validadas, com números em sequência', async () => {
  const muitas = Array.from({ length: 500 }, (_, i) =>
    linha({ numero: i + 1, quantidade: 1, unidade: 'QTD', valor_unit: 10 }),
  )
  const inicio = Date.now()
  const r = await lerPlanilhaItens(await xlsx([TITULOS, ...muitas]))
  assert.equal(r.ok, true)
  if (!r.ok) return
  const v = validarPlanilha(r.linhas, [])
  assert.equal(v.filter((l) => l.ok).length, 500)
  // Não é benchmark: é um teto largo para pegar regressão quadrática.
  assert.ok(Date.now() - inicio < 10000, `levou ${Date.now() - inicio} ms`)
})

test('o preview numera pela linha REAL do arquivo, não a partir de 2', async () => {
  // Template: 5 instruções, 1 em branco, cabeçalho na 7, exemplo na 8.
  const r = await lerPlanilhaItens(
    await templateComLinhas([{ numero: 2, tipo: 'Porta', quantidade: 1, unidade: 'QTD', valor_unit: 100 }]),
  )
  assert.equal(r.ok, true)
  if (!r.ok) return
  const esperadoExemplo = INSTRUCOES_TEMPLATE.length + 3
  assert.deepEqual(r.numerosDasLinhas, [esperadoExemplo, esperadoExemplo + 1])
  const v = validarPlanilha(r.linhas, [], r.numerosDasLinhas)
  assert.deepEqual(v.map((l) => l.linha), [esperadoExemplo, esperadoExemplo + 1])
})
