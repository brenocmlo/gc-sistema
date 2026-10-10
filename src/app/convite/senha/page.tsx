import { redirect } from 'next/navigation'

import { createClient } from '@/lib/supabase/server'

import DefinirSenha from './definir-senha'

type Props = { searchParams?: { tipo?: string } }

/** Depois do link de convite ou de acesso (13.1): a pessoa define a senha e entra. */
export default async function SenhaPage({ searchParams }: Props) {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login?erro=link')
  const { data: profile } = await supabase.from('profiles').select('nome, ativo').eq('id', user.id).maybeSingle()
  if (!profile) redirect('/login?erro=link')
  if (profile.ativo === false) redirect('/sair?erro=inativo')
  return <DefinirSenha nome={profile.nome} email={user.email ?? ''} convite={searchParams?.tipo !== 'recovery'} />
}
