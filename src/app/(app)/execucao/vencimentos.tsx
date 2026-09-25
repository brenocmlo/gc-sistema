import { formatDate } from '@/lib/format'
import { ETAPA_LABELS, type Vencimento } from '@/lib/execucao'
import type { ExecucaoListItem } from '@/lib/types'

type VencimentosProps = {
  proximos: Vencimento<ExecucaoListItem>[]
  atrasadas: number
  obraId: string
}

const MAXIMO = 8

/**
 * O painel de próximos vencimentos (7.5): etapas não concluídas com previsão
 * de fim nos próximos 7 dias, da mais próxima para a mais distante, e o total
 * de execuções já atrasadas, com o link para o filtro.
 */
export default function Vencimentos({ proximos, atrasadas, obraId }: VencimentosProps) {
  return (
    <section
      aria-label="Próximos vencimentos"
      className="bg-white rounded-lg border border-gray-200 p-4 space-y-3"
    >
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className="text-sm font-semibold text-gray-900">Próximos vencimentos (7 dias)</h2>
        {atrasadas > 0 ? (
          <a
            href={`/execucao?obra=${encodeURIComponent(obraId)}&atrasados=1`}
            className="text-xs font-medium text-red-700 hover:underline"
          >
            {atrasadas === 1 ? '1 execução atrasada' : `${atrasadas} execuções atrasadas`}
          </a>
        ) : (
          <span className="text-xs text-gray-500">Nenhuma execução atrasada</span>
        )}
      </div>
      {proximos.length === 0 ? (
        <p className="text-sm text-gray-500">Nenhuma etapa com previsão de fim nos próximos 7 dias.</p>
      ) : (
        <ul className="divide-y divide-gray-100 text-sm">
          {proximos.slice(0, MAXIMO).map((v) => (
            <li key={`${v.execucao.id}-${v.etapa}`} className="py-2 flex items-center justify-between gap-3 flex-wrap">
              <span className="text-gray-900">
                {`${v.execucao.item?.descricao ?? 'Item'}${v.execucao.localizacao ? ` · ${v.execucao.localizacao}` : ''} — ${ETAPA_LABELS[v.etapa]}`}
              </span>
              <span className={`text-xs tabular-nums ${v.dias <= 1 ? 'text-amber-700 font-medium' : 'text-gray-500'}`}>
                {v.dias === 0 ? 'vence hoje' : v.dias === 1 ? 'vence amanhã' : `em ${v.dias} dias`} · {formatDate(v.previsao)}
              </span>
            </li>
          ))}
          {proximos.length > MAXIMO && (
            <li className="py-2 text-xs text-gray-500">e mais {proximos.length - MAXIMO}.</li>
          )}
        </ul>
      )}
    </section>
  )
}
