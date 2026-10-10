'use server'

import { revalidatePath } from 'next/cache'

import { mensagemDeErroBanco } from '@/lib/erro-banco'
import { createClient } from '@/lib/supabase/server'
import type { Anexo, FdUpdate } from '@/lib/types'

// ============================================================
// Delete FD
// ============================================================

export type DeleteFdResult = { ok: true } | { ok: false; error: string }

export async function deleteFd(id: string): Promise<DeleteFdResult> {
  const supabase = createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Não autenticado' }

  const { data: profile } = await supabase
    .from('profiles')
    .select('perfil')
    .eq('id', user.id)
    .maybeSingle()

  if (!profile) return { ok: false, error: 'Perfil não configurado' }
  if (profile.perfil !== 'admin') {
    return { ok: false, error: 'Apenas admin pode excluir FDs' }
  }

  const { error } = await supabase.from('fd').delete().eq('id', id)
  if (error) return { ok: false, error: mensagemDeErroBanco(error) }

  revalidatePath('/fd')
  return { ok: true }
}

// ============================================================
// Evidências (Storage bucket "evidencias" + jsonb fd.evidencias)
// ============================================================
// Path no formato: <empresa_id>/<obra_id>/<fd_id>/<filename>
// Bucket RLS exige primeiro segmento = empresa_id e perfil em
// (admin, producao, medicao, financeiro) pra upload.

const BUCKET = 'evidencias'
const MAX_SIZE = 20 * 1024 * 1024 // 20MB
const ALLOWED_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
]

export type UploadEvidenciaResult = { ok: true } | { ok: false; error: string }

export async function uploadEvidencia(
  fdId: string,
  formData: FormData,
): Promise<UploadEvidenciaResult> {
  const file = formData.get('file')
  if (!(file instanceof File)) {
    return { ok: false, error: 'Arquivo ausente no upload' }
  }

  if (file.size > MAX_SIZE) {
    return { ok: false, error: 'Tamanho máximo: 20MB' }
  }
  if (!ALLOWED_TYPES.includes(file.type)) {
    return {
      ok: false,
      error: 'Tipos permitidos: PDF, JPG, PNG, WEBP, HEIC',
    }
  }

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

  if (profile.perfil !== 'admin' && profile.perfil !== 'financeiro') {
    return { ok: false, error: 'Sem permissão pra anexar evidências' }
  }

  const { data: current, error: readErr } = await supabase
    .from('fd')
    .select('obra_id, evidencias')
    .eq('id', fdId)
    .maybeSingle()

  if (readErr) return { ok: false, error: readErr.message }
  if (!current) return { ok: false, error: 'Lançamento não encontrado' }

  const safeName = file.name.replace(/[^a-zA-Z0-9.\-_]/g, '_')
  const path = `${profile.empresa_id}/${current.obra_id}/${fdId}/${Date.now()}_${safeName}`

  const { error: uploadErr } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, {
      contentType: file.type || 'application/octet-stream',
      upsert: false,
    })

  if (uploadErr) return { ok: false, error: uploadErr.message }

  const novo: Anexo = {
    nome: file.name,
    path,
    tipo: file.type || 'application/octet-stream',
    tamanho: file.size,
    uploaded_at: new Date().toISOString(),
    uploaded_by: user.id,
  }

  const existentes = (current.evidencias as Anexo[] | null) ?? []
  const atualizados = [...existentes, novo]

  const { error: updateErr } = await supabase
    .from('fd')
    .update({ evidencias: atualizados as unknown as FdUpdate['evidencias'] })
    .eq('id', fdId)

  if (updateErr) {
    await supabase.storage.from(BUCKET).remove([path])
    return { ok: false, error: updateErr.message }
  }

  revalidatePath(`/fd/${fdId}`)
  return { ok: true }
}

export type EvidenciaUrlResult =
  | { ok: true; url: string }
  | { ok: false; error: string }

export async function getEvidenciaUrl(
  path: string,
): Promise<EvidenciaUrlResult> {
  const supabase = createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Não autenticado' }

  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(path, 60 * 60)

  if (error) return { ok: false, error: mensagemDeErroBanco(error) }
  return { ok: true, url: data.signedUrl }
}

export type DeleteEvidenciaResult =
  | { ok: true }
  | { ok: false; error: string }

export async function deleteEvidencia(
  fdId: string,
  path: string,
): Promise<DeleteEvidenciaResult> {
  const supabase = createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Não autenticado' }

  const { data: profile } = await supabase
    .from('profiles')
    .select('perfil')
    .eq('id', user.id)
    .maybeSingle()

  if (!profile) return { ok: false, error: 'Perfil não configurado' }

  if (profile.perfil !== 'admin' && profile.perfil !== 'financeiro') {
    return { ok: false, error: 'Sem permissão pra excluir evidências' }
  }

  const { data: current, error: readErr } = await supabase
    .from('fd')
    .select('evidencias')
    .eq('id', fdId)
    .maybeSingle()

  if (readErr) return { ok: false, error: readErr.message }
  if (!current) return { ok: false, error: 'Lançamento não encontrado' }

  const existentes = (current.evidencias as Anexo[] | null) ?? []
  const atualizados = existentes.filter((e) => e.path !== path)

  const { error: rmErr } = await supabase.storage.from(BUCKET).remove([path])
  if (rmErr) return { ok: false, error: rmErr.message }

  const { error: updateErr } = await supabase
    .from('fd')
    .update({ evidencias: atualizados as unknown as FdUpdate['evidencias'] })
    .eq('id', fdId)

  if (updateErr) return { ok: false, error: updateErr.message }

  revalidatePath(`/fd/${fdId}`)
  return { ok: true }
}
