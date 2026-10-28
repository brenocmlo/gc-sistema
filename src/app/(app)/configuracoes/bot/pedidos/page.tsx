import { redirect } from 'next/navigation'

import type { PedidoAcessoListItem } from '@/lib/bot-config'
import { getCurrentProfile } from '@/lib/supabase/profile'
import { createClient } from '@/lib/supabase/server'

import PedidosPanel from './pedidos-panel'

// Quem mandou PDF num grupo liberado sem estar em Usuários permitidos.
export default async function PedidosAcessoPage() {
  const profile = await getCurrentProfile()
  if (!profile) redirect('/login')
  if (profile.perfil !== 'admin') redirect('/')

  const supabase = createClient()
  const { data: pedidos, error } = await supabase
    .from('bot_pedidos_acesso')
    .select('id, nome, telegram_username, telegram_user_id, status, created_at, grupo:bot_grupos(nome, telegram_chat_id)')
    .order('created_at', { ascending: false })
    .limit(200)

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-md p-4 text-sm text-red-700">
        Não foi possível carregar os pedidos de acesso: {error.message}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="max-w-5xl mx-auto">
        <h1 className="text-xl font-semibold text-gray-900">Pedidos de acesso</h1>
        <p className="text-sm text-gray-500 mt-1">
          Pessoas que mandaram um PDF num grupo liberado sem estar em Usuários permitidos. Permitir
          cadastra a pessoa; ela precisa reenviar o PDF.
        </p>
      </div>
      <PedidosPanel pedidos={(pedidos ?? []) as PedidoAcessoListItem[]} />
    </div>
  )
}
