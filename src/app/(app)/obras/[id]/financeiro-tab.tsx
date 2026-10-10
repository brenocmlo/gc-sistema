import Link from 'next/link'

import type { BlocosFinanceiros, LinhaNf, MesDaLinhaDoTempo, ParcelaEmAberto } from '@/lib/financeiro-obra'
import { rotuloDoMes } from '@/lib/financeiro-obra'
import { formatCurrency, formatDate } from '@/lib/format'
import { numeroComSerie, TIPO_NF_LABELS } from '@/lib/notas-fiscais'
import { ORIGEM_PAGAMENTO_LABELS, rotuloForma } from '@/lib/pagamentos'
import type { NotaFiscalTipo } from '@/lib/types'

import { SituacaoParcelaBadge } from '../../financeiro/acordos/status-badge'
import SituacaoBadge from '../../financeiro/notas-fiscais/situacao-badge'

type Props = {
  blocos: BlocosFinanceiros
  nfs: LinhaNf[]
  parcelas: ParcelaEmAberto[]
  linhaDoTempo: MesDaLinhaDoTempo[]
  /** Pagamentos de acordo convertido em NF: fora do recebido, mostrados à parte. */
  arquivado: number
}

/** Aba Financeiro da obra (12.1): os números das views, as NFs, as parcelas em aberto e os recebimentos. */
export default function FinanceiroTab({ blocos, nfs, parcelas, linhaDoTempo, arquivado }: Props) {
  const cartoes: { rotulo: string; valor: number; nota: string; destaque?: boolean }[] = [
    { rotulo: 'Valor contratado', valor: blocos.contratado, nota: 'valor final das propostas e contratos' },
    { rotulo: 'Faturado', valor: blocos.faturado, nota: 'NFs não canceladas' },
    { rotulo: 'Recebido', valor: blocos.recebido, nota: 'NFs, acordos e avulsos' },
    { rotulo: 'A receber', valor: blocos.aReceber, nota: 'NFs e parcelas menos o recebido' },
    { rotulo: 'Atrasado', valor: blocos.atrasado, nota: 'saldo de NFs vencidas e parcelas atrasadas', destaque: blocos.atrasado > 0 },
    { rotulo: 'FD descontado', valor: blocos.fdDescontado, nota: 'faturamento direto aceito' },
  ]

  return (
    <div className="space-y-6">
      <section aria-label="Resumo financeiro da obra" className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        {cartoes.map((c) => (
          <div key={c.rotulo} data-bloco={c.rotulo} className={`bg-white rounded-lg border p-4 ${c.destaque ? 'border-red-200' : 'border-gray-200'}`}>
            <p className="text-xs text-gray-500">{c.rotulo}</p>
            <p className={`text-lg font-semibold mt-1 ${c.destaque ? 'text-red-700' : 'text-gray-900'}`}>{formatCurrency(c.valor)}</p>
            <p className="text-xs text-gray-400 mt-1">{c.nota}</p>
          </div>
        ))}
      </section>
      {arquivado > 0 && (
        <p className="text-xs text-gray-500">
          {formatCurrency(arquivado)} de pagamentos de acordos convertidos em NF ficam arquivados: não entram no recebido.
        </p>
      )}

      <Secao titulo={`Notas fiscais (${nfs.length})`}>
        {nfs.length === 0 ? <Vazio texto="Nenhuma nota fiscal nesta obra." /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-gray-500">
                <tr><Th>NF</Th><Th>Tipo</Th><Th>Emissão</Th><Th>Vencimento</Th><Th direita>Valor</Th><Th direita>Recebido</Th><Th direita>Saldo</Th><Th>Situação</Th></tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {nfs.map((n) => (
                  <tr key={n.id} data-nf={n.numero}>
                    <Td><Link href={`/financeiro/notas-fiscais/${n.id}`} className="font-medium text-gray-900 hover:underline">{numeroComSerie(n.numero, n.serie)}</Link></Td>
                    <Td>{TIPO_NF_LABELS[n.tipo as NotaFiscalTipo] ?? n.tipo}</Td>
                    <Td>{formatDate(n.emissao)}</Td>
                    <Td>{n.vencimento ? formatDate(n.vencimento) : '—'}</Td>
                    <Td direita>{formatCurrency(n.valor)}</Td>
                    <Td direita>{formatCurrency(n.recebido)}</Td>
                    <Td direita>{n.situacao === 'cancelada' ? '—' : formatCurrency(n.saldo)}</Td>
                    <Td><SituacaoBadge situacao={n.situacao} /></Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Secao>

      <Secao titulo={`Parcelas de acordo em aberto (${parcelas.length})`}>
        {parcelas.length === 0 ? <Vazio texto="Nenhuma parcela de acordo em aberto." /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-gray-500">
                <tr><Th>Acordo</Th><Th>Parcela</Th><Th>Vencimento</Th><Th direita>Previsto</Th><Th direita>Pago</Th><Th direita>Saldo</Th><Th>Situação</Th></tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {parcelas.map((p) => (
                  <tr key={p.id} data-parcela={`${p.acordo} · ${p.numero}`}>
                    <Td><Link href={`/financeiro/acordos/${p.acordoId}`} className="font-medium text-gray-900 hover:underline">{p.acordo}</Link></Td>
                    <Td>{p.numero}</Td>
                    <Td>{formatDate(p.vencimento)}</Td>
                    <Td direita>{formatCurrency(p.previsto)}</Td>
                    <Td direita>{formatCurrency(p.pago)}</Td>
                    <Td direita>{formatCurrency(p.saldo)}</Td>
                    <Td><SituacaoParcelaBadge situacao={p.situacao} /></Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Secao>

      <Secao titulo="Linha do tempo de recebimentos">
        {linhaDoTempo.length === 0 ? <Vazio texto="Nenhum recebimento nesta obra." /> : (
          <ol aria-label="Recebimentos por mês" className="space-y-5">
            {linhaDoTempo.map((m) => (
              <li key={m.mes} data-mes={m.mes} className="border-l-2 border-gray-200 pl-4">
                <div className="flex items-baseline justify-between gap-3 flex-wrap">
                  <h3 className="text-sm font-semibold text-gray-900">{rotuloDoMes(m.mes)}</h3>
                  <p className="text-sm text-gray-700">
                    {formatCurrency(m.total)} <span className="text-xs text-gray-400">· acumulado {formatCurrency(m.acumulado)}</span>
                  </p>
                </div>
                <ul className="mt-2 space-y-1">
                  {m.pagamentos.map((p) => (
                    <li key={p.id} className="flex items-baseline justify-between gap-3 text-sm">
                      <span className="text-gray-600">
                        {formatDate(p.data)} · {p.documento === '—' ? ORIGEM_PAGAMENTO_LABELS[p.origem] : p.documento}
                        {p.forma ? <span className="text-gray-400"> · {rotuloForma(p.forma)}</span> : null}
                      </span>
                      <span className="text-gray-900">{formatCurrency(p.valor)}</span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        )}
      </Secao>
    </div>
  )
}

function Secao({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="bg-white rounded-lg border border-gray-200 p-5 space-y-4">
      <h2 className="text-sm font-semibold text-gray-900 pb-2 border-b border-gray-200">{titulo}</h2>
      {children}
    </section>
  )
}

function Vazio({ texto }: { texto: string }) {
  return <p className="text-sm text-gray-500">{texto}</p>
}

function Th({ children, direita }: { children: React.ReactNode; direita?: boolean }) {
  return <th className={`py-2 pr-4 font-medium whitespace-nowrap ${direita ? 'text-right' : ''}`}>{children}</th>
}

function Td({ children, direita }: { children: React.ReactNode; direita?: boolean }) {
  return <td className={`py-2 pr-4 whitespace-nowrap ${direita ? 'text-right' : ''}`}>{children}</td>
}
