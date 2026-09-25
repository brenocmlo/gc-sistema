import { ETAPAS, ETAPA_LABELS, STATUS_ETAPA_CORES, type QtdsEtapas } from '@/lib/execucao'

type TotalizadorProps = {
  /** % de cada etapa sobre a obra inteira (`progressoAgregado`). */
  pct: QtdsEtapas
  execucoes: number
}

/** O topo da tela: quanto da obra já foi fabricado, entregue, instalado e medido. */
export default function Totalizador({ pct, execucoes }: TotalizadorProps) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3" aria-label="Progresso da obra">
      {ETAPAS.map((etapa) => {
        const valor = pct[etapa]
        const cor = valor >= 100 ? STATUS_ETAPA_CORES.concluido : valor > 0 ? STATUS_ETAPA_CORES.andamento : STATUS_ETAPA_CORES.pendente
        return (
          <div key={etapa} className="bg-white rounded-lg border border-gray-200 p-4 space-y-2">
            <div className="flex items-baseline justify-between">
              <span className="text-sm font-medium text-gray-700">{ETAPA_LABELS[etapa]}</span>
              <span className="text-lg font-semibold text-gray-900 tabular-nums">
                {valor.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%
              </span>
            </div>
            <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
              <div className={`h-full ${cor.barra}`} style={{ width: `${Math.min(valor, 100)}%` }} />
            </div>
          </div>
        )
      })}
      <p className="col-span-2 lg:col-span-4 text-xs text-gray-500">
        Sobre {execucoes} {execucoes === 1 ? 'execução' : 'execuções'} da obra, sem os filtros abaixo:
        soma das quantidades de cada etapa sobre a soma das quantidades totais.
      </p>
    </div>
  )
}
