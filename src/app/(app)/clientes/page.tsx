import { Plus, Users } from 'lucide-react'
import Link from 'next/link'
import { redirect } from 'next/navigation'

import EmptyState from '@/components/EmptyState'
import Pagination from '@/components/Pagination'
import { isRangeForaDoAlcance, urlSemPagina } from '@/lib/listagem'
import { getCurrentProfile } from '@/lib/supabase/profile'
import { createClient } from '@/lib/supabase/server'

import ClientesFilters from './filters'
import ClientesTable from './clientes-table'

const PAGE_SIZE = 20

type SearchParams = {
  busca?: string
  page?: string
}

export default async function ClientesPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const profile = await getCurrentProfile()
  const canCreate =
    profile?.perfil === 'admin' || profile?.perfil === 'comercial'

  const page = Math.max(1, Number.parseInt(searchParams.page ?? '1', 10) || 1)
  const busca = searchParams.busca?.trim() ?? ''

  const supabase = createClient()

  let query = supabase
    .from('clientes')
    .select('id, nome, cnpj_cpf, contato, telefone, cidade', {
      count: 'exact',
    })
    .order('nome')

  if (busca) {
    query = query.or(
      `nome.ilike.%${busca}%,cnpj_cpf.ilike.%${busca}%,contato.ilike.%${busca}%,email.ilike.%${busca}%`,
    )
  }

  const from = (page - 1) * PAGE_SIZE
  const to = from + PAGE_SIZE - 1

  const { data, count, error } = await query.range(from, to)

  if (error) {
    // Página além do último registro: o PostgREST devolve 416 sem `count`, e a
    // tela mostraria erro de banco pra quem só abriu um link velho.
    if (isRangeForaDoAlcance(error) && page > 1) {
      redirect(urlSemPagina('/clientes', { ...searchParams, page: undefined }))
    }

    return (
      <div className="bg-red-50 border border-red-200 rounded-md p-4 text-sm text-red-700">
        Erro ao carregar clientes: {error.message}
      </div>
    )
  }

  const clientes = data ?? []
  const total = count ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const hasFilters = busca !== ''
  const isEmpty = clientes.length === 0

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex-1 min-w-[280px]">
          <ClientesFilters />
        </div>
        {canCreate && (
          <Link
            href="/clientes/novo"
            className="inline-flex items-center gap-2 bg-gray-900 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-gray-800 transition-colors whitespace-nowrap"
          >
            <Plus size={16} />
            Novo cliente
          </Link>
        )}
      </div>

      {isEmpty && !hasFilters ? (
        <EmptyState
          icon={Users}
          title="Nenhum cliente cadastrado ainda"
          action={
            canCreate
              ? { label: 'Novo cliente', href: '/clientes/novo' }
              : null
          }
        />
      ) : isEmpty ? (
        <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-sm text-gray-500">
          Nenhum cliente encontrado com esses filtros.
        </div>
      ) : (
        <>
          <ClientesTable clientes={clientes} />
          <Pagination
            page={page}
            totalPages={totalPages}
            total={total}
            basePath="/clientes"
            entityLabel={['cliente', 'clientes']}
            extraParams={{ busca }}
          />
        </>
      )}
    </div>
  )
}
