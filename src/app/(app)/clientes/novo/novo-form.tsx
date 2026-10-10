'use client'

import { useRouter } from 'next/navigation'
import { toast } from 'sonner'

import ClienteForm from '../cliente-form'
import {
  emptyFormValues,
  formValuesToPayload,
  type ClienteFormValues,
} from '../cliente-form-helpers'
import { createCliente } from './actions'

export default function NovoClienteForm({
  returnHref,
}: {
  returnHref: string
}) {
  const router = useRouter()

  async function handleSubmit(values: ClienteFormValues) {
    const result = await createCliente(formValuesToPayload(values))

    if (!result.ok) {
      toast.error(`Não foi possível salvar: ${result.error}`)
      return
    }

    toast.success('Cliente criado')
    router.push(returnHref)
    router.refresh()
  }

  return (
    <ClienteForm
      defaultValues={emptyFormValues()}
      submitLabel="Salvar cliente"
      cancelHref={returnHref}
      onSubmit={handleSubmit}
    />
  )
}
