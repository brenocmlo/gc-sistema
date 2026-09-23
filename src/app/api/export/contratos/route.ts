import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'

import {
  BRL_FORMAT,
  DATE_FORMAT,
  buildWorkbookResponse,
  todayStr,
} from '@/lib/excel-export'
import { STATUS_CONTRATO_LABELS, isContratoStatus } from '@/lib/contratos'
import { computePeriodoCutoff, sanitizeBusca } from '@/lib/listagem'
import { formatPct, obraIdsDaBusca } from '@/lib/propostas'
import { createClient } from '@/lib/supabase/server'
import { MOTIVO_RESCISAO_LABELS, type ContratoStatus } from '@/lib/types'

type Row = {
  numero: string
  obra: string
  cliente: string | null
  data_assinatura: string | null
  prazo_execucao: string | null
  status: string
  origem: string
  valor_total: number | null
  desconto: number | null
  valor_final: number | null
  condicoes: string
  motivo_rescisao: string | null
}

// Os mesmos perfis do layout de /contratos. A rota de API não passa pelo
// layout, então repete a regra: financeiro não vê contratos pela tela e não
// os baixa por aqui.
const PERFIS_COM_ACESSO = ['admin', 'comercial', 'visualizador']

export async function GET(req: NextRequest) {
  const supabase = createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

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
  const periodoFilter = sp.get('periodo') ?? ''

  let query = supabase
    .from('contratos')
    .select(
      'numero, data_assinatura, prazo_execucao, status, valor_total, desconto, valor_final, condicoes_pagamento, motivo_rescisao, detalhe_rescisao, pct_sinal, pct_fd, pct_entrega_material, pct_medicao_instalacao, obra:obras(codigo_obra, nome, cliente:clientes(nome)), proposta_origem:propostas(numero)',
    )
    .order('data_assinatura', { ascending: false, nullsFirst: false })
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

  if (statusFilter && isContratoStatus(statusFilter)) {
    query = query.eq('status', statusFilter)
  }

  // Período sobre a data de assinatura, como na listagem.
  const cutoff = computePeriodoCutoff(periodoFilter)
  if (cutoff) query = query.gte('data_assinatura', cutoff)

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
    const origem = d.proposta_origem as { numero: string } | null

    const status = d.status as ContratoStatus

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

    const motivo = d.motivo_rescisao
      ? (MOTIVO_RESCISAO_LABELS[
          d.motivo_rescisao as keyof typeof MOTIVO_RESCISAO_LABELS
        ] ?? d.motivo_rescisao)
      : null

    return {
      numero: d.numero,
      obra: obra ? `${obra.codigo_obra} — ${obra.nome}` : '',
      cliente: obra?.cliente?.nome ?? null,
      data_assinatura: d.data_assinatura,
      prazo_execucao: d.prazo_execucao,
      status: STATUS_CONTRATO_LABELS[status] ?? status,
      origem: origem ? `Proposta ${origem.numero}` : 'Avulso',
      valor_total: d.valor_total as number | null,
      desconto: d.desconto as number | null,
      valor_final: d.valor_final as number | null,
      condicoes,
      motivo_rescisao: motivo
        ? d.detalhe_rescisao
          ? `${motivo} — ${d.detalhe_rescisao}`
          : motivo
        : null,
    } satisfies Row
  })

  const metaParts = [
    busca ? `busca="${busca}"` : null,
    obraFilter ? 'obra=filtrada' : null,
    statusFilter ? `status=${statusFilter}` : null,
    periodoFilter ? `período=${periodoFilter}` : null,
  ].filter(Boolean)

  return buildWorkbookResponse(`contratos-${todayStr()}.xlsx`, {
    sheetName: 'Contratos',
    metaRows: [
      ['Contratos'],
      [`Emitido em: ${new Date().toLocaleString('pt-BR')}`],
      [`Filtros: ${metaParts.length > 0 ? metaParts.join(' · ') : 'nenhum'}`],
      [`Total de registros: ${rows.length}`],
    ],
    columns: [
      { header: 'Número', width: 18, value: (r) => r.numero },
      { header: 'Obra', width: 34, value: (r) => r.obra },
      { header: 'Cliente', width: 28, value: (r) => r.cliente ?? '' },
      {
        header: 'Assinatura',
        width: 14,
        value: (r) => (r.data_assinatura ? new Date(r.data_assinatura) : null),
        numFmt: DATE_FORMAT,
      },
      { header: 'Prazo', width: 20, value: (r) => r.prazo_execucao ?? '' },
      { header: 'Status', width: 14, value: (r) => r.status },
      { header: 'Origem', width: 24, value: (r) => r.origem },
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
        header: 'Motivo rescisão',
        width: 34,
        value: (r) => r.motivo_rescisao ?? '',
      },
    ],
    rows,
    includeTotals: true,
  })
}
