'use client'

import DataTable from '@/components/DataTable'
import { MOTIVO_ACORDO_LABELS, resumoDasParcelas, valorTotalDoAcordo } from '@/lib/acordos'
import { formatCurrency, formatDate } from '@/lib/format'
import type { AcordoListItem } from '@/lib/types'

import { StatusAcordoBadge } from './status-badge'

type AcordosTableProps = {
  acordos: AcordoListItem[]
  /** YYYY-MM-DD do servidor, para "atrasada" ser a mesma no SSR e no navegador. */
  hoje: string
}

export default function AcordosTable({ acordos, hoje }: AcordosTableProps) {
  return (
    <DataTable<AcordoListItem>
      data={acordos}
      rowKey={(a) => a.id}
      rowHref={(a) => `/financeiro/acordos/${a.id}`}
      columns={[
        { key: 'descricao', header: 'Descrição', render: (a) => <span className="font-medium text-gray-900">{a.descricao}</span> },
        { key: 'obra', header: 'Obra', render: (a) => (a.obra ? `${a.obra.codigo_obra} — ${a.obra.nome}` : '—') },
        { key: 'motivo', header: 'Motivo', render: (a) => (a.motivo ? (MOTIVO_ACORDO_LABELS[a.motivo] ?? a.motivo) : '—') },
        { key: 'periodo_ref', header: 'Período ref.', render: (a) => a.periodo_ref ?? '—' },
        { key: 'data_abertura', header: 'Abertura', className: 'tabular-nums', render: (a) => formatDate(a.data_abertura) },
        { key: 'valor', header: 'Valor total', className: 'tabular-nums', render: (a) => formatCurrency(valorTotalDoAcordo(a.parcelas)) },
        {
          key: 'parcelas',
          header: 'Nº parcelas',
          className: 'tabular-nums',
          render: (a) => {
            const r = resumoDasParcelas(a.parcelas, hoje)
            return r.canceladas > 0 ? `${r.validas} (+${r.canceladas} cancelada${r.canceladas === 1 ? '' : 's'})` : String(r.validas)
          },
        },
        {
          key: 'status',
          header: 'Status',
          render: (a) => {
            // As atrasadas só importam enquanto o acordo está aberto.
            const atrasadas = a.status === 'aberto' ? resumoDasParcelas(a.parcelas, hoje).atrasadas : 0
            return (
              <span className="inline-flex items-center gap-2 flex-wrap">
                <StatusAcordoBadge status={a.status} />
                {atrasadas > 0 && (
                  <span className="text-xs font-medium text-red-700">{`${atrasadas} atrasada${atrasadas === 1 ? '' : 's'}`}</span>
                )}
              </span>
            )
          },
        },
      ]}
    />
  )
}
