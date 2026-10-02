import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import type { ReactNode } from 'react'

import AnexosTab from '@/components/AnexosTab'
import DetailField from '@/components/DetailField'
import Tabs from '@/components/Tabs'
import {
  avisoDoCancelamento,
  linhaDaParcela,
  MOTIVO_ACORDO_LABELS,
  motivoParaNaoCancelarAcordo,
  motivoParaNaoConverter,
  motivoParaNaoMexerNoAcordo,
  motivoParaNaoQuitar,
  planoDoCancelamento,
  resumoDasParcelas,
  resumoFinanceiroDoAcordo,
  tipoNfDoMotivo,
} from '@/lib/acordos'
import { hojeISO } from '@/lib/execucao'
import { formatCurrency, formatDate } from '@/lib/format'
import { numeroComSerie } from '@/lib/notas-fiscais'
import { getCurrentProfile } from '@/lib/supabase/profile'
import { createClient } from '@/lib/supabase/server'
import type { AcordoPagamento, AcordoParcela, Anexo } from '@/lib/types'

import { getAnexoUrl } from '../../../propostas/[id]/actions'
import { StatusAcordoBadge } from '../status-badge'
import { deleteAnexoAcordo, uploadAnexoAcordo } from './actions'
import ConverterDialog from './converter-dialog'
import EncerrarAcordo from './encerrar-acordo'
import ParcelasTab, { type LinhaParcela } from './parcelas-tab'

type PageProps = { params: { id: string } }

type Join = {
  obra: { codigo_obra: string; nome: string; cliente: { nome: string } | null } | null
  contrato: { id: string; numero: string } | null
  proposta: { id: string; numero: string } | null
  nf: { id: string; numero: string; serie: string | null } | null
  parcelas: (Pick<AcordoParcela, 'id' | 'numero_parcela' | 'data_vencimento' | 'valor_previsto' | 'status' | 'observacao'> & {
    pagamentos: { valor: number }[] | null
  })[] | null
}

