'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { toast } from 'sonner'

import ConfirmDialog from '@/components/ConfirmDialog'
import { formatCurrency } from '@/lib/format'

import ContratoForm from '../../../contratos/contrato-form'
import {
  formValuesToPayload,
  type ContratoFormValues,
} from '@/lib/contratos-form'
import { gerarContratoDeProposta } from './actions'

type GerarContratoFormProps = {
  propostaId: string
  propostaNumero: string
  defaultValues: ContratoFormValues
  obraOptions: readonly { value: string; label: string }[]
  qtdItens: number
  somaItens: number
  /** Números dos contratos vigentes já gerados desta proposta. */
  contratosExistentes: string[]
}

export default function GerarContratoForm({
  propostaId,
  propostaNumero,
  defaultValues,
  obraOptions,
  qtdItens,
  somaItens,
  contratosExistentes: existentesIniciais,
}: GerarContratoFormProps) {
  const router = useRouter()
  const [copiarItens, setCopiarItens] = useState(qtdItens > 0)
  const [existentes, setExistentes] = useState(existentesIniciais)
  /** Valores esperando a confirmação de segundo contrato. */
  const [pendente, setPendente] = useState<ContratoFormValues | null>(null)

  async function enviar(values: ContratoFormValues, confirmarDuplicado: boolean) {
    const r = await gerarContratoDeProposta(propostaId, formValuesToPayload(values), {
      copiarItens,
      confirmarDuplicado,
    })
    if (!r.ok) {
      if (r.contratosExistentes && r.contratosExistentes.length > 0) {
        // Alguém gerou enquanto este form estava aberto: pede a confirmação.
        setExistentes(r.contratosExistentes)
        setPendente(values)
        return
      }
      toast.error(`Não foi possível gerar o contrato: ${r.error}`, { duration: 8000 })
      return
    }
    toast.success(`Contrato ${r.numero} gerado`)
    router.push(`/contratos/${r.id}`)
    router.refresh()
  }

  async function handleSubmit(values: ContratoFormValues) {
    if (existentes.length > 0) {
      setPendente(values)
      return
    }
    await enviar(values, false)
  }

  const listaExistentes = existentes.join(', ')

  return (
    <>
      <ContratoForm
        defaultValues={defaultValues}
        obraOptions={obraOptions}
        submitLabel="Gerar contrato"
        cancelHref={`/propostas/${propostaId}`}
        onSubmit={handleSubmit}
        obraTravadaMotivo={`A obra da proposta ${propostaNumero}`}
        travadoPorItens={
          copiarItens && qtdItens > 0 ? { quantidade: qtdItens, soma: somaItens } : null
        }
        extra={
          <section className="space-y-3">
            <header className="pb-2 border-b border-gray-200">
              <h2 className="text-sm font-semibold text-gray-900">Itens e origem</h2>
            </header>
            {qtdItens > 0 ? (
              <label className="flex items-start gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  name="copiar_itens"
                  checked={copiarItens}
                  onChange={(e) => setCopiarItens(e.target.checked)}
                  className="mt-0.5"
                />
                <span>
                  Copiar os {qtdItens} {qtdItens === 1 ? 'item' : 'itens'} da proposta (
                  {formatCurrency(somaItens)}). Com a cópia, o valor total do contrato é a
                  soma deles. A proposta continua com os itens dela; as fotos não vão junto.
                </span>
              </label>
            ) : (
              <p className="text-sm text-gray-500">
                A proposta não tem itens: o valor total do contrato é o digitado acima.
              </p>
            )}
            {existentes.length > 0 && (
              <p
                role="alert"
                className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900"
              >
                Esta proposta já gerou {existentes.length === 1 ? 'o contrato' : 'os contratos'}{' '}
                {listaExistentes}. Gerar outro pede confirmação.
              </p>
            )}
          </section>
        }
      />

      <ConfirmDialog
        open={pendente !== null}
        onOpenChange={(open) => !open && setPendente(null)}
        title="Gerar outro contrato desta proposta?"
        description={`A proposta ${propostaNumero} já tem contrato vigente (${listaExistentes}). Confirme só se for mesmo um segundo contrato, e não o mesmo gerado duas vezes.`}
        variant="danger"
        confirmLabel="Gerar mesmo assim"
        onConfirm={async () => {
          // O diálogo fica aberto (e travado) enquanto a action roda.
          if (pendente) await enviar(pendente, true)
          setPendente(null)
        }}
      />
    </>
  )
}
