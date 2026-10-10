'use client'

import { useRouter } from 'next/navigation'
import { toast } from 'sonner'

import FdForm from '../fd-form'
import {
  emptyFormValues,
  formValuesToPayload,
  type FdFormValues,
} from '../fd-form-helpers'
import { createFd } from './actions'

type NovoFdFormProps = {
  obraOptions: readonly { value: string; label: string }[]
}

export default function NovoFdForm({ obraOptions }: NovoFdFormProps) {
  const router = useRouter()

  async function handleSubmit(values: FdFormValues) {
    const result = await createFd(formValuesToPayload(values))

    if (!result.ok) {
      toast.error(`Não foi possível salvar: ${result.error}`)
      return
    }

    toast.success('Lançamento criado')
    router.push(`/fd/${result.id}`)
    router.refresh()
  }

  return (
    <FdForm
      defaultValues={emptyFormValues()}
      obraOptions={obraOptions}
      submitLabel="Salvar lançamento"
      cancelHref="/fd"
      onSubmit={handleSubmit}
    />
  )
}
