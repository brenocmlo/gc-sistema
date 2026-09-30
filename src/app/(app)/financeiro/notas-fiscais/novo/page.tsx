import { redirect } from 'next/navigation'

import { hojeISO } from '@/lib/execucao'
import { getCurrentProfile } from '@/lib/supabase/profile'
import { createClient } from '@/lib/supabase/server'

import { opcoesDeVinculo } from '../vinculos'
import NovaNotaFiscalForm from './novo-form'

export default async function NovaNotaFiscalPage() {
  const profile = await getCurrentProfile()
  if (!profile) redirect('/login')
  // O layout de /financeiro libera o visualizador; criar é de admin e financeiro.
  if (profile.perfil !== 'admin' && profile.perfil !== 'financeiro') redirect('/financeiro/notas-fiscais')

  const supabase = createClient()
  const [{ data: obras }, vinculos] = await Promise.all([
    supabase.from('obras').select('id, codigo_obra, nome').order('codigo_obra', { ascending: false }),
    opcoesDeVinculo(supabase),
  ])
  const obraOptions = (obras ?? []).map((o) => ({ value: o.id, label: `${o.codigo_obra} — ${o.nome}` }))

  return (
    <div className="space-y-4">
      <div className="max-w-3xl mx-auto">
        <h1 className="text-xl font-semibold text-gray-900">Nova nota fiscal</h1>
        <p className="text-sm text-gray-500 mt-1">
          Nasce emitida. O status muda com os pagamentos, ou pelo cancelamento no detalhe.
        </p>
      </div>
      <NovaNotaFiscalForm hoje={hojeISO()} obraOptions={obraOptions} {...vinculos} />
    </div>
  )
}
