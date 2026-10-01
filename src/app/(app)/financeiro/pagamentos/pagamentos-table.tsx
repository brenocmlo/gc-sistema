'use client'

import Link from 'next/link'

import DataTable from '@/components/DataTable'
import { formatCurrency, formatDate } from '@/lib/format'
import { documentoDoPagamento, motivoParaNaoEstornar, ORIGEM_PAGAMENTO_LABELS, rotuloForma } from '@/lib/pagamentos'
import type { PagamentoListItem, Perfil } from '@/lib/types'

import ComprovanteCell from './comprovante-cell'
import EstornarButton from './estornar-button'

type PagamentosTableProps = {
  pagamentos: PagamentoListItem[]
  perfil: Perfil | null
}

// Sem rowHref: pagamento não tem tela própria. O documento da NF leva à NF,
// onde fica a aba Pagamentos (10.3); o do acordo ganha link na sprint 11.
export default function PagamentosTable({ pagamentos, perfil }: PagamentosTableProps) {
  const podeEnviar = perfil === 'admin' || perfil === 'financeiro'
  return (
    <DataTable<PagamentoListItem>
      data={pagamentos}
      rowKey={(p) => p.id}
      columns={[
        { key: 'data_pagamento', header: 'Data', className: 'tabular-nums', render: (p) => formatDate(p.data_pagamento) },
        { key: 'obra', header: 'Obra', render: (p) => (p.obra ? `${p.obra.codigo_obra} — ${p.obra.nome}` : '—') },
        { key: 'origem', header: 'Origem', render: (p) => ORIGEM_PAGAMENTO_LABELS[p.origem] ?? p.origem },
        {
          key: 'documento',
          header: 'Documento',
          render: (p) =>
            p.origem === 'nf' && p.nota_id ? (
              <Link href={`/financeiro/notas-fiscais/${p.nota_id}`} className="text-gray-900 underline-offset-2 hover:underline">
                {documentoDoPagamento(p)}
              </Link>
            ) : (
              <span title={p.origem === 'avulso' ? (p.observacao ?? undefined) : undefined}>{documentoDoPagamento(p)}</span>
            ),
        },
        { key: 'forma', header: 'Forma', render: (p) => rotuloForma(p.forma) },
        { key: 'valor', header: 'Valor', className: 'tabular-nums', render: (p) => formatCurrency(p.valor) },
        {
          key: 'comprovante',
          header: 'Comprovante',
          render: (p) => <ComprovanteCell pagamentoId={p.id} temComprovante={Boolean(p.anexo)} podeEnviar={podeEnviar} />,
        },
        // Estorno (10.4, o mesmo botão da aba da NF): só o admin vê a coluna.
        ...(perfil === 'admin'
          ? [
              {
                key: 'estorno',
                header: '',
                render: (p: PagamentoListItem) => (
                  <EstornarButton
                    pagamentoId={p.id}
                    origem={p.origem}
                    descricao={`${formatCurrency(p.valor)} de ${formatDate(p.data_pagamento)}`}
                    bloqueio={motivoParaNaoEstornar(perfil, p.nota?.status)}
                  />
                ),
              },
            ]
          : []),
      ]}
    />
  )
}
