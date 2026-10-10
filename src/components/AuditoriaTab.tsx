import EventoDetalhe from '@/components/EventoDetalhe'
import { labelAcao, labelAutor, type EventoAuditoria } from '@/lib/auditoria'
import { formatDateTime } from '@/lib/format'

type AuditoriaTabProps = {
  eventos: EventoAuditoria[]
  /** uuid do profile → nome, resolvido pela page numa consulta só. */
  autores: Map<string, string>
  /** Ex: "nota fiscal". Entra na mensagem de lista vazia. */
  entidade: string
}

/**
 * Aba Histórico lida de `auditoria_eventos` (13.2), para a entidade que não
 * guarda o histórico em jsonb (a NF). Diferente do HistoricoTab, que só tem
 * transições de status, aqui entra toda mudança: criação, edição campo a
 * campo, status e exclusão de arquivo. Mais recente primeiro (a page ordena).
 */
export default function AuditoriaTab({ eventos, autores, entidade }: AuditoriaTabProps) {
  if (eventos.length === 0) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-sm text-gray-500">
        Nenhuma mudança registrada para esta {entidade}.
      </div>
    )
  }

  return (
    <ul className="bg-white rounded-lg border border-gray-200 divide-y divide-gray-100" aria-label={`Histórico da ${entidade}`}>
      {eventos.map((e) => (
        <li key={e.id} className="flex items-start gap-3 p-4 flex-wrap text-sm">
          <div className="w-44 shrink-0 text-gray-600">
            <p className="tabular-nums">{formatDateTime(e.em)}</p>
            <p className="text-gray-500">{labelAutor(e, autores)}</p>
          </div>
          <div className="flex-1 min-w-[200px]">
            <p className="font-medium text-gray-900">{labelAcao(e.acao)}</p>
            <div className="text-gray-600 mt-0.5">
              <EventoDetalhe evento={e} />
            </div>
          </div>
        </li>
      ))}
    </ul>
  )
}
