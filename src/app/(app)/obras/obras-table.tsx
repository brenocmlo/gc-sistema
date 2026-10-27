'use client'

import DataTable from '@/components/DataTable'
import ProgressBar from '@/components/ProgressBar'
import StatusBadge from '@/components/StatusBadge'
import { formatCurrency } from '@/lib/format'
import type { ObraListItem } from '@/lib/types'

/**
 * Progresso = % de itens medidos sobre total contratado.
 * Vem pré-calculado pela view `obras_com_valores` (coluna
 * `progresso_itens_pct`). "Contratado" = itens de contrato não rescindido
 * e de proposta aprovada ainda sem contrato (a regra de
 * `src/lib/progresso-obra.ts`). NULL quando não há contratado.
 */
function computeProgress(obra: ObraListItem): number | null {
  if (obra.status === 'concluida') return 100
  if (obra.progresso_itens_pct == null) return null
  return Math.round(Number(obra.progresso_itens_pct))
}

type ObrasTableProps = {
  obras: ObraListItem[]
}

export default function ObrasTable({ obras }: ObrasTableProps) {
  return (
    <DataTable<ObraListItem>
      data={obras}
      rowKey={(o) => o.id}
      rowHref={(o) => `/obras/${o.id}`}
      columns={[
        {
          key: 'codigo',
          header: 'Código',
          render: (o) => (
            <span className="font-medium text-gray-900">{o.codigo_obra}</span>
          ),
        },
        { key: 'nome', header: 'Nome', render: (o) => o.nome },
        {
          key: 'cliente',
          header: 'Cliente',
          render: (o) => o.cliente?.nome ?? '—',
        },
        { key: 'cidade', header: 'Cidade', render: (o) => o.cidade ?? '—' },
        {
          key: 'status',
          header: 'Status',
          render: (o) => <StatusBadge status={o.status} />,
        },
        {
          key: 'valor',
          header: 'Valor',
          className: 'tabular-nums',
          render: (o) => formatCurrency(o.valor_final_calculado),
        },
        {
          key: 'progresso',
          header: 'Progresso',
          render: (o) => <ProgressBar value={computeProgress(o)} />,
        },
      ]}
    />
  )
}
