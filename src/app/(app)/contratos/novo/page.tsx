import { redirect } from 'next/navigation'

import { getCurrentProfile } from '@/lib/supabase/profile'
import { createClient } from '@/lib/supabase/server'

import NovoContratoForm from './novo-form'

export default async function NovoContratoPage() {
  const profile = await getCurrentProfile()

  // Defesa em profundidade: o layout de /contratos libera visualizador, então
  // a rota de criação precisa do próprio guard.
  if (!profile) redirect('/login')

  if (profile.perfil !== 'admin' && profile.perfil !== 'comercial') {
    redirect('/contratos')
  }

  const supabase = createClient()

  // RLS filtra por empresa. Contrato não tem cliente_id: o cliente vem pela
  // obra, e entra no rótulo pra dar contexto.
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
        <h1 className="text-xl font-semibold text-gray-900">Novo contrato</h1>
        <p className="text-sm text-gray-500 mt-1">
          Contrato avulso, sem proposta de origem. Para contrato de proposta
          aprovada, use &ldquo;Gerar contrato&rdquo; na tela da proposta. Nasce
          ativo.
        </p>
      </div>
      <NovoContratoForm obraOptions={obraOptions} />
    </div>
  )
}
