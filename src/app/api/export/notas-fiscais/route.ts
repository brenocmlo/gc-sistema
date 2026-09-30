import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'

import { BRL_FORMAT, DATE_FORMAT, buildWorkbookResponse, todayStr } from '@/lib/excel-export'
import { hojeISO } from '@/lib/execucao'
import { computePeriodoCutoff, sanitizeBusca } from '@/lib/listagem'
import {
  filtroDaSituacao,
  isNfTipo,
  isSituacaoNf,
  recebidoDaNf,
  SITUACAO_NF_LABELS,
  situacaoDaNf,
  TIPO_NF_LABELS,
} from '@/lib/notas-fiscais'
import { createClient } from '@/lib/supabase/server'
import type { NotaFiscalStatus, NotaFiscalTipo } from '@/lib/types'

// Os perfis do layout de /financeiro. A rota de API não passa pelo layout.
const PERFIS_COM_ACESSO = ['admin', 'financeiro', 'visualizador']

type Linha = {
  numero: string
  serie: string | null
  chave_nfe: string | null
  tipo: NotaFiscalTipo
  status: NotaFiscalStatus
  data_emissao: string
  data_vencimento: string | null
  data_cancelamento: string | null
  motivo_cancelamento: string | null
  valor_total: number
  obra: { codigo_obra: string; nome: string } | null
  contrato: { numero: string } | null
  proposta: { numero: string } | null
  pagamentos: { valor: number }[] | null
}

/**
 * Export da listagem de NFs (9.6) com os filtros da tela: a mesma busca, os
 * mesmos filtros e a mesma regra de "vencida" de page.tsx — se divergir, o
 * XLSX não bate com a tela de onde a pessoa clicou "Exportar".
 */
export async function GET(req: NextRequest) {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { data: profile } = await supabase.from('profiles').select('perfil').eq('id', user.id).maybeSingle()
  if (!profile || !PERFIS_COM_ACESSO.includes(profile.perfil)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const sp = req.nextUrl.searchParams
  const busca = sanitizeBusca(sp.get('busca') ?? '')
  const obraFilter = sp.get('obra') ?? ''
  const tipoFilter = sp.get('tipo') ?? ''
  const statusFilter = sp.get('status') ?? ''
  const periodoFilter = sp.get('periodo') ?? ''
  const hoje = hojeISO()

  const { data: obras } = await supabase.from('obras').select('id, codigo_obra, nome')

  let query = supabase
    .from('notas_fiscais')
    .select(
      'numero, serie, chave_nfe, tipo, status, data_emissao, data_vencimento, data_cancelamento, motivo_cancelamento, valor_total, obra:obras(codigo_obra, nome), contrato:contratos(numero), proposta:propostas(numero), pagamentos(valor)',
    )
    .order('data_emissao', { ascending: false })
    .order('numero', { ascending: false })

  if (busca) {
    const termo = busca.toLowerCase()
    const obraIds = (obras ?? [])
      .filter((o) => o.codigo_obra.toLowerCase().includes(termo) || o.nome.toLowerCase().includes(termo))
      .map((o) => o.id)
    const filtros = [
      `numero.ilike.%${busca}%`,
      `chave_nfe.ilike.%${busca}%`,
      obraIds.length > 0 ? `obra_id.in.(${obraIds.join(',')})` : null,
    ].filter(Boolean)
    query = query.or(filtros.join(','))
  }
  if (obraFilter) query = query.eq('obra_id', obraFilter)
  if (tipoFilter && isNfTipo(tipoFilter)) query = query.eq('tipo', tipoFilter)
  if (statusFilter && isSituacaoNf(statusFilter)) {
    const f = filtroDaSituacao(statusFilter, hoje)
    query = query.in('status', f.status)
    if (f.vencimentoAntesDe) query = query.lt('data_vencimento', f.vencimentoAntesDe)
    if (f.naoVencidaEm) query = query.or(`data_vencimento.is.null,data_vencimento.gte.${f.naoVencidaEm}`)
  }
  const cutoff = computePeriodoCutoff(periodoFilter)
  if (cutoff) query = query.gte('data_emissao', cutoff)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const rows = (data ?? []) as Linha[]
  const metaParts = [
    busca ? `busca="${busca}"` : null,
    obraFilter ? 'obra=filtrada' : null,
    tipoFilter && isNfTipo(tipoFilter) ? `tipo=${TIPO_NF_LABELS[tipoFilter]}` : null,
    statusFilter && isSituacaoNf(statusFilter) ? `status=${SITUACAO_NF_LABELS[statusFilter]}` : null,
    periodoFilter ? `período=${periodoFilter}` : null,
  ].filter(Boolean)

  const data_ = (v: string | null) => (v ? new Date(`${v}T00:00:00Z`) : null)

  return buildWorkbookResponse(`notas-fiscais-${todayStr()}.xlsx`, {
    sheetName: 'Notas fiscais',
    metaRows: [
      ['Notas fiscais'],
      [`Emitido em: ${new Date().toLocaleString('pt-BR')}`],
      [`Filtros: ${metaParts.length > 0 ? metaParts.join(' · ') : 'nenhum'}`],
      [`Total de registros: ${rows.length}`],
    ],
    columns: [
      { header: 'Número', width: 16, value: (r) => r.numero },
      { header: 'Série', width: 8, value: (r) => r.serie ?? '' },
      { header: 'Obra', width: 34, value: (r) => (r.obra ? `${r.obra.codigo_obra} — ${r.obra.nome}` : '') },
      { header: 'Tipo', width: 20, value: (r) => TIPO_NF_LABELS[r.tipo] ?? r.tipo },
      {
        header: 'Vínculo',
        width: 22,
        value: (r) => (r.contrato ? `Contrato ${r.contrato.numero}` : r.proposta ? `Proposta ${r.proposta.numero}` : 'Sem vínculo'),
      },
      { header: 'Emissão', width: 12, value: (r) => data_(r.data_emissao), numFmt: DATE_FORMAT },
      { header: 'Vencimento', width: 12, value: (r) => data_(r.data_vencimento), numFmt: DATE_FORMAT },
      { header: 'Valor', width: 15, value: (r) => Number(r.valor_total), numFmt: BRL_FORMAT, sum: true },
      { header: 'Recebido', width: 15, value: (r) => recebidoDaNf(r.pagamentos), numFmt: BRL_FORMAT, sum: true },
      { header: 'Status', width: 18, value: (r) => SITUACAO_NF_LABELS[situacaoDaNf(r, hoje)] },
      { header: 'Chave da NF-e', width: 48, value: (r) => r.chave_nfe ?? '' },
      {
        header: 'Cancelamento',
        width: 40,
        value: (r) => (r.status === 'cancelada' ? `${r.data_cancelamento ?? ''} — ${r.motivo_cancelamento ?? ''}` : ''),
      },
    ],
    rows,
    includeTotals: true,
  })
}
