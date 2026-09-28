// POST /api/ingestao/contrato — contrato pelo bot (decisão 23).
//
// Mesmo desenho da rota de proposta (../proposta/route.ts): chamada por
// máquina (n8n), autenticada por x-ingestao-token, service role sem RLS de
// usuário — então a rota confere documento × empresa e obra × empresa.
// A regra mora em `montarIngestaoContrato` (@/lib/ingestao).
//
// As três relações do contrato (Breno, 23/09):
//   1. obra do contato (decisão 16) — obrigatória;
//   2. proposta citada no documento — ligada em proposta_origem_id só se
//      existir na MESMA obra (a FK composta exige); se não, aviso;
//   3. itens do documento, com as regras das decisões 10 e 11.
// E uma regra: a obra só tem UM contrato vigente (Breno, 25/09).
import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

import { mensagemDeErroContrato } from '@/lib/contratos'
import { montarIngestaoContrato, tokenConfere, type PayloadIngestaoContrato } from '@/lib/ingestao'
import { identificarObra } from '@/lib/obra-do-documento'
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

  let payload: PayloadIngestaoContrato
  try {
    payload = (await req.json()) as PayloadIngestaoContrato
  } catch {
    return resposta(422, { ok: false, error: 'Corpo da requisição não é JSON' })
  }

  const supabase = createClient<Database>(url, serviceRole, { auth: { persistSession: false } })

  // Decisão 27: sem obraId (o normal pelo bot), a obra sai do documento.
  let obraIdentificadaComo: string | null = null
  if (!payload.obraId) {
    const empresaIdPayload = typeof payload.empresaId === 'string' ? payload.empresaId : ''
    const { data: obrasEmpresa, error: erroObras } = await supabase
      .from('obras')
      .select('id, codigo_obra, nome, cliente:clientes(nome)')
      .eq('empresa_id', empresaIdPayload)
    if (erroObras) return resposta(500, { ok: false, error: erroObras.message })
    const candidatas = (obrasEmpresa ?? []).map((o) => ({
      id: o.id,
      codigo_obra: o.codigo_obra,
      nome: o.nome,
      cliente_nome: (o.cliente as { nome: string | null } | null)?.nome ?? null,
    }))
    const achada = identificarObra(candidatas, payload.obra ?? {})
    if (!achada.ok) return resposta(422, { ok: false, error: `Obra não identificada: ${achada.motivo}`, candidatas: achada.candidatas })
    payload.obraId = achada.obraId
    obraIdentificadaComo = achada.como
  }

  const montado = montarIngestaoContrato(payload, autor)
  if (!montado.ok) return resposta(422, { ok: false, error: montado.error })
  const { contrato, itens, avisos, propostaReferenciada } = montado
  const documentoId = String(payload.documentoId)


  const { data: doc, error: erroDoc } = await supabase
    .from('documentos_processamento')
    .select('id, empresa_id, contrato_criado_id')
    .eq('id', documentoId)
    .maybeSingle()
  if (erroDoc) return resposta(500, { ok: false, error: erroDoc.message })
  if (!doc || doc.empresa_id !== contrato.empresa_id) {
    return resposta(422, { ok: false, error: 'Documento não encontrado para esta empresa' })
  }
  if (doc.contrato_criado_id) {
    return resposta(200, { ok: true, contratoId: doc.contrato_criado_id, jaExistia: true })
  }

  const { data: obra, error: erroObra } = await supabase
    .from('obras')
    .select('id')
    .eq('id', contrato.obra_id)
    .eq('empresa_id', contrato.empresa_id)
    .maybeSingle()
  if (erroObra) return resposta(500, { ok: false, error: erroObra.message })
  if (!obra) return resposta(422, { ok: false, error: 'Obra não pertence a esta empresa' })

  // Regra do Breno (25/09): uma obra pode ter várias propostas, mas UM
  // contrato. Contrato rescindido não conta. Já existe → não cria um segundo:
  // 409 e o documento vai para revisão (pode ser aditivo ou reenvio).
  const { data: vigente, error: erroVigente } = await supabase
    .from('contratos')
    .select('numero')
    .eq('empresa_id', contrato.empresa_id)
    .eq('obra_id', contrato.obra_id)
    .neq('status', 'rescindido')
    .limit(1)
    .maybeSingle()
  if (erroVigente) return resposta(500, { ok: false, error: erroVigente.message })
  if (vigente) {
    return resposta(409, { ok: false, error: `A obra já tem um contrato vigente (${vigente.numero})`, contratoExistente: vigente.numero })
  }

  // Relação 2: a proposta citada, procurada pelo número na mesma obra.
  let propostaOrigemId: string | null = null
  if (propostaReferenciada) {
    const { data: prop } = await supabase
      .from('propostas')
      .select('id, valor_total, valor_final')
      .eq('empresa_id', contrato.empresa_id)
      .eq('obra_id', contrato.obra_id)
      .eq('numero', propostaReferenciada)
      .maybeSingle()
    if (prop) {
      propostaOrigemId = prop.id
      // Decisão 16: divergência de valor não bloqueia, vira aviso.
      const vp = Number(prop.valor_final ?? prop.valor_total)
      if (vp > 0 && Math.abs(contrato.valor_total - vp) > 0.01 * vp) {
        avisos.push(`o valor do contrato (${contrato.valor_total.toFixed(2)}) difere do da proposta ${propostaReferenciada} (${vp.toFixed(2)})`)
      }
    } else {
      avisos.push(`o contrato cita a proposta ${propostaReferenciada}, que não existe nesta obra; entrou sem vínculo`)
    }
  }

  const { data: criado, error: erroContrato } = await supabase
    .from('contratos')
    .insert({ ...contrato, proposta_origem_id: propostaOrigemId })
    .select('id')
    .single()
  if (erroContrato || !criado) {
    const bruto = erroContrato?.message ?? 'falha ao criar o contrato'
    // Número repetido é resultado esperado (decisão 9), não erro.
    const status = erroContrato?.code === '23505' ? 409 : 422
    return resposta(status, { ok: false, error: mensagemDeErroContrato(bruto) })
  }

  if (itens.length) {
    const { error: erroItens } = await supabase
      .from('itens')
      .insert(itens.map((it) => ({ ...it, contrato_id: criado.id })))
    if (erroItens) {
      // Contrato sem os itens do documento é o pior resultado: desfaz.
      await supabase.from('contratos').delete().eq('id', criado.id)
      return resposta(422, { ok: false, error: `Itens recusados pelo banco: ${erroItens.message}` })
    }
  }

  const { error: erroVinculo } = await supabase
    .from('documentos_processamento')
    .update({ status: 'APROVADO', tipo_documento: 'CONTRATO', obra_id: contrato.obra_id, contrato_criado_id: criado.id, conferencia: 'pendente' })
    .eq('id', documentoId)
  if (erroVinculo) {
    avisos.push(`contrato criado, mas o documento não foi vinculado: ${erroVinculo.message}`)
  }

  return resposta(201, { ok: true, contratoId: criado.id, itens: itens.length, propostaOrigemId, obraId: contrato.obra_id, obraIdentificadaComo, avisos })
}
