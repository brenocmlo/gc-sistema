import { redirect } from 'next/navigation'

import { hojeISO } from '@/lib/execucao'
import { inicioDaBaixa, pagamentoVazioFormValues } from '@/lib/pagamentos-form'
import { getCurrentProfile } from '@/lib/supabase/profile'
import { createClient } from '@/lib/supabase/server'

import { opcoesDePagamento } from '../opcoes'
import NovoPagamentoForm from './novo-form'

type PageProps = {
  // Baixa rápida (10.3): a NF ou a parcela de onde a pessoa veio.
  searchParams: { nota?: string; parcela?: string }
}

export default async function NovoPagamentoPage({ searchParams }: PageProps) {
  const profile = await getCurrentProfile()
  if (!profile) redirect('/login')
  // O layout de /financeiro libera o visualizador; registrar é de admin e financeiro.
  if (profile.perfil !== 'admin' && profile.perfil !== 'financeiro') redirect('/financeiro/pagamentos')

  const supabase = createClient()
  const [{ data: obras }, opcoes] = await Promise.all([
    supabase.from('obras').select('id, codigo_obra, nome').order('codigo_obra', { ascending: false }),
    opcoesDePagamento(supabase),
  ])
  const obraOptions = (obras ?? []).map((o) => ({ value: o.id, label: `${o.codigo_obra} — ${o.nome}` }))
  const { inicio, voltarPara } = inicioDaBaixa(searchParams, opcoes)

  return (
    <div className="space-y-4">
      <div className="max-w-3xl mx-auto">
        <h1 className="text-xl font-semibold text-gray-900">Registrar pagamento</h1>
        <p className="text-sm text-gray-500 mt-1">
          {inicio?.valor !== undefined
            ? 'O valor sugerido é o saldo em aberto; ajuste se o cliente pagou uma parte.'
            : 'O status da nota fiscal ou da parcela é recalculado a cada pagamento.'}
        </p>
      </div>
      <NovoPagamentoForm
        defaultValues={pagamentoVazioFormValues(hojeISO(), inicio)}
        obraOptions={obraOptions}
        voltarPara={voltarPara}
        {...opcoes}
      />
    </div>
  )
}
