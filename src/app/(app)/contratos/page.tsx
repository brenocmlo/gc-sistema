import { FileText, Plus } from 'lucide-react'
import Link from 'next/link'
import { redirect } from 'next/navigation'

import EmptyState from '@/components/EmptyState'
import ExportButton from '@/components/ExportButton'
import Pagination from '@/components/Pagination'
import { isContratoStatus } from '@/lib/contratos'
import {
  computePeriodoCutoff,
  isRangeForaDoAlcance,
  sanitizeBusca,
  urlSemPagina,
} from '@/lib/listagem'
import { obraIdsDaBusca } from '@/lib/propostas'
import { getCurrentProfile } from '@/lib/supabase/profile'
import { createClient } from '@/lib/supabase/server'
import type { ContratoListItem } from '@/lib/types'

import ContratosFilters from './filters'
import ContratosTable from './contratos-table'

const PAGE_SIZE = 20

type SearchParams = {
  busca?: string
  obra?: string
  status?: string
  periodo?: string
  page?: string
}

export default async function ContratosPage({
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
    .from('contratos')
    .select(
      'id, numero, data_assinatura, obra_id, status, valor_total, desconto, valor_final, obra:obras(codigo_obra, nome, cliente:clientes(nome))',
      { count: 'exact' },
    )
    // data_assinatura é nullable (contrato gerado antes da assinatura), então
    // os sem data vão pro fim, e o número desempata pra paginação não
    // embaralhar entre requisições.
    .order('data_assinatura', { ascending: false, nullsFirst: false })
    .order('numero', { ascending: false })

  if (busca) {
    // Cliente vem por obra (contratos não tem cliente_id), mesmo caminho da
    // listagem de propostas — ver obraIdsDaBusca.
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

  if (statusFilter && isContratoStatus(statusFilter)) {
    query = query.eq('status', statusFilter)
  }

  // Período sobre a data de assinatura. Contrato sem data fica fora de
  // qualquer período — não há como dizer se é "dos últimos 30 dias".
  const cutoff = computePeriodoCutoff(periodoFilter)
  if (cutoff) {
    query = query.gte('data_assinatura', cutoff)
  }

  const from = (page - 1) * PAGE_SIZE
  const to = from + PAGE_SIZE - 1

  const { data, count, error } = await query.range(from, to)

  if (error) {
    // Página além do último registro: o PostgREST devolve 416. Volta pra
    // primeira página com os filtros intactos (mesmo tratamento de /propostas).
    if (isRangeForaDoAlcance(error) && page > 1) {
      redirect(urlSemPagina('/contratos', { ...searchParams, page: undefined }))
    }

    return (
      <div className="bg-red-50 border border-red-200 rounded-md p-4 text-sm text-red-700">
        Erro ao carregar contratos: {error.message}
      </div>
    )
  }

  // Cast: status vem como `string` do gen, mas o CHECK garante ContratoStatus.
  const contratos = (data ?? []) as ContratoListItem[]
  const total = count ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const extraParams = {
    busca,
    obra: obraFilter,
    status: statusFilter,
    periodo: periodoFilter,
  }

  const hasFilters = Object.values(extraParams).some((v) => v !== '')
  const isEmpty = contratos.length === 0

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex-1 min-w-[280px]">
          <ContratosFilters obraOptions={obraOptions} />
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <ExportButton
            endpoint="/api/export/contratos"
            searchParams={extraParams}
            filename={`contratos-${new Date().toISOString().slice(0, 10)}`}
          />
          {canCreate && (
            <Link
              href="/contratos/novo"
              className="inline-flex items-center gap-2 bg-gray-900 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-gray-800 transition-colors whitespace-nowrap"
            >
              <Plus size={16} />
              Novo contrato
            </Link>
          )}
        </div>
      </div>

      {isEmpty && !hasFilters ? (
        <EmptyState
          icon={FileText}
          title="Nenhum contrato cadastrado ainda"
          action={
            canCreate ? { label: 'Novo contrato', href: '/contratos/novo' } : null
          }
        />
      ) : isEmpty ? (
        <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-sm text-gray-500">
          Nenhum contrato encontrado com esses filtros.
        </div>
      ) : (
        <>
          <ContratosTable contratos={contratos} />
          <Pagination
            page={page}
            totalPages={totalPages}
            total={total}
            basePath="/contratos"
            entityLabel={['contrato', 'contratos']}
            extraParams={extraParams}
          />
        </>
      )}
    </div>
  )
}
