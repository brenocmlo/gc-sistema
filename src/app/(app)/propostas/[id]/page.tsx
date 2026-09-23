import { notFound, redirect } from 'next/navigation'
import type { ReactNode } from 'react'

import DetailField from '@/components/DetailField'
import HistoricoTab from '@/components/HistoricoTab'
import Tabs from '@/components/Tabs'
import { formatCurrency, formatDate } from '@/lib/format'
import {
  formatPct,
  historicoOrdenado,
  isEditavel,
  isPropostaVencida,
  parcelasDaProposta,
  pctRestante,
} from '@/lib/propostas'
import { getCurrentProfile } from '@/lib/supabase/profile'
import { createClient } from '@/lib/supabase/server'
import {
  MOTIVO_REJEICAO_LABELS,
  type Anexo,
  type Item,
  type Proposta,
  type PropostaFinanceiro,
} from '@/lib/types'

import AnexosTab from '@/components/AnexosTab'

import { deleteAnexo, getAnexoUrl, uploadAnexo } from './actions'
import DetailHeader from './detail-header'
import ItensTab from '@/components/itens/itens-tab'

type PageProps = {
  params: { id: string }
}

type ObraJoin = {
  codigo_obra: string
  nome: string
  cidade: string | null
  cliente: { nome: string; contato: string | null; telefone: string | null } | null
} | null

export default async function PropostaDetalhePage({ params }: PageProps) {
  const profile = await getCurrentProfile()
  if (!profile) redirect('/login')

  const supabase = createClient()

  // A proposta (com obra → cliente) e a linha financeira em paralelo. A view
  // propostas_financeiro é security_invoker, então respeita a mesma RLS.
  const [propostaRes, financeiroRes, itensRes] = await Promise.all([
    supabase
      .from('propostas')
      .select(
        '*, obra:obras(codigo_obra, nome, cidade, cliente:clientes(nome, contato, telefone))',
      )
      .eq('id', params.id)
      .maybeSingle(),
    supabase
      .from('propostas_financeiro')
      .select('total_nfs, recebido_nfs, total_acordos, recebido_acordos')
      .eq('id', params.id)
      .maybeSingle(),
    // Itens da proposta, na ordem em que aparecem no documento. `numero` é
    // nullable (item cuja numeração original não era inteira), e nulls last
    // deixa esses no fim em vez de no topo.
    supabase
      .from('itens')
      .select(
        'id, empresa_id, obra_id, proposta_id, contrato_id, numero, tipo, descricao, linha, acabamento, largura, altura, quantidade, unidade, valor_unit, valor_total, area_m2, vidros, localizacao, observacao, foto_url, created_at, updated_at, created_by',
      )
      .eq('proposta_id', params.id)
      .order('numero', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: true }),
  ])

  if (!propostaRes.data) notFound()

  // Separa a obra aninhada pra ter narrowing limpo no tipo Proposta.
  const { obra, ...propostaRow } = propostaRes.data as Proposta & {
    obra: ObraJoin
  }
  const proposta = propostaRow as Proposta

  const financeiro = financeiroRes.data as Pick<
    PropostaFinanceiro,
    'total_nfs' | 'recebido_nfs' | 'total_acordos' | 'recebido_acordos'
  > | null

  const itens = (itensRes.data ?? []) as Item[]


  const anexos = (proposta.anexos as Anexo[] | null) ?? []
  const obraLabel = obra ? `${obra.codigo_obra} — ${obra.nome}` : '—'

  // Histórico de transições (jsonb append-only, bloco 4.6). Os autores viram
  // nome numa consulta só — sem isso a aba mostraria uuid.
  const historico = historicoOrdenado(proposta.historico)
  const autoresIds = Array.from(
    new Set(historico.map((h) => h.por).filter(Boolean)),
  )

  const { data: perfis } = autoresIds.length
    ? await supabase.from('profiles').select('id, nome').in('id', autoresIds)
    : { data: [] }

  const autores = new Map((perfis ?? []).map((p) => [p.id, p.nome]))

  return (
    <div className="space-y-6">
      <DetailHeader
        id={proposta.id}
        numero={proposta.numero}
        obraLabel={obraLabel}
        clienteNome={obra?.cliente?.nome ?? '—'}
        status={proposta.status}
        vencida={isPropostaVencida(proposta)}
        perfil={profile.perfil}
        totalItens={itens.length}
      />

      <Tabs
        tabs={[
          {
            value: 'detalhes',
            label: 'Detalhes',
            content: (
              <DetailsTab proposta={proposta} obra={obra} qtdItens={itens.length} />
            ),
          },
          {
            value: 'pagamento',
            label: 'Pagamento',
            content: <PagamentoTab proposta={proposta} />,
          },
          {
            value: 'itens',
            label: `Itens${itens.length > 0 ? ` (${itens.length})` : ''}`,
            content: (
              <ItensTab
                pai={{ tipo: 'proposta', id: proposta.id }}
                itens={itens}
                valorTotalPai={proposta.valor_total}
                descontoPai={proposta.desconto}
                perfil={profile.perfil}
                editavel={isEditavel(proposta.status)}
              />
            ),
          },
          {
            value: 'anexos',
            label: `Anexos${anexos.length > 0 ? ` (${anexos.length})` : ''}`,
            content: (
              <AnexosTab
                anexos={anexos}
                perfil={profile.perfil}
                userId={profile.id}
                doPai="da proposta"
                upload={uploadAnexo.bind(null, proposta.id)}
                remove={deleteAnexo.bind(null, proposta.id)}
                abrir={getAnexoUrl}
              />
            ),
          },
          {
            value: 'historico',
            label: `Histórico${historico.length > 0 ? ` (${historico.length})` : ''}`,
            content: (
              <HistoricoTab
                entradas={historico}
                autores={autores}
                entidade="proposta"
              />
            ),
          },
          {
            value: 'financeiro',
            label: 'Financeiro',
            content: (
              <FinanceiroTab proposta={proposta} financeiro={financeiro} />
            ),
          },
        ]}
      />
    </div>
  )
}

