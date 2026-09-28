'use server'

import { revalidatePath } from 'next/cache'

import {
  caminhoDoArquivo,
  caminhoEhDaEmpresa,
  isDestinoVinculo,
  aguardaConferencia,
  podeRevisar,
  validarMotivoRecusa,
  validarMotivoDescarte,
  type DestinoVinculo,
} from '@/lib/documentos'
import { createClient } from '@/lib/supabase/server'

export type EnvioResult =
  | { ok: true; id: string; automacao: 'acionada' | 'indisponivel'; aviso?: string }
  | { ok: false; error: string }

// Um ano, como o bot faz: a URL fica em documentos_processamento.arquivo_url
// e o n8n baixa por ela. A tela de detalhe gera uma nova quando abre.
const VALIDADE_URL_S = 60 * 60 * 24 * 365

/**
 * Registra um PDF que o navegador já subiu para o Storage e aciona a leitura
 * automática no n8n (mesmo fluxo do bot). O PDF não passa por aqui: o limite
 * de corpo da Server Action (1 MB) é menor que uma proposta comum.
 *
 * O documento é gravado ANTES de chamar o n8n: se a automação estiver fora
 * (limite de execuções, por exemplo), ele aparece na lista como "Processando"
 * em vez de sumir.
 */
export async function registrarEnvioDocumento(input: {
  caminho: string
  obraId: string
  nomeArquivo: string
}): Promise<EnvioResult> {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Não autenticado' }
  const { data: profile } = await supabase
    .from('profiles')
    .select('empresa_id, perfil')
    .eq('id', user.id)
    .maybeSingle()
  if (!profile) return { ok: false, error: 'Perfil não configurado' }
  // O layout libera visualizador para ler; enviar é de admin e comercial,
  // como a policy de insert da tabela e a de upload do bucket.
  if (profile.perfil !== 'admin' && profile.perfil !== 'comercial') {
    return { ok: false, error: 'Sem permissão para enviar documentos' }
  }
  if (!caminhoEhDaEmpresa(input.caminho, profile.empresa_id)) {
    return { ok: false, error: 'Arquivo fora da pasta de envio da empresa' }
  }
  // Obra opcional (decisão 27): em branco, a leitura identifica pelo PDF.
  const obraId = input.obraId || null
  if (obraId) {
    const { data: obra } = await supabase
      .from('obras')
      .select('id')
      .eq('id', obraId)
      .eq('empresa_id', profile.empresa_id)
      .maybeSingle()
    if (!obra) return { ok: false, error: 'Obra inválida para esta empresa' }
  }

  const { data: assinada, error: erroUrl } = await supabase.storage
    .from('documentos-processamento')
    .createSignedUrl(input.caminho, VALIDADE_URL_S)
  if (erroUrl || !assinada) {
    return { ok: false, error: `Arquivo não encontrado no armazenamento: ${erroUrl?.message ?? ''}`.trim() }
  }

  // canal nulo = enviado pela tela (o CHECK aceita só WHATSAPP, TELEGRAM ou nulo).
  // tipo provisório PROPOSTA; a leitura automática reclassifica.
  const { data: doc, error } = await supabase
    .from('documentos_processamento')
    .insert({
      empresa_id: profile.empresa_id,
      obra_id: obraId,
      tipo_documento: 'PROPOSTA',
      arquivo_url: assinada.signedUrl,
      status: 'PENDENTE',
      etapa: 'NA_FILA',
      canal: null,
      created_by: user.id,
    })
    .select('id')
    .single()
  if (error) return { ok: false, error: error.message }

  revalidatePath('/documentos')

  const r = await acionarLeitura({
    documento_id: doc.id,
    empresa_id: profile.empresa_id,
    obra_id: obraId,
    arquivo_url: assinada.signedUrl,
    nome_arquivo: input.nomeArquivo,
  })
  if (!r.ok) {
    await marcarFalhaAoAcionar(supabase, doc.id, r.aviso)
    return { ok: true, id: doc.id, automacao: 'indisponivel', aviso: r.aviso }
  }
  return { ok: true, id: doc.id, automacao: 'acionada' }
}

/**
 * Chama o webhook do n8n (Processar Documento, porta 'Envio pela tela'). Não
 * lança: o documento já está gravado, e a falha vira aviso para a pessoa.
 */
