import { redirect } from 'next/navigation'
import { Activity } from 'lucide-react'

import EmptyState from '@/components/EmptyState'
import Pagination from '@/components/Pagination'
import {
  filtroBuscaAuditoria,
  isAcaoDoTrigger,
  isEntidadeAuditada,
  isOrigemEvento,
  isResultadoEvento,
  type EventoAuditoria,
} from '@/lib/auditoria'
import {
  computePeriodoCutoff,
  isRangeForaDoAlcance,
  sanitizeBusca,
  urlSemPagina,
} from '@/lib/listagem'
import { createClient } from '@/lib/supabase/server'

import LogsFilters from './filters'
import EventosTable from './eventos-table'

const PAGE_SIZE = 20

type SearchParams = {
  busca?: string
  origem?: string
  resultado?: string
  entidade?: string
  acao?: string
  autor?: string
  periodo?: string
  page?: string
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default async function LogsPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const page = Math.max(1, Number.parseInt(searchParams.page ?? '1', 10) || 1)
  const busca = sanitizeBusca(searchParams.busca ?? '')
  const origemFilter = searchParams.origem ?? ''
  const resultadoFilter = searchParams.resultado ?? ''
  const entidadeFilter = searchParams.entidade ?? ''
  const acaoFilter = searchParams.acao ?? ''
  const autorFilter = searchParams.autor ?? ''
  const periodoFilter = searchParams.periodo ?? ''

  const supabase = createClient()

  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, nome')
    .order('nome')

  const autores: Record<string, string> = {}
  for (const p of profiles ?? []) autores[p.id] = p.nome
  const autorOptions = (profiles ?? []).map((p) => ({ value: p.id, label: p.nome }))

  let query = supabase
    .from('auditoria_eventos')
    .select(
      'id, em, origem, entidade, registro_id, referencia, acao, resultado, mensagem, autor_id, autor_descricao, detalhe',
      { count: 'exact' },
    )
    .order('em', { ascending: false })
    .order('id', { ascending: false })

  const filtroBusca = filtroBuscaAuditoria(busca)
  if (filtroBusca) query = query.or(filtroBusca)

  // Filtro desconhecido na URL é ignorado, não repassado ao banco.
  if (isOrigemEvento(origemFilter)) query = query.eq('origem', origemFilter)
  if (isResultadoEvento(resultadoFilter)) query = query.eq('resultado', resultadoFilter)
  if (isEntidadeAuditada(entidadeFilter)) query = query.eq('entidade', entidadeFilter)
  if (isAcaoDoTrigger(acaoFilter)) query = query.eq('acao', acaoFilter)
  if (UUID.test(autorFilter)) query = query.eq('autor_id', autorFilter)

  const cutoff = computePeriodoCutoff(periodoFilter)
  if (cutoff) query = query.gte('em', cutoff)

  const from = (page - 1) * PAGE_SIZE
  const to = from + PAGE_SIZE - 1

  const { data, count, error } = await query.range(from, to)

  if (error) {
    if (isRangeForaDoAlcance(error) && page > 1) {
      redirect(urlSemPagina('/logs', { ...searchParams, page: undefined }))
    }

    return (
      <div className="bg-red-50 border border-red-200 rounded-md p-4 text-sm text-red-700">
        Erro ao carregar os logs: {error.message}
      </div>
    )
  }

  // Cast: origem e resultado vêm como `string` do gen; os CHECKs garantem a união.
  const eventos = (data ?? []) as EventoAuditoria[]
  const total = count ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const extraParams = {
    busca,
    origem: origemFilter,
    resultado: resultadoFilter,
    entidade: entidadeFilter,
    acao: acaoFilter,
    autor: autorFilter,
    periodo: periodoFilter,
  }

  const hasFilters = Object.values(extraParams).some((v) => v !== '')
  const isEmpty = eventos.length === 0

  return (
    <div className="space-y-4">
      <LogsFilters autorOptions={autorOptions} />

      {isEmpty && !hasFilters ? (
        <EmptyState
          icon={Activity}
          title="Nenhum evento registrado ainda"
          description="Toda criação, edição, mudança de status e exclusão passa a aparecer aqui, com quem fez e o que mudou."
        />
      ) : isEmpty ? (
        <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-sm text-gray-500">
          Nenhum evento encontrado com esses filtros.
        </div>
      ) : (
        <>
          <EventosTable eventos={eventos} autores={autores} />
          <Pagination
            page={page}
            totalPages={totalPages}
            total={total}
            basePath="/logs"
            entityLabel={['evento', 'eventos']}
            extraParams={extraParams}
          />
        </>
      )}
    </div>
  )
}
