import type { ReactNode } from 'react'
import { redirect } from 'next/navigation'

import { getCurrentProfile } from '@/lib/supabase/profile'

import ConfiguracoesAbas from './abas'

/**
 * Só exige sessão: "Meu perfil" é de todos os perfis. As abas de admin
 * (Empresa, Contatos do bot, Usuários) repetem o guard na própria página.
 */
export default async function ConfiguracoesLayout({
  children,
}: {
  children: ReactNode
}) {
  const profile = await getCurrentProfile()
  if (!profile) redirect('/login')
  return (
    <div className="space-y-4">
      <ConfiguracoesAbas admin={profile.perfil === 'admin'} />
      {children}
    </div>
  )
}
