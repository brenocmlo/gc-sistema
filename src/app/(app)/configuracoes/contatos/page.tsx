import { redirect } from 'next/navigation'

import type { ContatoListItem } from '@/lib/contatos'
import { getCurrentProfile } from '@/lib/supabase/profile'
import { createClient } from '@/lib/supabase/server'

import ContatosPanel from './contatos-panel'

// Contatos autorizados a mandar propostas pelo bot do Telegram (Fase 7).
export default async function ContatosPage() {
  const profile = await getCurrentProfile()
  if (!profile) redirect('/login')
  // Layout-guard já bloqueia não-admin; defesa em profundidade.
  if (profile.perfil !== 'admin') redirect('/')

  const supabase = createClient()
  const [{ data: contatos, error }, { data: obras }] = await Promise.all([
    supabase
      .from('contatos_whatsapp')
      .select('id, nome, canal, telegram_chat_id, telefone, obra_id, created_at, obra:obras(codigo_obra, nome)')
      .order('created_at', { ascending: false }),
    supabase
      .from('obras')
      .select('id, codigo_obra, nome')
      .order('codigo_obra', { ascending: false }),
  ])

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-md p-4 text-sm text-red-700">
        Não foi possível carregar os contatos: {error.message}
      </div>
    )
  }

  const obraOptions = (obras ?? []).map((o) => ({
    value: o.id,
    label: [o.codigo_obra, o.nome].filter(Boolean).join(' — ') || o.id,
  }))

  return (
    <div className="space-y-4">
      <div className="max-w-5xl mx-auto">
        <h1 className="text-xl font-semibold text-gray-900">Contatos do bot</h1>
        <p className="text-sm text-gray-500 mt-1">
          Quem pode mandar propostas pelo Telegram. Quando alguém não cadastrado escreve ao bot,
          ele responde com um código; cadastre esse código aqui, com a obra, e a pessoa passa a
          poder enviar.
        </p>
      </div>
      <ContatosPanel contatos={(contatos ?? []) as ContatoListItem[]} obraOptions={obraOptions} />
    </div>
  )
}
