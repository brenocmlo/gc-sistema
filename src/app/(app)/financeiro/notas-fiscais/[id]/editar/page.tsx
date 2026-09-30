import { notFound, redirect } from 'next/navigation'

import { isNfEditavel, numeroComSerie } from '@/lib/notas-fiscais'
import { nfParaFormValues } from '@/lib/notas-fiscais-form'
import { getCurrentProfile } from '@/lib/supabase/profile'
import { createClient } from '@/lib/supabase/server'
import type { NotaFiscal } from '@/lib/types'

import { opcoesDeVinculo } from '../../vinculos'
import EditarNotaFiscalForm from './editar-form'

export default async function EditarNotaFiscalPage({ params }: { params: { id: string } }) {
  const profile = await getCurrentProfile()
  if (!profile) redirect('/login')
  // O layout de /financeiro libera o visualizador; editar é de admin e financeiro.
  if (profile.perfil !== 'admin' && profile.perfil !== 'financeiro') redirect(`/financeiro/notas-fiscais/${params.id}`)

  const supabase = createClient()
  const [{ data }, { data: obras }, vinculos] = await Promise.all([
    supabase.from('notas_fiscais').select('*').eq('id', params.id).maybeSingle(),
    supabase.from('obras').select('id, codigo_obra, nome').order('codigo_obra', { ascending: false }),
    opcoesDeVinculo(supabase),
  ])
  if (!data) notFound()
  const nf = data as NotaFiscal
  // Mesma regra da action: NF cancelada nem abre o form.
  if (!isNfEditavel(nf.status)) redirect(`/financeiro/notas-fiscais/${nf.id}`)

  const obraOptions = (obras ?? []).map((o) => ({ value: o.id, label: `${o.codigo_obra} — ${o.nome}` }))

  return (
    <div className="space-y-4">
      <div className="max-w-3xl mx-auto">
        <h1 className="text-xl font-semibold text-gray-900">Editar nota fiscal</h1>
        <p className="text-sm text-gray-500 mt-1">{`Nota fiscal ${numeroComSerie(nf.numero, nf.serie)}`}</p>
      </div>
      <EditarNotaFiscalForm id={nf.id} defaultValues={nfParaFormValues(nf)} obraOptions={obraOptions} {...vinculos} />
    </div>
  )
}
