import Link from 'next/link'
import { redirect } from 'next/navigation'

import ExportButton from '@/components/ExportButton'
import { hojeISO } from '@/lib/execucao'
import { FAIXA_VENCIMENTO_LABELS, PERIODO_FINANCEIRO_OPTIONS, somarDias, type FaixaVencimento } from '@/lib/financeiro-empresa'
import { formatCurrency, formatDate } from '@/lib/format'
import { getCurrentProfile } from '@/lib/supabase/profile'
import { createClient } from '@/lib/supabase/server'

import { carregarVisaoGeral } from './carregar'
import VisaoGeralFiltros from './filters'

type PageProps = { searchParams?: { obra?: string; periodo?: string } }

/** As faixas da seção "Contas a receber", na ordem; depois de 30 dias e sem vencimento vão no rodapé. */
const FAIXAS_PRINCIPAIS: FaixaVencimento[] = ['vencidas', 'hoje', '7dias', '30dias']

/** Visão consolidada do financeiro (12.2): substitui a aba de resumo da planilha antiga. */
export default async function VisaoGeralPage({ searchParams }: PageProps) {
  const profile = await getCurrentProfile()
  if (!profile) redirect('/login')

  const supabase = createClient()
  // Um "hoje" só para a requisição: as faixas e o período saem iguais na tela e no export.
  const hoje = hojeISO()
  const params = { obra: searchParams?.obra ?? '', periodo: searchParams?.periodo ?? '' }
  const [{ data: obras }, v] = await Promise.all([
    supabase.from('obras').select('id, codigo_obra, nome').order('codigo_obra', { ascending: false }),
    carregarVisaoGeral(supabase, params, hoje),
  ])
  const obraOptions = (obras ?? []).map((o) => ({ value: o.id, label: `${o.codigo_obra} — ${o.nome}` }))
  const rotuloPeriodo = PERIODO_FINANCEIRO_OPTIONS.find((o) => o.value === v.periodo)?.label ?? ''
  const noPeriodo = v.periodo === 'tudo' ? '' : ' no período'

  const cards = [
    { rotulo: 'A receber', valor: v.cards.aReceber, nota: 'saldo pendente das obras' },
    { rotulo: `Recebido${noPeriodo}`, valor: v.cards.recebidoNoPeriodo, nota: v.inicio ? `${rotuloPeriodo.toLowerCase()}, desde ${formatDate(v.inicio)}` : 'todo o período' },
    { rotulo: 'Atrasado', valor: v.cards.atrasado, nota: `${v.faixas.vencidas.quantidade} documento(s) vencido(s)`, alerta: v.cards.atrasado > 0 },
    { rotulo: 'Previsto para 30 dias', valor: v.cards.previsto30, nota: `vence de hoje até ${formatDate(somarDias(hoje, 30))}` },
  ]
  const total = v.obras.reduce((a, o) => ({ faturado: a.faturado + o.faturado, recebido: a.recebido + o.recebido, saldo: a.saldo + o.saldo }), { faturado: 0, recebido: 0, saldo: 0 })
  const contasPrincipais = v.contas.filter((c) => FAIXAS_PRINCIPAIS.includes(c.faixa))

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <VisaoGeralFiltros obraOptions={obraOptions} />
        <ExportButton endpoint="/api/export/financeiro" searchParams={params} filename={`financeiro-${hoje}`} />
      </div>

      <section aria-label="Resumo do financeiro" className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {cards.map((c) => (
          <div key={c.rotulo} data-card={c.rotulo} className={`bg-white rounded-lg border p-4 ${c.alerta ? 'border-red-200' : 'border-gray-200'}`}>
            <p className="text-xs text-gray-500">{c.rotulo}</p>
            <p className={`text-lg font-semibold mt-1 ${c.alerta ? 'text-red-700' : 'text-gray-900'}`}>{formatCurrency(c.valor)}</p>
            <p className="text-xs text-gray-400 mt-1">{c.nota}</p>
          </div>
        ))}
      </section>

      <section className="bg-white rounded-lg border border-gray-200 p-5 space-y-4">
        <h2 className="text-sm font-semibold text-gray-900 pb-2 border-b border-gray-200">{`Por obra (${v.obras.length})`}</h2>
        {v.obras.length === 0 ? <p className="text-sm text-gray-500">Nenhuma obra com movimento financeiro.</p> : (
          <div className="overflow-x-auto">
            <table aria-label="Financeiro por obra" className="w-full text-sm">
              <thead className="text-left text-gray-500">
                <tr>
                  <th className="py-2 pr-4 font-medium">Obra</th>
                  <th className="py-2 pr-4 font-medium text-right whitespace-nowrap">{`Faturado${noPeriodo}`}</th>
                  <th className="py-2 pr-4 font-medium text-right whitespace-nowrap">{`Recebido${noPeriodo}`}</th>
                  <th className="py-2 pr-4 font-medium text-right whitespace-nowrap">Saldo atual</th>
                  <th className="py-2 pr-4 font-medium text-right whitespace-nowrap">% recebido</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {v.obras.map((o) => (
                  <tr key={o.obraId} data-obra={o.codigo}>
                    <td className="py-2 pr-4 whitespace-nowrap">
                      <Link href={`/obras/${o.obraId}?aba=financeiro`} className="font-medium text-gray-900 hover:underline">{o.codigo}</Link>
                      <span className="block text-xs text-gray-500">{o.nome}</span>
                    </td>
                    <td className="py-2 pr-4 text-right whitespace-nowrap">{formatCurrency(o.faturado)}</td>
                    <td className="py-2 pr-4 text-right whitespace-nowrap">{formatCurrency(o.recebido)}</td>
                    <td className={`py-2 pr-4 text-right whitespace-nowrap ${o.saldo < 0 ? 'text-amber-700' : ''}`}>{formatCurrency(o.saldo)}</td>
                    <td className="py-2 pr-4 text-right whitespace-nowrap">{o.pctRecebido === null ? '—' : `${o.pctRecebido.toLocaleString('pt-BR')}%`}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t border-gray-300 font-semibold">
                <tr>
                  <td className="py-2 pr-4">Total</td>
                  <td className="py-2 pr-4 text-right whitespace-nowrap">{formatCurrency(total.faturado)}</td>
                  <td className="py-2 pr-4 text-right whitespace-nowrap">{formatCurrency(total.recebido)}</td>
                  <td className="py-2 pr-4 text-right whitespace-nowrap">{formatCurrency(total.saldo)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
        <p className="text-xs text-gray-400">
          Faturado e recebido seguem o período; saldo e % recebido são da obra inteira (o que falta hoje). % recebido é o recebido sobre as NFs e parcelas de acordo válidas.
        </p>
      </section>

      <section className="bg-white rounded-lg border border-gray-200 p-5 space-y-4">
        <h2 className="text-sm font-semibold text-gray-900 pb-2 border-b border-gray-200">Contas a receber por vencimento</h2>
        <div aria-label="Faixas de vencimento" className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {FAIXAS_PRINCIPAIS.map((f) => (
            <div key={f} data-faixa={f} className={`rounded-md border p-3 ${f === 'vencidas' && v.faixas.vencidas.quantidade > 0 ? 'border-red-200 bg-red-50' : 'border-gray-200'}`}>
              <p className="text-xs text-gray-500">{FAIXA_VENCIMENTO_LABELS[f]}</p>
              <p className="text-base font-semibold text-gray-900">{formatCurrency(v.faixas[f].total)}</p>
              <p className="text-xs text-gray-400">{v.faixas[f].quantidade} documento(s)</p>
            </div>
          ))}
        </div>
        {contasPrincipais.length === 0 ? <p className="text-sm text-gray-500">Nada vence nos próximos 30 dias, e nada está vencido.</p> : (
          <div className="overflow-x-auto">
            <table aria-label="Contas a receber" className="w-full text-sm">
              <thead className="text-left text-gray-500">
                <tr>
                  <th className="py-2 pr-4 font-medium">Vencimento</th>
                  <th className="py-2 pr-4 font-medium">Documento</th>
                  <th className="py-2 pr-4 font-medium">Obra</th>
                  <th className="py-2 pr-4 font-medium text-right">Saldo</th>
                  <th className="py-2 pr-4 font-medium">Faixa</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {contasPrincipais.map((c) => (
                  <tr key={`${c.tipo}-${c.id}`} data-conta={c.documento}>
                    <td className="py-2 pr-4 whitespace-nowrap">{c.vencimento ? formatDate(c.vencimento) : '—'}</td>
                    <td className="py-2 pr-4 whitespace-nowrap">
                      <Link href={c.tipo === 'nf' ? `/financeiro/notas-fiscais/${c.destinoId}` : `/financeiro/acordos/${c.destinoId}`} className="text-gray-900 hover:underline">{c.documento}</Link>
                    </td>
                    <td className="py-2 pr-4 whitespace-nowrap">{(obras ?? []).find((o) => o.id === c.obraId)?.codigo_obra ?? '—'}</td>
                    <td className="py-2 pr-4 text-right whitespace-nowrap">{formatCurrency(c.saldo)}</td>
                    <td className={`py-2 pr-4 whitespace-nowrap ${c.faixa === 'vencidas' ? 'text-red-700 font-medium' : 'text-gray-600'}`}>{FAIXA_VENCIMENTO_LABELS[c.faixa]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-xs text-gray-500">
          Fora da lista: {formatCurrency(v.faixas.depois.total)} vencem depois de 30 dias ({v.faixas.depois.quantidade}) e {formatCurrency(v.faixas.sem_vencimento.total)} não têm vencimento ({v.faixas.sem_vencimento.quantidade}).
        </p>
      </section>
    </div>
  )
}
