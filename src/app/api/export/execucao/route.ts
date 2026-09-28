import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'

import { DATE_FORMAT, buildWorkbookResponse, todayStr } from '@/lib/excel-export'
import {
  ETAPAS,
  ETAPA_LABELS,
  STATUS_ETAPA_LABELS,
  etapasAtrasadas,
  filtrarExecucoes,
  hojeISO,
  isEtapa,
  isEtapaStatus,
  isOrdemExecucao,
  ordenarExecucoes,
  progressoGeral,
  qtdsDaExecucao,
  statusDaEtapa,
  type Etapa,
} from '@/lib/execucao'
import { sanitizeBusca } from '@/lib/listagem'
import { createClient } from '@/lib/supabase/server'
import type { ExecucaoListItem } from '@/lib/types'

// Os mesmos perfis do layout de /execucao. A rota de API não passa pelo
// layout, então repete a regra.
const PERFIS_COM_ACESSO = ['admin', 'producao', 'medicao', 'visualizador']
/** Teto de linhas do PostgREST, como na tela. */
const LIMITE_POSTGREST = 1000

/**
 * Export da /execucao (bloco 8.5) com os filtros da tela aplicados: a mesma
 * query, `filtrarExecucoes` e `ordenarExecucoes` — se divergir, o XLSX não
 * bate com a tela de onde a pessoa clicou "Exportar". Sem paginação: vão todas
 * as linhas filtradas da obra.
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
  const obraId = sp.get('obra') ?? ''
  if (!obraId) return NextResponse.json({ error: 'Escolha uma obra' }, { status: 400 })
  const busca = sanitizeBusca(sp.get('busca') ?? '')
  const etapaParam = sp.get('etapa') ?? ''
  const etapa: Etapa | '' = isEtapa(etapaParam) ? etapaParam : ''
  const statusParam = sp.get('status') ?? ''
  const status = isEtapaStatus(statusParam) ? statusParam : ''
  const responsavel = sp.get('responsavel') ?? ''
  const ordemParam = sp.get('ordem') ?? ''
  const ordem = isOrdemExecucao(ordemParam) ? ordemParam : 'numero'
  const atrasados = sp.get('atrasados') === '1'
  const hoje = hojeISO()

  const [{ data: obra }, execRes] = await Promise.all([
    supabase.from('obras').select('codigo_obra, nome').eq('id', obraId).maybeSingle(),
    supabase
      .from('execucao')
      .select('*, item:itens!inner(id, numero, tipo, descricao, quantidade, unidade, obra_id)')
      .eq('item.obra_id', obraId)
      .limit(LIMITE_POSTGREST),
  ])
  if (!obra) return NextResponse.json({ error: 'Obra não encontrada' }, { status: 404 })
  if (execRes.error) return NextResponse.json({ error: execRes.error.message }, { status: 500 })

  const rows = ordenarExecucoes(
    filtrarExecucoes((execRes.data ?? []) as ExecucaoListItem[], { etapa, status, responsavel, busca, atrasados, hoje }),
    ordem,
    hoje,
  )

  const metaParts = [
    busca ? `busca="${busca}"` : null,
    etapa ? `etapa=${ETAPA_LABELS[etapa]}` : null,
    status ? `status=${STATUS_ETAPA_LABELS[status]}` : null,
    responsavel ? `responsável="${responsavel}"` : null,
    atrasados ? 'só atrasados' : null,
    ordem === 'atraso' ? 'ordem por atraso' : null,
  ].filter(Boolean)

  const colunasDaEtapa = (e: Etapa) => [
    { header: `${ETAPA_LABELS[e]} — qtd.`, width: 12, value: (r: ExecucaoListItem) => Number(qtdsDaExecucao(r)[e]) },
    {
      header: `${ETAPA_LABELS[e]} — status`,
      width: 14,
      value: (r: ExecucaoListItem) => STATUS_ETAPA_LABELS[statusDaEtapa(qtdsDaExecucao(r)[e], r.quantidade_total)],
    },
    {
      header: `${ETAPA_LABELS[e]} — previsão`,
      width: 13,
      value: (r: ExecucaoListItem) => {
        const p = r[`${e}_previsao_fim`]
        return p ? new Date(`${p}T00:00:00Z`) : null
      },
      numFmt: DATE_FORMAT,
    },
    { header: `${ETAPA_LABELS[e]} — responsável`, width: 20, value: (r: ExecucaoListItem) => r[`${e}_responsavel`] ?? '' },
  ]

  return buildWorkbookResponse(`execucao-${obra.codigo_obra.replace(/[^\w\-]/g, '_')}-${todayStr()}.xlsx`, {
    sheetName: 'Execução',
    metaRows: [
      [`Execução — ${obra.codigo_obra} — ${obra.nome}`],
      [`Emitido em: ${new Date().toLocaleString('pt-BR')}`],
      [`Filtros: ${metaParts.length > 0 ? metaParts.join(' · ') : 'nenhum'}`],
      [`Total de registros: ${rows.length}`],
    ],
    columns: [
      { header: 'Item', width: 7, value: (r) => r.item?.numero ?? '' },
      { header: 'Tipo', width: 16, value: (r) => r.item?.tipo ?? '' },
      { header: 'Descrição', width: 32, value: (r) => r.item?.descricao ?? '' },
      { header: 'Execução', width: 10, value: (r) => r.sequencial },
      { header: 'Localização', width: 22, value: (r) => r.localizacao ?? '' },
      { header: 'Qtd. total', width: 11, value: (r) => Number(r.quantidade_total) },
      { header: 'Unid.', width: 7, value: (r) => r.item?.unidade ?? '' },
      ...ETAPAS.flatMap(colunasDaEtapa),
      {
        header: 'Progresso geral (%)',
        width: 12,
        value: (r) => progressoGeral(qtdsDaExecucao(r), r.quantidade_total),
      },
      {
        header: 'Atrasada em',
        width: 24,
        value: (r) => etapasAtrasadas(r, hoje).map((e) => ETAPA_LABELS[e]).join(', '),
      },
    ],
    rows,
  })
}
