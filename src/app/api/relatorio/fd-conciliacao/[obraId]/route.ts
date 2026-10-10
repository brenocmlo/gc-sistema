import { renderToBuffer } from '@react-pdf/renderer'
import { NextResponse, type NextRequest } from 'next/server'

import {
  ConciliacaoFdPdf,
  type FdItemPdf,
} from '@/lib/pdf/conciliacao-fd'
import { createClient } from '@/lib/supabase/server'

// Os perfis do layout de /fd (13.3): a conciliação é do financeiro.
const PERFIS_COM_ACESSO = ['admin', 'financeiro', 'visualizador']

export async function GET(
  _req: NextRequest,
  { params }: { params: { obraId: string } },
) {
  const supabase = createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Profile + empresa em paralelo
  const { data: profile } = await supabase
    .from('profiles')
    .select('empresa_id, nome, email, perfil')
    .eq('id', user.id)
    .maybeSingle()

  if (!profile) {
    return NextResponse.json({ error: 'Perfil não configurado' }, { status: 400 })
  }
  if (!PERFIS_COM_ACESSO.includes(profile.perfil)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const [empresaRes, obraRes, fdRes] = await Promise.all([
    supabase
      .from('empresas')
      .select(
        'nome, razao_social, cnpj, email, telefone, endereco, cidade, cep, logo_url',
      )
      .eq('id', profile.empresa_id)
      .maybeSingle(),
    supabase
      .from('obras')
      .select('codigo_obra, nome, cliente:clientes(nome)')
      .eq('id', params.obraId)
      .maybeSingle(),
    supabase
      .from('fd')
      .select(
        'data_lancamento, pedido_documento, fornecedor, especificacao, quantidade, valor, valor_descontar, diferenca_favor, data_vencimento, data_pagamento',
      )
      .eq('obra_id', params.obraId)
      .order('data_lancamento', { ascending: true }),
  ])

  if (!empresaRes.data) {
    return NextResponse.json({ error: 'Empresa não encontrada' }, { status: 404 })
  }
  if (!obraRes.data) {
    return NextResponse.json({ error: 'Obra não encontrada' }, { status: 404 })
  }

  const items = (fdRes.data ?? []) as FdItemPdf[]
  const cliente = obraRes.data.cliente as { nome: string } | null

  const buffer = await renderToBuffer(
    ConciliacaoFdPdf({
      empresa: empresaRes.data,
      obra: {
        codigo_obra: obraRes.data.codigo_obra,
        nome: obraRes.data.nome,
        cliente_nome: cliente?.nome ?? '—',
      },
      items,
      emitidoPor: profile.nome ?? profile.email ?? user.email ?? 'usuário',
    }),
  )

  const safeCodigo = obraRes.data.codigo_obra.replace(/[^\w\-]/g, '_')
  const filename = `conciliacao-fd-${safeCodigo}-${new Date().toISOString().slice(0, 10)}.pdf`

  return new NextResponse(buffer as unknown as ArrayBuffer, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
}
