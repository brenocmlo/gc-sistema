import { FileSignature, Plus } from 'lucide-react'
import Link from 'next/link'
import { redirect } from 'next/navigation'

import EmptyState from '@/components/EmptyState'
import ExportButton from '@/components/ExportButton'
import Pagination from '@/components/Pagination'
import {
  computePeriodoCutoff,
  isRangeForaDoAlcance,
  sanitizeBusca,
  urlSemPagina,
} from '@/lib/listagem'
import { isPropostaStatus, obraIdsDaBusca } from '@/lib/propostas'
import { getCurrentProfile } from '@/lib/supabase/profile'
import { createClient } from '@/lib/supabase/server'
import type { PropostaListItem } from '@/lib/types'

import PropostasFilters from './filters'
import PropostasTable from './propostas-table'

const PAGE_SIZE = 20

type SearchParams = {
  busca?: string
  obra?: string
  status?: string
  vencidas?: string
  periodo?: string
  page?: string
}

export default async function PropostasPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const profile = await getCurrentProfile()
  const canCreate =
    profile?.perfil === 'admin' || profile?.perfil === 'comercial'

  const page = Math.max(1, Number.parseInt(searchParams.page ?? '1', 10) || 1)
  const busca = sanitizeBusca(searchParams.busca ?? '')
  const obraFilter = searchParams.obra ?? ''
  const statusFilter = searchParams.status ?? ''
  const vencidasFilter = searchParams.vencidas === '1'
  const periodoFilter = searchParams.periodo ?? ''

  const supabase = createClient()

  // Lista completa de obras: alimenta o select do filtro e, quando há busca,
  // o match por nome/código da obra sem uma segunda ida ao banco.
  const { data: obras } = await supabase
    .from('obras')
    .select('id, codigo_obra, nome, cliente_id')
    .order('codigo_obra', { ascending: false })

  const obraOptions = (obras ?? []).map((o) => ({
    value: o.id,
    label: `${o.codigo_obra} — ${o.nome}`,
  }))

  let query = supabase
    .from('propostas')
    .select(
      'id, numero, data_emissao, data_validade, obra_id, status, valor_total, desconto, valor_final, obra:obras(codigo_obra, nome, cliente:clientes(nome))',
      { count: 'exact' },
    )
    // data_emissao é nullable, então rascunho sem data vai pro fim, e o número
    // desempata pra paginação não embaralhar entre requisições.
    .order('data_emissao', { ascending: false, nullsFirst: false })
    .order('numero', { ascending: false })

  if (busca) {
    // Cliente vem por obra (propostas não tem cliente_id), então a busca
    // cross-table resolve os IDs antes — ver obraIdsDaBusca.
    const { data: clientesMatch } = await supabase
      .from('clientes')
      .select('id')
      .ilike('nome', `%${busca}%`)

    const obraIds = obraIdsDaBusca(
      obras ?? [],
      busca,
      (clientesMatch ?? []).map((c) => c.id),
    )

    const filters = [
      `numero.ilike.%${busca}%`,
      obraIds.length > 0 ? `obra_id.in.(${obraIds.join(',')})` : null,
    ].filter(Boolean)

    query = query.or(filters.join(','))
  }

  if (obraFilter) {
    query = query.eq('obra_id', obraFilter)
  }

  const hoje = new Date().toISOString().slice(0, 10)

  if (vencidasFilter) {
    // Vencida não é status: é proposta enviada cuja validade já passou.
    query = query.eq('status', 'enviada').lt('data_validade', hoje)
  } else if (statusFilter && isPropostaStatus(statusFilter)) {
    query = query.eq('status', statusFilter)
  }

  const cutoff = computePeriodoCutoff(periodoFilter)
  if (cutoff) {
    query = query.gte('data_emissao', cutoff)
  }

  const from = (page - 1) * PAGE_SIZE
  const to = from + PAGE_SIZE - 1

  const { data, count, error } = await query.range(from, to)

  if (error) {
    // Página além do último registro: o PostgREST devolve 416 em vez de lista
    // vazia, e sem `count` a tela não tem como se recompor. Volta pra primeira
    // página com os filtros intactos, em vez de mostrar erro de banco pra quem
    // só abriu um link velho.
    if (isRangeForaDoAlcance(error) && page > 1) {
      redirect(urlSemPagina('/propostas', { ...searchParams, page: undefined }))
    }

    return (
      <div className="bg-red-50 border border-red-200 rounded-md p-4 text-sm text-red-700">
        Erro ao carregar propostas: {error.message}
      </div>
    )
  }

  // Cast: status vem como `string` do gen, mas o banco garante PropostaStatus.
  const propostas = (data ?? []) as PropostaListItem[]
  const total = count ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const extraParams = {
    busca,
    obra: obraFilter,
    status: statusFilter,
    vencidas: vencidasFilter ? '1' : '',
    periodo: periodoFilter,
  }

  const hasFilters = Object.values(extraParams).some((v) => v !== '')
  const isEmpty = propostas.length === 0

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex-1 min-w-[280px]">
          <PropostasFilters obraOptions={obraOptions} />
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <ExportButton
            endpoint="/api/export/propostas"
            searchParams={extraParams}
            filename={`propostas-${new Date().toISOString().slice(0, 10)}`}
          />
          {canCreate && (
            <Link
              href="/propostas/nova"
              className="inline-flex items-center gap-2 bg-gray-900 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-gray-800 transition-colors whitespace-nowrap"
            >
              <Plus size={16} />
              Nova proposta
            </Link>
          )}
        </div>
      </div>

      {isEmpty && !hasFilters ? (
        <EmptyState
          icon={FileSignature}
          title="Nenhuma proposta cadastrada ainda"
          action={
            canCreate
              ? { label: 'Nova proposta', href: '/propostas/nova' }
              : null
          }
        />
      ) : isEmpty ? (
        <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-sm text-gray-500">
          Nenhuma proposta encontrada com esses filtros.
        </div>
      ) : (
        <>
          <PropostasTable propostas={propostas} />
          <Pagination
            page={page}
            totalPages={totalPages}
            total={total}
            basePath="/propostas"
            entityLabel={['proposta', 'propostas']}
            extraParams={extraParams}
          />
        </>
      )}
    </div>
  )
}
