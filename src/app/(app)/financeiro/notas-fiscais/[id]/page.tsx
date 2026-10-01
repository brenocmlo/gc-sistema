import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import type { ReactNode } from 'react'

import DetailField from '@/components/DetailField'
import Tabs from '@/components/Tabs'
import { hojeISO } from '@/lib/execucao'
import { formatCurrency, formatDate } from '@/lib/format'
import { isNfEditavel, recebidoDaNf, situacaoDaNf, TIPO_NF_LABELS } from '@/lib/notas-fiscais'
import { motivoParaNaoEstornar, rotuloForma } from '@/lib/pagamentos'
import { getCurrentProfile } from '@/lib/supabase/profile'
import { createClient } from '@/lib/supabase/server'
import type { NotaFiscal, Pagamento, Perfil } from '@/lib/types'

import ComprovanteCell from '../../pagamentos/comprovante-cell'
import EstornarButton from '../../pagamentos/estornar-button'

import ArquivosTab from './arquivos-tab'
import DetailHeader from './detail-header'

type PageProps = { params: { id: string } }

type Join = {
  obra: { codigo_obra: string; nome: string; cliente: { nome: string } | null } | null
  contrato: { id: string; numero: string } | null
  proposta: { id: string; numero: string } | null
  pagamentos: Pick<Pagamento, 'id' | 'origem' | 'data_pagamento' | 'valor' | 'forma' | 'observacao' | 'anexo' | 'created_at'>[] | null
}

export default async function NotaFiscalDetalhePage({ params }: PageProps) {
  const profile = await getCurrentProfile()
  if (!profile) redirect('/login')

  const supabase = createClient()
  const { data } = await supabase
    .from('notas_fiscais')
    .select(
      '*, obra:obras(codigo_obra, nome, cliente:clientes(nome)), contrato:contratos(id, numero), proposta:propostas(id, numero), pagamentos(id, origem, data_pagamento, valor, forma, observacao, anexo, created_at)',
    )
    .eq('id', params.id)
    .maybeSingle()

  if (!data) notFound()

  const { obra, contrato, proposta, pagamentos, ...row } = data as NotaFiscal & Join
  const nf = row as NotaFiscal
  const recebido = recebidoDaNf(pagamentos)
  const obraLabel = obra ? `${obra.codigo_obra} — ${obra.nome}` : '—'

  return (
    <div className="space-y-6">
      <DetailHeader
        id={nf.id}
        numero={nf.numero}
        serie={nf.serie}
        obraLabel={obraLabel}
        status={nf.status}
        situacao={situacaoDaNf(nf, hojeISO())}
        valorTotal={nf.valor_total}
        recebido={recebido}
        qtdPagamentos={(pagamentos ?? []).length}
        perfil={profile.perfil}
      />

      <Tabs
        tabs={[
          {
            value: 'detalhes',
            label: 'Detalhes',
            content: <DetailsTab nf={nf} obra={obra} contrato={contrato} proposta={proposta} />,
          },
          {
            value: 'pagamentos',
            label: `Pagamentos${(pagamentos ?? []).length > 0 ? ` (${(pagamentos ?? []).length})` : ''}`,
            content: (
              <PagamentosTab
                pagamentos={pagamentos ?? []}
                recebido={recebido}
                perfil={profile.perfil}
                notaStatus={nf.status}
              />
            ),
          },
          {
            value: 'arquivos',
            label: `Arquivos${[nf.xml_url, nf.pdf_url].filter(Boolean).length > 0 ? ` (${[nf.xml_url, nf.pdf_url].filter(Boolean).length})` : ''}`,
            content: (
              <ArquivosTab
                nfId={nf.id}
                xml={nf.xml_url}
                pdf={nf.pdf_url}
                podeEnviar={(profile.perfil === 'admin' || profile.perfil === 'financeiro') && isNfEditavel(nf.status)}
                cancelada={nf.status === 'cancelada'}
              />
            ),
          },
        ]}
      />
    </div>
  )
}

