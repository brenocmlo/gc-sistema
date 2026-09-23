'use client'

import { useRouter } from 'next/navigation'
import { toast } from 'sonner'

import {
  emptyContratoFormValues,
  formValuesToPayload,
  type ContratoFormValues,
} from '@/lib/contratos-form'

import ContratoForm from '../contrato-form'
import { createContrato } from './actions'

type NovoContratoFormProps = {
  obraOptions: readonly { value: string; label: string }[]
}

export default function NovoContratoForm({ obraOptions }: NovoContratoFormProps) {
  const router = useRouter()

  async function handleSubmit(values: ContratoFormValues) {
    const result = await createContrato(formValuesToPayload(values))

    if (!result.ok) {
      toast.error(`Não foi possível salvar: ${result.error}`)
      return
    }

    toast.success(`Contrato ${result.numero} criado`)
    router.push(`/contratos/${result.id}`)
    router.refresh()
  }

  return (
    <ContratoForm
      defaultValues={emptyContratoFormValues()}
      obraOptions={obraOptions}
      submitLabel="Criar contrato"
      cancelHref="/contratos"
      onSubmit={handleSubmit}
    />
  )
}
