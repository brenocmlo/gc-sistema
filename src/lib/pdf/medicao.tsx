import { Document, Image, Page, StyleSheet, Text, View } from '@react-pdf/renderer'

import type { Periodo, RelatorioDeMedicao } from '@/lib/medicao'

// Relatório de medição por obra (bloco 8.4). Mesma estrutura do relatório de
// conciliação de FD (./conciliacao-fd.tsx): cabeçalho da empresa, bloco de
// dados, tabela com o cabeçalho repetido a cada página (`fixed`) e aceite.

export type MedicaoPdfProps = {
  empresa: {
    nome: string
    razao_social: string
    cnpj: string | null
    email: string | null
    telefone: string | null
    endereco: string | null
    cidade: string | null
    cep: string | null
    logo_url: string | null
  }
  obra: { codigo_obra: string; nome: string; cliente_nome: string }
  periodo: Periodo
  relatorio: RelatorioDeMedicao
  emitidoPor: string
}

const styles = StyleSheet.create({
  page: { fontFamily: 'Helvetica', fontSize: 8, padding: 28, paddingBottom: 36, color: '#1f2937' },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    paddingBottom: 8,
    borderBottom: '1pt solid #e5e7eb',
  },
  headerLogo: { width: 60, height: 60, marginRight: 12, objectFit: 'contain' },
  headerInfo: { flex: 1 },
  empresaName: { fontSize: 12, fontWeight: 'bold', color: '#111827' },
  empresaMeta: { fontSize: 8, color: '#6b7280', marginTop: 2 },
  title: { fontSize: 14, fontWeight: 'bold', marginTop: 4, marginBottom: 2, color: '#111827' },
  subtitle: { fontSize: 10, color: '#374151' },

  metaBlock: { marginTop: 8, marginBottom: 10, padding: 8, backgroundColor: '#f9fafb', borderRadius: 3 },
  metaRow: { flexDirection: 'row', marginBottom: 2 },
  metaLabel: { fontWeight: 'bold', color: '#374151', width: 110 },
  metaValue: { color: '#1f2937', flex: 1 },

  table: { borderTop: '1pt solid #d1d5db', borderLeft: '1pt solid #d1d5db' },
  tableHeader: { flexDirection: 'row', backgroundColor: '#f3f4f6', fontWeight: 'bold' },
  tableRow: { flexDirection: 'row' },
  tableRowAlt: { flexDirection: 'row', backgroundColor: '#fafafa' },
  cell: { padding: 3, borderRight: '1pt solid #d1d5db', borderBottom: '1pt solid #d1d5db' },
  cellRight: { textAlign: 'right' },

  // Larguras das colunas (somam 100%)
  colItem: { width: '5%' },
  colDescricao: { width: '25%' },
  colContratada: { width: '10%' },
  colPeriodo: { width: '10%' },
  colAcumulado: { width: '10%' },
  colUnit: { width: '12%' },
  colValorPeriodo: { width: '14%' },
  colValorAcumulado: { width: '14%' },

  totalRow: { flexDirection: 'row', fontWeight: 'bold', backgroundColor: '#f3f4f6' },

  aceite: { marginTop: 24, paddingTop: 12, borderTop: '1pt solid #e5e7eb' },
  aceiteTexto: { fontSize: 9, lineHeight: 1.4 },
  assinaturas: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 44 },
  signatureLine: { width: 230, borderTop: '1pt solid #6b7280', paddingTop: 4, fontSize: 8, color: '#6b7280' },
  emitidoPor: { fontSize: 7, color: '#9ca3af', marginTop: 16 },
  pageNumber: { position: 'absolute', bottom: 14, right: 28, fontSize: 7, color: '#9ca3af' },
})

function fmtBRL(v: number | null | undefined): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v ?? 0)
}

function fmtQtd(v: number): string {
  return v.toLocaleString('pt-BR', { maximumFractionDigits: 3 })
}

function fmtDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-')
  return `${d}/${m}/${y}`
}

