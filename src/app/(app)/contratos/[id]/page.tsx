import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import type { ReactNode } from 'react'

import AnexosTab from '@/components/AnexosTab'
import DetailField from '@/components/DetailField'
import HistoricoTab from '@/components/HistoricoTab'
import ItensTab from '@/components/itens/itens-tab'
import Tabs from '@/components/Tabs'
import { isContratoEditavel, type EntradaHistoricoContrato } from '@/lib/contratos'
import { formatCurrency, formatDate } from '@/lib/format'
import { historicoOrdenado } from '@/lib/historico'
import { formatPct, parcelasDaProposta } from '@/lib/propostas'
import { getCurrentProfile } from '@/lib/supabase/profile'
import { createClient } from '@/lib/supabase/server'
import { MOTIVO_RESCISAO_LABELS, type Anexo, type Contrato, type Item } from '@/lib/types'

// A URL assinada não depende da entidade — é a mesma action da proposta.
import { getAnexoUrl } from '../../propostas/[id]/actions'
import { deleteAnexoContrato, uploadAnexoContrato } from './actions'
import DetailHeader from './detail-header'

type PageProps = {
  params: { id: string }
}

type ObraJoin = {
  codigo_obra: string
  nome: string
  cidade: string | null
  cliente: { nome: string; contato: string | null; telefone: string | null } | null
} | null

type PropostaOrigemJoin = { id: string; numero: string } | null

export default async function ContratoDetalhePage({ params }: PageProps) {
  const profile = await getCurrentProfile()
  if (!profile) redirect('/login')

  const supabase = createClient()

  const [contratoRes, itensRes] = await Promise.all([
    // Contrato com obra → cliente e a proposta de origem (FK contratos_proposta_fk).
    supabase
      .from('contratos')
      .select(
        '*, obra:obras(codigo_obra, nome, cidade, cliente:clientes(nome, contato, telefone)), proposta_origem:propostas(id, numero)',
      )
      .eq('id', params.id)
      .maybeSingle(),
    // Itens na ordem do documento, com os sem número inteiro no fim.
    supabase
      .from('itens')
      .select(
        'id, empresa_id, obra_id, proposta_id, contrato_id, numero, tipo, descricao, linha, acabamento, largura, altura, quantidade, unidade, valor_unit, valor_total, area_m2, vidros, localizacao, observacao, foto_url, created_at, updated_at, created_by',
      )
      .eq('contrato_id', params.id)
      .order('numero', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: true }),
  ])

  if (!contratoRes.data) notFound()

  // Separa os joins pra ter narrowing limpo no tipo Contrato.
  const { obra, proposta_origem, ...contratoRow } = contratoRes.data as Contrato & {
    obra: ObraJoin
    proposta_origem: PropostaOrigemJoin
  }
  const contrato = contratoRow as Contrato

  const itens = (itensRes.data ?? []) as Item[]
  const anexos = (contrato.anexos as Anexo[] | null) ?? []
  const obraLabel = obra ? `${obra.codigo_obra} — ${obra.nome}` : '—'

  // Histórico de transições (bloco 6.5). Os autores viram nome numa consulta
  // só — sem isso a aba mostraria uuid.
  const historico = historicoOrdenado(contrato.historico) as EntradaHistoricoContrato[]
  const autoresIds = Array.from(new Set(historico.map((h) => h.por).filter(Boolean)))

  const { data: perfis } = autoresIds.length
    ? await supabase.from('profiles').select('id, nome').in('id', autoresIds)
    : { data: [] }

  const autores = new Map((perfis ?? []).map((p) => [p.id, p.nome]))

  return (
    <div className="space-y-6">
      <DetailHeader
        id={contrato.id}
        numero={contrato.numero}
        obraLabel={obraLabel}
        clienteNome={obra?.cliente?.nome ?? '—'}
        status={contrato.status}
        perfil={profile.perfil}
        propostaOrigem={proposta_origem}
      />

      <Tabs
        tabs={[
          {
            value: 'detalhes',
            label: 'Detalhes',
            content: (
              <DetailsTab
                contrato={contrato}
                obra={obra}
                propostaOrigem={proposta_origem}
                qtdItens={itens.length}
              />
            ),
          },
          {
            value: 'itens',
            label: `Itens${itens.length > 0 ? ` (${itens.length})` : ''}`,
            content: (
              <ItensTab
                pai={{ tipo: 'contrato', id: contrato.id }}
                itens={itens}
                valorTotalPai={contrato.valor_total}
                descontoPai={contrato.desconto}
                perfil={profile.perfil}
                editavel={isContratoEditavel(contrato.status)}
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
                doPai="do contrato"
                upload={uploadAnexoContrato.bind(null, contrato.id)}
                remove={deleteAnexoContrato.bind(null, contrato.id)}
                abrir={getAnexoUrl}
              />
            ),
          },
          {
            value: 'historico',
            label: `Histórico${historico.length > 0 ? ` (${historico.length})` : ''}`,
            content: (
              <HistoricoTab entradas={historico} autores={autores} entidade="contrato" />
            ),
          },
          {
            value: 'financeiro',
            label: 'Financeiro',
            content: <FinanceiroTab />,
          },
        ]}
      />
    </div>
  )
}

