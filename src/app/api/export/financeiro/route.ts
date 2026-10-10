import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'

import { carregarVisaoGeral } from '@/app/(app)/financeiro/visao-geral/carregar'
import { BRL_FORMAT, buildWorkbookResponse, todayStr, type Destaque } from '@/lib/excel-export'
import { hojeISO } from '@/lib/execucao'
import { PERIODO_FINANCEIRO_OPTIONS, type LinhaObra } from '@/lib/financeiro-empresa'
import { formatCurrency, formatDate } from '@/lib/format'
import { createClient } from '@/lib/supabase/server'

const PERFIS_COM_ACESSO = ['admin', 'financeiro', 'visualizador']

/**
 * Export da visão geral do financeiro (12.2): a tabela por obra, com os
 * filtros da tela (carregar.ts, o mesmo da página) e os quatro cards no
 * cabeçalho. Faturado e recebido seguem o período; saldo e % recebido são da
 * obra inteira.
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
  const obra = sp.get('obra') ?? ''
  const v = await carregarVisaoGeral(supabase, { obra, periodo: sp.get('periodo') }, hojeISO())

  const metaParts: string[] = []
  const rotuloPeriodo = PERIODO_FINANCEIRO_OPTIONS.find((o) => o.value === v.periodo)?.label ?? v.periodo
  metaParts.push(`Período: ${rotuloPeriodo}${v.inicio ? ` (desde ${formatDate(v.inicio)})` : ''}`)
  if (obra) {
    const { data: o } = await supabase.from('obras').select('codigo_obra, nome').eq('id', obra).maybeSingle()
    metaParts.push(`Obra: ${o ? `${o.codigo_obra} — ${o.nome}` : obra}`)
  }
  const destaque = (r: LinhaObra): Destaque | null => (r.saldo < 0 ? 'atencao' : r.saldo === 0 ? 'positivo' : null)

  return buildWorkbookResponse(`financeiro-${todayStr()}.xlsx`, {
    sheetName: 'Visão geral',
    metaRows: [
      ['Financeiro — visão geral'],
      [`Emitido em: ${new Date().toLocaleString('pt-BR')}`],
      [`Filtros: ${metaParts.join(' · ')}`],
      [`A receber: ${formatCurrency(v.cards.aReceber)} · Recebido: ${formatCurrency(v.cards.recebidoNoPeriodo)} · Atrasado: ${formatCurrency(v.cards.atrasado)} · Previsto para 30 dias: ${formatCurrency(v.cards.previsto30)}`],
      [`Total de registros: ${v.obras.length}`],
    ],
    columns: [
      { header: 'Obra', width: 16, value: (r) => r.codigo },
      { header: 'Nome', width: 34, value: (r) => r.nome },
      { header: v.periodo === 'tudo' ? 'Faturado' : 'Faturado no período', width: 18, value: (r) => r.faturado, numFmt: BRL_FORMAT, sum: true },
      { header: v.periodo === 'tudo' ? 'Recebido' : 'Recebido no período', width: 18, value: (r) => r.recebido, numFmt: BRL_FORMAT, sum: true },
      { header: 'Saldo atual', width: 16, value: (r) => r.saldo, numFmt: BRL_FORMAT, sum: true, destaque },
      { header: '% recebido', width: 12, value: (r) => (r.pctRecebido === null ? null : r.pctRecebido / 100), numFmt: '0.0%' },
    ],
    rows: v.obras,
    includeTotals: true,
  })
}
