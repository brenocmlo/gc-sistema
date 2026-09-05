'use server'

import { revalidatePath } from 'next/cache'

import { isEditavel, mensagemDeErroProposta } from '@/lib/propostas'
import { createClient } from '@/lib/supabase/server'
import type { PropostaStatus } from '@/lib/types'

import type { PropostaPayload } from '../../proposta-form-helpers'

export type UpdatePropostaResult =
  | { ok: true; id: string }
  | { ok: false; error: string }

export async function updateProposta(
  id: string,
  input: PropostaPayload,
): Promise<UpdatePropostaResult> {
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
    return { ok: false, error: 'Sem permissão pra editar propostas' }
  }

  // Rascunho é o único status editável. A checagem é contra o banco, não
  // contra o que a tela mandou: entre abrir o form e salvar, alguém pode ter
  // enviado a proposta.
  const { data: atual, error: readErr } = await supabase
    .from('propostas')
    .select('status')
    .eq('id', id)
    .maybeSingle()

  if (readErr) return { ok: false, error: readErr.message }
  if (!atual) return { ok: false, error: 'Proposta não encontrada' }

  if (!isEditavel(atual.status as PropostaStatus)) {
    return {
      ok: false,
      error:
        'Só proposta em rascunho pode ser editada. Volte o status pra rascunho antes.',
    }
  }

  // status, empresa_id, created_by e as datas de envio/decisão ficam fora:
  // quem muda isso é o diálogo de status.
  const { error } = await supabase.from('propostas').update(input).eq('id', id)

  if (error) return { ok: false, error: mensagemDeErroProposta(error.message) }

  revalidatePath('/propostas')
  revalidatePath(`/propostas/${id}`)

  return { ok: true, id }
}
