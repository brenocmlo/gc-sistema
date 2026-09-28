import { Pencil } from 'lucide-react'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'

import DetailField from '@/components/DetailField'
import StatusBadge from '@/components/StatusBadge'
import Tabs from '@/components/Tabs'
import { hojeISO } from '@/lib/execucao'
import { formatCurrency, formatDate } from '@/lib/format'
import { getCurrentProfile } from '@/lib/supabase/profile'
import { createClient } from '@/lib/supabase/server'
import type { ExecucaoListItem, Obra, ObraStatus } from '@/lib/types'

import ExecucaoTab from './execucao-tab'
import RelatorioFdButton from './relatorio-fd-button'

type PageProps = {
  params: { id: string }
  searchParams?: { aba?: string }
}

/** O layout de /execucao (8.3: os links da aba Execução só aparecem para eles). */
const PERFIS_QUE_VEEM_EXECUCAO = ['admin', 'producao', 'medicao', 'visualizador']
const PERFIS_QUE_APONTAM = ['admin', 'producao', 'medicao']
/** A rota /api/relatorio/medicao (8.4). */
const PERFIS_QUE_EMITEM_MEDICAO = ['admin', 'medicao', 'financeiro']
/** Teto de linhas do PostgREST, como na /execucao. */
const LIMITE_POSTGREST = 1000

export default async function ObraDetalhePage({ params, searchParams }: PageProps) {
  const profile = await getCurrentProfile()
  if (!profile) redirect('/login')

  const supabase = createClient()

  const [{ data }, execRes] = await Promise.all([
    supabase
      .from('obras_com_valores')
      .select(
        '*, cliente:clientes(nome, contato, telefone, email, cidade, cep)',
      )
      .eq('id', params.id)
      .maybeSingle(),
    // Aba Execução (8.3): a mesma query da /execucao.
    supabase
      .from('execucao')
      .select('*, item:itens!inner(id, numero, tipo, descricao, quantidade, unidade, obra_id)')
      .eq('item.obra_id', params.id)
      .limit(LIMITE_POSTGREST),
  ])

  if (!data) notFound()

  const { cliente, ...obraRow } = data as Obra & {
    valor_total_calculado: number | null
    valor_final_calculado: number | null
    desconto_calculado: number | null
    pct_sinal_calculado: number | null
    pct_fd_calculado: number | null
    pct_entrega_material_calculado: number | null
    pct_medicao_instalacao_calculado: number | null
    fonte_valores: string | null
    cliente: {
      nome: string
      contato: string | null
      telefone: string | null
      email: string | null
      cidade: string | null
      cep: string | null
    } | null
  }
  const obra = obraRow as Obra

  const canEdit =
    profile.perfil === 'admin' || profile.perfil === 'comercial'

  const valoresCalc = data as {
    valor_total_calculado: number | null
    valor_final_calculado: number | null
    desconto_calculado: number | null
    fonte_valores: string | null
  }

  const execucoes = (execRes.data ?? []) as ExecucaoListItem[]

  const detalhes = (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div className="space-y-6">
        <Block title="Identificação">
          <DetailField label="Código" value={obra.codigo_obra} />
          <DetailField label="Nome" value={obra.nome} />
          <DetailField
            label="Status"
            value={
              <StatusBadge status={obra.status as ObraStatus} />
            }
          />
        </Block>

        <Block title="Cliente">
          <DetailField
            label="Nome"
            value={cliente?.nome ?? null}
            className="md:col-span-2"
          />
          <DetailField label="Contato" value={cliente?.contato ?? null} />
          <DetailField label="Telefone" value={cliente?.telefone ?? null} />
          <DetailField label="Email" value={cliente?.email ?? null} />
          <DetailField label="Cidade (cliente)" value={cliente?.cidade ?? null} />
        </Block>

        <Block title="Localização da obra">
          <DetailField
            label="Endereço"
            value={obra.endereco}
            className="md:col-span-2"
          />
          <DetailField label="Cidade" value={obra.cidade} />
          <DetailField label="CEP" value={obra.cep} />
        </Block>
      </div>

      <div className="space-y-6">
        <Block title="Prazos">
          <DetailField label="Prazo (texto)" value={obra.prazo_execucao} />
          <DetailField
            label="Início"
            value={obra.data_inicio ? formatDate(obra.data_inicio) : null}
          />
          <DetailField
            label="Previsto fim"
            value={
              obra.data_prevista_fim ? formatDate(obra.data_prevista_fim) : null
            }
          />
          <DetailField
            label="Real fim"
            value={obra.data_real_fim ? formatDate(obra.data_real_fim) : null}
          />
        </Block>

        <Block title="Valores (calculados das propostas/contratos)">
          <DetailField
            label="Valor total"
            value={formatCurrency(valoresCalc.valor_total_calculado)}
          />
          <DetailField
            label="Desconto"
            value={formatCurrency(valoresCalc.desconto_calculado)}
          />
          <DetailField
            label="Valor final"
            value={formatCurrency(valoresCalc.valor_final_calculado)}
            className="md:col-span-2"
          />
          <DetailField
            label="Fonte"
            value={valoresCalc.fonte_valores}
            className="md:col-span-2"
          />
        </Block>

        <Block title="Observação">
          <DetailField
            label="Observação"
            value={obra.observacao}
            className="md:col-span-2"
          />
        </Block>
      </div>
    </div>
  )

  return (
    <div className="space-y-6">
      <header className="bg-white rounded-lg border border-gray-200 p-5 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">
            {obra.codigo_obra} — {obra.nome}
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Cliente: {cliente?.nome ?? '—'}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <StatusBadge status={obra.status as ObraStatus} />
          <RelatorioFdButton obraId={obra.id} />
          {canEdit && (
            <Link
              href={`/obras/${obra.id}/editar`}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-md bg-gray-900 text-white text-sm font-medium hover:bg-gray-800"
            >
              <Pencil size={14} />
              Editar
            </Link>
          )}
        </div>
      </header>

      <Tabs
        defaultValue={searchParams?.aba === 'execucao' ? 'execucao' : 'detalhes'}
        tabs={[
          { value: 'detalhes', label: 'Detalhes', content: detalhes },
          {
            value: 'execucao',
            label: 'Execução',
            content: (
              <ExecucaoTab
                obraId={obra.id}
                execucoes={execucoes}
                hoje={hojeISO()}
                podeAbrirExecucao={PERFIS_QUE_VEEM_EXECUCAO.includes(profile.perfil)}
                podeApontar={PERFIS_QUE_APONTAM.includes(profile.perfil)}
                podeEmitirMedicao={PERFIS_QUE_EMITEM_MEDICAO.includes(profile.perfil)}
              />
            ),
          },
        ]}
      />
    </div>
  )
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-5 space-y-4">
      <h2 className="text-sm font-semibold text-gray-900 pb-2 border-b border-gray-200">
        {title}
      </h2>
      <dl className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-4">
        {children}
      </dl>
    </div>
  )
}
