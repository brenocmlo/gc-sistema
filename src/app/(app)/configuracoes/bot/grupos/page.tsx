import { redirect } from 'next/navigation'

import type { GrupoBotListItem } from '@/lib/bot-config'
import { getCurrentProfile } from '@/lib/supabase/profile'
import { createClient } from '@/lib/supabase/server'

import GruposPanel from './grupos-panel'

// Grupos do Telegram em que o bot aceita documento de pessoa liberada.
export default async function GruposBotPage() {
  const profile = await getCurrentProfile()
  if (!profile) redirect('/login')
  if (profile.perfil !== 'admin') redirect('/')

  const supabase = createClient()
  const { data: grupos, error } = await supabase
    .from('bot_grupos')
    .select('id, nome, telegram_chat_id, status, created_at')
    .order('created_at', { ascending: false })

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-md p-4 text-sm text-red-700">
        Não foi possível carregar os grupos: {error.message}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="max-w-5xl mx-auto">
        <h1 className="text-xl font-semibold text-gray-900">Grupos</h1>
        <p className="text-sm text-gray-500 mt-1">
          Grupos do Telegram em que o bot aceita documentos. Um grupo aparece aqui quando alguém
          liberado chama o bot nele.
        </p>
      </div>
      <GruposPanel grupos={(grupos ?? []) as GrupoBotListItem[]} />
    </div>
  )
}