export default async function AcordoDetalhePage({ params }: PageProps) {
  const profile = await getCurrentProfile()
  if (!profile) redirect('/login')

  const supabase = createClient()
  const { data } = await supabase
    .from('acordos_pagamento')
    .select(
      '*, obra:obras(codigo_obra, nome, cliente:clientes(nome)), contrato:contratos(id, numero), proposta:propostas(id, numero), nf:notas_fiscais!acordo_nf_convertida_fk(id, numero, serie), parcelas:acordo_parcelas(id, numero_parcela, data_vencimento, valor_previsto, status, observacao, pagamentos(valor))',
    )
    .eq('id', params.id)
    .maybeSingle()

  if (!data) notFound()

  const { obra, contrato, proposta, nf, parcelas, ...row } = data as AcordoPagamento & Join
  const acordo = row as AcordoPagamento
  // Um "hoje" só para a requisição: o selo de atrasada.
  const hoje = hojeISO()
  const lista = [...(parcelas ?? [])].sort((a, b) => a.numero_parcela - b.numero_parcela)
  const resumo = resumoFinanceiroDoAcordo(lista)
  const atrasadas = acordo.status === 'aberto' ? resumoDasParcelas(lista, hoje).atrasadas : 0
  const linhas: LinhaParcela[] = lista.map((p) => ({
    id: p.id,
    numero: p.numero_parcela,
    data_vencimento: p.data_vencimento,
    valor_previsto: Number(p.valor_previsto),
    observacao: p.observacao,
    status: p.status,
    qtdPagamentos: (p.pagamentos ?? []).length,
    ...linhaDaParcela(p, hoje),
  }))
  const anexos = (acordo.anexos as Anexo[] | null) ?? []
  const escreve = profile.perfil === 'admin' || profile.perfil === 'financeiro'
  const qtdPagamentos = lista.reduce((acc, p) => acc + (p.pagamentos ?? []).length, 0)
  const planoCancelar = planoDoCancelamento(lista.map((p) => ({ ...p, pago: linhaDaParcela(p, hoje).pago })))
  const podeConverter = motivoParaNaoConverter(profile.perfil, acordo.status, resumo.saldo) === null
  const pendentes = lista.filter((p) => p.status === 'pendente')

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-lg border border-gray-200 p-5 space-y-4">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-xl font-semibold text-gray-900">{acordo.descricao}</h1>
            <p className="text-sm text-gray-500 mt-1">{obra ? `${obra.codigo_obra} — ${obra.nome}` : '—'}</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <StatusAcordoBadge status={acordo.status} />
            {escreve && acordo.status === 'aberto' && (
              <EncerrarAcordo
                acordoId={acordo.id}
                bloqueioQuitar={motivoParaNaoQuitar(profile.perfil, acordo.status, lista)}
                bloqueioCancelar={motivoParaNaoCancelarAcordo(profile.perfil, acordo.status)}
                avisoCancelar={avisoDoCancelamento(planoCancelar)}
                cancelaPeloRecebido={planoCancelar.recebido > 0}
                pendentes={{ quantidade: pendentes.length, valor: pendentes.reduce((a, p) => a + Number(p.valor_previsto), 0) }}
                recebido={resumo.recebido}
              />
            )}
            {podeConverter && (
              <ConverterDialog
                acordoId={acordo.id}
                saldo={resumo.saldo}
                recebido={resumo.recebido}
                qtdPagamentos={qtdPagamentos}
                tipoSugerido={tipoNfDoMotivo(acordo.motivo)}
                hoje={hoje}
              />
            )}
            {atrasadas > 0 && (
              <span className="text-xs font-medium text-red-700">{`${atrasadas} ${atrasadas === 1 ? 'parcela atrasada' : 'parcelas atrasadas'}`}</span>
            )}
          </div>
        </div>
        {acordo.status === 'convertido_nf' && (
          <div className="rounded-md border border-purple-200 bg-purple-50 px-3 py-2 text-sm text-purple-900">
            {nf ? (
              <>
                {'Convertido na '}
                <Link href={`/financeiro/notas-fiscais/${nf.id}`} className="font-medium underline-offset-2 hover:underline">
                  {`NF ${numeroComSerie(nf.numero, nf.serie)}`}
                </Link>
                {acordo.data_encerramento ? ` em ${formatDate(acordo.data_encerramento)}` : ''}
                {'. '}
              </>
            ) : (
              'Convertido em nota fiscal. '
            )}
            {qtdPagamentos > 0
              ? `Os pagamentos lançados antes (${formatCurrency(resumo.recebido)}) estão arquivados: não contam no recebido da obra.`
              : 'Não havia pagamento lançado.'}
          </div>
        )}
        <dl className="grid grid-cols-2 sm:grid-cols-3 gap-4" aria-label="Valores do acordo">
          <div>
            <dt className="text-xs text-gray-500">Valor total</dt>
            <dd className="text-lg font-semibold text-gray-900 tabular-nums">{formatCurrency(resumo.total)}</dd>
          </div>
          <div>
            <dt className="text-xs text-gray-500">Recebido</dt>
            <dd className="text-lg font-semibold text-gray-900 tabular-nums">{formatCurrency(resumo.recebido)}</dd>
          </div>
          <div>
            <dt className="text-xs text-gray-500">Saldo</dt>
            <dd className="text-lg font-semibold text-gray-900 tabular-nums">
              {acordo.status === 'cancelado' || acordo.status === 'convertido_nf' ? '—' : formatCurrency(resumo.saldo)}
            </dd>
          </div>
        </dl>
      </div>

      <Tabs
        tabs={[
          {
            value: 'parcelas',
            label: `Parcelas (${linhas.length})`,
            content: (
              <ParcelasTab
                acordoId={acordo.id}
                parcelas={linhas}
                bloqueio={motivoParaNaoMexerNoAcordo(profile.perfil, acordo.status)}
                podeRegistrar={escreve && acordo.status === 'aberto'}
              />
            ),
          },
          {
            value: 'detalhes',
            label: 'Detalhes',
            content: <DetailsTab acordo={acordo} obra={obra} contrato={contrato} proposta={proposta} />,
          },
          {
            value: 'anexos',
            label: `Anexos${anexos.length > 0 ? ` (${anexos.length})` : ''}`,
            content: (
              <AnexosTab
                anexos={anexos}
                perfil={profile.perfil}
                userId={profile.id}
                doPai="do acordo"
                upload={uploadAnexoAcordo.bind(null, acordo.id)}
                remove={deleteAnexoAcordo.bind(null, acordo.id)}
                abrir={getAnexoUrl}
                podeGerenciar={escreve}
              />
            ),
          },
        ]}
      />
    </div>
  )
}

function DetailsTab({
  acordo,
  obra,
  contrato,
  proposta,
}: {
  acordo: AcordoPagamento
  obra: Join['obra']
  contrato: Join['contrato']
  proposta: Join['proposta']
}) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <Block title="Acordo">
        <DetailField label="Descrição" value={acordo.descricao} className="md:col-span-2" />
        <DetailField label="Motivo" value={acordo.motivo ? MOTIVO_ACORDO_LABELS[acordo.motivo] : null} />
        <DetailField label="Período de referência" value={acordo.periodo_ref} />
        <DetailField label="Abertura" value={formatDate(acordo.data_abertura)} />
        <DetailField label="Encerramento" value={acordo.data_encerramento ? formatDate(acordo.data_encerramento) : null} />
      </Block>
      <Block title="Obra e vínculo">
        <DetailField label="Obra" value={obra ? `${obra.codigo_obra} — ${obra.nome}` : null} className="md:col-span-2" />
        <DetailField label="Cliente" value={obra?.cliente?.nome ?? null} className="md:col-span-2" />
        <DetailField
          label="Vínculo"
          className="md:col-span-2"
          value={
            contrato ? (
              <Link href={`/contratos/${contrato.id}`} className="text-blue-700 hover:underline">{`Contrato ${contrato.numero}`}</Link>
            ) : proposta ? (
              <Link href={`/propostas/${proposta.id}`} className="text-blue-700 hover:underline">{`Proposta ${proposta.numero}`}</Link>
            ) : (
              'Sem vínculo'
            )
          }
        />
        <DetailField label="Observações" value={acordo.observacao} className="md:col-span-2" />
      </Block>
    </div>
  )
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-5 space-y-4">
      <h2 className="text-sm font-semibold text-gray-900 pb-2 border-b border-gray-200">{title}</h2>
      <dl className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-4">{children}</dl>
    </div>
  )
}
