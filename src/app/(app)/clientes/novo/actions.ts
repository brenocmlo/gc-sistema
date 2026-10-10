'use server'

import { revalidatePath } from 'next/cache'

import { mensagemDeErroBanco } from '@/lib/erro-banco'
import { createClient } from '@/lib/supabase/server'

import type { ClientePayload } from '../cliente-form-helpers'

export type CreateClienteResult =
  | { ok: true; id: string }
  | { ok: false; error: string }

export async function createCliente(
  input: ClientePayload,
): Promise<CreateClienteResult> {
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

  if (profile.perfil !== 'admin' && profile.perfil !== 'comercial') {
    return { ok: false, error: 'Sem permissão pra criar clientes' }
  }

  const { data, error } = await supabase
    .from('clientes')
    .insert({
      empresa_id: profile.empresa_id,
      created_by: user.id,
      ...input,
    })
    .select('id')
    .single()

  if (error) return { ok: false, error: mensagemDeErroBanco(error) }

  revalidatePath('/clientes')
  return { ok: true, id: data.id }
}
