import { Building2, Plus } from 'lucide-react'
import Link from 'next/link'
import { redirect } from 'next/navigation'

import EmptyState from '@/components/EmptyState'
import ExportButton from '@/components/ExportButton'
import Pagination from '@/components/Pagination'
import { getCurrentProfile } from '@/lib/supabase/profile'
import { isRangeForaDoAlcance, urlSemPagina } from '@/lib/listagem'
import { createClient } from '@/lib/supabase/server'
import type { ObraListItem, ObraStatus } from '@/lib/types'

import ObrasFilters from './filters'
import ObrasTable from './obras-table'

const PAGE_SIZE = 20

const VALID_STATUS: readonly ObraStatus[] = [
  'ativa',
  'concluida',
  'suspensa',
  'cancelada',
]

function isValidStatus(v: string): v is ObraStatus {
  return (VALID_STATUS as readonly string[]).includes(v)
}

type SearchParams = {
  q?: string
  status?: string
  page?: string
}

export default async function ObrasPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const profile = await getCurrentProfile()
  const canCreate =
    profile?.perfil === 'admin' || profile?.perfil === 'comercial'

  const page = Math.max(1, Number.parseInt(searchParams.page ?? '1', 10) || 1)
  const q = searchParams.q?.trim() ?? ''
  const statusFilter = searchParams.status ?? ''

  const supabase = createClient()

  let query = supabase
    .from('obras_com_valores')
    .select(
      'id, empresa_id, codigo_obra, nome, cliente_id, cidade, status, valor_final_calculado, data_inicio, data_prevista_fim, data_real_fim, created_at, updated_at, desconto_calculado, valor_total_calculado, pct_sinal_calculado, pct_fd_calculado, pct_entrega_material_calculado, pct_medicao_instalacao_calculado, progresso_itens_pct, cliente:clientes(nome)',
      { count: 'exact' },
    )
    .order('created_at', { ascending: false })

  if (q) {
    // Mesmo padrão de orcamentos/page.tsx: pre-query em clientes pra resolver IDs.
    const { data: clientesMatch } = await supabase
      .from('clientes')
      .select('id')
      .ilike('nome', `%${q}%`)

    const clienteIds = (clientesMatch ?? []).map((c) => c.id)
    const clienteFilter =
      clienteIds.length > 0 ? `cliente_id.in.(${clienteIds.join(',')})` : null

    const filters = [
      `nome.ilike.%${q}%`,
      `codigo_obra.ilike.%${q}%`,
      clienteFilter,
    ].filter(Boolean)
    query = query.or(filters.join(','))
  }

  if (statusFilter && isValidStatus(statusFilter)) {
    query = query.eq('status', statusFilter)
  }

  const from = (page - 1) * PAGE_SIZE
  const to = from + PAGE_SIZE - 1

  const { data, count, error } = await query.range(from, to)

  if (error) {
    // Página além do último registro: o PostgREST devolve 416 sem `count`, e a
    // tela mostraria erro de banco pra quem só abriu um link velho.
    if (isRangeForaDoAlcance(error) && page > 1) {
      redirect(urlSemPagina('/obras', { ...searchParams, page: undefined }))
    }

    return (
      <div className="bg-red-50 border border-red-200 rounded-md p-4 text-sm text-red-700">
        Erro ao carregar obras: {error.message}
      </div>
    )
  }

  // Cast: narrowing de campos NOT NULL da tabela obras que a view marca como
  // nullable (id, empresa_id, codigo_obra, nome, status) — ver lib/types.ts.
  // Um `as` só, nunca `as unknown as`: assim o tsc ainda compara o resultado do
  // select() com o Database gerado e acusa coluna que deixou de existir.
  const obras = (data ?? []) as ObraListItem[]
  const total = count ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const hasFilters = q !== '' || statusFilter !== ''
  const isEmpty = obras.length === 0

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex-1 min-w-[280px]">
          <ObrasFilters />
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <ExportButton
            endpoint="/api/export/obras"
            searchParams={{ q, status: statusFilter }}
            filename={`obras-${new Date().toISOString().slice(0, 10)}`}
          />
          {canCreate && (
            <Link
              href="/obras/nova"
              className="inline-flex items-center gap-2 bg-gray-900 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-gray-800 transition-colors whitespace-nowrap"
            >
              <Plus size={16} />
              Nova obra
            </Link>
          )}
        </div>
      </div>

      {isEmpty && !hasFilters ? (
        <EmptyState
          icon={Building2}
          title="Nenhuma obra cadastrada ainda"
          action={canCreate ? { label: 'Nova obra', href: '/obras/nova' } : null}
        />
      ) : isEmpty ? (
        <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-sm text-gray-500">
          Nenhuma obra encontrada com esses filtros.
        </div>
      ) : (
        <>
          <ObrasTable obras={obras} />
          <Pagination
            page={page}
            totalPages={totalPages}
            total={total}
            basePath="/obras"
            entityLabel={['obra', 'obras']}
            extraParams={{ q, status: statusFilter }}
          />
        </>
      )}
    </div>
  )
}
