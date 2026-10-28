import type { ReactNode } from 'react'
import { redirect } from 'next/navigation'

import { getCurrentProfile } from '@/lib/supabase/profile'
import { createClient } from '@/lib/supabase/server'

import BotAbas from './abas'

/** Só admin. Cada page repete o guard; aqui sai também a contagem de pedidos pendentes. */
export default async function BotLayout({ children }: { children: ReactNode }) {
  const profile = await getCurrentProfile()
  if (!profile) redirect('/login')
  if (profile.perfil !== 'admin') redirect('/')

  const supabase = createClient()
  const { count } = await supabase
    .from('bot_pedidos_acesso')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'PENDENTE')

  return (
    <div className="space-y-4">
      <BotAbas pendentes={count ?? 0} />
      {children}
    </div>
  )
}
