import { ArrowRight } from 'lucide-react'
import Link from 'next/link'

import {
  ETAPA_LABELS,
  etapasAtrasadas,
  formatQtd,
  linkDoApontamento,
  maisAtrasadas,
  progressoAgregado,
  progressoGeralDaObra,
} from '@/lib/execucao'
import { formatDate } from '@/lib/format'
import { periodoPadrao } from '@/lib/medicao'
import type { ExecucaoListItem } from '@/lib/types'

import Totalizador from '../../execucao/totalizador'

import RelatorioMedicaoButton from './relatorio-medicao-button'

type ExecucaoTabProps = {
  obraId: string
  execucoes: ExecucaoListItem[]
  /** YYYY-MM-DD do servidor, o mesmo "hoje" da /execucao. */
  hoje: string
  /** Quem entra em /execucao: os links só aparecem para esses perfis. */
  podeAbrirExecucao: boolean
  podeApontar: boolean
  /** Admin, medição e financeiro: o relatório de medição (8.4). */
  podeEmitirMedicao: boolean
}

/**
 * Aba Execução de /obras/[id] (bloco 8.3): o progresso da obra nas quatro
 * etapas, o geral, e as execuções mais atrasadas com link direto para o
 * apontamento. A edição continua em /execucao; aqui é leitura.
 */
export default function ExecucaoTab({
  obraId,
  execucoes,
  hoje,
  podeAbrirExecucao,
  podeApontar,
  podeEmitirMedicao,
}: ExecucaoTabProps) {
  if (execucoes.length === 0) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-sm text-gray-500 space-y-2">
        <p>Esta obra ainda não tem execução.</p>
        {podeAbrirExecucao && (
          <Link href={`/execucao?obra=${obraId}`} className="inline-flex items-center gap-1 font-medium text-blue-700 hover:underline">
            Abrir a execução da obra <ArrowRight size={14} />
          </Link>
        )}
      </div>
    )
  }

  const pct = progressoAgregado(execucoes)
  const geral = progressoGeralDaObra(pct)
  const atrasadas = execucoes.filter((e) => etapasAtrasadas(e, hoje).length > 0).length
  const lista = maisAtrasadas(execucoes, hoje)

  return (
    <div className="space-y-6">
      {podeEmitirMedicao && (
        <div className="bg-white rounded-lg border border-gray-200 p-5 space-y-3">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">Relatório de medição</h2>
            <p className="text-xs text-gray-500">
              PDF para o cliente aprovar: por item, o medido no período e o acumulado, com os valores e o
              espaço para o aceite.
            </p>
          </div>
          <RelatorioMedicaoButton obraId={obraId} periodoInicial={periodoPadrao(hoje)} />
        </div>
      )}

      <div className="bg-white rounded-lg border border-gray-200 p-5 space-y-3" aria-label="Progresso geral da obra">
        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <h2 className="text-sm font-semibold text-gray-900">Progresso geral</h2>
          <span className="text-2xl font-semibold text-gray-900 tabular-nums">
            {geral.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%
          </span>
        </div>
        <div className="h-3 rounded-full bg-gray-100 overflow-hidden">
          <div className="h-full bg-gray-900" style={{ width: `${Math.min(geral, 100)}%` }} />
        </div>
        <p className="text-xs text-gray-500">
          Média das quatro etapas, com o mesmo peso: a obra só chega a 100% com tudo medido.{' '}
          {`${execucoes.length} ${execucoes.length === 1 ? 'execução' : 'execuções'}, ${atrasadas} com etapa atrasada.`}
        </p>
      </div>

      <Totalizador pct={pct} execucoes={execucoes.length} />

      <div className="bg-white rounded-lg border border-gray-200" aria-label="Itens mais atrasados">
        <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between gap-3 flex-wrap">
          <h2 className="text-sm font-semibold text-gray-900">Itens mais atrasados</h2>
          {podeAbrirExecucao && (
            <Link
              href={`/execucao?obra=${obraId}&atrasados=1`}
              className="text-sm font-medium text-blue-700 hover:underline"
            >
              Ver todos na execução
            </Link>
          )}
        </div>
        {lista.length === 0 ? (
          <p className="px-5 py-6 text-sm text-gray-500">Nenhuma etapa com a previsão vencida.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {lista.map(({ execucao: e, etapa, previsao, diasDeAtraso }) => (
              <li key={e.id} data-atrasada={e.id} className="px-5 py-3 flex items-center justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900">
                    {e.item?.numero != null ? `${e.item.numero}. ` : ''}
                    {e.item?.descricao ?? e.item?.tipo ?? 'Item'}
                    {e.localizacao ? ` · ${e.localizacao}` : ''}
                  </p>
                  <p className="text-xs text-gray-500">
                    {`${ETAPA_LABELS[etapa]} prevista para ${formatDate(previsao)} · ${diasDeAtraso} ${
                      diasDeAtraso === 1 ? 'dia' : 'dias'
                    } de atraso · ${formatQtd(e[`${etapa}_qtd`])} de ${formatQtd(e.quantidade_total)}`}
                  </p>
                </div>
                {podeAbrirExecucao && (
                  <Link
                    href={linkDoApontamento(obraId, e.id)}
                    aria-label={`${podeApontar ? 'Apontar' : 'Ver etapas de'} ${e.item?.descricao ?? 'item'}`}
                    className="shrink-0 inline-flex items-center gap-1 px-3 py-2 rounded-md border border-gray-300 text-sm font-medium text-gray-700 hover:bg-gray-50"
                  >
                    {podeApontar ? 'Apontar' : 'Ver etapas'} <ArrowRight size={14} />
                  </Link>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
