'use client'

import DataTable from '@/components/DataTable'
import { formatCurrency, formatDate } from '@/lib/format'
import { numeroComSerie, recebidoDaNf, situacaoDaNf, TIPO_NF_LABELS } from '@/lib/notas-fiscais'
import type { NotaFiscalListItem } from '@/lib/types'

import SituacaoBadge from './situacao-badge'

type NotasTableProps = {
  notas: NotaFiscalListItem[]
  /** YYYY-MM-DD do servidor, para "vencida" ser a mesma no SSR e no navegador. */
  hoje: string
}

export default function NotasTable({ notas, hoje }: NotasTableProps) {
  return (
    <DataTable<NotaFiscalListItem>
      data={notas}
      rowKey={(n) => n.id}
      rowHref={(n) => `/financeiro/notas-fiscais/${n.id}`}
      columns={[
        {
          key: 'numero',
          header: 'Número/Série',
          render: (n) => <span className="font-medium text-gray-900">{numeroComSerie(n.numero, n.serie)}</span>,
        },
        { key: 'obra', header: 'Obra', render: (n) => (n.obra ? `${n.obra.codigo_obra} — ${n.obra.nome}` : '—') },
        { key: 'tipo', header: 'Tipo', render: (n) => TIPO_NF_LABELS[n.tipo] ?? n.tipo },
        { key: 'data_emissao', header: 'Emissão', className: 'tabular-nums', render: (n) => formatDate(n.data_emissao) },
        { key: 'data_vencimento', header: 'Vencimento', className: 'tabular-nums', render: (n) => formatDate(n.data_vencimento) },
        { key: 'valor_total', header: 'Valor', className: 'tabular-nums', render: (n) => formatCurrency(n.valor_total) },
        { key: 'recebido', header: 'Recebido', className: 'tabular-nums', render: (n) => formatCurrency(recebidoDaNf(n.pagamentos)) },
        { key: 'status', header: 'Status', render: (n) => <SituacaoBadge situacao={situacaoDaNf(n, hoje)} /> },
      ]}
    />
  )
}
