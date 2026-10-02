import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'

import { filtroDeAcordos } from '@/app/(app)/financeiro/acordos/filtro'
import {
  isAcordoMotivo,
  isAcordoStatus,
  MOTIVO_ACORDO_LABELS,
  resumoDasParcelas,
  resumoFinanceiroDoAcordo,
  STATUS_ACORDO_LABELS,
} from '@/lib/acordos'
import { BRL_FORMAT, DATE_FORMAT, buildWorkbookResponse, todayStr, type Destaque } from '@/lib/excel-export'
import { hojeISO } from '@/lib/execucao'
import { numeroComSerie } from '@/lib/notas-fiscais'
import { createClient } from '@/lib/supabase/server'
import type { AcordoMotivo, AcordoStatus, ParcelaStatus } from '@/lib/types'

const PERFIS_COM_ACESSO = ['admin', 'financeiro', 'visualizador']

type Linha = {
  descricao: string
  motivo: AcordoMotivo | null
  periodo_ref: string | null
  data_abertura: string
  data_encerramento: string | null
  status: AcordoStatus
  obra: { codigo_obra: string; nome: string } | null
  nf: { numero: string; serie: string | null } | null
  parcelas: { valor_previsto: number; status: ParcelaStatus; data_vencimento: string; pagamentos: { valor: number }[] | null }[] | null
}

/**
 * Export da listagem de acordos (11.5) com os filtros da tela (filtro.ts, os
 * mesmos da página). Valor total, recebido e saldo são os do cabeçalho do
 * acordo (resumoFinanceiroDoAcordo): o recebido do convertido é o que ficou
 * arquivado nas views (regra 7).
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
  const hoje = hojeISO()
  const { data: obras } = await supabase.from('obras').select('id, codigo_obra, nome')
  const { filtrar, valores } = filtroDeAcordos(
    { busca: sp.get('busca'), obra: sp.get('obra'), status: sp.get('status'), motivo: sp.get('motivo'), periodo: sp.get('periodo') },
    obras ?? [],
  )

  const { data, error } = await filtrar(
    supabase
      .from('acordos_pagamento')
      .select(
        'descricao, motivo, periodo_ref, data_abertura, data_encerramento, status, obra:obras(codigo_obra, nome), nf:notas_fiscais!acordo_nf_convertida_fk(numero, serie), parcelas:acordo_parcelas(valor_previsto, status, data_vencimento, pagamentos(valor))',
      ),
  )
    .order('data_abertura', { ascending: false })
    .order('created_at', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const rows = ((data ?? []) as Linha[]).map((a) => ({
    ...a,
    resumo: resumoFinanceiroDoAcordo(a.parcelas),
    contagem: resumoDasParcelas(a.parcelas, hoje),
  }))
  const metaParts = [
    valores.busca ? `busca="${valores.busca}"` : null,
    valores.obra ? 'obra=filtrada' : null,
    isAcordoStatus(valores.status) ? `status=${STATUS_ACORDO_LABELS[valores.status]}` : null,
    isAcordoMotivo(valores.motivo) ? `motivo=${MOTIVO_ACORDO_LABELS[valores.motivo]}` : null,
    valores.periodo ? `período=${valores.periodo}` : null,
  ].filter(Boolean)

  const data_ = (v: string | null) => (v ? new Date(`${v}T00:00:00Z`) : null)
  // Os selos da tela: quitado em verde; aberto com atrasada em vermelho, sem, em âmbar; o resto neutro.
  const destaque = (r: (typeof rows)[number]): Destaque =>
    r.status === 'quitado' ? 'positivo' : r.status === 'aberto' ? (r.contagem.atrasadas > 0 ? 'negativo' : 'atencao') : 'neutro'

  return buildWorkbookResponse(`acordos-${todayStr()}.xlsx`, {
    sheetName: 'Acordos',
    metaRows: [
      ['Acordos de pagamento'],
      [`Emitido em: ${new Date().toLocaleString('pt-BR')}`],
      [`Filtros: ${metaParts.length > 0 ? metaParts.join(' · ') : 'nenhum'}`],
      [`Total de registros: ${rows.length}`],
    ],
    columns: [
      { header: 'Descrição', width: 34, value: (r) => r.descricao },
      { header: 'Obra', width: 32, value: (r) => (r.obra ? `${r.obra.codigo_obra} — ${r.obra.nome}` : '') },
      { header: 'Motivo', width: 22, value: (r) => (r.motivo ? (MOTIVO_ACORDO_LABELS[r.motivo] ?? r.motivo) : '') },
      { header: 'Período ref.', width: 14, value: (r) => r.periodo_ref ?? '' },
      { header: 'Abertura', width: 12, value: (r) => data_(r.data_abertura), numFmt: DATE_FORMAT },
      { header: 'Encerramento', width: 13, value: (r) => data_(r.data_encerramento), numFmt: DATE_FORMAT },
      { header: 'Valor total', width: 15, value: (r) => r.resumo.total, numFmt: BRL_FORMAT, sum: true },
      { header: 'Recebido', width: 15, value: (r) => r.resumo.recebido, numFmt: BRL_FORMAT, sum: true },
      { header: 'Saldo', width: 15, value: (r) => (r.status === 'aberto' ? r.resumo.saldo : 0), numFmt: BRL_FORMAT, sum: true },
      { header: 'Nº parcelas', width: 11, value: (r) => r.contagem.validas, align: 'center' },
      { header: 'Atrasadas', width: 10, value: (r) => (r.status === 'aberto' ? r.contagem.atrasadas : 0), align: 'center' },
      { header: 'Status', width: 18, value: (r) => STATUS_ACORDO_LABELS[r.status], align: 'center', destaque },
      { header: 'NF da conversão', width: 20, value: (r) => (r.nf ? numeroComSerie(r.nf.numero, r.nf.serie) : '') },
    ],
    rows,
    includeTotals: true,
  })
}
