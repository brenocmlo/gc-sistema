import { redirect } from 'next/navigation'

import EmConstrucao from '@/components/EmConstrucao'
import { getCurrentProfile } from '@/lib/supabase/profile'

/**
 * Placeholder do bloco 4.4 (criação). Existe agora só pra que o botão "Nova
 * proposta" da listagem não caia em 404 — e já com o guard de escrita, porque
 * o layout de /propostas libera visualizador também.
 */
export default async function NovaPropostaPage() {
  const profile = await getCurrentProfile()
  if (!profile) redirect('/login')

  if (profile.perfil !== 'admin' && profile.perfil !== 'comercial') {
    redirect('/propostas')
  }

  return <EmConstrucao pagina="Nova proposta" />
}
