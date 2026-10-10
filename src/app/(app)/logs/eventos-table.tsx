'use client'

import Link from 'next/link'

import DataTable from '@/components/DataTable'
import EventoDetalhe from '@/components/EventoDetalhe'
import {
  ORIGEM_LABELS,
  RESULTADO_LABELS,
  hrefDoRegistro,
  labelAcao,
  labelAutor,
  labelEntidade,
  type EventoAuditoria,
  type OrigemEvento,
  type ResultadoEvento,
} from '@/lib/auditoria'
import { formatDateTime } from '@/lib/format'

const BADGE = 'inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border whitespace-nowrap'

const ORIGEM_CLASS: Record<OrigemEvento, string> = {
  sistema: 'bg-gray-100 text-gray-700 border-gray-200',
  automacao: 'bg-violet-100 text-violet-700 border-violet-200',
  banco: 'bg-amber-100 text-amber-700 border-amber-200',
}

const RESULTADO_CLASS: Record<ResultadoEvento, string> = {
  sucesso: 'bg-green-100 text-green-700 border-green-200',
  erro: 'bg-red-100 text-red-700 border-red-200',
}

type EventosTableProps = {
  eventos: EventoAuditoria[]
  /** id do profile → nome. Record, não Map: atravessa a fronteira do RSC. */
  autores: Record<string, string>
}

export default function EventosTable({ eventos, autores }: EventosTableProps) {
  const mapaAutores = new Map(Object.entries(autores))

  return (
    <DataTable<EventoAuditoria>
      data={eventos}
      rowKey={(e) => String(e.id)}
      columns={[
        {
          key: 'em',
          header: 'Quando',
          className: 'tabular-nums whitespace-nowrap align-top',
          render: (e) => formatDateTime(e.em),
        },
        {
          key: 'origem',
          header: 'Origem',
          className: 'align-top',
          render: (e) => (
            <span className={`${BADGE} ${ORIGEM_CLASS[e.origem] ?? ''}`}>
              {ORIGEM_LABELS[e.origem] ?? e.origem}
            </span>
          ),
        },
        {
          key: 'resultado',
          header: 'Resultado',
          className: 'align-top',
          render: (e) => (
            <span className={`${BADGE} ${RESULTADO_CLASS[e.resultado] ?? ''}`}>
              {RESULTADO_LABELS[e.resultado] ?? e.resultado}
            </span>
          ),
        },
        {
          key: 'entidade',
          header: 'Entidade',
          className: 'align-top',
          render: (e) => {
            const href = hrefDoRegistro(e)
            return (
              <div className="flex flex-col">
                <span>{labelEntidade(e.entidade)}</span>
                {e.referencia &&
                  (href ? (
                    <Link href={href} className="text-xs text-gray-600 underline underline-offset-2 hover:text-gray-900">
                      {e.referencia}
                    </Link>
                  ) : (
                    <span className="text-xs text-gray-600">{e.referencia}</span>
                  ))}
              </div>
            )
          },
        },
        {
          key: 'acao',
          header: 'Ação',
          className: 'align-top whitespace-nowrap',
          render: (e) => labelAcao(e.acao),
        },
        {
          key: 'autor',
          header: 'Autor',
          className: 'align-top',
          render: (e) => labelAutor(e, mapaAutores),
        },
        {
          key: 'resumo',
          header: 'Resumo',
          className: 'align-top min-w-[280px]',
          render: (e) => <EventoDetalhe evento={e} />,
        },
      ]}
    />
  )
}
