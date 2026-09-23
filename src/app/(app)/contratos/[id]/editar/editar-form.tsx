'use client'

import { useRouter } from 'next/navigation'
import { toast } from 'sonner'

import {
  formValuesToPayload,
  type ContratoFormValues,
} from '@/lib/contratos-form'

import ContratoForm, { type TravaPorItens } from '../../contrato-form'
import { updateContrato } from './actions'

type EditarContratoFormProps = {
  id: string
  defaultValues: ContratoFormValues
  obraOptions: readonly { value: string; label: string }[]
  travadoPorItens: TravaPorItens | null
  obraTravadaMotivo: string | null
}

export default function EditarContratoForm({
  id,
  defaultValues,
  obraOptions,
  travadoPorItens,
  obraTravadaMotivo,
}: EditarContratoFormProps) {
  const router = useRouter()

  async function handleSubmit(values: ContratoFormValues) {
    const result = await updateContrato(id, formValuesToPayload(values))

    if (!result.ok) {
      toast.error(`Não foi possível salvar: ${result.error}`)
      return
    }

    toast.success('Contrato atualizado')
    router.push(`/contratos/${id}`)
    router.refresh()
  }

  return (
    <ContratoForm
      defaultValues={defaultValues}
      obraOptions={obraOptions}
      submitLabel="Salvar alterações"
      cancelHref={`/contratos/${id}`}
      onSubmit={handleSubmit}
      travadoPorItens={travadoPorItens}
      obraTravadaMotivo={obraTravadaMotivo}
    />
  )
}
