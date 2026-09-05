'use client'

import { useRouter } from 'next/navigation'
import { toast } from 'sonner'

import PropostaForm from '../proposta-form'
import {
  emptyFormValues,
  formValuesToPayload,
  type PropostaFormValues,
} from '../proposta-form-helpers'
import { createProposta } from './actions'

type NovaPropostaFormProps = {
  obraOptions: readonly { value: string; label: string }[]
}

export default function NovaPropostaForm({
  obraOptions,
}: NovaPropostaFormProps) {
  const router = useRouter()

  async function handleSubmit(values: PropostaFormValues) {
    const result = await createProposta(formValuesToPayload(values))

    if (!result.ok) {
      toast.error(`Não foi possível salvar: ${result.error}`)
      return
    }

    toast.success('Proposta criada com sucesso')
    router.push(`/propostas/${result.id}`)
    router.refresh()
  }

  return (
    <PropostaForm
      defaultValues={emptyFormValues()}
      obraOptions={obraOptions}
      submitLabel="Salvar rascunho"
      cancelHref="/propostas"
      onSubmit={handleSubmit}
    />
  )
}
