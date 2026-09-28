import { renderToBuffer } from '@react-pdf/renderer'
import { NextResponse, type NextRequest } from 'next/server'

import { montarRelatorioDeMedicao, validarPeriodo, type ExecucaoParaMedicao } from '@/lib/medicao'
import { MedicaoPdf } from '@/lib/pdf/medicao'
import { createClient } from '@/lib/supabase/server'

/**
 * Quem emite o relatório que vai para o cliente aprovar: medição e
 * financeiro (quem fatura), além do admin. A RLS de leitura é por empresa, então
 * a rota repete a regra de perfil.
 */
const PERFIS_QUE_EMITEM = ['admin', 'medicao', 'financeiro']
/** Teto de linhas do PostgREST, como na /execucao. */
const LIMITE_POSTGREST = 1000

export async function GET(req: NextRequest, { params }: { params: { obraId: string } }) {
  const supabase = createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('empresa_id, nome, email, perfil')
    .eq('id', user.id)
    .maybeSingle()
  if (!profile) return NextResponse.json({ error: 'Perfil não configurado' }, { status: 400 })
  if (!PERFIS_QUE_EMITEM.includes(profile.perfil)) {
    return NextResponse.json({ error: 'Sem permissão para emitir o relatório de medição' }, { status: 403 })
  }

  const periodo = validarPeriodo(req.nextUrl.searchParams.get('de'), req.nextUrl.searchParams.get('ate'))
  if (!periodo.ok) return NextResponse.json({ error: periodo.error }, { status: 400 })

  const [empresaRes, obraRes, execRes] = await Promise.all([
    supabase
      .from('empresas')
      .select('nome, razao_social, cnpj, email, telefone, endereco, cidade, cep, logo_url')
      .eq('id', profile.empresa_id)
      .maybeSingle(),
    supabase.from('obras').select('codigo_obra, nome, cliente:clientes(nome)').eq('id', params.obraId).maybeSingle(),
    supabase
      .from('execucao')
      .select('id, item_id, med_qtd, valor_unit, item:itens!inner(numero, tipo, descricao, quantidade, unidade, obra_id)')
      .eq('item.obra_id', params.obraId)
      .limit(LIMITE_POSTGREST),
  ])

  if (!empresaRes.data) return NextResponse.json({ error: 'Empresa não encontrada' }, { status: 404 })
  if (!obraRes.data) return NextResponse.json({ error: 'Obra não encontrada' }, { status: 404 })
  if (execRes.error) return NextResponse.json({ error: execRes.error.message }, { status: 500 })

  const execucoes = (execRes.data ?? []) as ExecucaoParaMedicao[]
  const ids = execucoes.map((e) => e.id)
  const histRes = ids.length
    ? await supabase.from('execucao_medicoes').select('execucao_id, data, qtd_anterior, qtd_nova').in('execucao_id', ids)
    : { data: [], error: null }
  if (histRes.error) return NextResponse.json({ error: histRes.error.message }, { status: 500 })

  const cliente = obraRes.data.cliente as { nome: string } | null
  const buffer = await renderToBuffer(
    MedicaoPdf({
      empresa: empresaRes.data,
      obra: { codigo_obra: obraRes.data.codigo_obra, nome: obraRes.data.nome, cliente_nome: cliente?.nome ?? '—' },
      periodo: periodo.periodo,
      relatorio: montarRelatorioDeMedicao(execucoes, histRes.data ?? [], periodo.periodo),
      emitidoPor: profile.nome ?? profile.email ?? user.email ?? 'usuário',
    }),
  )

  const safeCodigo = obraRes.data.codigo_obra.replace(/[^\w\-]/g, '_')
  const filename = `medicao-${safeCodigo}-${periodo.periodo.de}-a-${periodo.periodo.ate}.pdf`
  return new NextResponse(buffer as unknown as ArrayBuffer, {
    headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${filename}"` },
  })
}
