import { redirect } from 'next/navigation'

import { getCurrentProfile } from '@/lib/supabase/profile'

// A aba "Contatos do bot" virou "Bot → Usuários permitidos". O guard vem antes
// do redirect, como nas outras abas de admin: quem não é admin vai para "/" e
// não fica sabendo do caminho novo (a matriz de rotas confere isso).
export default async function ContatosPage() {
  const profile = await getCurrentProfile()
  if (!profile) redirect('/login')
  if (profile.perfil !== 'admin') redirect('/')
  redirect('/configuracoes/bot')
}
