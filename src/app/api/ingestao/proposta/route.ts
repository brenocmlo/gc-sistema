// POST /api/ingestao/proposta — porta de entrada da automação (Fase 6).
//
// Quem chama é máquina (o workflow n8n `Processar Documento`), não formulário:
// por isso é route handler e não Server Action, e autentica por token em vez de
// sessão. O middleware deixa `/api/ingestao/` passar sem sessão; a proteção é o
// `x-ingestao-token` conferido aqui.
//
// Sem sessão não há RLS de usuário, então a rota usa a service role e faz ela
// mesma o que a policy faria: confere que o documento e a obra são da empresa
// informada antes de gravar. A regra de negócio mora em `@/lib/ingestao`.
import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

import { montarIngestao, tokenConfere, type PayloadIngestao } from '@/lib/ingestao'
import { mensagemDeErroProposta } from '@/lib/propostas'
import type { Database } from '@/lib/supabase/types'

export const dynamic = 'force-dynamic'

function resposta(status: number, corpo: Record<string, unknown>) {
  return NextResponse.json(corpo, { status })
}

export async function POST(req: Request) {
  const tokenEsperado = process.env.INGESTAO_TOKEN
  const autor = process.env.INGESTAO_PROFILE_ID
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!tokenEsperado || !autor || !url || !serviceRole) {
    return resposta(500, { ok: false, error: 'Rota de ingestão não configurada neste ambiente' })
  }
  if (!tokenConfere(req.headers.get('x-ingestao-token'), tokenEsperado)) {
    return resposta(401, { ok: false, error: 'Token de ingestão inválido' })
  }

  let payload: PayloadIngestao
  try {
    payload = (await req.json()) as PayloadIngestao
  } catch {
    return resposta(422, { ok: false, error: 'Corpo da requisição não é JSON' })
  }

  const montado = montarIngestao(payload, autor)
  if (!montado.ok) return resposta(422, { ok: false, error: montado.error })
  const { proposta, itens, avisos } = montado
  const documentoId = String(payload.documentoId)

  const supabase = createClient<Database>(url, serviceRole, { auth: { persistSession: false } })

  // O documento tem de existir e ser da empresa; se já gerou proposta, a
  // chamada é repetição (o n8n reexecuta) e devolve o mesmo id.
  const { data: doc, error: erroDoc } = await supabase
    .from('documentos_processamento')
    .select('id, empresa_id, proposta_criada_id')
    .eq('id', documentoId)
    .maybeSingle()
  if (erroDoc) return resposta(500, { ok: false, error: erroDoc.message })
  if (!doc || doc.empresa_id !== proposta.empresa_id) {
    return resposta(422, { ok: false, error: 'Documento não encontrado para esta empresa' })
  }
  if (doc.proposta_criada_id) {
    return resposta(200, { ok: true, propostaId: doc.proposta_criada_id, jaExistia: true })
  }

  // Nenhuma policy confere obra × empresa sem sessão; a FK composta pegaria no
  // insert, mas com mensagem de banco. Conferir antes dá um 422 legível.
  const { data: obra, error: erroObra } = await supabase
    .from('obras')
    .select('id')
    .eq('id', proposta.obra_id)
    .eq('empresa_id', proposta.empresa_id)
    .maybeSingle()
  if (erroObra) return resposta(500, { ok: false, error: erroObra.message })
  if (!obra) return resposta(422, { ok: false, error: 'Obra não pertence a esta empresa' })

  const { data: criada, error: erroProposta } = await supabase
    .from('propostas')
    .insert(proposta)
    .select('id')
    .single()
  if (erroProposta || !criada) {
    const bruto = erroProposta?.message ?? 'falha ao criar a proposta'
    // Número repetido é resultado esperado (decisão 9), não erro.
    const status = erroProposta?.code === '23505' ? 409 : 422
    return resposta(status, { ok: false, error: mensagemDeErroProposta(bruto) })
  }

  if (itens.length) {
    const { error: erroItens } = await supabase
      .from('itens')
      .insert(itens.map((it) => ({ ...it, proposta_id: criada.id })))
    if (erroItens) {
      // Proposta sem os itens é o pior resultado possível: desfaz.
      await supabase.from('propostas').delete().eq('id', criada.id)
      return resposta(422, { ok: false, error: `Itens recusados pelo banco: ${erroItens.message}` })
    }
  }

  const { error: erroVinculo } = await supabase
    .from('documentos_processamento')
    .update({ status: 'APROVADO', tipo_documento: 'PROPOSTA', obra_id: proposta.obra_id, proposta_criada_id: criada.id })
    .eq('id', documentoId)
  if (erroVinculo) {
    // A proposta está gravada e inteira; só o vínculo com o documento falhou.
    // Uma repetição da chamada cairia no 409 do número — por isso o aviso.
    avisos.push(`proposta criada, mas o documento não foi vinculado: ${erroVinculo.message}`)
  }

  return resposta(201, { ok: true, propostaId: criada.id, itens: itens.length, avisos })
}
