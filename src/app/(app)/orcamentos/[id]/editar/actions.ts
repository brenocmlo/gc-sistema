'use server'

import { revalidatePath } from 'next/cache'

import { mensagemDeErroBanco } from '@/lib/erro-banco'
import { createClient } from '@/lib/supabase/server'

import type { OrcamentoPayload } from '../../orcamento-form-helpers'

export type UpdateOrcamentoResult =
  | { ok: true; id: string }
  | { ok: false; error: string }

export async function updateOrcamento(
  id: string,
  input: OrcamentoPayload,
): Promise<UpdateOrcamentoResult> {
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
    return { ok: false, error: 'Sem permissão pra editar orçamentos' }
  }

  // Não deixamos alterar status pelo form de edição — isso é Bloco 2.5 (próximo).
  // empresa_id, created_by, created_at também não são editáveis.
  const { error } = await supabase
    .from('orcamentos')
    .update(input)
    .eq('id', id)

  if (error) return { ok: false, error: mensagemDeErroBanco(error) }

  revalidatePath('/orcamentos')
  revalidatePath(`/orcamentos/${id}`)

  return { ok: true, id }
}
