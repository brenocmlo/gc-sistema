'use server'

import { revalidatePath } from 'next/cache'

import { mensagemDeErroBanco } from '@/lib/erro-banco'
import { createClient } from '@/lib/supabase/server'

import type { ObraPayload } from '../../obra-form-helpers'

export type UpdateObraResult =
  | { ok: true; id: string }
  | { ok: false; error: string }

export async function updateObra(
  id: string,
  input: ObraPayload,
): Promise<UpdateObraResult> {
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

  if (profile.perfil !== 'admin' && profile.perfil !== 'comercial') {
    return { ok: false, error: 'Sem permissão pra editar obras' }
  }

  const { error } = await supabase.from('obras').update(input).eq('id', id)

  if (error) {
    if (error.message.includes('unique')) {
      return {
        ok: false,
        error: 'Já existe uma obra com esse código nessa empresa',
      }
    }
    return { ok: false, error: mensagemDeErroBanco(error) }
  }

  revalidatePath('/obras')
  revalidatePath(`/obras/${id}`)
  revalidatePath(`/obras/${id}/editar`)

  return { ok: true, id }
}

export type DeleteObraResult = { ok: true } | { ok: false; error: string }

export async function deleteObra(id: string): Promise<DeleteObraResult> {
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
    return { ok: false, error: 'Apenas admin pode excluir obras' }
  }

  const { error } = await supabase.from('obras').delete().eq('id', id)

  if (error) {
    if (error.message.includes('violates foreign key')) {
      return {
        ok: false,
        error:
          'Obra vinculada a propostas, contratos, itens, NFs, pagamentos, acordos ou FDs. Remova os vínculos antes.',
      }
    }
    return { ok: false, error: mensagemDeErroBanco(error) }
  }

  revalidatePath('/obras')
  return { ok: true }
}
