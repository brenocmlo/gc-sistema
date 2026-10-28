import { redirect } from 'next/navigation'

import type { ContatoListItem } from '@/lib/contatos'
import { getCurrentProfile } from '@/lib/supabase/profile'
import { createClient } from '@/lib/supabase/server'

import UsuariosPermitidosPanel from './usuarios-permitidos-panel'

// Quem pode mandar propostas e contratos ao bot do Telegram (conversa privada e grupos).
export default async function UsuariosPermitidosPage() {
  const profile = await getCurrentProfile()
  if (!profile) redirect('/login')
  // O layout de /configuracoes só exige sessão (Meu perfil é de todos): o guard de admin é daqui.
  if (profile.perfil !== 'admin') redirect('/')

  const supabase = createClient()
  const { data: contatos, error } = await supabase
    .from('contatos_whatsapp')
    .select('id, nome, canal, telegram_chat_id, telefone, obra_id, ativo, created_at, obra:obras(codigo_obra, nome)')
    .order('created_at', { ascending: false })

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-md p-4 text-sm text-red-700">
        Não foi possível carregar os usuários permitidos: {error.message}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="max-w-5xl mx-auto">
        <h1 className="text-xl font-semibold text-gray-900">Usuários permitidos</h1>
        <p className="text-sm text-gray-500 mt-1">
          Pessoas que podem mandar propostas e contratos ao bot do Telegram, pela conversa privada e
          pelos grupos liberados. Quem manda um PDF num grupo liberado sem estar aqui aparece em
          Pedidos de acesso.
        </p>
      </div>
      <UsuariosPermitidosPanel contatos={(contatos ?? []) as ContatoListItem[]} />
    </div>
  )
}
