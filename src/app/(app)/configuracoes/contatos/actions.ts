'use server'

import { revalidatePath } from 'next/cache'

import {
  contatoSchema,
  formValuesToPayload,
  mensagemDeErroContato,
  type ContatoFormValues,
} from '@/lib/contatos'
import { createClient } from '@/lib/supabase/server'

export type ContatoActionResult = { ok: true; id: string } | { ok: false; error: string }

// O layout de /configuracoes já barra quem não é admin; a action repete a
// checagem por conta própria (Server Action é endpoint público — CLAUDE.md).
// A RLS deixaria o comercial criar e editar; a tela fica com admin, como o
// resto de Configurações.
async function autorizarAdmin() {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false as const, error: 'Não autenticado' }
  const { data: profile } = await supabase
    .from('profiles')
    .select('empresa_id, perfil')
    .eq('id', user.id)
    .maybeSingle()
  if (!profile) return { ok: false as const, error: 'Perfil não configurado' }
  if (profile.perfil !== 'admin') {
    return { ok: false as const, error: 'Só o administrador cadastra contatos' }
  }
  return { ok: true as const, supabase, userId: user.id, empresaId: profile.empresa_id }
}

function validar(values: ContatoFormValues) {
  const parsed = contatoSchema.safeParse(values)
  if (!parsed.success) {
    return { ok: false as const, error: parsed.error.issues[0]?.message ?? 'Dados inválidos' }
  }
  return { ok: true as const, payload: formValuesToPayload(values) }
}

export async function createContato(values: ContatoFormValues): Promise<ContatoActionResult> {
  const auth = await autorizarAdmin()
  if (!auth.ok) return auth
  const v = validar(values)
  if (!v.ok) return v

  const { data, error } = await auth.supabase
    .from('contatos_whatsapp')
    .insert({ ...v.payload, empresa_id: auth.empresaId, created_by: auth.userId })
    .select('id')
    .single()
  if (error) return { ok: false, error: mensagemDeErroContato(error.message) }

  revalidatePath('/configuracoes/contatos')
  return { ok: true, id: data.id }
}

export async function updateContato(
  id: string,
  values: ContatoFormValues,
): Promise<ContatoActionResult> {
  const auth = await autorizarAdmin()
  if (!auth.ok) return auth
  const v = validar(values)
  if (!v.ok) return v

  // Editar vale só para Telegram: o WhatsApp saiu (decisão 14), e um contato
  // antigo de WhatsApp editado aqui viraria Telegram sem a pessoa saber.
  const { data, error } = await auth.supabase
    .from('contatos_whatsapp')
    .update(v.payload)
    .eq('id', id)
    .eq('empresa_id', auth.empresaId)
    .eq('canal', 'TELEGRAM')
    .select('id')
    .maybeSingle()
  if (error) return { ok: false, error: mensagemDeErroContato(error.message) }
  if (!data) return { ok: false, error: 'Contato não encontrado' }

  revalidatePath('/configuracoes/contatos')
  return { ok: true, id: data.id }
}

export async function deleteContato(id: string): Promise<ContatoActionResult> {
  const auth = await autorizarAdmin()
  if (!auth.ok) return auth

  const { data, error } = await auth.supabase
    .from('contatos_whatsapp')
    .delete()
    .eq('id', id)
    .eq('empresa_id', auth.empresaId)
    .select('id')
    .maybeSingle()
  if (error) return { ok: false, error: mensagemDeErroContato(error.message) }
  if (!data) return { ok: false, error: 'Contato não encontrado' }

  revalidatePath('/configuracoes/contatos')
  return { ok: true, id: data.id }
}
