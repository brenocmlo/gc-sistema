'use client'

import { useRouter } from 'next/navigation'
import { toast } from 'sonner'

import OrcamentoForm from '../orcamento-form'
import {
  emptyFormValues,
  formValuesToPayload,
  type OrcamentoFormValues,
} from '../orcamento-form-helpers'
import { createOrcamento } from './actions'

type NovoOrcamentoFormProps = {
  obraOptions: readonly { value: string; label: string }[]
  clienteOptions: readonly { value: string; label: string }[]
}

export default function NovoOrcamentoForm({
  obraOptions,
  clienteOptions,
}: NovoOrcamentoFormProps) {
  const router = useRouter()

  async function handleSubmit(values: OrcamentoFormValues) {
    const result = await createOrcamento(formValuesToPayload(values))

    if (!result.ok) {
      toast.error(`Não foi possível salvar: ${result.error}`)
      return
    }

    toast.success('Orçamento criado')
    router.push(`/orcamentos/${result.id}`)
    router.refresh()
  }

  return (
    <OrcamentoForm
      defaultValues={emptyFormValues()}
      obraOptions={obraOptions}
      clienteOptions={clienteOptions}
      submitLabel="Salvar rascunho"
      cancelHref="/orcamentos"
      onSubmit={handleSubmit}
    />
  )
}
