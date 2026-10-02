import { redirect } from 'next/navigation'

import { hojeISO } from '@/lib/execucao'
import { getCurrentProfile } from '@/lib/supabase/profile'
import { createClient } from '@/lib/supabase/server'

import { opcoesDeVinculo } from '../../notas-fiscais/vinculos'
import NovoAcordoForm from './novo-form'

export default async function NovoAcordoPage() {
  const profile = await getCurrentProfile()
  if (!profile) redirect('/login')
  // O layout de /financeiro libera o visualizador; criar é de admin e financeiro.
  if (profile.perfil !== 'admin' && profile.perfil !== 'financeiro') redirect('/financeiro/acordos')

  const supabase = createClient()
  const [{ data: obras }, vinculos] = await Promise.all([
    supabase.from('obras').select('id, codigo_obra, nome').order('codigo_obra', { ascending: false }),
    opcoesDeVinculo(supabase),
  ])
  const obraOptions = (obras ?? []).map((o) => ({ value: o.id, label: `${o.codigo_obra} — ${o.nome}` }))

  return (
    <div className="space-y-4">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-xl font-semibold text-gray-900">Novo acordo de pagamento</h1>
        <p className="text-sm text-gray-500 mt-1">
          Nasce aberto, com as parcelas. O status das parcelas e do acordo muda com os pagamentos.
        </p>
      </div>
      <NovoAcordoForm hoje={hojeISO()} obraOptions={obraOptions} {...vinculos} />
    </div>
  )
}
