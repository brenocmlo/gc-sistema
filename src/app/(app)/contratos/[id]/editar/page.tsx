import { notFound, redirect } from 'next/navigation'

import { isContratoEditavel } from '@/lib/contratos'
import { contratoToFormValues } from '@/lib/contratos-form'
import { somaItens } from '@/lib/itens'
import { getCurrentProfile } from '@/lib/supabase/profile'
import { createClient } from '@/lib/supabase/server'
import type { Contrato } from '@/lib/types'

import EditarContratoForm from './editar-form'

type PageProps = {
  params: { id: string }
}

export default async function EditarContratoPage({ params }: PageProps) {
  const profile = await getCurrentProfile()
  if (!profile) redirect('/login')

  // Defesa em profundidade: o layout de /contratos libera visualizador.
  if (profile.perfil !== 'admin' && profile.perfil !== 'comercial') {
    redirect(`/contratos/${params.id}`)
  }

  const supabase = createClient()

  const [contratoResult, obrasResult, itensResult] = await Promise.all([
    supabase
      .from('contratos')
      .select('*, obra:obras(codigo_obra, nome)')
      .eq('id', params.id)
      .maybeSingle(),
    supabase
      .from('obras')
      .select('id, codigo_obra, nome, cliente:clientes(nome)')
      .order('codigo_obra', { ascending: false }),
    // Com itens, obra e valor total saem do formulário (mesma regra do 5.6).
    supabase.from('itens').select('valor_total').eq('contrato_id', params.id),
  ])

  if (!contratoResult.data) notFound()

  const { obra, ...contratoRow } = contratoResult.data as Contrato & {
    obra: { codigo_obra: string; nome: string } | null
  }
  const contrato = contratoRow as Contrato

  // Mesma regra da action: fora de ativo, o form nem abre.
  if (!isContratoEditavel(contrato.status)) {
    redirect(`/contratos/${contrato.id}`)
  }

  const itens = (itensResult.data ?? []) as { valor_total: number | null }[]
  const travadoPorItens =
    itens.length > 0 ? { quantidade: itens.length, soma: somaItens(itens) } : null

  const obraOptions = (obrasResult.data ?? []).map((o) => ({
    value: o.id,
    label: o.cliente
      ? `${o.codigo_obra} — ${o.nome} (${o.cliente.nome})`
      : `${o.codigo_obra} — ${o.nome}`,
  }))

  return (
    <div className="space-y-4">
      <div className="max-w-3xl mx-auto">
        <h1 className="text-xl font-semibold text-gray-900">Editar contrato</h1>
        <p className="text-sm text-gray-500 mt-1">
          Contrato {contrato.numero}
          {obra ? ` · ${obra.codigo_obra} — ${obra.nome}` : ''}
        </p>
      </div>
      <EditarContratoForm
        id={contrato.id}
        defaultValues={
          travadoPorItens
            ? { ...contratoToFormValues(contrato), valor_total: travadoPorItens.soma }
            : contratoToFormValues(contrato)
        }
        obraOptions={obraOptions}
        travadoPorItens={travadoPorItens}
        obraTravadaMotivo={
          contrato.proposta_origem_id
            ? 'Contrato gerado de proposta fica na obra da proposta de origem.'
            : null
        }
      />
    </div>
  )
}
