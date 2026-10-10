// POST /api/ingestao/resposta-obra — a resposta à pergunta da obra (decisão 31).
//
// O bot perguntou "de qual obra é este documento?" com uma lista numerada (as
// opções ficaram em documentos_processamento.opcoes_obra). Toda mensagem de
// texto de um contato cadastrado passa por aqui: se o chat tem pergunta
// aberta, o número escolhe a obra e o documento volta para a fila; se não tem,
// a rota diz isso e o n8n responde o de sempre ("envie o PDF").
//
// Máquina chamando, como as outras rotas de ingestão: x-ingestao-token,
// service role, e a rota confere ela mesma empresa e chat.
import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

import { tokenConfere } from '@/lib/ingestao'
import { interpretarRespostaDeObra, lerOpcoesGravadas, textoDaPergunta } from '@/lib/obra-do-documento'
import type { Database } from '@/lib/supabase/types'

export const dynamic = 'force-dynamic'

/** Pergunta mais velha que isto não vale mais: a revisão pela tela assume. */
const VALIDADE_PERGUNTA_DIAS = 7

function resposta(status: number, corpo: Record<string, unknown>) {
  return NextResponse.json(corpo, { status })
}

export async function POST(req: Request) {
  const tokenEsperado = process.env.INGESTAO_TOKEN
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!tokenEsperado || !url || !serviceRole) {
    return resposta(500, { ok: false, error: 'Rota de ingestão não configurada neste ambiente' })
  }
  if (!tokenConfere(req.headers.get('x-ingestao-token'), tokenEsperado)) {
    return resposta(401, { ok: false, error: 'Token de ingestão inválido' })
  }

  let corpo: { empresaId?: unknown; chatId?: unknown; texto?: unknown }
  try {
    corpo = await req.json()
  } catch {
    return resposta(422, { ok: false, error: 'Corpo da requisição não é JSON' })
  }
  const empresaId = typeof corpo.empresaId === 'string' ? corpo.empresaId : ''
  const chatId = corpo.chatId === undefined || corpo.chatId === null ? '' : String(corpo.chatId)
  if (!empresaId || !chatId) return resposta(422, { ok: false, error: 'empresaId e chatId são obrigatórios' })

  const supabase = createClient<Database>(url, serviceRole, { auth: { persistSession: false } })
  const desde = new Date(Date.now() - VALIDADE_PERGUNTA_DIAS * 86400e3).toISOString()
  const { data: doc, error: erroDoc } = await supabase
    .from('documentos_processamento')
    .select('id, empresa_id, tipo_documento, arquivo_url, opcoes_obra, motivo_revisao')
    .eq('empresa_id', empresaId)
    .eq('canal', 'TELEGRAM')
    .eq('canal_chat_id', chatId)
    .eq('status', 'REVISAO_HUMANA')
    .not('opcoes_obra', 'is', null)
    .gte('created_at', desde)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (erroDoc) return resposta(500, { ok: false, error: erroDoc.message })
  if (!doc) return resposta(200, { ok: true, acao: 'sem_pergunta' })

  const opcoes = lerOpcoesGravadas(doc.opcoes_obra)
  const r = interpretarRespostaDeObra(corpo.texto, opcoes)

  if (r.tipo === 'invalida') {
    return resposta(200, { ok: true, acao: 'repetir', documentoId: doc.id, pergunta: textoDaPergunta(opcoes) })
  }

  if (r.tipo === 'nenhuma') {
    const { error } = await supabase
      .from('documentos_processamento')
      .update({
        opcoes_obra: null,
        motivo_revisao: `${doc.motivo_revisao ?? 'Obra não identificada'} — quem enviou disse que a obra não está entre as cadastradas`,
      })
      .eq('id', doc.id)
    if (error) return resposta(500, { ok: false, error: error.message })
    return resposta(200, { ok: true, acao: 'nenhuma', documentoId: doc.id })
  }

  // A obra escolhida tem de continuar sendo da empresa (pode ter sido apagada
  // entre a pergunta e a resposta).
  const { data: obra } = await supabase.from('obras').select('id').eq('id', r.obraId).eq('empresa_id', empresaId).maybeSingle()
  if (!obra) return resposta(200, { ok: true, acao: 'repetir', documentoId: doc.id, pergunta: textoDaPergunta(opcoes), aviso: 'a obra escolhida não existe mais' })

  // Volta para a fila com a obra fixada; o n8n relê o PDF e a rota de
  // proposta/contrato usa esta obra em vez de procurar.
  const { error: erroUp } = await supabase
    .from('documentos_processamento')
    .update({ obra_id: r.obraId, opcoes_obra: null, status: 'PENDENTE', motivo_revisao: null, etapa: 'NA_FILA', etapa_detalhe: null })
    .eq('id', doc.id)
    .eq('status', 'REVISAO_HUMANA')
  if (erroUp) return resposta(500, { ok: false, error: erroUp.message })

  return resposta(200, {
    ok: true,
    acao: 'reprocessar',
    documentoId: doc.id,
    obra: r.rotulo,
    entrada: {
      documento_id: doc.id,
      empresa_id: doc.empresa_id,
      obra_id: r.obraId,
      arquivo_url: doc.arquivo_url,
      canal: 'TELEGRAM',
      chat_id: chatId,
      tipo_documento: doc.tipo_documento,
    },
  })
}
