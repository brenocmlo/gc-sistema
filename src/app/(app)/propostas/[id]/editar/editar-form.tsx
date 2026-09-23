'use client'

import { useRouter } from 'next/navigation'
import { toast } from 'sonner'

import PropostaForm, { type TravaPorItens } from '../../proposta-form'
import {
  formValuesToPayload,
  type PropostaFormValues,
} from '../../proposta-form-helpers'
import { updateProposta } from './actions'

type EditarPropostaFormProps = {
  id: string
  defaultValues: PropostaFormValues
  obraOptions: readonly { value: string; label: string }[]
  travadoPorItens: TravaPorItens | null
}

export default function EditarPropostaForm({
  id,
  defaultValues,
  obraOptions,
  travadoPorItens,
}: EditarPropostaFormProps) {
  const router = useRouter()

  async function handleSubmit(values: PropostaFormValues) {
    const result = await updateProposta(id, formValuesToPayload(values))

    if (!result.ok) {
      toast.error(`Não foi possível salvar: ${result.error}`)
      return
    }

    toast.success('Proposta atualizada')
    router.push(`/propostas/${id}`)
    router.refresh()
  }

  return (
    <PropostaForm
      defaultValues={defaultValues}
      obraOptions={obraOptions}
      submitLabel="Salvar alterações"
      cancelHref={`/propostas/${id}`}
      onSubmit={handleSubmit}
      travadoPorItens={travadoPorItens}
    />
  )
}
