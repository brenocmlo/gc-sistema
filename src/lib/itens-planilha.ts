import ExcelJS from 'exceljs'

import {
  COLUNAS_IMPORTACAO,
  type ChaveImportacao,
  type LinhaImportacao,
} from './itens-form.ts'

/**
 * Leitura da planilha de importação de itens (bloco 5.4), fora do React.
 *
 * Até o fechamento da sprint 5 este código vivia dentro de
 * `itens-importar.tsx`, e por isso **não tinha cobertura automatizada**: era a
 * maior lacuna registrada no documento do 5.4. Aqui é função pura sobre um
 * `ArrayBuffer`, então roda no navegador (o componente chama) e no
 * `node --test` (os testes geram `.xlsx` de verdade com exceljs).
 */

export type ResultadoLeitura =
  | {
      ok: true
      linhas: LinhaImportacao[]
      /**
       * Número REAL de cada linha na planilha, na mesma ordem de `linhas`. O
       * preview mostra este número para a pessoa achar a linha no Excel. A
       * primeira versão numerava a partir de 2, assumindo o cabeçalho na
       * linha 1 — no template ele está na 7, então "Linha 2" do preview era a
       * linha 8 do arquivo.
       */
      numerosDasLinhas: number[]
    }
  | { ok: false; erro: string }

/**
 * Desembrulha o valor de uma célula. O ExcelJS devolve objeto, não o valor,
 * para fórmula (`{ formula, result }`), rich text (`{ richText: [...] }`) e
 * hiperlink (`{ text, hyperlink }`). Sem isto, uma coluna Quantidade com
 * `=2*2` chegaria à validação como `[object Object]`.
 */
export function valorDaCelula(bruto: unknown): unknown {
  let v = bruto
  if (v && typeof v === 'object' && !(v instanceof Date)) {
    const o = v as Record<string, unknown>
    if ('result' in o) v = o.result
    else if (Array.isArray(o.richText)) {
      v = (o.richText as { text?: string }[]).map((t) => t.text ?? '').join('')
    } else if ('text' in o) v = o.text
    else if ('error' in o) v = ''
  }
  if (typeof v === 'string') v = v.trim()
  return v ?? ''
}

export async function lerPlanilhaItens(buffer: ArrayBuffer): Promise<ResultadoLeitura> {
  const wb = new ExcelJS.Workbook()
  try {
    await wb.xlsx.load(buffer)
  } catch {
    return { ok: false, erro: 'O arquivo não é uma planilha .xlsx válida' }
  }

  const ws = wb.worksheets[0]
  if (!ws) return { ok: false, erro: 'A planilha não tem nenhuma aba' }

  // Acha o cabeçalho procurando o título "Nº" em QUALQUER célula da linha, em
  // vez de assumir posição fixa: o template abre com linhas de instrução, quem
  // edita no Excel costuma acrescentar mais, e pode mover colunas. A primeira
  // versão só olhava a coluna A — mover a coluna Nº no Excel fazia a
  // importação inteira ser recusada. O teste unitário pegou isso.
  const ancora = COLUNAS_IMPORTACAO[0].titulo
  let linhaCabecalho = -1
  ws.eachRow((row, n) => {
    if (linhaCabecalho !== -1) return
    row.eachCell((cell) => {
      if (String(valorDaCelula(cell.value)) === ancora) linhaCabecalho = n
    })
  })
  if (linhaCabecalho === -1) {
    return {
      ok: false,
      erro: `Não achei o cabeçalho (procurei a coluna "${ancora}"). Use o template.`,
    }
  }

  // Título → número da coluna, pela ordem REAL do arquivo: coluna movida no
  // Excel não desalinha a importação em silêncio.
  const porTitulo = new Map<string, number>()
  ws.getRow(linhaCabecalho).eachCell((cell, col) => {
    porTitulo.set(String(valorDaCelula(cell.value)), col)
  })
  const faltando = COLUNAS_IMPORTACAO.filter((c) => !porTitulo.has(c.titulo)).map(
    (c) => c.titulo,
  )
  if (faltando.length > 0) {
    return { ok: false, erro: `Colunas ausentes na planilha: ${faltando.join(', ')}` }
  }

  const linhas: LinhaImportacao[] = []
  const numerosDasLinhas: number[] = []
  for (let n = linhaCabecalho + 1; n <= ws.rowCount; n++) {
    const row = ws.getRow(n)
    const linha: Partial<Record<ChaveImportacao, unknown>> = {}
    let temAlgo = false
    for (const col of COLUNAS_IMPORTACAO) {
      const v = valorDaCelula(row.getCell(porTitulo.get(col.titulo) as number).value)
      if (v !== '') temAlgo = true
      linha[col.chave] = v
    }
    // Linha totalmente vazia é separador, não erro.
    if (temAlgo) {
      linhas.push(linha)
      numerosDasLinhas.push(n)
    }
  }

  if (linhas.length === 0) {
    return { ok: false, erro: 'A planilha não tem nenhuma linha preenchida' }
  }
  return { ok: true, linhas, numerosDasLinhas }
}
