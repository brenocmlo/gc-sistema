'use client'

import DataTable from '@/components/DataTable'
import StatusBadge from '@/components/StatusBadge'
import { formatCurrency, formatDate } from '@/lib/format'
import { isPropostaVencida } from '@/lib/propostas'
import type { PropostaListItem } from '@/lib/types'

type PropostasTableProps = {
  propostas: PropostaListItem[]
}

export default function PropostasTable({ propostas }: PropostasTableProps) {
  return (
    <DataTable<PropostaListItem>
      data={propostas}
      rowKey={(p) => p.id}
      rowHref={(p) => `/propostas/${p.id}`}
      columns={[
        {
          key: 'numero',
          header: 'Número',
          render: (p) => (
            <span className="font-medium text-gray-900">{p.numero}</span>
          ),
        },
        {
          key: 'obra',
          header: 'Obra',
          render: (p) =>
            p.obra ? `${p.obra.codigo_obra} — ${p.obra.nome}` : '—',
        },
        {
          key: 'cliente',
          header: 'Cliente',
          render: (p) => p.obra?.cliente?.nome ?? '—',
        },
        {
          key: 'data_emissao',
          header: 'Data emissão',
          className: 'tabular-nums',
          render: (p) => formatDate(p.data_emissao),
        },
        {
          key: 'data_validade',
          header: 'Validade',
          className: 'tabular-nums',
          render: (p) => formatDate(p.data_validade),
        },
        {
          key: 'valor_final',
          header: 'Valor final',
          className: 'tabular-nums',
          render: (p) => formatCurrency(p.valor_final),
        },
        {
          key: 'status',
          header: 'Status',
          render: (p) => (
            <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
              <StatusBadge status={p.status} />
              {/* Vencida não é status do banco — é derivado da validade. */}
              {isPropostaVencida(p) && (
                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border bg-amber-100 text-amber-700 border-amber-200">
                  Vencida
                </span>
              )}
            </span>
          ),
        },
      ]}
    />
  )
}
