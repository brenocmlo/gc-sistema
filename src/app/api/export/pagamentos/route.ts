import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'

import { filtroDePagamentos } from '@/app/(app)/financeiro/pagamentos/filtro'
import { BRL_FORMAT, DATE_FORMAT, buildWorkbookResponse, todayStr } from '@/lib/excel-export'
import { FORMA_PAGAMENTO_LABELS, documentoDoPagamento, isPagamentoForma, isPagamentoOrigem, ORIGEM_PAGAMENTO_LABELS, rotuloForma } from '@/lib/pagamentos'
import { createClient } from '@/lib/supabase/server'
import type { PagamentoListItem } from '@/lib/types'

const PERFIS_COM_ACESSO = ['admin', 'financeiro', 'visualizador']

type Linha = PagamentoListItem & { created_at: string | null }

/**
 * Export da listagem de pagamentos (10.6) com os filtros da tela. Os filtros
 * vêm de `filtro.ts`, os mesmos da página e do totalizador: o total da
 * planilha é o do topo da listagem.
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
  const { data: obras } = await supabase.from('obras').select('id, codigo_obra, nome')
  const { filtrar, valores } = await filtroDePagamentos(
    supabase,
    { busca: sp.get('busca'), obra: sp.get('obra'), origem: sp.get('origem'), forma: sp.get('forma'), periodo: sp.get('periodo') },
    obras ?? [],
  )

  const { data, error } = await filtrar(
    supabase
      .from('pagamentos')
      .select(
        'id, data_pagamento, obra_id, origem, forma, valor, observacao, nota_id, parcela_acordo_id, anexo, created_at, obra:obras(codigo_obra, nome), nota:notas_fiscais(numero, serie, status), parcela:acordo_parcelas(numero_parcela, acordo:acordos_pagamento(descricao))',
      ),
  )
    .order('data_pagamento', { ascending: false })
    .order('created_at', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const rows = (data ?? []) as Linha[]
  const metaParts = [
    valores.busca ? `busca="${valores.busca}"` : null,
    valores.obra ? 'obra=filtrada' : null,
    isPagamentoOrigem(valores.origem) ? `origem=${ORIGEM_PAGAMENTO_LABELS[valores.origem]}` : null,
    isPagamentoForma(valores.forma) ? `forma=${FORMA_PAGAMENTO_LABELS[valores.forma]}` : null,
    valores.periodo ? `período=${valores.periodo}` : null,
  ].filter(Boolean)

  const data_ = (v: string | null) => (v ? new Date(`${v}T00:00:00Z`) : null)

  return buildWorkbookResponse(`pagamentos-${todayStr()}.xlsx`, {
    sheetName: 'Pagamentos',
    metaRows: [
      ['Pagamentos'],
      [`Emitido em: ${new Date().toLocaleString('pt-BR')}`],
      [`Filtros: ${metaParts.length > 0 ? metaParts.join(' · ') : 'nenhum'}`],
      [`Total de registros: ${rows.length}`],
    ],
    columns: [
      { header: 'Data', width: 12, value: (r) => data_(r.data_pagamento), numFmt: DATE_FORMAT },
      { header: 'Obra', width: 34, value: (r) => (r.obra ? `${r.obra.codigo_obra} — ${r.obra.nome}` : '') },
      { header: 'Origem', width: 10, value: (r) => ORIGEM_PAGAMENTO_LABELS[r.origem] ?? r.origem },
      { header: 'Documento', width: 34, value: (r) => documentoDoPagamento(r) },
      { header: 'Forma', width: 12, value: (r) => rotuloForma(r.forma) },
      { header: 'Valor', width: 15, value: (r) => Number(r.valor), numFmt: BRL_FORMAT, sum: true },
      { header: 'Observação', width: 40, value: (r) => r.observacao ?? '' },
      { header: 'Comprovante', width: 13, value: (r) => (r.anexo ? 'Sim' : 'Não') },
    ],
    rows,
    includeTotals: true,
  })
}
