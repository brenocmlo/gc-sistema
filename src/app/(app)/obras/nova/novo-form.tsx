'use client'

import { useRouter } from 'next/navigation'
import { toast } from 'sonner'

import ObraForm from '../obra-form'
import {
  emptyFormValues,
  formValuesToPayload,
  type ObraFormValues,
} from '../obra-form-helpers'
import { createObra } from './actions'

type NovaObraFormProps = {
  clienteOptions: readonly { value: string; label: string }[]
}

export default function NovaObraForm({ clienteOptions }: NovaObraFormProps) {
  const router = useRouter()

  async function handleSubmit(values: ObraFormValues) {
    const result = await createObra(formValuesToPayload(values))

    if (!result.ok) {
      toast.error(`Não foi possível salvar: ${result.error}`)
      return
    }

    toast.success('Obra criada')
    router.push(`/obras/${result.id}`)
    router.refresh()
  }

  return (
    <ObraForm
      defaultValues={emptyFormValues()}
      clienteOptions={clienteOptions}
      submitLabel="Salvar obra"
      cancelHref="/obras"
      onSubmit={handleSubmit}
    />
  )
}
