'use server'

import { createClient as createAvulso } from '@supabase/supabase-js'
import { revalidatePath } from 'next/cache'

import { createClient } from '@/lib/supabase/server'
import {
  meuPerfilPayload,
  meuPerfilSchema,
  mensagemDeErroSenha,
  mensagemDeErroUsuario,
  trocaSenhaSchema,
  type MeuPerfilFormValues,
  type TrocaSenhaFormValues,
} from '@/lib/usuarios'

export type MeuPerfilActionResult = { ok: true } | { ok: false; error: string }

/** Guard da ação: sessão e perfil ativo. Qualquer perfil, mas só a própria linha. */
async function autorizarProprio() {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user?.email) return { ok: false as const, error: 'Não autenticado' }
  const { data: profile } = await supabase.from('profiles').select('ativo').eq('id', user.id).maybeSingle()
  if (!profile) return { ok: false as const, error: 'Perfil não configurado' }
  if (profile.ativo === false) return { ok: false as const, error: 'Seu acesso está desativado' }
  return { ok: true as const, supabase, userId: user.id, email: user.email }
}

/**
 * Nome e telefone. Pela sessão da pessoa, não pela chave de serviço: a policy
 * "Usuário edita próprio perfil" e o trigger profiles_proteger seguem valendo.
 */
export async function atualizarMeuPerfil(input: MeuPerfilFormValues): Promise<MeuPerfilActionResult> {
  const parsed = meuPerfilSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Dados inválidos' }

  const auth = await autorizarProprio()
  if (!auth.ok) return auth

  const { error } = await auth.supabase.from('profiles').update(meuPerfilPayload(parsed.data)).eq('id', auth.userId)
  if (error) return { ok: false, error: mensagemDeErroUsuario(error.message) }

  // O nome aparece no header e na sidebar de todas as telas.
  revalidatePath('/', 'layout')
  return { ok: true }
}

/**
 * Troca a senha conferindo a atual. A conferência é um login num cliente
 * avulso, sem cookie: a sessão da pessoa não muda. O secure_password_change do
 * Supabase pediria um código por e-mail, e o gc não tem SMTP próprio.
 */
export async function trocarMinhaSenha(input: TrocaSenhaFormValues): Promise<MeuPerfilActionResult> {
  const parsed = trocaSenhaSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Dados inválidos' }

  const auth = await autorizarProprio()
  if (!auth.ok) return auth

  const avulso = createAvulso(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const conferida = await avulso.auth.signInWithPassword({ email: auth.email, password: parsed.data.senhaAtual })
  if (conferida.error) return { ok: false, error: mensagemDeErroSenha(conferida.error.message) }
  // O login avulso abriu uma sessão só para conferir; fecha só ela.
  await avulso.auth.signOut({ scope: 'local' })

  const { error } = await auth.supabase.auth.updateUser({ password: parsed.data.senha })
  if (error) return { ok: false, error: mensagemDeErroSenha(error.message) }
  return { ok: true }
}
