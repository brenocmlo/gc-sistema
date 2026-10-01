'use server'

import { revalidatePath } from 'next/cache'

import {
  BUCKET_COMPROVANTE,
  caminhoDoComprovante,
  caminhoEhDoPagamento,
} from '@/lib/pagamento-comprovante'
import { createClient } from '@/lib/supabase/server'

// Comprovante do pagamento (10.4), no padrão dos arquivos da NF (9.5): o
// arquivo não passa por aqui (teto de 1 MB da Server Action). A action confere
// quem envia e devolve uma URL de upload ASSINADA para um caminho novo na
// pasta do pagamento; depois do upload, grava o caminho em `anexo`.

const PERFIS_QUE_ENVIAM = ['admin', 'financeiro']
const PERFIS_QUE_VEEM = ['admin', 'financeiro', 'visualizador']

type Resultado<T = object> = ({ ok: true } & T) | { ok: false; error: string }

async function contexto(pagamentoId: string, perfis: string[], acao: string) {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false as const, error: 'Não autenticado' }
  const { data: profile } = await supabase.from('profiles').select('empresa_id, perfil').eq('id', user.id).maybeSingle()
  if (!profile) return { ok: false as const, error: 'Perfil não configurado' }
  if (!perfis.includes(profile.perfil)) return { ok: false as const, error: `Sem permissão pra ${acao}` }
  const { data: pagamento } = await supabase
    .from('pagamentos')
    .select('id, empresa_id, obra_id, nota_id, anexo')
    .eq('id', pagamentoId)
    .maybeSingle()
  if (!pagamento || pagamento.empresa_id !== profile.empresa_id) return { ok: false as const, error: 'Pagamento não encontrado' }
  const pasta = { empresaId: pagamento.empresa_id, obraId: pagamento.obra_id, pagamentoId }
  return { ok: true as const, supabase, pagamento, pasta }
}

/** Passo 1: a URL assinada de upload, para um caminho novo na pasta do pagamento. */
export async function prepararEnvioComprovante(
  pagamentoId: string,
  nomeArquivo: string,
): Promise<Resultado<{ path: string; token: string }>> {
  const c = await contexto(pagamentoId, PERFIS_QUE_ENVIAM, 'enviar comprovante')
  if (!c.ok) return c
  const path = caminhoDoComprovante(c.pasta, nomeArquivo, Date.now())
  if (!path) return { ok: false, error: 'Envie um PDF ou uma imagem (JPG, PNG ou WEBP)' }
  const { data, error } = await c.supabase.storage.from(BUCKET_COMPROVANTE).createSignedUploadUrl(path)
  if (error || !data) return { ok: false, error: error?.message ?? 'Não foi possível preparar o envio' }
  return { ok: true, path: data.path, token: data.token }
}

/**
 * Passo 2: depois do upload, aponta `anexo` para o arquivo novo e tenta
 * apagar o anterior. Apagar é do admin ou do dono (policy do bucket): se quem
 * substitui não for nenhum dos dois, o antigo fica no bucket, sem referência.
 */
export async function registrarComprovante(pagamentoId: string, path: string): Promise<Resultado> {
  const c = await contexto(pagamentoId, PERFIS_QUE_ENVIAM, 'enviar comprovante')
  if (!c.ok) return c
  if (!caminhoEhDoPagamento(path, c.pasta)) return { ok: false, error: 'Caminho de comprovante inválido' }

  // O arquivo tem de estar no bucket: sem isto, a coluna apontaria para nada.
  const { error: naoExiste } = await c.supabase.storage.from(BUCKET_COMPROVANTE).createSignedUrl(path, 60)
  if (naoExiste) return { ok: false, error: 'Arquivo não encontrado no armazenamento' }

  const anterior = c.pagamento.anexo
  const { error } = await c.supabase.from('pagamentos').update({ anexo: path }).eq('id', pagamentoId)
  if (error) return { ok: false, error: error.message }
  if (anterior && anterior !== path) await c.supabase.storage.from(BUCKET_COMPROVANTE).remove([anterior])

  revalidatePath('/financeiro/pagamentos')
  if (c.pagamento.nota_id) revalidatePath(`/financeiro/notas-fiscais/${c.pagamento.nota_id}`)
  return { ok: true }
}

/** URL assinada de 10 minutos para ver o comprovante. */
export async function urlComprovante(pagamentoId: string): Promise<Resultado<{ url: string }>> {
  const c = await contexto(pagamentoId, PERFIS_QUE_VEEM, 'ver comprovante')
  if (!c.ok) return c
  if (!c.pagamento.anexo) return { ok: false, error: 'O pagamento não tem comprovante' }
  const { data, error } = await c.supabase.storage.from(BUCKET_COMPROVANTE).createSignedUrl(c.pagamento.anexo, 60 * 10)
  if (error || !data) return { ok: false, error: error?.message ?? 'Comprovante não encontrado' }
  return { ok: true, url: data.signedUrl }
}
