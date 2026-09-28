import { ArrowLeft, ScrollText } from 'lucide-react'
import Link from 'next/link'
import { redirect } from 'next/navigation'

import { ErroExplicado, IconeNivel } from '@/components/AndamentoAutomacao'
import AutomacaoParada from '@/components/AutomacaoParada'
import EmptyState from '@/components/EmptyState'
import Pagination from '@/components/Pagination'
import { descreverErro, rotuloEtapa, type EventoAutomacao } from '@/lib/automacao'
import { formatDateTime } from '@/lib/format'
import { isRangeForaDoAlcance, urlSemPagina } from '@/lib/listagem'
import { createClient } from '@/lib/supabase/server'

const PAGE_SIZE = 20

const NIVEIS = [
  { value: '', label: 'Tudo' },
  { value: 'erro', label: 'Erros' },
  { value: 'aviso', label: 'Avisos' },
  { value: 'info', label: 'Andamento' },
] as const

type SearchParams = { nivel?: string; page?: string }

// Log da automação: cada mudança de etapa dos documentos (gravada pelo trigger
// do banco) e cada erro do n8n (gravado pelo workflow Notificar), com o erro
// traduzido para o que a pessoa precisa saber.
export default async function LogAutomacaoPage({ searchParams }: { searchParams: SearchParams }) {
  const page = Math.max(1, Number(searchParams.page) || 1)
  const nivel = NIVEIS.some((n) => n.value === searchParams.nivel) ? (searchParams.nivel ?? '') : ''

  const supabase = createClient()
  const { data: recentes } = await supabase
    .from('automacao_eventos')
    .select('id, documento_id, etapa, nivel, mensagem, detalhe, origem, criado_em')
    .order('criado_em', { ascending: false })
    .limit(50)

  let query = supabase
    .from('automacao_eventos')
    .select('id, documento_id, etapa, nivel, mensagem, detalhe, origem, criado_em', { count: 'exact' })
    .order('criado_em', { ascending: false })
    .order('id', { ascending: false })
  if (nivel) query = query.eq('nivel', nivel)

  const from = (page - 1) * PAGE_SIZE
  const { data, count, error } = await query.range(from, from + PAGE_SIZE - 1)
  if (error) {
    if (isRangeForaDoAlcance(error) && page > 1) {
      redirect(urlSemPagina('/documentos/log', { ...searchParams, page: undefined }))
    }
    return (
      <div className="bg-red-50 border border-red-200 rounded-md p-4 text-sm text-red-700">
        Erro ao carregar o log da automação: {error.message}
      </div>
    )
  }

  const eventos = (data ?? []) as EventoAutomacao[]
  const total = count ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <div className="space-y-4 max-w-5xl mx-auto">
      <Link href="/documentos" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900">
        <ArrowLeft size={14} /> Documentos
      </Link>

      <div className="flex items-center justify-between gap-4 flex-wrap">
        <h1 className="text-xl font-semibold text-gray-900">Log da automação</h1>
        <div className="flex gap-1">
          {NIVEIS.map((n) => (
            <Link
              key={n.value}
              href={n.value ? `/documentos/log?nivel=${n.value}` : '/documentos/log'}
              className={`px-3 py-1.5 rounded-md text-sm border ${
                n.value === nivel ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
              }`}
            >
              {n.label}
            </Link>
          ))}
        </div>
      </div>

      <AutomacaoParada eventos={(recentes ?? []) as EventoAutomacao[]} />

      {eventos.length === 0 ? (
        <EmptyState
          icon={ScrollText}
          title={nivel ? 'Nenhum evento com esse filtro' : 'Nenhum evento registrado ainda'}
          description="Cada documento que entra pelo bot ou pela tela deixa aqui as etapas por onde passou; os erros do n8n também aparecem aqui."
        />
      ) : (
        <>
          <ul className="bg-white rounded-lg border border-gray-200 shadow-sm divide-y divide-gray-100">
            {eventos.map((ev) => (
              <li key={ev.id} className="px-4 py-3 text-sm flex gap-3">
                <IconeNivel nivel={ev.nivel} />
                <div className="flex-1 min-w-0 space-y-1">
                  <div className="flex items-baseline justify-between gap-3 flex-wrap">
                    <span className="font-medium text-gray-900">
                      {ev.origem === 'n8n' ? 'Erro no n8n' : rotuloEtapa(ev.etapa)}
                    </span>
                    <span className="text-xs text-gray-500 tabular-nums">{formatDateTime(ev.criado_em)}</span>
                  </div>
                  <p className="text-gray-600">
                    {ev.mensagem}
                    {ev.documento_id && (
                      <>
                        {' · '}
                        <Link href={`/documentos/${ev.documento_id}`} className="underline underline-offset-2">
                          abrir o documento
                        </Link>
                      </>
                    )}
                  </p>
                  {(ev.nivel === 'erro' || ev.nivel === 'aviso') && (
                    <ErroExplicado erro={descreverErro(ev.detalhe ?? ev.mensagem)} bruto={ev.detalhe} grave={ev.nivel === 'erro'} />
                  )}
                </div>
              </li>
            ))}
          </ul>
          <Pagination
            page={page}
            totalPages={totalPages}
            total={total}
            basePath="/documentos/log"
            entityLabel={['evento', 'eventos']}
            extraParams={{ nivel }}
          />
        </>
      )}
    </div>
  )
}
