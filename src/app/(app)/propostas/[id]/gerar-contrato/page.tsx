import { notFound, redirect } from 'next/navigation'

import { somaItens } from '@/lib/itens'
import { getCurrentProfile } from '@/lib/supabase/profile'
import { createClient } from '@/lib/supabase/server'
import type { Proposta } from '@/lib/types'

import { propostaToContratoFormValues } from '@/lib/contratos-form'
import GerarContratoForm from './gerar-form'

type PageProps = {
  params: { id: string }
}

/**
 * Bloco 6.2 — "Gerar contrato" a partir de uma proposta aprovada. O form nasce
 * com os valores, os pct_* e as condições da proposta; os itens vão junto
 * (copiados) se a pessoa não desmarcar.
 */
export default async function GerarContratoPage({ params }: PageProps) {
  const profile = await getCurrentProfile()
  if (!profile) redirect('/login')

  // O layout de /propostas libera visualizador; gerar contrato, não.
  if (profile.perfil !== 'admin' && profile.perfil !== 'comercial') {
    redirect(`/propostas/${params.id}`)
  }

  const supabase = createClient()

  const [propostaRes, itensRes, contratosRes] = await Promise.all([
    supabase
      .from('propostas')
      .select('*, obra:obras(codigo_obra, nome, cliente:clientes(nome))')
      .eq('id', params.id)
      .maybeSingle(),
    supabase.from('itens').select('valor_total').eq('proposta_id', params.id),
    // Contratos já gerados desta proposta. Rescindido não conta: gerar outro
    // depois de uma rescisão é o caso normal, e a função do banco também não
    // o conta.
    supabase
      .from('contratos')
      .select('numero, status')
      .eq('proposta_origem_id', params.id)
      .neq('status', 'rescindido')
      .order('numero'),
  ])

  if (!propostaRes.data) notFound()

  const { obra, ...propostaRow } = propostaRes.data as Proposta & {
    obra: { codigo_obra: string; nome: string; cliente: { nome: string } | null } | null
  }
  const proposta = propostaRow as Proposta

  // Mesma regra da função do banco: só proposta aprovada gera contrato.
  if (proposta.status !== 'aprovada') redirect(`/propostas/${proposta.id}`)

  const itens = (itensRes.data ?? []) as { valor_total: number | null }[]
  const soma = itens.length > 0 ? somaItens(itens) : null

  const obraLabel = obra ? `${obra.codigo_obra} — ${obra.nome}` : '—'

  return (
    <div className="space-y-4">
      <div className="max-w-3xl mx-auto">
        <h1 className="text-xl font-semibold text-gray-900">Gerar contrato</h1>
        <p className="text-sm text-gray-500 mt-1">
          A partir da proposta {proposta.numero} · {obraLabel}
          {obra?.cliente ? ` · ${obra.cliente.nome}` : ''}
        </p>
      </div>
      <GerarContratoForm
        propostaId={proposta.id}
        propostaNumero={proposta.numero}
        defaultValues={propostaToContratoFormValues(proposta, soma)}
        obraOptions={[{ value: proposta.obra_id, label: obraLabel }]}
        qtdItens={itens.length}
        somaItens={soma ?? 0}
        contratosExistentes={(contratosRes.data ?? []).map((c) => c.numero)}
      />
    </div>
  )
}
