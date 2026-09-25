import { Factory } from 'lucide-react'
import { redirect } from 'next/navigation'

import EmptyState from '@/components/EmptyState'
import Pagination from '@/components/Pagination'
import {
  etapasAtrasadas,
  filtrarExecucoes,
  hojeISO,
  isEtapa,
  isEtapaStatus,
  isOrdemExecucao,
  ordenarExecucoes,
  progressoAgregado,
  proximosVencimentos,
  responsaveisDe,
  resumoPorItem,
  type Etapa,
  type OrdemExecucao,
} from '@/lib/execucao'
import { sanitizeBusca, urlSemPagina } from '@/lib/listagem'
import { getCurrentProfile } from '@/lib/supabase/profile'
import { createClient } from '@/lib/supabase/server'
import type { EtapaStatus, ExecucaoListItem } from '@/lib/types'

import CriarFaltantes from './criar-faltantes'
import ExecucaoTable from './execucao-table'
import ExecucaoFilters from './filters'
import { itensSemExecucao } from './queries'
import Totalizador from './totalizador'
import Vencimentos from './vencimentos'

const PAGE_SIZE = 20
/** Teto de linhas do PostgREST: acima disso a obra viria cortada. */
const LIMITE_POSTGREST = 1000

type SearchParams = {
  obra?: string
  busca?: string
  etapa?: string
  status?: string
  responsavel?: string
  ordem?: string
  atrasados?: string
  page?: string
}

export default async function ExecucaoPage({ searchParams }: { searchParams: SearchParams }) {
  const profile = await getCurrentProfile()
  const podeApontar = ['admin', 'producao', 'medicao'].includes(profile?.perfil ?? '')

  const obraId = searchParams.obra ?? ''
  const page = Math.max(1, Number.parseInt(searchParams.page ?? '1', 10) || 1)
  const busca = sanitizeBusca(searchParams.busca ?? '')
  const etapaParam = searchParams.etapa ?? ''
  const etapa: Etapa | '' = isEtapa(etapaParam) ? etapaParam : ''
  const statusParam = searchParams.status ?? ''
  const status: EtapaStatus | '' = isEtapaStatus(statusParam) ? statusParam : ''
  const responsavel = searchParams.responsavel ?? ''
  const ordemParam = searchParams.ordem ?? ''
  const ordem: OrdemExecucao = isOrdemExecucao(ordemParam) ? ordemParam : 'numero'
  const atrasados = searchParams.atrasados === '1'
  // Um "hoje" só para a requisição inteira: filtro, ordem, painel e selo.
  const hoje = hojeISO()

  const supabase = createClient()

  const { data: obras } = await supabase
    .from('obras')
    .select('id, codigo_obra, nome')
    .order('codigo_obra', { ascending: false })

  const obraOptions = (obras ?? []).map((o) => ({ value: o.id, label: `${o.codigo_obra} — ${o.nome}` }))

  if (!obraId) {
    return (
      <div className="space-y-4">
        <ExecucaoFilters obraOptions={obraOptions} responsaveis={[]} />
        <EmptyState
          icon={Factory}
          title="Escolha uma obra"
          description="A execução é acompanhada obra a obra: fabricação, entrega, instalação e medição de cada item."
        />
      </div>
    )
  }

  // Todas as execuções da obra: o totalizador é da obra inteira, e filtro,
  // ordenação e paginação são feitos em memória (ver src/lib/execucao.ts).
  const [execRes, faltantes] = await Promise.all([
    supabase
      .from('execucao')
      .select('*, item:itens!inner(id, numero, tipo, descricao, quantidade, unidade, obra_id)')
      .eq('item.obra_id', obraId)
      .limit(LIMITE_POSTGREST),
    podeApontar ? itensSemExecucao(supabase, obraId) : Promise.resolve({ ids: [], error: null }),
  ])

  if (execRes.error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-md p-4 text-sm text-red-700">
        Erro ao carregar a execução: {execRes.error.message}
      </div>
    )
  }

  const todas = (execRes.data ?? []) as ExecucaoListItem[]
  const filtradas = ordenarExecucoes(
    filtrarExecucoes(todas, { etapa, status, responsavel, busca, atrasados, hoje }),
    ordem,
    hoje,
  )
  const total = filtradas.length
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  // Página além da última: volta pra primeira com os filtros intactos (mesmo
  // tratamento das outras listagens).
  if (page > totalPages) {
    redirect(urlSemPagina('/execucao', { ...searchParams, page: undefined }))
  }
  const pagina = page
  const visiveis = filtradas.slice((pagina - 1) * PAGE_SIZE, pagina * PAGE_SIZE)

  const extraParams = {
    obra: obraId,
    busca,
    etapa,
    status,
    responsavel,
    ordem: ordem === 'numero' ? '' : ordem,
    atrasados: atrasados ? '1' : '',
  }
  const temFiltro = Boolean(busca || etapa || status || responsavel || atrasados)

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex-1 min-w-[280px]">
          <ExecucaoFilters obraOptions={obraOptions} responsaveis={responsaveisDe(todas)} />
        </div>
        {podeApontar && faltantes.ids.length > 0 && (
          <CriarFaltantes obraId={obraId} quantidade={faltantes.ids.length} />
        )}
      </div>

      {todas.length >= LIMITE_POSTGREST && (
        <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-4 py-3">
          A obra tem {LIMITE_POSTGREST} execuções ou mais, e a tela mostra só as primeiras{' '}
          {LIMITE_POSTGREST}. O totalizador e os filtros podem estar incompletos.
        </p>
      )}

      {todas.length > 0 && <Totalizador pct={progressoAgregado(todas)} execucoes={todas.length} />}

      {todas.length > 0 && (
        <Vencimentos
          proximos={proximosVencimentos(todas, hoje)}
          atrasadas={todas.filter((e) => etapasAtrasadas(e, hoje).length > 0).length}
          obraId={obraId}
        />
      )}

      {todas.length === 0 ? (
        <EmptyState
          icon={Factory}
          title="Nenhuma execução nesta obra"
          description={
            faltantes.ids.length > 0
              ? 'Os itens de contrato desta obra ainda não têm execução. Use o botão acima para criar.'
              : 'A execução nasce dos itens de contrato da obra, e esta obra não tem item de contrato sem execução.'
          }
        />
      ) : total === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-sm text-gray-500">
          Nenhuma execução encontrada com esses filtros.
        </div>
      ) : (
        <>
          <ExecucaoTable
            execucoes={visiveis}
            podeApontar={podeApontar}
            resumos={Object.fromEntries(resumoPorItem(todas))}
            agrupar={ordem === 'numero'}
            hoje={hoje}
          />
          <Pagination
            page={pagina}
            totalPages={totalPages}
            total={total}
            basePath="/execucao"
            entityLabel={['execução', 'execuções']}
            extraParams={extraParams}
          />
        </>
      )}
      {temFiltro && todas.length > 0 && (
        <p className="text-xs text-gray-500">
          Mostrando {total} de {todas.length} execuções da obra.
        </p>
      )}
    </div>
  )
}
