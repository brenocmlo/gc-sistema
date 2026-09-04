import { FileText, Plus } from 'lucide-react'
import Link from 'next/link'

import EmptyState from '@/components/EmptyState'
import ExportButton from '@/components/ExportButton'
import Pagination from '@/components/Pagination'
import { computePeriodoCutoff } from '@/lib/listagem'
import { getCurrentProfile } from '@/lib/supabase/profile'
import { createClient } from '@/lib/supabase/server'
import type { OrcamentoListItem, OrcamentoStatus } from '@/lib/types'

import OrcamentosFilters from './filters'
import OrcamentosTable from './orcamentos-table'

const PAGE_SIZE = 20

const VALID_STATUS: readonly OrcamentoStatus[] = [
  'pendente',
  'analise',
  'enviado',
  'aprovado',
  'rejeitado',
  'expirado',
]

function isValidStatus(v: string): v is OrcamentoStatus {
  return (VALID_STATUS as readonly string[]).includes(v)
}

type SearchParams = {
  busca?: string
  status?: string
  periodo?: string
  page?: string
}

export default async function OrcamentosPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const profile = await getCurrentProfile()
  const canCreate =
    profile?.perfil === 'admin' || profile?.perfil === 'comercial'

  const page = Math.max(1, Number.parseInt(searchParams.page ?? '1', 10) || 1)
  const busca = searchParams.busca?.trim() ?? ''
  const statusFilter = searchParams.status ?? ''
  const periodoFilter = searchParams.periodo ?? ''

  const supabase = createClient()

  let query = supabase
    .from('orcamentos')
    .select(
      'id, numero, data_solicitacao, cliente_id, status, valor_estimado, responsavel, cliente:clientes(nome, cidade)',
      { count: 'exact' },
    )
    .order('data_solicitacao', { ascending: false })

  if (busca) {
    // Cliente virou FK, então busca cross-table exige resolver IDs antes.
    const { data: clientesMatch } = await supabase
      .from('clientes')
      .select('id')
      .or(
        `nome.ilike.%${busca}%,contato.ilike.%${busca}%,email.ilike.%${busca}%`,
      )

    const clienteIds = (clientesMatch ?? []).map((c) => c.id)
    const clienteFilter =
      clienteIds.length > 0 ? `cliente_id.in.(${clienteIds.join(',')})` : null

    const filters = [`numero.ilike.%${busca}%`, clienteFilter].filter(Boolean)
    query = query.or(filters.join(','))
  }

  if (statusFilter && isValidStatus(statusFilter)) {
    query = query.eq('status', statusFilter)
  }

  const cutoff = computePeriodoCutoff(periodoFilter)
  if (cutoff) {
    query = query.gte('data_solicitacao', cutoff)
  }

  const from = (page - 1) * PAGE_SIZE
  const to = from + PAGE_SIZE - 1

  const { data, count, error } = await query.range(from, to)

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-md p-4 text-sm text-red-700">
        Erro ao carregar orçamentos: {error.message}
      </div>
    )
  }

  // Cast: status vem como `string` do gen, mas o banco garante OrcamentoStatus.
  const orcamentos = (data ?? []) as OrcamentoListItem[]
  const total = count ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const hasFilters =
    busca !== '' || statusFilter !== '' || periodoFilter !== ''
  const isEmpty = orcamentos.length === 0

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex-1 min-w-[280px]">
          <OrcamentosFilters />
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <ExportButton
            endpoint="/api/export/orcamentos"
            searchParams={{
              busca,
              status: statusFilter,
              periodo: periodoFilter,
            }}
            filename={`orcamentos-${new Date().toISOString().slice(0, 10)}`}
          />
          {canCreate && (
            <Link
              href="/orcamentos/novo"
              className="inline-flex items-center gap-2 bg-gray-900 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-gray-800 transition-colors whitespace-nowrap"
            >
              <Plus size={16} />
              Novo orçamento
            </Link>
          )}
        </div>
      </div>

      {isEmpty && !hasFilters ? (
        <EmptyState
          icon={FileText}
          title="Nenhum orçamento cadastrado ainda"
          action={
            canCreate
              ? { label: 'Novo orçamento', href: '/orcamentos/novo' }
              : null
          }
        />
      ) : isEmpty ? (
        <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-sm text-gray-500">
          Nenhum orçamento encontrado com esses filtros.
        </div>
      ) : (
        <>
          <OrcamentosTable orcamentos={orcamentos} />
          <Pagination
            page={page}
            totalPages={totalPages}
            total={total}
            basePath="/orcamentos"
            entityLabel={['orçamento', 'orçamentos']}
            extraParams={{
              busca,
              status: statusFilter,
              periodo: periodoFilter,
            }}
          />
        </>
      )}
    </div>
  )
}
