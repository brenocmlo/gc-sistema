'use server'

import { revalidatePath } from 'next/cache'

import { caminhoEhDaEmpresa } from '@/lib/documentos'
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
  if (!input.obraId) return { ok: false, error: 'Escolha a obra' }

  const { data: obra } = await supabase
    .from('obras')
    .select('id')
    .eq('id', input.obraId)
    .eq('empresa_id', profile.empresa_id)
    .maybeSingle()
  if (!obra) return { ok: false, error: 'Obra inválida para esta empresa' }

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
      obra_id: input.obraId,
      tipo_documento: 'PROPOSTA',
      arquivo_url: assinada.signedUrl,
      status: 'PENDENTE',
      canal: null,
      created_by: user.id,
    })
    .select('id')
    .single()
  if (error) return { ok: false, error: error.message }

  revalidatePath('/documentos')

  const url = process.env.N8N_DOCUMENTO_WEBHOOK_URL
  const token = process.env.N8N_DOCUMENTO_TOKEN
  if (!url || !token) {
    return { ok: true, id: doc.id, automacao: 'indisponivel', aviso: 'Leitura automática não configurada neste ambiente' }
  }
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-documento-token': token },
      body: JSON.stringify({
        documento_id: doc.id,
        empresa_id: profile.empresa_id,
        obra_id: input.obraId,
        arquivo_url: assinada.signedUrl,
        nome_arquivo: input.nomeArquivo,
        canal: 'SISTEMA',
      }),
      signal: AbortSignal.timeout(10_000),
      cache: 'no-store',
    })
    if (!res.ok) {
      return { ok: true, id: doc.id, automacao: 'indisponivel', aviso: `A leitura automática respondeu ${res.status}` }
    }
  } catch (e) {
    return {
      ok: true,
      id: doc.id,
      automacao: 'indisponivel',
      aviso: `A leitura automática não respondeu (${e instanceof Error ? e.message : 'erro'})`,
    }
  }
  return { ok: true, id: doc.id, automacao: 'acionada' }
}
