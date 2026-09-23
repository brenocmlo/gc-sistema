'use client'

import DataTable from '@/components/DataTable'
import StatusBadge from '@/components/StatusBadge'
import { formatCurrency, formatDate } from '@/lib/format'
import type { ContratoListItem } from '@/lib/types'

type ContratosTableProps = {
  contratos: ContratoListItem[]
}

export default function ContratosTable({ contratos }: ContratosTableProps) {
  return (
    <DataTable<ContratoListItem>
      data={contratos}
      rowKey={(c) => c.id}
      rowHref={(c) => `/contratos/${c.id}`}
      columns={[
        {
          key: 'numero',
          header: 'Número',
          render: (c) => (
            <span className="font-medium text-gray-900">{c.numero}</span>
          ),
        },
        {
          key: 'obra',
          header: 'Obra',
          render: (c) =>
            c.obra ? `${c.obra.codigo_obra} — ${c.obra.nome}` : '—',
        },
        {
          key: 'cliente',
          header: 'Cliente',
          render: (c) => c.obra?.cliente?.nome ?? '—',
        },
        {
          key: 'data_assinatura',
          header: 'Data assinatura',
          className: 'tabular-nums',
          render: (c) => formatDate(c.data_assinatura),
        },
        {
          // O enunciado pede "Valor total". Com desconto (desde
          // 20260923160000) o que o cliente deve é o valor final; a coluna
          // mostra o total e, quando há desconto, o final embaixo.
          key: 'valor_total',
          header: 'Valor total',
          className: 'tabular-nums',
          render: (c) => (
            <span className="flex flex-col">
              <span>{formatCurrency(c.valor_total)}</span>
              {c.desconto > 0 && (
                <span className="text-xs text-gray-500">
                  final {formatCurrency(c.valor_final)}
                </span>
              )}
            </span>
          ),
        },
        {
          key: 'status',
          header: 'Status',
          render: (c) => <StatusBadge status={c.status} />,
        },
      ]}
    />
  )
}
