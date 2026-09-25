'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

import { etapaAtrasada, etapasAtrasadas, formatQtd, somaAcimaDoItem, type ResumoDoItem } from '@/lib/execucao'
import type { ExecucaoListItem } from '@/lib/types'

import ApontamentoDialog from './apontamento-dialog'
import EtapaProgresso from './etapa-progresso'

type ExecucaoTableProps = {
  execucoes: ExecucaoListItem[]
  podeApontar: boolean
  /** Por item_id, na obra inteira: quantas execuções e quanto somam (7.4). */
  resumos: Record<string, ResumoDoItem>
  /** Agrupar as execuções do mesmo item: só faz sentido na ordem por número. */
  agrupar: boolean
  /** YYYY-MM-DD do servidor, para o atraso ser o mesmo no SSR e no navegador. */
  hoje: string
}

const CABECALHO = ['Item', 'Qtd. total', 'Fabricação', 'Entrega', 'Instalação', 'Medição']

/**
 * Uma linha por execução; o clique abre o painel de apontamento (7.3). Depois
 * de salvar, a linha que voltou do banco substitui só ela na tabela — sem
 * perder a rolagem nem os filtros. O `router.refresh()` em seguida atualiza o
 * totalizador do topo, que é da obra inteira.
 */
export default function ExecucaoTable({ execucoes, podeApontar, resumos, agrupar, hoje }: ExecucaoTableProps) {
  const router = useRouter()
  const [linhas, setLinhas] = useState(execucoes)
  const [aberta, setAberta] = useState<ExecucaoListItem | null>(null)

  // Os filtros trocam a página no servidor: a tabela acompanha.
  useEffect(() => {
    setLinhas(execucoes)
  }, [execucoes])

  function trocarLinha(nova: ExecucaoListItem) {
    setLinhas((atual) => atual.map((l) => (l.id === nova.id ? nova : l)))
    router.refresh()
  }

  return (
    <>
      <div className="bg-white rounded-lg border border-gray-200 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              {CABECALHO.map((h) => (
                <th key={h} className="px-4 py-3 text-left font-medium text-gray-700 whitespace-nowrap">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {linhas.map((e, i) => {
              const resumo = resumos[e.item_id]
              const varias = (resumo?.execucoes ?? 1) > 1
              // Continuação do grupo: mesma linha de item logo acima, na ordem por número.
              const continuacao = agrupar && varias && i > 0 && linhas[i - 1].item_id === e.item_id
              return (
                <tr
                  key={e.id}
                  data-execucao={e.id}
                  onClick={() => setAberta(e)}
                  className={`align-top cursor-pointer hover:bg-gray-50 transition-colors ${
                    continuacao ? 'border-t-0' : ''
                  }`}
                >
                  <td className={`px-4 py-3 min-w-[220px] ${continuacao ? 'pl-8' : ''}`}>
                    {continuacao ? (
                      <p className="text-gray-700 text-xs font-medium">
                        {/* Uma string só: texto ao lado de {expressão} ganha <!-- --> no SSR. */}
                        {`↳ Execução ${e.sequencial} de ${resumo.execucoes}`}
                      </p>
                    ) : (
                      <>
                        <p className="font-medium text-gray-900">
                          {e.item?.numero != null ? `${e.item.numero}. ` : ''}
                          {e.item?.tipo ?? 'Item'}
                          {varias ? ` · execução ${e.sequencial} de ${resumo.execucoes}` : ''}
                        </p>
                        <p className="text-gray-500 text-xs mt-0.5">{e.item?.descricao ?? '—'}</p>
                        {varias && resumo && somaAcimaDoItem(resumo) && (
                          <p className="mt-1 inline-flex px-1.5 py-0.5 rounded text-[11px] font-medium border bg-amber-100 text-amber-800 border-amber-200">
                            Execuções somam {formatQtd(resumo.soma)} de {formatQtd(resumo.quantidadeDoItem)} do item
                          </p>
                        )}
                      </>
                    )}
                    {e.localizacao && <p className="text-gray-500 text-xs">{e.localizacao}</p>}
                    {etapasAtrasadas(e, hoje).length > 0 && (
                      <p className="mt-1 inline-flex px-1.5 py-0.5 rounded text-[11px] font-medium border bg-red-100 text-red-700 border-red-200">
                        Atrasada
                      </p>
                    )}
                    <button
                      type="button"
                      onClick={(ev) => {
                        ev.stopPropagation()
                        setAberta(e)
                      }}
                      aria-label={`${podeApontar ? 'Apontar' : 'Ver etapas de'} ${e.item?.descricao ?? 'item'}`}
                      className="mt-1 text-xs font-medium text-blue-700 hover:underline"
                    >
                      {podeApontar ? 'Apontar' : 'Ver etapas'}
                    </button>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap tabular-nums text-gray-900">
                    {formatQtd(e.quantidade_total)} {e.item?.unidade ?? ''}
                  </td>
                  <td className="px-4 py-3">
                    <EtapaProgresso
                      qtd={e.fab_qtd}
                      total={e.quantidade_total}
                      previsao={e.fab_previsao_fim}
                      atrasada={etapaAtrasada(e, 'fab', hoje)}
                    />
                  </td>
                  <td className="px-4 py-3">
                    <EtapaProgresso
                      qtd={e.ent_qtd}
                      total={e.quantidade_total}
                      previsao={e.ent_previsao_fim}
                      atrasada={etapaAtrasada(e, 'ent', hoje)}
                    />
                  </td>
                  <td className="px-4 py-3">
                    <EtapaProgresso
                      qtd={e.inst_qtd}
                      total={e.quantidade_total}
                      previsao={e.inst_previsao_fim}
                      atrasada={etapaAtrasada(e, 'inst', hoje)}
                    />
                  </td>
                  <td className="px-4 py-3">
                    <EtapaProgresso
                      qtd={e.med_qtd}
                      total={e.quantidade_total}
                      previsao={e.med_previsao_fim}
                      atrasada={etapaAtrasada(e, 'med', hoje)}
                    />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <ApontamentoDialog
        execucao={aberta}
        resumo={aberta ? (resumos[aberta.item_id] ?? null) : null}
        podeApontar={podeApontar}
        onOpenChange={(open) => !open && setAberta(null)}
        onSalvo={(linha) => {
          trocarLinha(linha)
          setAberta((a) => (a && a.id === linha.id ? linha : a))
        }}
      />
    </>
  )
}