async function acionarLeitura(corpo: {
  documento_id: string
  empresa_id: string
  obra_id: string | null
  arquivo_url: string
  nome_arquivo: string | null
}): Promise<{ ok: true } | { ok: false; aviso: string }> {
  const url = process.env.N8N_DOCUMENTO_WEBHOOK_URL
  const token = process.env.N8N_DOCUMENTO_TOKEN
  if (!url || !token) return { ok: false, aviso: 'a leitura automática não está configurada neste ambiente' }
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-documento-token': token },
      body: JSON.stringify({ ...corpo, canal: 'SISTEMA' }),
      signal: AbortSignal.timeout(10_000),
      cache: 'no-store',
    })
    if (!res.ok) {
      // O corpo diz o porquê (ex.: "Execution limit reached" quando o plano do
      // n8n estourou) — é o que o log traduz para frase de gente.
      const corpo = (await res.text().catch(() => '')).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
      return { ok: false, aviso: `a leitura automática respondeu ${res.status}${corpo ? `: ${corpo.slice(0, 300)}` : ''}` }
    }
    return { ok: true }
  } catch (e) {
    return { ok: false, aviso: `a leitura automática não respondeu (${e instanceof Error ? e.message : 'erro'})` }
  }
}

// ============================================================
// Revisão pela tela
// ============================================================

export type RevisaoResult = { ok: true; aviso?: string } | { ok: false; error: string }

async function autorizarRevisao(documentoId: string) {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false as const, error: 'Não autenticado' }
  const { data: profile } = await supabase
    .from('profiles')
    .select('empresa_id, perfil')
    .eq('id', user.id)
    .maybeSingle()
  if (!profile) return { ok: false as const, error: 'Perfil não configurado' }
  // Mesma regra da policy de update da tabela: admin e comercial.
  if (profile.perfil !== 'admin' && profile.perfil !== 'comercial') {
    return { ok: false as const, error: 'Sem permissão para revisar documentos' }
  }
  const { data: doc } = await supabase
    .from('documentos_processamento')
    .select('id, status, empresa_id, obra_id, arquivo_url')
    .eq('id', documentoId)
    .eq('empresa_id', profile.empresa_id)
    .maybeSingle()
  if (!doc) return { ok: false as const, error: 'Documento não encontrado' }
  if (!podeRevisar(doc.status)) {
    return { ok: false as const, error: 'Este documento já foi resolvido' }
  }
  return { ok: true as const, supabase, userId: user.id, empresaId: profile.empresa_id, doc }
}

/**
 * Manda o documento de novo para a leitura automática, opcionalmente em outra
 * obra (o caso "não conseguimos confirmar a que obra"). O n8n reaproveita o
 * mesmo registro pelo id.
 */
export async function reprocessarDocumento(documentoId: string, obraId: string): Promise<RevisaoResult> {
  const auth = await autorizarRevisao(documentoId)
  if (!auth.ok) return auth
  const { supabase, empresaId, doc } = auth
  if (!obraId) return { ok: false, error: 'Escolha a obra' }
  const { data: obra } = await supabase.from('obras').select('id').eq('id', obraId).eq('empresa_id', empresaId).maybeSingle()
  if (!obra) return { ok: false, error: 'Obra inválida para esta empresa' }

  const caminho = caminhoDoArquivo(doc.arquivo_url)
  if (!caminho) return { ok: false, error: 'O arquivo deste documento não está no armazenamento' }
  const { data: assinada, error: erroUrl } = await supabase.storage
    .from('documentos-processamento')
    .createSignedUrl(caminho, VALIDADE_URL_S)
  if (erroUrl || !assinada) return { ok: false, error: `Arquivo não encontrado: ${erroUrl?.message ?? ''}`.trim() }

  const { error } = await supabase
    .from('documentos_processamento')
    .update({ status: 'PENDENTE', motivo_revisao: null, obra_id: obraId, arquivo_url: assinada.signedUrl, etapa: 'NA_FILA', etapa_detalhe: null })
    .eq('id', documentoId)
  if (error) return { ok: false, error: error.message }
  revalidatePath('/documentos')
  revalidatePath(`/documentos/${documentoId}`)

  const r = await acionarLeitura({ documento_id: documentoId, empresa_id: empresaId, obra_id: obraId, arquivo_url: assinada.signedUrl, nome_arquivo: null })
  if (!r.ok) {
    await marcarFalhaAoAcionar(supabase, documentoId, r.aviso)
    return { ok: true, aviso: r.aviso }
  }
  return { ok: true }
}

