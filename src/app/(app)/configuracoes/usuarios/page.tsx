import { redirect } from 'next/navigation'

import { createAdminClient } from '@/lib/supabase/admin'
import { getCurrentProfile } from '@/lib/supabase/profile'
import { createClient } from '@/lib/supabase/server'
import type { Perfil } from '@/lib/types'
import { situacaoDoUsuario, type SituacaoUsuario } from '@/lib/usuarios'

import UsuariosPanel from './usuarios-panel'

export type UsuarioListItem = {
  id: string
  nome: string
  email: string
  telefone: string | null
  perfil: Perfil
  situacao: SituacaoUsuario
  ultimoAcesso: string | null
  criadoEm: string | null
  /** "Esqueci minha senha" esperando o link de acesso (19/10). */
  pedidoDeAcessoEm: string | null
  euMesmo: boolean
}

/** Usuários da empresa (13.1). Só admin: o layout de /configuracoes só exige sessão, o guard é daqui. */
export default async function UsuariosPage() {
  const profile = await getCurrentProfile()
  if (!profile) redirect('/login')
  if (profile.perfil !== 'admin') redirect('/')

  const supabase = createClient()
  const { data: perfis, error } = await supabase
    .from('profiles')
    .select('id, nome, email, telefone, perfil, ativo, created_at')
    .eq('empresa_id', profile.empresa_id)
    .order('nome')

  // Último acesso e confirmação do e-mail vêm do Auth, pela API de administração.
  let doAuth = new Map<string, { ultimo: string | null; confirmado: boolean }>()
  let avisoAuth: string | null = null
  try {
    const { data, error: eAuth } = await createAdminClient().auth.admin.listUsers({ perPage: 1000 })
    if (eAuth) throw new Error(eAuth.message)
    doAuth = new Map(data.users.map((u) => [u.id, { ultimo: u.last_sign_in_at ?? null, confirmado: Boolean(u.email_confirmed_at) }]))
  } catch (e) {
    avisoAuth = e instanceof Error ? e.message : String(e)
  }

  const { data: pedidos } = await supabase.rpc('pedidos_de_acesso_pendentes')
  const pedidoDe = new Map((pedidos ?? []).map((x) => [x.profile_id, x.pedido_em]))

  const usuarios: UsuarioListItem[] = (perfis ?? []).map((p) => {
    const a = doAuth.get(p.id)
    return {
      id: p.id,
      nome: p.nome,
      email: p.email,
      telefone: p.telefone,
      perfil: p.perfil as Perfil,
      situacao: situacaoDoUsuario({ ativo: p.ativo, ultimo_acesso: a?.ultimo ?? null, email_confirmado: a?.confirmado ?? true }),
      ultimoAcesso: a?.ultimo ?? null,
      criadoEm: p.created_at,
      pedidoDeAcessoEm: pedidoDe.get(p.id) ?? null,
      euMesmo: p.id === profile.id,
    }
  })

  return <UsuariosPanel usuarios={usuarios} erro={error?.message ?? null} avisoAuth={avisoAuth} />
}
