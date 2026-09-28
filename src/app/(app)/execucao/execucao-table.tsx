'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useState } from 'react'

import {
  ETAPA_LABELS,
  ETAPAS,
  etapaAtrasada,
  etapasAtrasadas,
  formatQtd,
  somaAcimaDoItem,
  type ResumoDoItem,
} from '@/lib/execucao'
import type { ExecucaoListItem } from '@/lib/types'

import ApontamentoDialog, { type QuemVe } from './apontamento-dialog'
import EtapaProgresso from './etapa-progresso'

type ExecucaoTableProps = {
  execucoes: ExecucaoListItem[]
  podeApontar: boolean
  /**
   * `?apontar=<id>` (8.3): a execução cujo painel abre ao carregar, procurada
   * na obra inteira — ela pode não estar na página atual da tabela.
   */
  abrirAoCarregar?: ExecucaoListItem | null
  /** Quem está vendo: a galeria de evidências (8.1) monta o path e decide quem exclui. */
  quem: QuemVe
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
export default function ExecucaoTable({
  execucoes,
  podeApontar,
  abrirAoCarregar = null,
  quem,
  resumos,
  agrupar,
  hoje,
}: ExecucaoTableProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [linhas, setLinhas] = useState(execucoes)
  const [aberta, setAberta] = useState<ExecucaoListItem | null>(abrirAoCarregar)

  // Fechou o painel que veio pelo link: tira o `apontar` da URL, para o
  // recarregar e o voltar não o abrirem de novo.
  function fecharPainel() {
    setAberta(null)
    if (searchParams.has('apontar')) {
      const params = new URLSearchParams(searchParams.toString())
      params.delete('apontar')
      router.replace(`${pathname}${params.size > 0 ? `?${params}` : ''}`, { scroll: false })
    }
  }

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
      <div className="hidden md:block bg-white rounded-lg border border-gray-200 overflow-x-auto">
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

      {/* Celular (8.2): um cartão por execução no lugar da tabela de seis
          colunas. O cartão inteiro é o alvo de toque que abre o painel. */}
      <ul data-cartoes className="md:hidden space-y-3">
        {linhas.map((e) => {
          const resumo = resumos[e.item_id]
          const varias = (resumo?.execucoes ?? 1) > 1
          const atrasada = etapasAtrasadas(e, hoje).length > 0
          return (
            <li key={e.id}>
              <button
                type="button"
                data-execucao={e.id}
                onClick={() => setAberta(e)}
                aria-label={`${podeApontar ? 'Apontar' : 'Ver etapas de'} ${e.item?.descricao ?? 'item'}`}
                className="w-full text-left bg-white rounded-lg border border-gray-200 p-4 space-y-3 active:bg-gray-50"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium text-gray-900">
                      {e.item?.numero != null ? `${e.item.numero}. ` : ''}
                      {e.item?.tipo ?? 'Item'}
                      {varias ? ` · execução ${e.sequencial} de ${resumo.execucoes}` : ''}
                    </p>
                    <p className="text-gray-500 text-sm">{e.item?.descricao ?? '—'}</p>
                    {e.localizacao && <p className="text-gray-500 text-xs">{e.localizacao}</p>}
                  </div>
                  <span className="shrink-0 text-sm tabular-nums text-gray-900">
                    {formatQtd(e.quantidade_total)} {e.item?.unidade ?? ''}
                  </span>
                </div>
                {atrasada && (
                  <p className="inline-flex px-1.5 py-0.5 rounded text-[11px] font-medium border bg-red-100 text-red-700 border-red-200">
                    Atrasada
                  </p>
                )}
                <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                  {ETAPAS.map((etapa) => (
                    <div key={etapa}>
                      <p className="text-xs font-medium text-gray-600 mb-1">{ETAPA_LABELS[etapa]}</p>
                      <EtapaProgresso
                        qtd={e[`${etapa}_qtd`]}
                        total={e.quantidade_total}
                        previsao={e[`${etapa}_previsao_fim`]}
                        atrasada={etapaAtrasada(e, etapa, hoje)}
                      />
                    </div>
                  ))}
                </div>
                <p className="text-sm font-medium text-blue-700">{podeApontar ? 'Apontar' : 'Ver etapas'}</p>
              </button>
            </li>
          )
        })}
      </ul>

      <ApontamentoDialog
        execucao={aberta}
        resumo={aberta ? (resumos[aberta.item_id] ?? null) : null}
        podeApontar={podeApontar}
        quem={quem}
        onOpenChange={(open) => !open && fecharPainel()}
        onSalvo={(linha) => {
          trocarLinha(linha)
          setAberta((a) => (a && a.id === linha.id ? linha : a))
        }}
      />
    </>
  )
}
