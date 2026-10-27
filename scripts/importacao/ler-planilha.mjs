/**
 * Leitura da planilha legada, guiada por mapa-planilha.json: acha cada aba
 * pelo nome, acha a linha de cabeçalho (a que casa mais colunas do mapa, nas
 * 15 primeiras) e devolve as linhas como objetos { campo: valor }, com a
 * referência "Aba!linha" de cada uma para o log.
 */
import ExcelJS from 'exceljs'

import { chaveDeComparacao } from '../../src/lib/importacao.ts'
import { valorDaCelula } from '../../src/lib/itens-planilha.ts'

/** Campo do mapa: lista de cabeçalhos, ou { colunas, obrigatorio }. */
function specDoCampo(spec) {
  return Array.isArray(spec) ? { colunas: spec, obrigatorio: false } : { colunas: spec.colunas, obrigatorio: Boolean(spec.obrigatorio) }
}

/** O link de uma célula com hiperlink (o Drive), ou null. */
function linkDaCelula(bruto) {
  if (bruto && typeof bruto === 'object' && typeof bruto.hyperlink === 'string') return bruto.hyperlink
  const v = valorDaCelula(bruto)
  return typeof v === 'string' && /^https?:\/\//.test(v) ? v : null
}

function lerAba(ws, nomeEntidade, config) {
  const campos = Object.entries(config.campos).map(([campo, spec]) => [campo, specDoCampo(spec)])
  // Linha de cabeçalho: a que casa mais campos nas 15 primeiras.
  let melhor = { linha: 0, colunas: {} }
  for (let r = 1; r <= Math.min(15, ws.rowCount); r++) {
    const textos = {}
    ws.getRow(r).eachCell({ includeEmpty: false }, (cell, col) => {
      textos[col] = chaveDeComparacao(valorDaCelula(cell.value))
    })
    const colunas = {}
    for (const [campo, { colunas: nomes }] of campos) {
      const alvo = nomes.map(chaveDeComparacao)
      const col = Object.entries(textos).find(([, t]) => alvo.includes(t))
      if (col) colunas[campo] = Number(col[0])
    }
    if (Object.keys(colunas).length > Object.keys(melhor.colunas).length) melhor = { linha: r, colunas }
  }

  const faltando = campos.filter(([campo, s]) => s.obrigatorio && !melhor.colunas[campo]).map(([c]) => c)
  if (!melhor.linha || faltando.length > 0) {
    return { linhas: [], problema: `aba "${ws.name}" (${nomeEntidade}): não achei a coluna de ${faltando.join(', ') || 'nenhum campo'}; ajuste mapa-planilha.json` }
  }

  const linhas = []
  for (let r = melhor.linha + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r)
    const reg = { __ref: `${ws.name}!${r}` }
    let algum = false
    for (const [campo, col] of Object.entries(melhor.colunas)) {
      const bruto = row.getCell(col).value
      const v = valorDaCelula(bruto)
      reg[campo] = v === '' ? null : v
      if (campo === 'link') reg[campo] = linkDaCelula(bruto)
      if (reg[campo] != null) algum = true
    }
    if (algum) linhas.push(reg)
  }
  return { linhas, problema: null, cabecalho: melhor.linha, colunas: Object.keys(melhor.colunas) }
}

/** { entidade: { linhas, problema, aba, cabecalho, colunas } } para cada aba do mapa. */
export async function lerPlanilha(caminho, mapa) {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(caminho)
  const resultado = {}
  for (const [entidade, config] of Object.entries(mapa.abas)) {
    const nomes = config.nomes.map(chaveDeComparacao)
    const ws = wb.worksheets.find((w) => nomes.includes(chaveDeComparacao(w.name)))
    if (!ws) {
      resultado[entidade] = { linhas: [], problema: `nenhuma aba chamada ${config.nomes.map((n) => `"${n}"`).join(' ou ')}`, aba: null }
      continue
    }
    resultado[entidade] = { ...lerAba(ws, entidade, config), aba: ws.name }
  }
  return { resultado, abasDaPlanilha: wb.worksheets.map((w) => w.name) }
}