function DetailsTab({
  proposta,
  obra,
  qtdItens,
}: {
  proposta: Proposta
  obra: ObraJoin
  qtdItens: number
}) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div className="space-y-6">
        <Block title="Identificação">
          <DetailField label="Número" value={proposta.numero} />
          <DetailField
            label="Emissão"
            value={formatDate(proposta.data_emissao)}
          />
          <DetailField
            label="Validade"
            value={
              proposta.data_validade ? formatDate(proposta.data_validade) : null
            }
          />
        </Block>

        <Block title="Obra e cliente">
          <DetailField
            label="Obra"
            value={obra ? `${obra.codigo_obra} — ${obra.nome}` : null}
            className="md:col-span-2"
          />
          <DetailField label="Cidade" value={obra?.cidade ?? null} />
          <DetailField label="Cliente" value={obra?.cliente?.nome ?? null} />
          <DetailField label="Contato" value={obra?.cliente?.contato ?? null} />
          <DetailField
            label="Telefone"
            value={obra?.cliente?.telefone ?? null}
          />
        </Block>

        <Block title="Escopo">
          <DetailField
            label="Descrição"
            value={proposta.descricao}
            className="md:col-span-2"
          />
        </Block>
      </div>

      <div className="space-y-6">
        <Block title="Valores">
          <DetailField
            label={
              qtdItens > 0
                ? `Valor total (soma de ${qtdItens} ${qtdItens === 1 ? 'item' : 'itens'})`
                : 'Valor total'
            }
            value={formatCurrency(proposta.valor_total)}
          />
          <DetailField
            label="Desconto"
            value={formatCurrency(proposta.desconto)}
          />
          <DetailField
            label="Valor final"
            value={formatCurrency(proposta.valor_final)}
            className="md:col-span-2"
          />
        </Block>

        <Block title="Datas">
          <DetailField
            label="Envio"
            value={proposta.data_envio ? formatDate(proposta.data_envio) : null}
          />
          <DetailField
            label="Decisão"
            value={
              proposta.data_decisao ? formatDate(proposta.data_decisao) : null
            }
          />
          <DetailField
            label="Criada em"
            value={proposta.created_at ? formatDate(proposta.created_at) : null}
          />
          <DetailField
            label="Atualizada em"
            value={proposta.updated_at ? formatDate(proposta.updated_at) : null}
          />
        </Block>

        <Block title="Observações">
          <DetailField
            label="Observações"
            value={proposta.observacao}
            className="md:col-span-2"
          />
          <DetailField
            label="Motivo da rejeição"
            value={motivoRejeicaoLabel(proposta.motivo_rejeicao)}
          />
          <DetailField
            label="Detalhes da rejeição"
            value={proposta.detalhe_rejeicao}
            className="md:col-span-2"
          />
        </Block>
      </div>
    </div>
  )
}

