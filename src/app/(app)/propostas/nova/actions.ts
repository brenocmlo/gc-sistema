'use server'

import { revalidatePath } from 'next/cache'

import { mensagemDeErroProposta } from '@/lib/propostas'
import { createClient } from '@/lib/supabase/server'
import type { PropostaStatus } from '@/lib/types'

import type { PropostaPayload } from '../proposta-form-helpers'

export type CreatePropostaResult =
  | { ok: true; id: string }
  | { ok: false; error: string }

export async function createProposta(
  input: PropostaPayload,
): Promise<CreatePropostaResult> {
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

  // O guard do layout protege a rota; a action repete por conta própria.
  if (profile.perfil !== 'admin' && profile.perfil !== 'comercial') {
    return { ok: false, error: 'Sem permissão pra criar propostas' }
  }

  // Toda proposta nasce rascunho — status muda pelo diálogo do detalhe.
  const status: PropostaStatus = 'rascunho'

  const { data, error } = await supabase
    .from('propostas')
    .insert({
      empresa_id: profile.empresa_id,
      created_by: user.id,
      status,
      ...input,
    })
    .select('id')
    .single()

  if (error) return { ok: false, error: mensagemDeErroProposta(error.message) }

  revalidatePath('/propostas')
  return { ok: true, id: data.id }
}
