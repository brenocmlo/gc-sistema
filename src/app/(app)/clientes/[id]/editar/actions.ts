'use server'

import { revalidatePath } from 'next/cache'

import { mensagemDeErroBanco } from '@/lib/erro-banco'
import { createClient } from '@/lib/supabase/server'

import type { ClientePayload } from '../../cliente-form-helpers'

export type UpdateClienteResult =
  | { ok: true; id: string }
  | { ok: false; error: string }

export async function updateCliente(
  id: string,
  input: ClientePayload,
): Promise<UpdateClienteResult> {
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
    return { ok: false, error: 'Sem permissão pra editar clientes' }
  }

  const { error } = await supabase.from('clientes').update(input).eq('id', id)

  if (error) return { ok: false, error: mensagemDeErroBanco(error) }

  revalidatePath('/clientes')
  revalidatePath(`/clientes/${id}/editar`)

  return { ok: true, id }
}

export type DeleteClienteResult = { ok: true } | { ok: false; error: string }

export async function deleteCliente(id: string): Promise<DeleteClienteResult> {
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
    return { ok: false, error: 'Apenas admin pode excluir clientes' }
  }

  const { error } = await supabase.from('clientes').delete().eq('id', id)

  if (error) {
    // FK RESTRICT em orcamentos/obras → mensagem amigável
    if (error.message.includes('violates foreign key')) {
      return {
        ok: false,
        error:
          'Cliente vinculado a orçamentos ou obras. Remova os vínculos antes.',
      }
    }
    return { ok: false, error: mensagemDeErroBanco(error) }
  }

  revalidatePath('/clientes')
  return { ok: true }
}
