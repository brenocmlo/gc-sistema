'use server'

import { revalidatePath } from 'next/cache'

import { BUCKET_NF, caminhoArquivoNf, COLUNA_ARQUIVO_NF, isTipoArquivoNf } from '@/lib/nf-arquivos'
import { isNfEditavel } from '@/lib/notas-fiscais'
import { mensagemDeErroNf } from '@/lib/notas-fiscais-form'
import { createClient } from '@/lib/supabase/server'
import type { NotaFiscalStatus } from '@/lib/types'

// Arquivos da NF (9.5). O arquivo não passa por aqui (teto de 1 MB da Server
// Action): a action confere quem envia e o status da NF, e devolve uma URL de
// upload ASSINADA para o caminho fixo daquele tipo. Assim nem o XML de uma NF
// cancelada é trocado pelo navegador direto no bucket.

const PERFIS_QUE_ENVIAM = ['admin', 'financeiro']
const PERFIS_QUE_VEEM = ['admin', 'financeiro', 'visualizador']

async function contexto(nfId: string, perfis: string[], acao: string) {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false as const, error: 'Não autenticado' }
  const { data: profile } = await supabase.from('profiles').select('empresa_id, perfil').eq('id', user.id).maybeSingle()
  if (!profile) return { ok: false as const, error: 'Perfil não configurado' }
  if (!perfis.includes(profile.perfil)) return { ok: false as const, error: `Sem permissão pra ${acao}` }
  const { data: nf } = await supabase
    .from('notas_fiscais')
    .select('id, empresa_id, obra_id, status, xml_url, pdf_url')
    .eq('id', nfId)
    .maybeSingle()
  if (!nf || nf.empresa_id !== profile.empresa_id) return { ok: false as const, error: 'Nota fiscal não encontrada' }
  return { ok: true as const, supabase, nf }
}

/** Passo 1: a URL assinada de upload (sobrescreve o arquivo do tipo, se houver). */
export async function prepararEnvioArquivoNf(
  nfId: string,
  tipo: string,
): Promise<{ ok: true; path: string; token: string } | { ok: false; error: string }> {
  if (!isTipoArquivoNf(tipo)) return { ok: false, error: 'Tipo de arquivo inválido' }
  const c = await contexto(nfId, PERFIS_QUE_ENVIAM, 'enviar arquivos da nota fiscal')
  if (!c.ok) return c
  if (!isNfEditavel(c.nf.status as NotaFiscalStatus)) {
    return { ok: false, error: 'Nota fiscal cancelada não recebe arquivo' }
  }
  const path = caminhoArquivoNf({ empresaId: c.nf.empresa_id, obraId: c.nf.obra_id, nfId }, tipo)
  const { data, error } = await c.supabase.storage.from(BUCKET_NF).createSignedUploadUrl(path, { upsert: true })
  if (error || !data) return { ok: false, error: error?.message ?? 'Não foi possível preparar o envio' }
  return { ok: true, path: data.path, token: data.token }
}

/** Passo 2: depois do upload, grava o caminho na coluna do tipo. */
export async function registrarArquivoNf(nfId: string, tipo: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isTipoArquivoNf(tipo)) return { ok: false, error: 'Tipo de arquivo inválido' }
  const c = await contexto(nfId, PERFIS_QUE_ENVIAM, 'enviar arquivos da nota fiscal')
  if (!c.ok) return c
  const path = caminhoArquivoNf({ empresaId: c.nf.empresa_id, obraId: c.nf.obra_id, nfId }, tipo)

  // O arquivo tem de estar no bucket: sem isto, a coluna apontaria para nada.
  const { error: naoExiste } = await c.supabase.storage.from(BUCKET_NF).createSignedUrl(path, 60)
  if (naoExiste) return { ok: false, error: 'Arquivo não encontrado no armazenamento' }

  const coluna = COLUNA_ARQUIVO_NF[tipo]
  // Substituição com o mesmo caminho: a coluna já está certa, e reescrevê-la
  // só mudaria o updated_at. `neq cancelada`: o trigger recusaria de qualquer jeito.
  if (c.nf[coluna] !== path) {
    const { error } = await c.supabase
      .from('notas_fiscais')
      .update(tipo === 'xml' ? { xml_url: path } : { pdf_url: path })
      .eq('id', nfId)
      .neq('status', 'cancelada')
    if (error) return { ok: false, error: mensagemDeErroNf(error.message) }
  }
  revalidatePath(`/financeiro/notas-fiscais/${nfId}`)
  return { ok: true }
}

/** URL assinada de 10 minutos para visualizar o arquivo. */
export async function urlArquivoNf(nfId: string, tipo: string): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  if (!isTipoArquivoNf(tipo)) return { ok: false, error: 'Tipo de arquivo inválido' }
  const c = await contexto(nfId, PERFIS_QUE_VEEM, 'ver arquivos da nota fiscal')
  if (!c.ok) return c
  const path = c.nf[COLUNA_ARQUIVO_NF[tipo]]
  if (!path) return { ok: false, error: 'A nota fiscal não tem esse arquivo' }
  const { data, error } = await c.supabase.storage.from(BUCKET_NF).createSignedUrl(path, 60 * 10)
  if (error || !data) return { ok: false, error: error?.message ?? 'Arquivo não encontrado' }
  return { ok: true, url: data.signedUrl }
}
