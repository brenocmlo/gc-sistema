'use client'

import { useRouter } from 'next/navigation'
import { toast } from 'sonner'

import { formParaPayloadNf, type NotaFiscalFormValues } from '@/lib/notas-fiscais-form'

import NotaFiscalForm, { type VinculoOpcao } from '../../nota-fiscal-form'
import { updateNotaFiscal } from './actions'

type Props = {
  id: string
  defaultValues: NotaFiscalFormValues
  obraOptions: readonly { value: string; label: string }[]
  contratos: readonly VinculoOpcao[]
  propostas: readonly VinculoOpcao[]
}

export default function EditarNotaFiscalForm({ id, defaultValues, obraOptions, contratos, propostas }: Props) {
  const router = useRouter()

  async function handleSubmit(values: NotaFiscalFormValues) {
    const r = await updateNotaFiscal(id, formParaPayloadNf(values))
    if (!r.ok) {
      toast.error(`Não foi possível salvar: ${r.error}`)
      return
    }
    toast.success('Nota fiscal atualizada')
    router.push(`/financeiro/notas-fiscais/${id}`)
    router.refresh()
  }

  return (
    <NotaFiscalForm
      defaultValues={defaultValues}
      obraOptions={obraOptions}
      contratos={contratos}
      propostas={propostas}
      submitLabel="Salvar alterações"
      cancelHref={`/financeiro/notas-fiscais/${id}`}
      onSubmit={handleSubmit}
    />
  )
}
