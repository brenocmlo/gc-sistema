'use client'

import { useRouter } from 'next/navigation'
import { toast } from 'sonner'

import { formatCurrency } from '@/lib/format'
import { formParaPayloadPagamento, type PagamentoFormValues } from '@/lib/pagamentos-form'

import type { OpcoesDePagamento } from '../opcoes'
import PagamentoForm from '../pagamento-form'
import { createPagamento } from './actions'

type Props = OpcoesDePagamento & {
  defaultValues: PagamentoFormValues
  obraOptions: readonly { value: string; label: string }[]
  /** Para onde voltar: a listagem, ou a NF de onde veio a baixa (10.3). */
  voltarPara: string
}

export default function NovoPagamentoForm({ defaultValues, obraOptions, voltarPara, ...opcoes }: Props) {
  const router = useRouter()

  async function handleSubmit(values: PagamentoFormValues) {
    const payload = formParaPayloadPagamento(values)
    const r = await createPagamento(payload)
    if (!r.ok) {
      toast.error(`Não foi possível salvar: ${r.error}`)
      return
    }
    toast.success(`Pagamento de ${formatCurrency(payload.valor)} registrado`)
    router.push(voltarPara)
    router.refresh()
  }

  return (
    <PagamentoForm
      defaultValues={defaultValues}
      obraOptions={obraOptions}
      {...opcoes}
      submitLabel="Registrar pagamento"
      cancelHref={voltarPara}
      onSubmit={handleSubmit}
    />
  )
}
