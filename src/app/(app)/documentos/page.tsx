import { Inbox } from 'lucide-react'
import { redirect } from 'next/navigation'

import EmptyState from '@/components/EmptyState'
import Pagination from '@/components/Pagination'
import { isDocumentoStatus, type DocumentoListItem } from '@/lib/documentos'
import { computePeriodoCutoff, isRangeForaDoAlcance, sanitizeBusca, urlSemPagina } from '@/lib/listagem'
import { getCurrentProfile } from '@/lib/supabase/profile'
import { createClient } from '@/lib/supabase/server'

import DocumentosFilters from './filters'
import DocumentosTable from './documentos-table'
import EnviarDocumento from './enviar-documento'

const PAGE_SIZE = 20

type SearchParams = {
  busca?: string
  status?: string
  tipo?: string
  obra?: string
  periodo?: string
  page?: string
}

// Caixa de entrada da automação (Fase 7): o que chegou pelo bot ou pela tela,
// e em que deu — proposta registrada, revisão, falta de dados.
export default async function DocumentosPage({ searchParams }: { searchParams: SearchParams }) {
  const page = Math.max(1, Number.parseInt(searchParams.page ?? '1', 10) || 1)
  const busca = sanitizeBusca(searchParams.busca ?? '')
  const statusFilter = searchParams.status ?? ''
  const tipoFilter = searchParams.tipo ?? ''
  const obraFilter = searchParams.obra ?? ''
  const periodoFilter = searchParams.periodo ?? ''

  const profile = await getCurrentProfile()
  const podeEnviar = profile?.perfil === 'admin' || profile?.perfil === 'comercial'
  const supabase = createClient()
  const { data: obras } = await supabase
    .from('obras')
    .select('id, codigo_obra, nome')
    .order('codigo_obra', { ascending: false })
  const obraOptions = (obras ?? []).map((o) => ({ value: o.id, label: `${o.codigo_obra} — ${o.nome}` }))

  let query = supabase
    .from('documentos_processamento')
    .select(
      'id, status, tipo_documento, canal, obra_id, created_at, motivo_revisao, proposta_criada_id, contrato_criado_id, dados_extraidos, obra:obras(codigo_obra, nome)',
      { count: 'exact' },
    )
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })

  // Número e valor moram dentro do dados_extraidos (JSON) com três formatos
  // diferentes ao longo do tempo; a busca fica no motivo, que é texto.
  if (busca) query = query.ilike('motivo_revisao', `%${busca}%`)
  if (statusFilter && isDocumentoStatus(statusFilter)) query = query.eq('status', statusFilter)
  if (tipoFilter === 'PROPOSTA' || tipoFilter === 'CONTRATO') query = query.eq('tipo_documento', tipoFilter)
  if (obraFilter) query = query.eq('obra_id', obraFilter)
  const cutoff = computePeriodoCutoff(periodoFilter)
  if (cutoff) query = query.gte('created_at', cutoff)

  const from = (page - 1) * PAGE_SIZE
  const { data, count, error } = await query.range(from, from + PAGE_SIZE - 1)

  if (error) {
    if (isRangeForaDoAlcance(error) && page > 1) {
      redirect(urlSemPagina('/documentos', { ...searchParams, page: undefined }))
    }
    return (
      <div className="bg-red-50 border border-red-200 rounded-md p-4 text-sm text-red-700">
        Erro ao carregar documentos: {error.message}
      </div>
    )
  }

  const documentos = (data ?? []) as DocumentoListItem[]
  const total = count ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const extraParams = { busca, status: statusFilter, tipo: tipoFilter, obra: obraFilter, periodo: periodoFilter }
  const hasFilters = Object.values(extraParams).some((v) => v !== '')

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex-1 min-w-[280px]">
          <DocumentosFilters obraOptions={obraOptions} />
        </div>
        {podeEnviar && profile && <EnviarDocumento empresaId={profile.empresa_id} obraOptions={obraOptions} />}
      </div>

      {documentos.length === 0 && !hasFilters ? (
        <EmptyState
          icon={Inbox}
          title="Nenhum documento recebido ainda"
          description="O que os contatos mandarem pelo bot do Telegram, ou o que for enviado aqui pela tela, aparece nesta lista."
        />
      ) : documentos.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-sm text-gray-500">
          Nenhum documento com esses filtros.
        </div>
      ) : (
        <>
          <DocumentosTable documentos={documentos} />
          <Pagination
            page={page}
            totalPages={totalPages}
            total={total}
            basePath="/documentos"
            entityLabel={['documento', 'documentos']}
            extraParams={extraParams}
          />
        </>
      )}
    </div>
  )
}
