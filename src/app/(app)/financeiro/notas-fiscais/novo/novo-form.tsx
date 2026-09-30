'use client'

import { useRouter } from 'next/navigation'
import { toast } from 'sonner'

import { formParaPayloadNf, nfVaziaFormValues, type NotaFiscalFormValues } from '@/lib/notas-fiscais-form'

import NotaFiscalForm, { type VinculoOpcao } from '../nota-fiscal-form'
import { createNotaFiscal } from './actions'

type Props = {
  hoje: string
  obraOptions: readonly { value: string; label: string }[]
  contratos: readonly VinculoOpcao[]
  propostas: readonly VinculoOpcao[]
}

export default function NovaNotaFiscalForm({ hoje, obraOptions, contratos, propostas }: Props) {
  const router = useRouter()

  async function handleSubmit(values: NotaFiscalFormValues) {
    const r = await createNotaFiscal(formParaPayloadNf(values))
    if (!r.ok) {
      toast.error(`Não foi possível salvar: ${r.error}`)
      return
    }
    toast.success(`Nota fiscal ${r.numero} criada`)
    router.push(`/financeiro/notas-fiscais/${r.id}`)
    router.refresh()
  }

  return (
    <NotaFiscalForm
      defaultValues={nfVaziaFormValues(hoje)}
      obraOptions={obraOptions}
      contratos={contratos}
      propostas={propostas}
      submitLabel="Criar nota fiscal"
      cancelHref="/financeiro/notas-fiscais"
      onSubmit={handleSubmit}
    />
  )
}