/** A equipe resolveu à mão: liga o documento à proposta ou contrato que já existe. */
export async function vincularDocumento(documentoId: string, destino: DestinoVinculo): Promise<RevisaoResult> {
  const auth = await autorizarRevisao(documentoId)
  if (!auth.ok) return auth
  const { supabase, userId, empresaId } = auth
  if (!isDestinoVinculo(destino)) return { ok: false, error: 'Escolha a proposta ou o contrato' }

  const tabela = destino.tipo === 'proposta' ? 'propostas' : 'contratos'
  const { data: alvo } = await supabase.from(tabela).select('id, obra_id').eq('id', destino.id).eq('empresa_id', empresaId).maybeSingle()
  if (!alvo) return { ok: false, error: destino.tipo === 'proposta' ? 'Proposta não encontrada' : 'Contrato não encontrado' }

  const { error } = await supabase
    .from('documentos_processamento')
    .update({
      status: 'APROVADO',
      tipo_documento: destino.tipo === 'proposta' ? 'PROPOSTA' : 'CONTRATO',
      obra_id: alvo.obra_id,
      proposta_criada_id: destino.tipo === 'proposta' ? alvo.id : null,
      contrato_criado_id: destino.tipo === 'contrato' ? alvo.id : null,
      revisado_por: userId,
      revisado_em: new Date().toISOString(),
    })
    .eq('id', documentoId)
  if (error) return { ok: false, error: error.message }
  revalidatePath('/documentos')
  revalidatePath(`/documentos/${documentoId}`)
  return { ok: true }
}

/** Encerra sem gravar nada: PDF errado, duplicado, sem relação com a empresa. */
export async function descartarDocumento(documentoId: string, motivo: string): Promise<RevisaoResult> {
  const auth = await autorizarRevisao(documentoId)
  if (!auth.ok) return auth
  const v = validarMotivoDescarte(motivo)
  if (!v.ok) return v
  const { error } = await auth.supabase
    .from('documentos_processamento')
    .update({
      status: 'DESCARTADO',
      motivo_revisao: `Descartado: ${v.motivo}`,
      revisado_por: auth.userId,
      revisado_em: new Date().toISOString(),
    })
    .eq('id', documentoId)
  if (error) return { ok: false, error: error.message }
  revalidatePath('/documentos')
  revalidatePath(`/documentos/${documentoId}`)
  return { ok: true }
}

// ============================================================
// Conferência do que o bot criou — "aceitar ou não"
// ============================================================

async function autorizarConferencia(documentoId: string, perfis: readonly string[]) {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false as const, error: 'Não autenticado' }
  const { data: profile } = await supabase
    .from('profiles')
    .select('empresa_id, perfil')
    .eq('id', user.id)
    .maybeSingle()
  if (!profile) return { ok: false as const, error: 'Perfil não configurado' }
  if (!perfis.includes(profile.perfil)) {
    return { ok: false as const, error: perfis.length === 1 ? 'Só o administrador pode desfazer o que o bot criou' : 'Sem permissão para conferir documentos' }
  }
  const { data: doc } = await supabase
    .from('documentos_processamento')
    .select('id, status, conferencia, proposta_criada_id, contrato_criado_id')
    .eq('id', documentoId)
    .eq('empresa_id', profile.empresa_id)
    .maybeSingle()
  if (!doc) return { ok: false as const, error: 'Documento não encontrado' }
  if (!aguardaConferencia(doc)) return { ok: false as const, error: 'Este documento não está aguardando conferência' }
  return { ok: true as const, supabase, userId: user.id, doc }
}

function revalidarConferencia(doc: { id: string; proposta_criada_id: string | null; contrato_criado_id: string | null }) {
  revalidatePath('/documentos')
  revalidatePath(`/documentos/${doc.id}`)
  if (doc.proposta_criada_id) revalidatePath(`/propostas/${doc.proposta_criada_id}`)
  if (doc.contrato_criado_id) revalidatePath(`/contratos/${doc.contrato_criado_id}`)
}

