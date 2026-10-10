import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'

import {
  BRL_FORMAT,
  DATE_FORMAT,
  buildWorkbookResponse,
  todayStr,
} from '@/lib/excel-export'
import { mensagemDeErroBanco } from '@/lib/erro-banco'
import { createClient } from '@/lib/supabase/server'
import type { ObraStatus } from '@/lib/types'

const VALID_STATUS: readonly ObraStatus[] = [
  'ativa',
  'concluida',
  'suspensa',
  'cancelada',
]

function isValidStatus(v: string): v is ObraStatus {
  return (VALID_STATUS as readonly string[]).includes(v)
}

export async function GET(req: NextRequest) {
  const supabase = createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sp = req.nextUrl.searchParams
  const q = sp.get('q')?.trim() ?? ''
  const statusFilter = sp.get('status') ?? ''

  let query = supabase
    .from('obras_com_valores')
    .select(
      'codigo_obra, nome, cidade, status, data_inicio, data_prevista_fim, data_real_fim, valor_total_calculado, desconto_calculado, valor_final_calculado, cliente:clientes(nome)',
    )
    .order('created_at', { ascending: false })

  if (q) {
    const { data: clientesMatch } = await supabase
      .from('clientes')
      .select('id')
      .ilike('nome', `%${q}%`)
    const clienteIds = (clientesMatch ?? []).map((c) => c.id)
    const clienteFilter =
      clienteIds.length > 0 ? `cliente_id.in.(${clienteIds.join(',')})` : null
    const filters = [
      `nome.ilike.%${q}%`,
      `codigo_obra.ilike.%${q}%`,
      clienteFilter,
    ].filter(Boolean)
    query = query.or(filters.join(','))
  }

  if (statusFilter && isValidStatus(statusFilter)) {
    query = query.eq('status', statusFilter)
  }

  const { data, error } = await query

  if (error) {
    return NextResponse.json({ error: mensagemDeErroBanco(error) }, { status: 500 })
  }

  const rows = (data ?? []).map((d) => {
    const cliente = d.cliente as { nome: string } | null
    return {
      codigo_obra: d.codigo_obra as string | null,
      nome: d.nome as string | null,
      cliente_nome: cliente?.nome ?? null,
      cidade: d.cidade as string | null,
      status: d.status as string | null,
      data_inicio: d.data_inicio as string | null,
      data_prevista_fim: d.data_prevista_fim as string | null,
      data_real_fim: d.data_real_fim as string | null,
      valor_total: d.valor_total_calculado as number | null,
      desconto: d.desconto_calculado as number | null,
      valor_final: d.valor_final_calculado as number | null,
    }
  })

  const metaParts = [
    q ? `busca="${q}"` : null,
    statusFilter ? `status=${statusFilter}` : null,
  ].filter(Boolean)

  return buildWorkbookResponse(`obras-${todayStr()}.xlsx`, {
    sheetName: 'Obras',
    metaRows: [
      ['Obras'],
      [`Emitido em: ${new Date().toLocaleString('pt-BR')}`],
      [`Filtros: ${metaParts.length > 0 ? metaParts.join(' · ') : 'nenhum'}`],
      [`Total de registros: ${rows.length}`],
    ],
    columns: [
      { header: 'Código', width: 14, value: (r) => r.codigo_obra ?? '' },
      { header: 'Nome', width: 32, value: (r) => r.nome ?? '' },
      { header: 'Cliente', width: 28, value: (r) => r.cliente_nome ?? '' },
      { header: 'Cidade', width: 16, value: (r) => r.cidade ?? '' },
      { header: 'Status', width: 12, value: (r) => r.status ?? '' },
      {
        header: 'Início',
        width: 12,
        value: (r) => (r.data_inicio ? new Date(r.data_inicio) : null),
        numFmt: DATE_FORMAT,
      },
      {
        header: 'Previsto fim',
        width: 14,
        value: (r) =>
          r.data_prevista_fim ? new Date(r.data_prevista_fim) : null,
        numFmt: DATE_FORMAT,
      },
      {
        header: 'Fim real',
        width: 12,
        value: (r) => (r.data_real_fim ? new Date(r.data_real_fim) : null),
        numFmt: DATE_FORMAT,
      },
      {
        header: 'Valor total',
        width: 16,
        value: (r) => r.valor_total ?? 0,
        numFmt: BRL_FORMAT,
        sum: true,
      },
      {
        header: 'Desconto',
        width: 14,
        value: (r) => r.desconto ?? 0,
        numFmt: BRL_FORMAT,
        sum: true,
      },
      {
        header: 'Valor final',
        width: 16,
        value: (r) => r.valor_final ?? 0,
        numFmt: BRL_FORMAT,
        sum: true,
      },
    ],
    rows,
    includeTotals: true,
  })
}