function DetailsTab({
  contrato,
  obra,
  propostaOrigem,
  qtdItens,
}: {
  contrato: Contrato
  obra: ObraJoin
  propostaOrigem: PropostaOrigemJoin
  qtdItens: number
}) {
  // Rateio em reais sobre o valor final — a mesma conta da aba Pagamento da proposta.
  const { parcelas, restante, valorRestante } = parcelasDaProposta(contrato)

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div className="space-y-6">
        <Block title="Identificação">
          <DetailField label="Número" value={contrato.numero} />
          <DetailField
            label="Assinatura"
            value={contrato.data_assinatura ? formatDate(contrato.data_assinatura) : null}
          />
          <DetailField
            label="Prazo de execução"
            value={contrato.prazo_execucao}
            className="md:col-span-2"
          />
          <DetailField
            label="Proposta de origem"
            value={
              propostaOrigem ? (
                <Link
                  href={`/propostas/${propostaOrigem.id}`}
                  className="text-blue-700 hover:underline"
                >
                  {propostaOrigem.numero}
                </Link>
              ) : (
                'Contrato avulso'
              )
            }
            className="md:col-span-2"
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
          <DetailField label="Telefone" value={obra?.cliente?.telefone ?? null} />
        </Block>

        <Block title="Escopo">
          <DetailField
            label="Descrição"
            value={contrato.descricao}
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
            value={formatCurrency(contrato.valor_total)}
          />
          <DetailField label="Desconto" value={formatCurrency(contrato.desconto)} />
          <DetailField
            label="Valor final"
            value={formatCurrency(contrato.valor_final)}
            className="md:col-span-2"
          />
        </Block>

        <Block title="Pagamento">
          {parcelas.length === 0 ? (
            <DetailField
              label="Parcelas"
              value="Nenhum percentual informado"
              className="md:col-span-2"
            />
          ) : (
            parcelas.map((p) => (
              <DetailField
                key={p.field}
                label={`${p.label} (${formatPct(p.fracao)})`}
                value={formatCurrency(p.valor)}
              />
            ))
          )}
          {restante > 0 && parcelas.length > 0 && (
            <DetailField
              label={`Em aberto (${formatPct(restante)})`}
              value={formatCurrency(valorRestante)}
            />
          )}
          <DetailField
            label="Condições de pagamento"
            value={contrato.condicoes_pagamento}
            className="md:col-span-2"
          />
        </Block>

        {contrato.status === 'rescindido' && (
          <Block title="Rescisão">
            <DetailField
              label="Motivo"
              value={
                contrato.motivo_rescisao
                  ? ((MOTIVO_RESCISAO_LABELS as Record<string, string>)[contrato.motivo_rescisao] ??
                    contrato.motivo_rescisao)
                  : null
              }
            />
            <DetailField
              label="Detalhamento"
              value={contrato.detalhe_rescisao}
              className="md:col-span-2"
            />
          </Block>
        )}

        <Block title="Registro">
          <DetailField
            label="Criado em"
            value={contrato.created_at ? formatDate(contrato.created_at) : null}
          />
          <DetailField
            label="Atualizado em"
            value={contrato.updated_at ? formatDate(contrato.updated_at) : null}
          />
          <DetailField
            label="Observações"
            value={contrato.observacao}
            className="md:col-span-2"
          />
        </Block>
      </div>
    </div>
  )
}

/** Placeholder: NFs, medições e recebimentos do contrato chegam no Sprint 12. */
function FinanceiroTab() {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-sm text-gray-500">
      O financeiro do contrato (notas fiscais, medições e recebimentos) chega no
      Sprint 12.
    </div>
  )
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-5 space-y-4">
      <h2 className="text-sm font-semibold text-gray-900 pb-2 border-b border-gray-200">
        {title}
      </h2>
      <dl className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-4">{children}</dl>
    </div>
  )
}
