// Helpers compartilhados pra montar planilhas XLSX nos handlers de /api/export.
// Cada handler define colunas + rows e chama `buildWorkbookResponse`.

import ExcelJS from 'exceljs'
import { NextResponse } from 'next/server'

/**
 * Destaque de uma célula de dado (status, por exemplo): cor do texto e um
 * fundo claro. As cores são as dos selos da tela (verde, vermelho, âmbar).
 */
export type Destaque = 'positivo' | 'negativo' | 'atencao' | 'neutro'

export type ColumnDef<T> = {
  /** Header exibido no XLSX */
  header: string
  /** Largura sugerida em "characters" (ExcelJS unit) */
  width?: number
  /** Função pra extrair o valor da row */
  value: (row: T) => string | number | Date | null
  /** Formato de célula (ex: '#,##0.00' pra BRL, 'dd/mm/yyyy' pra data) */
  numFmt?: string
  /** Se true, soma essa coluna na linha de totais */
  sum?: boolean
  /** Alinhamento; sem ele, número à direita, data ao centro e texto à esquerda */
  align?: 'left' | 'center' | 'right'
  /** Cor da célula conforme o valor da linha (ex.: status pago em verde) */
  destaque?: (row: T) => Destaque | null
}

export type BuildSheetOptions<T> = {
  sheetName: string
  /** Linhas extras no topo (cabeçalho com nome da entidade, filtros, data) */
  metaRows?: Array<Array<string | number | null>>
  columns: ColumnDef<T>[]
  rows: T[]
  /** Mostra uma linha "Total" no final somando colunas marcadas com sum:true */
  includeTotals?: boolean
}

// Paleta: os cinzas e as cores dos selos da tela (Tailwind gray/green/red/amber).
const COR = {
  titulo: 'FF111827',
  meta: 'FF6B7280',
  cabecalhoFundo: 'FF1F2937',
  cabecalhoTexto: 'FFFFFFFF',
  zebra: 'FFF9FAFB',
  borda: 'FFE5E7EB',
  totalFundo: 'FFF3F4F6',
  totalBorda: 'FF9CA3AF',
} as const

const DESTAQUE: Record<Destaque, { texto: string; fundo: string }> = {
  positivo: { texto: 'FF15803D', fundo: 'FFF0FDF4' },
  negativo: { texto: 'FFB91C1C', fundo: 'FFFEF2F2' },
  atencao: { texto: 'FFB45309', fundo: 'FFFFFBEB' },
  neutro: { texto: 'FF4B5563', fundo: 'FFF3F4F6' },
}

const BORDA_FINA: Partial<ExcelJS.Borders> = {
  top: { style: 'thin', color: { argb: COR.borda } },
  bottom: { style: 'thin', color: { argb: COR.borda } },
  left: { style: 'thin', color: { argb: COR.borda } },
  right: { style: 'thin', color: { argb: COR.borda } },
}

function alinhamentoPadrao<T>(col: ColumnDef<T>): 'left' | 'center' | 'right' {
  if (col.align) return col.align
  if (col.numFmt === DATE_FORMAT) return 'center'
  if (col.numFmt || col.sum) return 'right'
  return 'left'
}