/** A leitura está certa: mantém a proposta ou o contrato como o bot gravou. */
export async function aceitarDocumento(documentoId: string): Promise<RevisaoResult> {
  const auth = await autorizarConferencia(documentoId, ['admin', 'comercial'])
  if (!auth.ok) return auth
  const { error } = await auth.supabase
    .from('documentos_processamento')
    .update({ conferencia: 'aceita', revisado_por: auth.userId, revisado_em: new Date().toISOString() })
    .eq('id', documentoId)
  if (error) return { ok: false, error: error.message }
  revalidarConferencia(auth.doc)
  return { ok: true }
}

/**
 * A leitura está errada: apaga o que o bot criou (itens, anexos e a proposta
 * ou o contrato) e devolve o documento para revisão, com o motivo. Só admin —
 * é quem pode excluir pela RLS. A proposta só é desfeita se ainda está em
 * rascunho: depois de enviada, alguém já trabalhou nela.
 */
export async function recusarDocumento(documentoId: string, motivo: string): Promise<RevisaoResult> {
  const auth = await autorizarConferencia(documentoId, ['admin'])
  if (!auth.ok) return auth
  const v = validarMotivoRecusa(motivo)
  if (!v.ok) return v
  const { supabase, userId, doc } = auth
  const ehProposta = Boolean(doc.proposta_criada_id)
  const paiId = doc.proposta_criada_id ?? doc.contrato_criado_id
  if (!paiId) return { ok: false, error: 'O documento não aponta para nada criado pelo bot' }
  const tabela = ehProposta ? 'propostas' : 'contratos'

  const { data: pai } = await supabase.from(tabela).select('id, status, anexos').eq('id', paiId).maybeSingle()
  if (pai) {
    if (ehProposta && pai.status !== 'rascunho') {
      return { ok: false, error: 'A proposta já saiu de rascunho; mude o status dela em vez de desfazer' }
    }
    if (!ehProposta && pai.status !== 'ativo') {
      return { ok: false, error: 'O contrato já mudou de status; resolva pelo detalhe dele' }
    }
  }

  // O documento solta a referência antes: contrato_criado_id não tem ON DELETE.
  const agora = new Date().toISOString()
  const { error: erroDoc } = await supabase
    .from('documentos_processamento')
    .update({
      status: 'REVISAO_HUMANA',
      conferencia: 'recusada',
      motivo_revisao: `Não aceito na conferência: ${v.motivo}`,
      proposta_criada_id: null,
      contrato_criado_id: null,
      revisado_por: userId,
      revisado_em: agora,
    })
    .eq('id', documentoId)
  if (erroDoc) return { ok: false, error: erroDoc.message }

  if (pai) {
    const coluna = ehProposta ? 'proposta_id' : 'contrato_id'
    const { error: erroItens } = await supabase.from('itens').delete().eq(coluna, paiId)
    const { error: erroPai } = erroItens ? { error: erroItens } : await supabase.from(tabela).delete().eq('id', paiId)
    if (erroPai) {
      // Volta o documento como estava: nada pela metade.
      await supabase
        .from('documentos_processamento')
        .update({ status: 'APROVADO', conferencia: 'pendente', motivo_revisao: null, proposta_criada_id: doc.proposta_criada_id, contrato_criado_id: doc.contrato_criado_id, revisado_por: null, revisado_em: null })
        .eq('id', documentoId)
      return { ok: false, error: `Não foi possível desfazer: ${erroPai.message}` }
    }
    const paths = (Array.isArray(pai.anexos) ? pai.anexos : [])
      .map((x) => (x && typeof x === 'object' && 'path' in x ? String((x as { path: unknown }).path) : ''))
      .filter(Boolean)
    if (paths.length) await supabase.storage.from('anexos').remove(paths)
  }

  revalidarConferencia(doc)
  revalidatePath(ehProposta ? '/propostas' : '/contratos')
  return { ok: true }
}

/**
 * O n8n não recebeu o pedido (fora do ar, limite de execuções, sem
 * configuração): o documento fica parado com etapa ERRO e o motivo, e o
 * trigger registra o evento no log da automação — é o que aparece em
 * /documentos em vez de um "Processando" eterno.
 */
async function marcarFalhaAoAcionar(
  supabase: ReturnType<typeof createClient>,
  documentoId: string,
  aviso: string,
) {
  await supabase
    .from('documentos_processamento')
    .update({ etapa: 'ERRO', etapa_detalhe: aviso.slice(0, 1000) })
    .eq('id', documentoId)
}