export function MedicaoPdf({ empresa, obra, periodo, relatorio, emitidoPor }: MedicaoPdfProps) {
  const { linhas, totais } = relatorio
  const empresaMetaParts = [
    empresa.cnpj ? `CNPJ ${empresa.cnpj}` : null,
    empresa.telefone,
    empresa.email,
    empresa.endereco
      ? `${empresa.endereco}${empresa.cidade ? ` — ${empresa.cidade}` : ''}${empresa.cep ? ` — ${empresa.cep}` : ''}`
      : empresa.cidade,
  ].filter(Boolean)
  const periodoTexto = `${fmtDate(periodo.de)} a ${fmtDate(periodo.ate)}`

  return (
    <Document title={`Medição ${obra.codigo_obra} — ${periodoTexto}`}>
      <Page size="A4" style={styles.page}>
        <View style={styles.headerRow}>
          {empresa.logo_url && (
            // eslint-disable-next-line jsx-a11y/alt-text
            <Image src={empresa.logo_url} style={styles.headerLogo} />
          )}
          <View style={styles.headerInfo}>
            <Text style={styles.empresaName}>{empresa.razao_social}</Text>
            {empresaMetaParts.length > 0 && <Text style={styles.empresaMeta}>{empresaMetaParts.join(' · ')}</Text>}
          </View>
        </View>

        <Text style={styles.title}>Relatório de Medição</Text>
        <Text style={styles.subtitle}>
          Obra {obra.codigo_obra} — {obra.nome}
        </Text>

        <View style={styles.metaBlock}>
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>Cliente:</Text>
            <Text style={styles.metaValue}>{obra.cliente_nome}</Text>
          </View>
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>Período da medição:</Text>
            <Text style={styles.metaValue}>{periodoTexto}</Text>
          </View>
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>Itens:</Text>
            <Text style={styles.metaValue}>{linhas.length}</Text>
          </View>
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>Emitido em:</Text>
            <Text style={styles.metaValue}>{new Date().toLocaleDateString('pt-BR')}</Text>
          </View>
        </View>

        <View style={styles.table}>
          <View style={styles.tableHeader} fixed>
            <Text style={[styles.cell, styles.colItem]}>Item</Text>
            <Text style={[styles.cell, styles.colDescricao]}>Descrição</Text>
            <Text style={[styles.cell, styles.colContratada, styles.cellRight]}>Qtd. contratada</Text>
            <Text style={[styles.cell, styles.colPeriodo, styles.cellRight]}>Medido no período</Text>
            <Text style={[styles.cell, styles.colAcumulado, styles.cellRight]}>Medido acumulado</Text>
            <Text style={[styles.cell, styles.colUnit, styles.cellRight]}>Valor unitário</Text>
            <Text style={[styles.cell, styles.colValorPeriodo, styles.cellRight]}>Valor no período</Text>
            <Text style={[styles.cell, styles.colValorAcumulado, styles.cellRight]}>Valor acumulado</Text>
          </View>

          {linhas.map((l, idx) => (
            <View key={l.itemId} style={idx % 2 === 0 ? styles.tableRow : styles.tableRowAlt} wrap={false}>
              <Text style={[styles.cell, styles.colItem]}>{l.numero ?? '—'}</Text>
              <Text style={[styles.cell, styles.colDescricao]}>{l.descricao}</Text>
              <Text style={[styles.cell, styles.colContratada, styles.cellRight]}>
                {fmtQtd(l.contratada)} {l.unidade}
              </Text>
              <Text style={[styles.cell, styles.colPeriodo, styles.cellRight]}>{fmtQtd(l.medidoPeriodo)}</Text>
              <Text style={[styles.cell, styles.colAcumulado, styles.cellRight]}>{fmtQtd(l.acumulado)}</Text>
              <Text style={[styles.cell, styles.colUnit, styles.cellRight]}>
                {l.valorUnit === null ? 'variável' : fmtBRL(l.valorUnit)}
              </Text>
              <Text style={[styles.cell, styles.colValorPeriodo, styles.cellRight]}>{fmtBRL(l.valorPeriodo)}</Text>
              <Text style={[styles.cell, styles.colValorAcumulado, styles.cellRight]}>{fmtBRL(l.valorAcumulado)}</Text>
            </View>
          ))}

          <View style={styles.totalRow} wrap={false}>
            <Text style={[styles.cell, { width: '72%' }]}>TOTAL</Text>
            <Text style={[styles.cell, styles.colValorPeriodo, styles.cellRight]}>{fmtBRL(totais.valorPeriodo)}</Text>
            <Text style={[styles.cell, styles.colValorAcumulado, styles.cellRight]}>{fmtBRL(totais.valorAcumulado)}</Text>
          </View>
        </View>

        <View style={styles.aceite} wrap={false}>
          <Text style={styles.aceiteTexto}>
            Aceite da medição: declaramos que os serviços acima, medidos no período de {periodoTexto}, no valor de{' '}
            {fmtBRL(totais.valorPeriodo)}, foram conferidos e aprovados.
          </Text>
          <View style={styles.assinaturas}>
            <Text style={styles.signatureLine}>Assinatura e data — {obra.cliente_nome}</Text>
            <Text style={styles.signatureLine}>Assinatura e data — {empresa.razao_social}</Text>
          </View>
          <Text style={styles.emitidoPor}>
            Documento gerado por {emitidoPor} em {new Date().toLocaleString('pt-BR')} via GC-Sistema.
          </Text>
        </View>

        <Text
          style={styles.pageNumber}
          render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`}
          fixed
        />
      </Page>
    </Document>
  )
}