export async function buildWorkbook<T>(
  options: BuildSheetOptions<T>,
): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'GC-Sistema'
  wb.created = new Date()

  const ws = wb.addWorksheet(options.sheetName, {
    // Impressão: paisagem, cabendo na largura da folha.
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 },
  })
  const nCols = options.columns.length
  const ultimaLetra = ws.getColumn(nCols).letter

  let nextRow = 1

  // Meta rows (cabeçalho informativo antes da tabela). O título ocupa a
  // largura da tabela; as demais linhas são a legenda, em cinza.
  if (options.metaRows) {
    options.metaRows.forEach((meta, metaIdx) => {
      const n = nextRow++
      const row = ws.getRow(n)
      meta.forEach((cell, i) => {
        row.getCell(i + 1).value = cell
      })
      if (meta.length === 1 && nCols > 1) ws.mergeCells(`A${n}:${ultimaLetra}${n}`)
      if (metaIdx === 0) {
        row.font = { bold: true, size: 16, color: { argb: COR.titulo } }
        row.height = 26
      } else {
        row.font = { size: 10, color: { argb: COR.meta } }
      }
      row.alignment = { vertical: 'middle' }
    })
    nextRow++ // linha em branco
  }

  // Header da tabela
  const headerRowNumber = nextRow++
  const headerRow = ws.getRow(headerRowNumber)
  options.columns.forEach((col, i) => {
    const cell = headerRow.getCell(i + 1)
    cell.value = col.header
    cell.font = { bold: true, color: { argb: COR.cabecalhoTexto } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COR.cabecalhoFundo } }
    cell.alignment = { vertical: 'middle', horizontal: alinhamentoPadrao(col), wrapText: true }
    cell.border = BORDA_FINA
    if (col.width) {
      ws.getColumn(i + 1).width = col.width
    }
  })
  headerRow.height = 24

  // Data rows, em zebra
  const dataStartRow = nextRow
  options.rows.forEach((row, idx) => {
    const r = ws.getRow(nextRow++)
    options.columns.forEach((col, i) => {
      const v = col.value(row)
      const cell = r.getCell(i + 1)
      cell.value = v ?? ''
      if (col.numFmt) cell.numFmt = col.numFmt
      cell.alignment = { vertical: 'middle', horizontal: alinhamentoPadrao(col) }
      cell.border = BORDA_FINA
      const destaque = col.destaque?.(row)
      if (destaque) {
        cell.font = { bold: true, color: { argb: DESTAQUE[destaque].texto } }
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: DESTAQUE[destaque].fundo } }
      } else if (idx % 2 === 1) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COR.zebra } }
      }
    })
    r.height = 18
  })
  const dataEndRow = nextRow - 1

  // Totals
  if (options.includeTotals && options.rows.length > 0) {
    const totalRow = ws.getRow(nextRow++)
    options.columns.forEach((col, i) => {
      const cell = totalRow.getCell(i + 1)
      if (i === 0) cell.value = 'TOTAL'
      if (col.sum) {
        const colLetter = ws.getColumn(i + 1).letter
        cell.value = {
          formula: `SUM(${colLetter}${dataStartRow}:${colLetter}${dataEndRow})`,
        }
        if (col.numFmt) cell.numFmt = col.numFmt
      }
      cell.font = { bold: true }
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COR.totalFundo } }
      cell.alignment = { vertical: 'middle', horizontal: i === 0 ? 'left' : alinhamentoPadrao(col) }
      cell.border = {
        top: { style: 'medium', color: { argb: COR.totalBorda } },
        bottom: { style: 'thin', color: { argb: COR.borda } },
      }
    })
    totalRow.height = 20
  }

  // O cabeçalho fica parado ao rolar, e ganha o filtro do Excel.
  // Sem as linhas de grade do Excel: a tabela tem bordas próprias.
  ws.views = [{ state: 'frozen', ySplit: headerRowNumber, activeCell: `A${headerRowNumber + 1}`, showGridLines: false }]
  if (options.rows.length > 0) {
    ws.autoFilter = { from: { row: headerRowNumber, column: 1 }, to: { row: dataEndRow, column: nCols } }
  }
  ws.pageSetup.printTitlesRow = `${headerRowNumber}:${headerRowNumber}`

  return wb
}

export async function buildWorkbookResponse<T>(
  filename: string,
  options: BuildSheetOptions<T>,
): Promise<Response> {
  const wb = await buildWorkbook(options)
  const buffer = await wb.xlsx.writeBuffer()

  return new NextResponse(buffer as ArrayBuffer, {
    headers: {
      'Content-Type':
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
}

export const BRL_FORMAT = '"R$" #,##0.00'
export const DATE_FORMAT = 'dd/mm/yyyy'

export function todayStr(): string {
  return new Date().toISOString().slice(0, 10)
}
