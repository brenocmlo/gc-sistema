'use server'

import { revalidatePath } from 'next/cache'

import { mensagemDeErroBanco } from '@/lib/erro-banco'
import { createClient } from '@/lib/supabase/server'

import type { FdPayload } from '../../fd-form-helpers'

export type UpdateFdResult =
  | { ok: true; id: string }
  | { ok: false; error: string }

export async function updateFd(
  id: string,
  input: FdPayload,
): Promise<UpdateFdResult> {
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
    return { ok: false, error: 'Sem permissão pra editar FDs' }
  }

  const { error } = await supabase.from('fd').update(input).eq('id', id)

  if (error) return { ok: false, error: mensagemDeErroBanco(error) }

  revalidatePath('/fd')
  revalidatePath(`/fd/${id}`)
  revalidatePath(`/fd/${id}/editar`)

  return { ok: true, id }
}
