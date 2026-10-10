'use server'

import { revalidatePath } from 'next/cache'

import { mensagemDeErroBanco } from '@/lib/erro-banco'
import { createClient } from '@/lib/supabase/server'

import type { EmpresaPayload } from './empresa-form-helpers'

export type UpdateEmpresaResult = { ok: true } | { ok: false; error: string }

export async function updateEmpresa(
  input: EmpresaPayload,
): Promise<UpdateEmpresaResult> {
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
  if (profile.perfil !== 'admin') {
    return { ok: false, error: 'Apenas admin pode editar a empresa' }
  }

  const { error } = await supabase
    .from('empresas')
    .update(input)
    .eq('id', profile.empresa_id)

  if (error) return { ok: false, error: mensagemDeErroBanco(error) }

  revalidatePath('/configuracoes')
  return { ok: true }
}

export type UploadLogoResult =
  | { ok: true; url: string }
  | { ok: false; error: string }

const MAX_LOGO_SIZE = 2 * 1024 * 1024 // 2MB
const ALLOWED_LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']

export async function uploadLogo(formData: FormData): Promise<UploadLogoResult> {
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
  if (profile.perfil !== 'admin') {
    return { ok: false, error: 'Apenas admin pode trocar o logo' }
  }

  const file = formData.get('file')
  if (!(file instanceof File)) return { ok: false, error: 'Arquivo inválido' }

  if (file.size > MAX_LOGO_SIZE) {
    return { ok: false, error: 'Tamanho máximo do logo: 2MB' }
  }
  if (!ALLOWED_LOGO_TYPES.includes(file.type)) {
    return { ok: false, error: 'Use PNG, JPG, WEBP ou SVG' }
  }

  // Sobrescreve sempre no mesmo path pra evitar lixo no bucket
  const ext = file.name.split('.').pop()?.toLowerCase() ?? 'png'
  const path = `${profile.empresa_id}/empresa/logo.${ext}`

  const { error: uploadError } = await supabase.storage
    .from('documentos')
    .upload(path, file, { upsert: true, contentType: file.type })

  if (uploadError) return { ok: false, error: mensagemDeErroBanco(uploadError) }

  // URL signed válida por 100 anos (basicamente "permanente" pra logo)
  const { data: signed, error: signError } = await supabase.storage
    .from('documentos')
    .createSignedUrl(path, 60 * 60 * 24 * 365 * 100)

  if (signError || !signed)
    return { ok: false, error: signError?.message ?? 'Falha ao gerar URL' }

  const { error: updateError } = await supabase
    .from('empresas')
    .update({ logo_url: signed.signedUrl })
    .eq('id', profile.empresa_id)

  if (updateError) return { ok: false, error: mensagemDeErroBanco(updateError) }

  revalidatePath('/configuracoes')
  return { ok: true, url: signed.signedUrl }
}
