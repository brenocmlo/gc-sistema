import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'

import {
  BRL_FORMAT,
  DATE_FORMAT,
  buildWorkbookResponse,
  todayStr,
} from '@/lib/excel-export'
import { computePeriodoCutoff } from '@/lib/listagem'
import { createClient } from '@/lib/supabase/server'
import {
  MOTIVO_REJEICAO_LABELS,
  type OrcamentoStatus,
} from '@/lib/types'

const VALID_STATUS: readonly OrcamentoStatus[] = [
  'pendente',
  'analise',
  'enviado',
  'aprovado',
  'rejeitado',
  'expirado',
]

function isValidStatus(v: string): v is OrcamentoStatus {
  return (VALID_STATUS as readonly string[]).includes(v)
}

type Row = {
  numero: string | null
  data_solicitacao: string
  cliente_nome: string | null
  cliente_cidade: string | null
  status: string
  valor_estimado: number | null
  responsavel: string | null
  motivo_rejeicao: string | null
}

const PERFIS_COM_ACESSO = ['admin', 'comercial', 'visualizador']

export async function GET(req: NextRequest) {
  const supabase = createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Os mesmos perfis do layout de /orcamentos. A rota de API não passa pelo layout,
  // e a RLS deixa qualquer perfil da empresa ler: sem esta checagem, o
  // financeiro baixava pelo export o que não vê na tela.
  const { data: profile } = await supabase
    .from('profiles')
    .select('perfil')
    .eq('id', user.id)
    .maybeSingle()
  if (!profile || !PERFIS_COM_ACESSO.includes(profile.perfil)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const sp = req.nextUrl.searchParams
  const busca = sp.get('busca')?.trim() ?? ''
  const statusFilter = sp.get('status') ?? ''
  const periodoFilter = sp.get('periodo') ?? ''

  let query = supabase
    .from('orcamentos')
    .select(
      'numero, data_solicitacao, status, valor_estimado, responsavel, motivo_rejeicao, cliente:clientes(nome, cidade)',
    )
    .order('data_solicitacao', { ascending: false })

  if (busca) {
    const { data: clientesMatch } = await supabase
      .from('clientes')
      .select('id')
      .or(
        `nome.ilike.%${busca}%,contato.ilike.%${busca}%,email.ilike.%${busca}%`,
      )
    const clienteIds = (clientesMatch ?? []).map((c) => c.id)
    const clienteFilter =
      clienteIds.length > 0 ? `cliente_id.in.(${clienteIds.join(',')})` : null
    const filters = [`numero.ilike.%${busca}%`, clienteFilter].filter(Boolean)
    query = query.or(filters.join(','))
  }

  if (statusFilter && isValidStatus(statusFilter)) {
    query = query.eq('status', statusFilter)
  }

  const cutoff = computePeriodoCutoff(periodoFilter)
  if (cutoff) query = query.gte('data_solicitacao', cutoff)

  const { data, error } = await query

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const rows = (data ?? []).map((d) => {
    const cliente = d.cliente as { nome: string; cidade: string | null } | null
    return {
      numero: d.numero,
      data_solicitacao: d.data_solicitacao,
      cliente_nome: cliente?.nome ?? null,
      cliente_cidade: cliente?.cidade ?? null,
      status: d.status,
      valor_estimado: d.valor_estimado as number | null,
      responsavel: d.responsavel,
      motivo_rejeicao: d.motivo_rejeicao
        ? (MOTIVO_REJEICAO_LABELS[
            d.motivo_rejeicao as keyof typeof MOTIVO_REJEICAO_LABELS
          ] ?? d.motivo_rejeicao)
        : null,
    } satisfies Row
  })

  const metaParts = [
    busca ? `busca="${busca}"` : null,
    statusFilter ? `status=${statusFilter}` : null,
    periodoFilter ? `período=${periodoFilter}` : null,
  ].filter(Boolean)

  return buildWorkbookResponse(`orcamentos-${todayStr()}.xlsx`, {
    sheetName: 'Orçamentos',
    metaRows: [
      ['Orçamentos'],
      [`Emitido em: ${new Date().toLocaleString('pt-BR')}`],
      [`Filtros: ${metaParts.length > 0 ? metaParts.join(' · ') : 'nenhum'}`],
      [`Total de registros: ${rows.length}`],
    ],
    columns: [
      { header: 'Número', width: 18, value: (r) => r.numero ?? '' },
      {
        header: 'Data solicitação',
        width: 16,
        value: (r) =>
          r.data_solicitacao ? new Date(r.data_solicitacao) : null,
        numFmt: DATE_FORMAT,
      },
      { header: 'Cliente', width: 32, value: (r) => r.cliente_nome ?? '' },
      { header: 'Cidade', width: 18, value: (r) => r.cliente_cidade ?? '' },
      { header: 'Status', width: 14, value: (r) => r.status },
      {
        header: 'Valor estimado',
        width: 18,
        value: (r) => r.valor_estimado ?? 0,
        numFmt: BRL_FORMAT,
        sum: true,
      },
      {
        header: 'Responsável',
        width: 20,
        value: (r) => r.responsavel ?? '',
      },
      {
        header: 'Motivo rejeição',
        width: 28,
        value: (r) => r.motivo_rejeicao ?? '',
      },
    ],
    rows,
    includeTotals: true,
  })
}
