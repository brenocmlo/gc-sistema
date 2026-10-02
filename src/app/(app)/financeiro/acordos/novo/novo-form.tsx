'use client'

import { useRouter } from 'next/navigation'
import { toast } from 'sonner'

import { acordoVazioFormValues, formParaPayloadAcordo, type AcordoFormValues } from '@/lib/acordos-form'

import type { VinculoOpcao } from '../../notas-fiscais/nota-fiscal-form'
import AcordoForm from '../acordo-form'
import { createAcordo } from './actions'

type Props = {
  hoje: string
  obraOptions: readonly { value: string; label: string }[]
  contratos: readonly VinculoOpcao[]
  propostas: readonly VinculoOpcao[]
}

export default function NovoAcordoForm({ hoje, obraOptions, contratos, propostas }: Props) {
  const router = useRouter()

  async function handleSubmit(values: AcordoFormValues) {
    const payload = formParaPayloadAcordo(values)
    const r = await createAcordo(payload)
    if (!r.ok) {
      toast.error(`Não foi possível salvar: ${r.error}`)
      return
    }
    toast.success(`Acordo criado com ${payload.parcelas.length} ${payload.parcelas.length === 1 ? 'parcela' : 'parcelas'}`)
    router.push(`/financeiro/acordos/${r.id}`)
    router.refresh()
  }

  return (
    <AcordoForm
      defaultValues={acordoVazioFormValues(hoje)}
      obraOptions={obraOptions}
      contratos={contratos}
      propostas={propostas}
      submitLabel="Criar acordo"
      cancelHref="/financeiro/acordos"
      onSubmit={handleSubmit}
    />
  )
}
