import { formatDate } from '@/lib/format'
import { STATUS_ETAPA_CORES, STATUS_ETAPA_LABELS, statusDaEtapa, formatQtd, progressoEtapa } from '@/lib/execucao'

type EtapaProgressoProps = {
  qtd: number
  total: number
  /** Previsão de fim da etapa (7.5), YYYY-MM-DD. */
  previsao?: string | null
  atrasada?: boolean
}

/** Uma etapa na linha da listagem: "4 / 10", a barra e o status (cor + texto). */
export default function EtapaProgresso({ qtd, total, previsao = null, atrasada = false }: EtapaProgressoProps) {
  const status = statusDaEtapa(qtd, total)
  const pct = progressoEtapa(qtd, total)
  const cores = STATUS_ETAPA_CORES[status]
  return (
    <div className="min-w-[110px] space-y-1" title={`${STATUS_ETAPA_LABELS[status]} · ${pct}%`}>
      <div className="flex items-baseline justify-between gap-2 text-xs tabular-nums">
        <span className="text-gray-900">
          {formatQtd(qtd)} / {formatQtd(total)}
        </span>
        <span className="text-gray-500">{pct}%</span>
      </div>
      <div
        className="h-1.5 rounded-full bg-gray-100 overflow-hidden"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div className={`h-full ${cores.barra}`} style={{ width: `${pct}%` }} />
      </div>
      <span className={`inline-flex px-1.5 py-0.5 rounded text-[11px] font-medium border ${cores.selo}`}>
        {STATUS_ETAPA_LABELS[status]}
      </span>
      {previsao && (
        <p className={`text-[11px] ${atrasada ? 'text-red-700 font-medium' : 'text-gray-500'}`}>
          {atrasada ? `Atrasada · prev. ${formatDate(previsao)}` : `Prev. ${formatDate(previsao)}`}
        </p>
      )}
    </div>
  )
}