function PagamentoTab({ proposta }: { proposta: Proposta }) {
  // Rateio em reais sobre o valor final, com o que sobrou dos percentuais.
  const { parcelas, restante, valorRestante } = parcelasDaProposta(proposta)
  const semParcelas = parcelas.length === 0

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="px-4 py-3 text-left font-medium text-gray-700">
                Parcela
              </th>
              <th className="px-4 py-3 text-left font-medium text-gray-700">
                Percentual
              </th>
              <th className="px-4 py-3 text-left font-medium text-gray-700">
                Valor
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {semParcelas ? (
              <tr>
                <td
                  colSpan={3}
                  className="px-4 py-6 text-center text-sm text-gray-500"
                >
                  Nenhum percentual informado. As condições estão só no campo
                  livre abaixo.
                </td>
              </tr>
            ) : (
              parcelas.map((p) => (
                <tr key={p.field}>
                  <td className="px-4 py-3 text-gray-900">{p.label}</td>
                  <td className="px-4 py-3 text-gray-900 tabular-nums">
                    {formatPct(p.fracao)}
                  </td>
                  <td className="px-4 py-3 text-gray-900 tabular-nums">
                    {formatCurrency(p.valor)}
                  </td>
                </tr>
              ))
            )}
            {restante > 0 && (
              <tr className="bg-amber-50">
                <td className="px-4 py-3 text-amber-800">
                  Em aberto (ver condições livres)
                </td>
                <td className="px-4 py-3 text-amber-800 tabular-nums">
                  {formatPct(restante)}
                </td>
                <td className="px-4 py-3 text-amber-800 tabular-nums">
                  {formatCurrency(valorRestante)}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Block title="Condições livres">
        <DetailField
          label="Condições de pagamento"
          value={proposta.condicoes_pagamento}
          className="md:col-span-2"
        />
        <DetailField
          label="Percentual não alocado"
          value={formatPct(pctRestante(proposta))}
        />
      </Block>
    </div>
  )
}

function FinanceiroTab({
  proposta,
  financeiro,
}: {
  proposta: Proposta
  financeiro: Pick<
    PropostaFinanceiro,
    'total_nfs' | 'recebido_nfs' | 'total_acordos' | 'recebido_acordos'
  > | null
}) {
  if (!financeiro) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-sm text-gray-500">
        Sem dados financeiros para esta proposta.
      </div>
    )
  }

  const recebido = (financeiro.recebido_nfs ?? 0) + (financeiro.recebido_acordos ?? 0)
  const aReceber = (proposta.valor_final ?? 0) - recebido

  return (
    <div className="space-y-6">
      <Block title="Notas fiscais e acordos">
        <DetailField
          label="Total em NFs"
          value={formatCurrency(financeiro.total_nfs)}
        />
        <DetailField
          label="Recebido em NFs"
          value={formatCurrency(financeiro.recebido_nfs)}
        />
        <DetailField
          label="Total em acordos"
          value={formatCurrency(financeiro.total_acordos)}
        />
        <DetailField
          label="Recebido em acordos"
          value={formatCurrency(financeiro.recebido_acordos)}
        />
      </Block>

      <Block title="Posição">
        <DetailField
          label="Valor final da proposta"
          value={formatCurrency(proposta.valor_final)}
        />
        <DetailField label="Recebido" value={formatCurrency(recebido)} />
        <DetailField
          label="A receber"
          value={formatCurrency(aReceber)}
          className="md:col-span-2"
        />
      </Block>

      <p className="text-xs text-gray-500">
        Os números vêm da view <code>propostas_financeiro</code>, somando notas
        fiscais não canceladas e acordos ativos. Enquanto as telas de financeiro
        não existirem, tudo aqui costuma ficar zerado.
      </p>
    </div>
  )
}

function Block({ title, children }: { title: string; children: ReactNode }) {
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

/** Slug do motivo → label amigável, com fallback pro slug cru. */
function motivoRejeicaoLabel(raw: string | null): string | null {
  if (!raw) return null
  const label = (MOTIVO_REJEICAO_LABELS as Record<string, string>)[raw]
  return label ?? raw
}
