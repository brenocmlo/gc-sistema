'use server'

import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'

import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import {
  conviteSchema,
  linkDeAcesso,
  mensagemDeErroUsuario,
  usuarioPayload,
  usuarioSchema,
  type ConviteFormValues,
  type TipoDeLink,
  type UsuarioFormValues,
} from '@/lib/usuarios'

export type UsuarioActionResult = { ok: true } | { ok: false; error: string }
export type LinkActionResult = { ok: true; link: string; id: string } | { ok: false; error: string }

/** Bloqueio no Auth de quem foi desativado: a sessão não se renova e o login é recusado. */
const BLOQUEIO = '876000h'

/** Guard da ação (o layout protege a rota, não a ação): admin e ativo. */
async function autorizarAdmin() {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false as const, error: 'Não autenticado' }
  const { data: profile } = await supabase.from('profiles').select('empresa_id, perfil, ativo').eq('id', user.id).maybeSingle()
  if (!profile) return { ok: false as const, error: 'Perfil não configurado' }
  if (profile.perfil !== 'admin' || profile.ativo === false) {
    return { ok: false as const, error: 'Só o administrador gerencia usuários' }
  }
  return { ok: true as const, supabase, userId: user.id, empresaId: profile.empresa_id }
}

/** A origem do sistema para montar o link: a do próprio pedido. */
function origemDoPedido(): string {
  const h = headers()
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000'
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') || host.startsWith('127.') ? 'http' : 'https')
  return `${proto}://${host}`
}

async function gerarLink(email: string, tipo: TipoDeLink, dados?: Record<string, string>) {
  const admin = createAdminClient()
  const { data, error } = await admin.auth.admin.generateLink(
    tipo === 'invite' ? { type: 'invite', email, options: { data: dados } } : { type: 'recovery', email },
  )
  if (error || !data.properties?.hashed_token || !data.user) {
    return { ok: false as const, error: mensagemDeErroUsuario(error?.message ?? 'Não foi possível gerar o link') }
  }
  return { ok: true as const, userId: data.user.id, link: linkDeAcesso(origemDoPedido(), data.properties.hashed_token, tipo) }
}

/**
 * Convida: cria o usuário no Auth sem mandar e-mail (generateLink) e o perfil
 * da empresa, já com o perfil escolhido. Devolve o link para o admin mandar à
 * pessoa. Se o perfil não grava, o usuário do Auth é desfeito.
 */
export async function convidarUsuario(values: ConviteFormValues): Promise<LinkActionResult> {
  const auth = await autorizarAdmin()
  if (!auth.ok) return auth
  const v = conviteSchema.safeParse(values)
  if (!v.success) return { ok: false, error: v.error.issues[0]?.message ?? 'Dados inválidos' }

  const { data: existente } = await auth.supabase.from('profiles').select('id').eq('empresa_id', auth.empresaId).eq('email', v.data.email).maybeSingle()
  if (existente) return { ok: false, error: 'Já existe um usuário com esse e-mail na empresa' }

  const gerado = await gerarLink(v.data.email, 'invite', { nome: v.data.nome })
  if (!gerado.ok) return gerado

  const { error } = await auth.supabase.from('profiles').insert({
    id: gerado.userId,
    empresa_id: auth.empresaId,
    email: v.data.email,
    ...usuarioPayload(v.data),
    ativo: true,
  })
  if (error) {
    await createAdminClient().auth.admin.deleteUser(gerado.userId)
    return { ok: false, error: mensagemDeErroUsuario(error.message) }
  }
  revalidatePath('/configuracoes/usuarios')
  return { ok: true, link: gerado.link, id: gerado.userId }
}

/**
 * Novo link de acesso para um usuário da empresa: o convite venceu (vale 1
 * hora em gc-dev) ou a pessoa esqueceu a senha. O link leva a definir a senha.
 */
export async function gerarLinkDeAcesso(id: string): Promise<LinkActionResult> {
  const auth = await autorizarAdmin()
  if (!auth.ok) return auth
  const { data: alvo } = await auth.supabase.from('profiles').select('id, email, ativo').eq('id', id).eq('empresa_id', auth.empresaId).maybeSingle()
  if (!alvo) return { ok: false, error: 'Usuário não encontrado' }
  if (alvo.ativo === false) return { ok: false, error: 'Usuário inativo: reative antes de gerar o link' }
  const gerado = await gerarLink(alvo.email, 'recovery')
  if (!gerado.ok) return gerado
  return { ok: true, link: gerado.link, id: alvo.id }
}

export async function atualizarUsuario(id: string, values: UsuarioFormValues): Promise<UsuarioActionResult> {
  const auth = await autorizarAdmin()
  if (!auth.ok) return auth
  const v = usuarioSchema.safeParse(values)
  if (!v.success) return { ok: false, error: v.error.issues[0]?.message ?? 'Dados inválidos' }
  const { data, error } = await auth.supabase
    .from('profiles')
    .update(usuarioPayload(v.data))
    .eq('id', id)
    .eq('empresa_id', auth.empresaId)
    .select('id')
    .maybeSingle()
  if (error) return { ok: false, error: mensagemDeErroUsuario(error.message) }
  if (!data) return { ok: false, error: 'Usuário não encontrado' }
  revalidatePath('/configuracoes/usuarios')
  return { ok: true }
}

/**
 * Desativa ou reativa. Desativar marca profiles.ativo (as policies param de
 * deixar a pessoa ler ou gravar) e bloqueia o usuário no Auth (o login é
 * recusado e a sessão não se renova). O próprio acesso não se desativa.
 */
export async function definirAtivo(id: string, ativo: boolean): Promise<UsuarioActionResult> {
  const auth = await autorizarAdmin()
  if (!auth.ok) return auth
  if (!ativo && id === auth.userId) return { ok: false, error: 'Você não pode desativar o próprio acesso' }
  const { data, error } = await auth.supabase
    .from('profiles')
    .update({ ativo })
    .eq('id', id)
    .eq('empresa_id', auth.empresaId)
    .select('id')
    .maybeSingle()
  if (error) return { ok: false, error: mensagemDeErroUsuario(error.message) }
  if (!data) return { ok: false, error: 'Usuário não encontrado' }
  const { error: eAuth } = await createAdminClient().auth.admin.updateUserById(id, { ban_duration: ativo ? 'none' : BLOQUEIO })
  if (eAuth) {
    // O perfil mudou mas o Auth não: desfaz, para não ficar meio desativado.
    await auth.supabase.from('profiles').update({ ativo: !ativo }).eq('id', id)
    return { ok: false, error: `Não foi possível ${ativo ? 'reativar' : 'desativar'} no Auth: ${eAuth.message}` }
  }
  revalidatePath('/configuracoes/usuarios')
  return { ok: true }
}
