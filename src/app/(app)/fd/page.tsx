import { HandCoins, Plus } from 'lucide-react'
import Link from 'next/link'

import EmptyState from '@/components/EmptyState'
import ExportButton from '@/components/ExportButton'
import Pagination from '@/components/Pagination'
import { getCurrentProfile } from '@/lib/supabase/profile'
import { createClient } from '@/lib/supabase/server'

import FdFilters from './filters'
import FdTable, { type FdListItem } from './fd-table'

const PAGE_SIZE = 20

type SearchParams = {
  busca?: string
  obra?: string
  status?: string
  periodo?: string
  page?: string
}

function computePeriodoCutoff(periodo: string): string | null {
  if (periodo === '30d') {
    const d = new Date()
    d.setDate(d.getDate() - 30)
    return d.toISOString().slice(0, 10)
  }
  if (periodo === '90d') {
    const d = new Date()
    d.setDate(d.getDate() - 90)
    return d.toISOString().slice(0, 10)
  }
  if (periodo === 'ano') {
    return `${new Date().getFullYear()}-01-01`
  }
  return null
}

export default async function FdPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const profile = await getCurrentProfile()
  const canCreate =
    profile?.perfil === 'admin' || profile?.perfil === 'financeiro'

  const page = Math.max(1, Number.parseInt(searchParams.page ?? '1', 10) || 1)
  const busca = searchParams.busca?.trim() ?? ''
  const obraFilter = searchParams.obra ?? ''
  const statusFilter = searchParams.status ?? ''
  const periodoFilter = searchParams.periodo ?? ''

  const supabase = createClient()

  const { data: obras } = await supabase
    .from('obras')
    .select('id, codigo_obra, nome')
    .order('codigo_obra', { ascending: false })

  const obraOptions = (obras ?? []).map((o) => ({
    value: o.id,
    label: `${o.codigo_obra} — ${o.nome}`,
  }))

  let query = supabase
    .from('fd')
    .select(
      'id, data_lancamento, data_vencimento, data_pagamento, pedido_documento, fornecedor, valor, diferenca_favor, obra:obras(codigo_obra, nome)',
      { count: 'exact' },
    )
    .order('data_lancamento', { ascending: false })

  if (busca) {
    query = query.or(
      `pedido_documento.ilike.%${busca}%,fornecedor.ilike.%${busca}%,codigo.ilike.%${busca}%,especificacao.ilike.%${busca}%`,
    )
  }

  if (obraFilter) {
    query = query.eq('obra_id', obraFilter)
  }

  // Status pgto é derivado em runtime mas pode ser traduzido em SQL:
  const hoje = new Date().toISOString().slice(0, 10)
  if (statusFilter === 'pago') {
    query = query.not('data_pagamento', 'is', null)
  } else if (statusFilter === 'pendente') {
    query = query
      .is('data_pagamento', null)
      .or(`data_vencimento.is.null,data_vencimento.gte.${hoje}`)
  } else if (statusFilter === 'vencido') {
    query = query.is('data_pagamento', null).lt('data_vencimento', hoje)
  }

  const cutoff = computePeriodoCutoff(periodoFilter)
  if (cutoff) {
    query = query.gte('data_lancamento', cutoff)
  }

  const from = (page - 1) * PAGE_SIZE
  const to = from + PAGE_SIZE - 1

  const { data, count, error } = await query.range(from, to)

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-md p-4 text-sm text-red-700">
        Erro ao carregar FDs: {error.message}
      </div>
    )
  }

  const fds = (data ?? []) as FdListItem[]
  const total = count ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const hasFilters =
    busca !== '' ||
    obraFilter !== '' ||
    statusFilter !== '' ||
    periodoFilter !== ''
  const isEmpty = fds.length === 0

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex-1 min-w-[280px]">
          <FdFilters obraOptions={obraOptions} />
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <ExportButton
            endpoint="/api/export/fd"
            searchParams={{
              busca,
              obra: obraFilter,
              status: statusFilter,
              periodo: periodoFilter,
            }}
            filename={`fd-${new Date().toISOString().slice(0, 10)}`}
          />
          {canCreate && (
            <Link
              href="/fd/novo"
              className="inline-flex items-center gap-2 bg-gray-900 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-gray-800 transition-colors whitespace-nowrap"
            >
              <Plus size={16} />
              Novo lançamento
            </Link>
          )}
        </div>
      </div>

      {isEmpty && !hasFilters ? (
        <EmptyState
          icon={HandCoins}
          title="Nenhum lançamento de FD cadastrado"
          action={canCreate ? { label: 'Novo lançamento', href: '/fd/novo' } : null}
        />
      ) : isEmpty ? (
        <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-sm text-gray-500">
          Nenhum lançamento encontrado com esses filtros.
        </div>
      ) : (
        <>
          <FdTable fds={fds} />
          <Pagination
            page={page}
            totalPages={totalPages}
            total={total}
            basePath="/fd"
            entityLabel={['lançamento', 'lançamentos']}
            extraParams={{
              busca,
              obra: obraFilter,
              status: statusFilter,
              periodo: periodoFilter,
            }}
          />
        </>
      )}
    </div>
  )
}
