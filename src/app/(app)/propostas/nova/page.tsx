import { redirect } from 'next/navigation'

import { getCurrentProfile } from '@/lib/supabase/profile'
import { createClient } from '@/lib/supabase/server'

import NovaPropostaForm from './nova-form'

export default async function NovaPropostaPage() {
  const profile = await getCurrentProfile()

  // Defesa em profundidade: o layout de /propostas libera visualizador, então
  // a rota de criação precisa do próprio guard.
  if (!profile) redirect('/login')

  if (profile.perfil !== 'admin' && profile.perfil !== 'comercial') {
    redirect('/propostas')
  }

  const supabase = createClient()

  // RLS filtra por empresa. Só obras, porque proposta não tem cliente_id —
  // o cliente vem junto pra dar contexto no rótulo.
  const { data: obras } = await supabase
    .from('obras')
    .select('id, codigo_obra, nome, cliente:clientes(nome)')
    .order('codigo_obra', { ascending: false })

  const obraOptions = (obras ?? []).map((o) => ({
    value: o.id,
    label: o.cliente
      ? `${o.codigo_obra} — ${o.nome} (${o.cliente.nome})`
      : `${o.codigo_obra} — ${o.nome}`,
  }))

  return (
    <div className="space-y-4">
      <div className="max-w-3xl mx-auto">
        <h1 className="text-xl font-semibold text-gray-900">Nova proposta</h1>
        <p className="text-sm text-gray-500 mt-1">
          A proposta nasce como rascunho. Você pode editar tudo antes de enviar.
        </p>
      </div>
      <NovaPropostaForm obraOptions={obraOptions} />
    </div>
  )
}
