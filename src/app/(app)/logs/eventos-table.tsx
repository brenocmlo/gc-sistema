'use client'

import Link from 'next/link'

import DataTable from '@/components/DataTable'
import {
  ORIGEM_LABELS,
  RESULTADO_LABELS,
  camposAlterados,
  formatarValorAuditoria,
  hrefDoRegistro,
  labelAcao,
  labelAutor,
  labelEntidade,
  linhaDoEvento,
  resumoEvento,
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

/**
 * Resumo na linha, detalhe no <details>: abre sem JS e sem ir pra outra tela.
 * Update mostra o diff campo a campo; criação e exclusão, a linha inteira.
 */
function EventoDetalhe({ evento }: { evento: EventoAuditoria }) {
  const campos = camposAlterados(evento.detalhe)
  const linha = linhaDoEvento(evento.detalhe)
  const resumo = resumoEvento(evento)
  const temDetalhe = campos.length > 0 || linha !== null || evento.detalhe != null

  if (!temDetalhe) {
    return <span className={evento.resultado === 'erro' ? 'text-red-700' : ''}>{resumo}</span>
  }

  return (
    <details className="group">
      <summary
        className={`cursor-pointer select-none ${evento.resultado === 'erro' ? 'text-red-700' : ''}`}
      >
        {resumo}
      </summary>
      <div className="mt-2 text-xs">
        {campos.length > 0 ? (
          <table className="w-full border border-gray-200 rounded">
            <thead className="bg-gray-50 text-gray-600">
              <tr>
                <th className="px-2 py-1 text-left font-medium">Campo</th>
                <th className="px-2 py-1 text-left font-medium">Antes</th>
                <th className="px-2 py-1 text-left font-medium">Depois</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {campos.map((c) => (
                <tr key={c.campo}>
                  <td className="px-2 py-1 font-mono text-gray-700">{c.campo}</td>
                  <td className="px-2 py-1 text-gray-500 break-all">{formatarValorAuditoria(c.de)}</td>
                  <td className="px-2 py-1 text-gray-900 break-all">{formatarValorAuditoria(c.para)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : linha ? (
          <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-0.5">
            {Object.entries(linha).map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="font-mono text-gray-500">{k}</dt>
                <dd className="text-gray-900 break-all">{formatarValorAuditoria(v)}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <pre className="whitespace-pre-wrap break-all text-gray-700">
            {JSON.stringify(evento.detalhe, null, 2)}
          </pre>
        )}
        {evento.registro_id && (
          <p className="mt-1 text-gray-400 font-mono">id {evento.registro_id}</p>
        )}
      </div>
    </details>
  )
}
