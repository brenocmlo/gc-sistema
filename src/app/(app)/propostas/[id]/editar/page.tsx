import { notFound, redirect } from 'next/navigation'

import { isEditavel } from '@/lib/propostas'
import { getCurrentProfile } from '@/lib/supabase/profile'
import { createClient } from '@/lib/supabase/server'
import type { Proposta } from '@/lib/types'

import { propostaToFormValues } from '../../proposta-form-helpers'
import EditarPropostaForm from './editar-form'

type PageProps = {
  params: { id: string }
}

export default async function EditarPropostaPage({ params }: PageProps) {
  const profile = await getCurrentProfile()
  if (!profile) redirect('/login')

  if (profile.perfil !== 'admin' && profile.perfil !== 'comercial') {
    redirect(`/propostas/${params.id}`)
  }

  const supabase = createClient()

  const [propostaResult, obrasResult] = await Promise.all([
    supabase
      .from('propostas')
      .select('*, obra:obras(codigo_obra, nome)')
      .eq('id', params.id)
      .maybeSingle(),
    supabase
      .from('obras')
      .select('id, codigo_obra, nome, cliente:clientes(nome)')
      .order('codigo_obra', { ascending: false }),
  ])

  if (!propostaResult.data) notFound()

  const { obra, ...propostaRow } = propostaResult.data as Proposta & {
    obra: { codigo_obra: string; nome: string } | null
  }
  const proposta = propostaRow as Proposta

  // Mesma regra da action: fora de rascunho, o form nem abre.
  if (!isEditavel(proposta.status)) {
    redirect(`/propostas/${proposta.id}`)
  }

  const obraOptions = (obrasResult.data ?? []).map((o) => ({
    value: o.id,
    label: o.cliente
      ? `${o.codigo_obra} — ${o.nome} (${o.cliente.nome})`
      : `${o.codigo_obra} — ${o.nome}`,
  }))

  return (
    <div className="space-y-4">
      <div className="max-w-3xl mx-auto">
        <h1 className="text-xl font-semibold text-gray-900">Editar proposta</h1>
        <p className="text-sm text-gray-500 mt-1">
          Proposta {proposta.numero}
          {obra ? ` · ${obra.codigo_obra} — ${obra.nome}` : ''}
        </p>
      </div>
      <EditarPropostaForm
        id={proposta.id}
        defaultValues={propostaToFormValues(proposta)}
        obraOptions={obraOptions}
      />
    </div>
  )
}
