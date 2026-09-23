import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'

import {
  BRL_FORMAT,
  DATE_FORMAT,
  buildWorkbookResponse,
  todayStr,
} from '@/lib/excel-export'
import { computePeriodoCutoff, sanitizeBusca } from '@/lib/listagem'
import {
  STATUS_PROPOSTA_LABELS,
  formatPct,
  isPropostaStatus,
  obraIdsDaBusca,
} from '@/lib/propostas'
import { createClient } from '@/lib/supabase/server'
import { MOTIVO_REJEICAO_LABELS, type PropostaStatus } from '@/lib/types'

type Row = {
  numero: string
  obra: string
  cliente: string | null
  data_emissao: string | null
  data_validade: string | null
  status: string
  vencida: string
  valor_total: number | null
  desconto: number | null
  valor_final: number | null
  condicoes: string
  motivo_rejeicao: string | null
}

const PERFIS_COM_ACESSO = ['admin', 'comercial', 'visualizador']

export async function GET(req: NextRequest) {
  const supabase = createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Os mesmos perfis do layout de /propostas. A rota de API não passa pelo layout,
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
  const busca = sanitizeBusca(sp.get('busca') ?? '')
  const obraFilter = sp.get('obra') ?? ''
  const statusFilter = sp.get('status') ?? ''
  const vencidasFilter = sp.get('vencidas') === '1'
  const periodoFilter = sp.get('periodo') ?? ''

  const hoje = new Date().toISOString().slice(0, 10)

  let query = supabase
    .from('propostas')
    .select(
      'numero, data_emissao, data_validade, status, valor_total, desconto, valor_final, condicoes_pagamento, motivo_rejeicao, pct_sinal, pct_fd, pct_entrega_material, pct_medicao_instalacao, obra:obras(codigo_obra, nome, cliente:clientes(nome))',
    )
    .order('data_emissao', { ascending: false, nullsFirst: false })
    .order('numero', { ascending: false })

  // Mesma resolução de IDs da listagem — se divergir, o XLSX não bate com a
  // tela de onde o usuário clicou "Exportar".
  if (busca) {
    const [{ data: obras }, { data: clientesMatch }] = await Promise.all([
      supabase.from('obras').select('id, codigo_obra, nome, cliente_id'),
      supabase.from('clientes').select('id').ilike('nome', `%${busca}%`),
    ])

    const obraIds = obraIdsDaBusca(
      obras ?? [],
      busca,
      (clientesMatch ?? []).map((c) => c.id),
    )

    const filters = [
      `numero.ilike.%${busca}%`,
      obraIds.length > 0 ? `obra_id.in.(${obraIds.join(',')})` : null,
    ].filter(Boolean)

    query = query.or(filters.join(','))
  }

  if (obraFilter) query = query.eq('obra_id', obraFilter)

  if (vencidasFilter) {
    query = query.eq('status', 'enviada').lt('data_validade', hoje)
  } else if (statusFilter && isPropostaStatus(statusFilter)) {
    query = query.eq('status', statusFilter)
  }

  const cutoff = computePeriodoCutoff(periodoFilter)
  if (cutoff) query = query.gte('data_emissao', cutoff)

  const { data, error } = await query

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const rows = (data ?? []).map((d) => {
    const obra = d.obra as {
      codigo_obra: string
      nome: string
      cliente: { nome: string } | null
    } | null

    const status = d.status as PropostaStatus

    // "Vencida" não existe no banco: é derivado, e vai como coluna própria
    // pra planilha não perder a informação que a tela mostra em selo.
    const vencida =
      status === 'enviada' && d.data_validade && d.data_validade < hoje

    const condicoes = [
      d.pct_sinal ? `Sinal ${formatPct(d.pct_sinal)}` : null,
      d.pct_fd ? `FD ${formatPct(d.pct_fd)}` : null,
      d.pct_entrega_material
        ? `Entrega ${formatPct(d.pct_entrega_material)}`
        : null,
      d.pct_medicao_instalacao
        ? `Medição ${formatPct(d.pct_medicao_instalacao)}`
        : null,
      d.condicoes_pagamento,
    ]
      .filter(Boolean)
      .join(' · ')

    return {
      numero: d.numero,
      obra: obra ? `${obra.codigo_obra} — ${obra.nome}` : '',
      cliente: obra?.cliente?.nome ?? null,
      data_emissao: d.data_emissao,
      data_validade: d.data_validade,
      status: STATUS_PROPOSTA_LABELS[status] ?? status,
      vencida: vencida ? 'Sim' : '',
      valor_total: d.valor_total as number | null,
      desconto: d.desconto as number | null,
      valor_final: d.valor_final as number | null,
      condicoes,
      motivo_rejeicao: d.motivo_rejeicao
        ? (MOTIVO_REJEICAO_LABELS[
            d.motivo_rejeicao as keyof typeof MOTIVO_REJEICAO_LABELS
          ] ?? d.motivo_rejeicao)
        : null,
    } satisfies Row
  })

  const metaParts = [
    busca ? `busca="${busca}"` : null,
    obraFilter ? 'obra=filtrada' : null,
    statusFilter ? `status=${statusFilter}` : null,
    vencidasFilter ? 'somente vencidas' : null,
    periodoFilter ? `período=${periodoFilter}` : null,
  ].filter(Boolean)

  return buildWorkbookResponse(`propostas-${todayStr()}.xlsx`, {
    sheetName: 'Propostas',
    metaRows: [
      ['Propostas'],
      [`Emitido em: ${new Date().toLocaleString('pt-BR')}`],
      [`Filtros: ${metaParts.length > 0 ? metaParts.join(' · ') : 'nenhum'}`],
      [`Total de registros: ${rows.length}`],
    ],
    columns: [
      { header: 'Número', width: 18, value: (r) => r.numero },
      { header: 'Obra', width: 34, value: (r) => r.obra },
      { header: 'Cliente', width: 28, value: (r) => r.cliente ?? '' },
      {
        header: 'Emissão',
        width: 14,
        value: (r) => (r.data_emissao ? new Date(r.data_emissao) : null),
        numFmt: DATE_FORMAT,
      },
      {
        header: 'Validade',
        width: 14,
        value: (r) => (r.data_validade ? new Date(r.data_validade) : null),
        numFmt: DATE_FORMAT,
      },
      { header: 'Status', width: 14, value: (r) => r.status },
      { header: 'Vencida', width: 10, value: (r) => r.vencida },
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
      { header: 'Condições', width: 40, value: (r) => r.condicoes },
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
