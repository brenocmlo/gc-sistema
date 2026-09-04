import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'

import {
  BRL_FORMAT,
  DATE_FORMAT,
  buildWorkbookResponse,
  todayStr,
} from '@/lib/excel-export'
import { computeStatusFd, formatStatusFdLabel } from '@/lib/fd'
import { computePeriodoCutoff } from '@/lib/listagem'
import { createClient } from '@/lib/supabase/server'

export async function GET(req: NextRequest) {
  const supabase = createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sp = req.nextUrl.searchParams
  const busca = sp.get('busca')?.trim() ?? ''
  const obraFilter = sp.get('obra') ?? ''
  const statusFilter = sp.get('status') ?? ''
  const periodoFilter = sp.get('periodo') ?? ''

  let query = supabase
    .from('fd')
    .select(
      'data_lancamento, data_vencimento, data_pagamento, pedido_documento, fornecedor, codigo, especificacao, quantidade, preco_unitario, valor, valor_descontar, diferenca_favor, obra:obras(codigo_obra, nome)',
    )
    .order('data_lancamento', { ascending: false })

  if (busca) {
    query = query.or(
      `pedido_documento.ilike.%${busca}%,fornecedor.ilike.%${busca}%,codigo.ilike.%${busca}%,especificacao.ilike.%${busca}%`,
    )
  }
  if (obraFilter) query = query.eq('obra_id', obraFilter)

  const hoje = new Date().toISOString().slice(0, 10)
  if (statusFilter === 'pago') {
    query = query.not('data_pagamento', 'is', null)
  } else if (statusFilter === 'pendente') {
    query = query
      .is('data_pagamento', null)
      .or(`data_vencimento.is.null,data_vencimento.gte.${hoje}`)
  } else if (statusFilter === 'vencido') {
    query = query.is('data_pagamento', null).lt('data_vencimento', hoje)
  }

  const cutoff = computePeriodoCutoff(periodoFilter)
  if (cutoff) query = query.gte('data_lancamento', cutoff)

  const { data, error } = await query

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const rows = (data ?? []).map((d) => {
    const obra = d.obra as { codigo_obra: string; nome: string } | null
    const statusPgto = computeStatusFd({
      data_pagamento: d.data_pagamento as string | null,
      data_vencimento: d.data_vencimento as string | null,
    })
    return {
      data_lancamento: d.data_lancamento as string,
      pedido_documento: (d.pedido_documento as string | null) ?? '',
      obra_codigo: obra?.codigo_obra ?? '',
      obra_nome: obra?.nome ?? '',
      fornecedor: d.fornecedor as string,
      codigo: (d.codigo as string | null) ?? '',
      especificacao: (d.especificacao as string | null) ?? '',
      quantidade: d.quantidade as number | null,
      preco_unitario: d.preco_unitario as number | null,
      valor: d.valor as number,
      valor_descontar: d.valor_descontar as number,
      diferenca_favor: d.diferenca_favor as number,
      data_vencimento: d.data_vencimento as string | null,
      data_pagamento: d.data_pagamento as string | null,
      status_pgto: formatStatusFdLabel(statusPgto),
    }
  })

  const metaParts = [
    busca ? `busca="${busca}"` : null,
    obraFilter ? `obra=${obraFilter}` : null,
    statusFilter ? `status=${statusFilter}` : null,
    periodoFilter ? `período=${periodoFilter}` : null,
  ].filter(Boolean)

  return buildWorkbookResponse(`fd-${todayStr()}.xlsx`, {
    sheetName: 'Faturamento Direto',
    metaRows: [
      ['Faturamento Direto'],
      [`Emitido em: ${new Date().toLocaleString('pt-BR')}`],
      [`Filtros: ${metaParts.length > 0 ? metaParts.join(' · ') : 'nenhum'}`],
      [`Total de registros: ${rows.length}`],
    ],
    columns: [
      {
        header: 'Lançamento',
        width: 12,
        value: (r) => new Date(r.data_lancamento),
        numFmt: DATE_FORMAT,
      },
      {
        header: 'Pedido / Doc.',
        width: 18,
        value: (r) => r.pedido_documento,
      },
      { header: 'Obra (código)', width: 14, value: (r) => r.obra_codigo },
      { header: 'Obra (nome)', width: 28, value: (r) => r.obra_nome },
      { header: 'Fornecedor', width: 28, value: (r) => r.fornecedor },
      { header: 'Código produto', width: 14, value: (r) => r.codigo },
      {
        header: 'Especificação',
        width: 36,
        value: (r) => r.especificacao,
      },
      {
        header: 'Qtd',
        width: 10,
        value: (r) => r.quantidade ?? 0,
      },
      {
        header: 'Preço unit.',
        width: 14,
        value: (r) => r.preco_unitario ?? 0,
        numFmt: BRL_FORMAT,
      },
      {
        header: 'Valor (cliente)',
        width: 16,
        value: (r) => r.valor,
        numFmt: BRL_FORMAT,
        sum: true,
      },
      {
        header: 'A descontar',
        width: 14,
        value: (r) => r.valor_descontar,
        numFmt: BRL_FORMAT,
        sum: true,
      },
      {
        header: 'Diferença a favor',
        width: 16,
        value: (r) => r.diferenca_favor,
        numFmt: BRL_FORMAT,
        sum: true,
      },
      {
        header: 'Vencimento',
        width: 12,
        value: (r) => (r.data_vencimento ? new Date(r.data_vencimento) : null),
        numFmt: DATE_FORMAT,
      },
      {
        header: 'Pagamento',
        width: 12,
        value: (r) => (r.data_pagamento ? new Date(r.data_pagamento) : null),
        numFmt: DATE_FORMAT,
      },
      { header: 'Status', width: 12, value: (r) => r.status_pgto },
    ],
    rows,
    includeTotals: true,
  })
}