function DetailsTab({
  nf,
  obra,
  contrato,
  proposta,
}: {
  nf: NotaFiscal
  obra: Join['obra']
  contrato: Join['contrato']
  proposta: Join['proposta']
}) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div className="space-y-6">
        <Block title="Identificação">
          <DetailField label="Número" value={nf.numero} />
          <DetailField label="Série" value={nf.serie} />
          <DetailField label="Chave da NF-e" value={nf.chave_nfe} className="md:col-span-2 break-all" />
          <DetailField label="Tipo" value={TIPO_NF_LABELS[nf.tipo] ?? nf.tipo} />
        </Block>
        <Block title="Obra e vínculo">
          <DetailField label="Obra" value={obra ? `${obra.codigo_obra} — ${obra.nome}` : null} className="md:col-span-2" />
          <DetailField label="Cliente" value={obra?.cliente?.nome ?? null} className="md:col-span-2" />
          <DetailField
            label="Vínculo"
            className="md:col-span-2"
            value={
              contrato ? (
                <Link href={`/contratos/${contrato.id}`} className="text-blue-700 hover:underline">
                  {`Contrato ${contrato.numero}`}
                </Link>
              ) : proposta ? (
                <Link href={`/propostas/${proposta.id}`} className="text-blue-700 hover:underline">
                  {`Proposta ${proposta.numero}`}
                </Link>
              ) : (
                'Sem vínculo'
              )
            }
          />
        </Block>
      </div>
      <div className="space-y-6">
        <Block title="Datas e valor">
          <DetailField label="Emissão" value={formatDate(nf.data_emissao)} />
          <DetailField label="Vencimento" value={nf.data_vencimento ? formatDate(nf.data_vencimento) : null} />
          <DetailField label="Valor total" value={formatCurrency(nf.valor_total)} />
        </Block>
        {nf.status === 'cancelada' && (
          <Block title="Cancelamento">
            <DetailField
              label="Data"
              value={nf.data_cancelamento ? formatDate(nf.data_cancelamento) : null}
            />
            <DetailField label="Motivo" value={nf.motivo_cancelamento} className="md:col-span-2" />
          </Block>
        )}
        <Block title="Observações">
          <DetailField label="Observações" value={nf.observacao} className="md:col-span-2" />
        </Block>
      </div>
    </div>
  )
}

/** Aba Pagamentos (10.3): as baixas da NF, da mais recente, com o estorno. */
function PagamentosTab({
  pagamentos,
  recebido,
  perfil,
  notaStatus,
}: {
  pagamentos: NonNullable<Join['pagamentos']>
  recebido: number
  perfil: Perfil
  notaStatus: NotaFiscal['status']
}) {
  if (pagamentos.length === 0) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-sm text-gray-500">
        Nenhum pagamento registrado.
      </div>
    )
  }
  const ordenados = [...pagamentos].sort(
    (a, b) => b.data_pagamento.localeCompare(a.data_pagamento) || (b.created_at ?? '').localeCompare(a.created_at ?? ''),
  )
  const bloqueio = motivoParaNaoEstornar(perfil, notaStatus)
  // Estornar só aparece para o admin; fora das regras, vem desabilitado com o porquê.
  const mostraEstorno = perfil === 'admin'
  return (
    <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm" aria-label="Pagamentos da nota fiscal">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="px-4 py-3 text-left font-medium text-gray-700">Data</th>
              <th className="px-4 py-3 text-left font-medium text-gray-700">Forma</th>
              <th className="px-4 py-3 text-left font-medium text-gray-700">Valor</th>
              <th className="px-4 py-3 text-left font-medium text-gray-700">Observação</th>
              <th className="px-4 py-3 text-left font-medium text-gray-700">Comprovante</th>
              {mostraEstorno && <th className="px-4 py-3" aria-label="Ações" />}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {ordenados.map((p) => (
              <tr key={p.id}>
                <td className="px-4 py-3 tabular-nums">{formatDate(p.data_pagamento)}</td>
                <td className="px-4 py-3">{rotuloForma(p.forma)}</td>
                <td className="px-4 py-3 tabular-nums">{formatCurrency(p.valor)}</td>
                <td className="px-4 py-3 text-gray-600">{p.observacao ?? '—'}</td>
                <td className="px-4 py-3">
                  <ComprovanteCell
                    pagamentoId={p.id}
                    temComprovante={Boolean(p.anexo)}
                    podeEnviar={perfil === 'admin' || perfil === 'financeiro'}
                  />
                </td>
                {mostraEstorno && (
                  <td className="px-4 py-3 text-right">
                    <EstornarButton
                      pagamentoId={p.id}
                      origem={p.origem}
                      descricao={`${formatCurrency(p.valor)} de ${formatDate(p.data_pagamento)}`}
                      bloqueio={bloqueio}
                    />
                  </td>
                )}
              </tr>
            ))}
          </tbody>
          <tfoot className="bg-gray-50 border-t border-gray-200">
            <tr>
              <td className="px-4 py-3 font-medium text-gray-700" colSpan={2}>
                {`Total recebido em ${pagamentos.length} ${pagamentos.length === 1 ? 'pagamento' : 'pagamentos'}`}
              </td>
              <td className="px-4 py-3 font-semibold text-gray-900 tabular-nums">{formatCurrency(recebido)}</td>
              <td colSpan={mostraEstorno ? 3 : 2} />
            </tr>
          </tfoot>
        </table>
      </div>
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
