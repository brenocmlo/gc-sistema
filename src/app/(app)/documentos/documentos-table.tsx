'use client'

import DataTable from '@/components/DataTable'
import { resumoDoDocumento, rotuloOrigem, rotuloTipo, type DocumentoListItem } from '@/lib/documentos'
import { formatCurrency, formatDateTime } from '@/lib/format'

import StatusDocumento from './status-documento'

export default function DocumentosTable({ documentos }: { documentos: DocumentoListItem[] }) {
  return (
    <DataTable<DocumentoListItem>
      data={documentos}
      rowKey={(d) => d.id}
      rowHref={(d) => `/documentos/${d.id}`}
      columns={[
        { key: 'created_at', header: 'Recebido', className: 'tabular-nums whitespace-nowrap', render: (d) => formatDateTime(d.created_at) },
        { key: 'tipo', header: 'Tipo', render: (d) => rotuloTipo(d.tipo_documento) },
        {
          key: 'numero',
          header: 'Número lido',
          render: (d) => <span className="font-medium text-gray-900">{resumoDoDocumento(d.dados_extraidos).numero ?? '—'}</span>,
        },
        { key: 'obra', header: 'Obra', render: (d) => (d.obra ? `${d.obra.codigo_obra} — ${d.obra.nome}` : '—') },
        {
          key: 'valor',
          header: 'Valor lido',
          className: 'tabular-nums',
          render: (d) => {
            const v = resumoDoDocumento(d.dados_extraidos).valor
            return v === null ? '—' : formatCurrency(v)
          },
        },
        { key: 'origem', header: 'Origem', render: (d) => rotuloOrigem(d.canal) },
        { key: 'status', header: 'Status', render: (d) => <StatusDocumento status={d.status} /> },
      ]}
    />
  )
}
