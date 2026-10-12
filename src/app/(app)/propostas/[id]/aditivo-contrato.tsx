'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { toast } from 'sonner'

import Select from '@/components/form/Select'

import { definirContratoAditivo } from './aditivo-actions'

type Opcao = { value: string; label: string }

// Opção 1.a: de qual contrato esta proposta é aditivo. Quem não edita só vê
// o link; admin e comercial trocam pela lista de contratos da mesma obra.
export default function AditivoContrato({
  propostaId,
  atual,
  contratoOptions,
  podeEditar,
}: {
  propostaId: string
  atual: { id: string; numero: string } | null
  contratoOptions: Opcao[]
  podeEditar: boolean
}) {
  const router = useRouter()
  const [editando, setEditando] = useState(false)
  const [valor, setValor] = useState(atual?.id ?? '')
  const [salvando, setSalvando] = useState(false)

  async function salvar() {
    setSalvando(true)
    const r = await definirContratoAditivo(propostaId, valor)
    setSalvando(false)
    if (!r.ok) return void toast.error(r.error)
    toast.success(valor ? 'Proposta marcada como aditivo' : 'A proposta deixou de ser aditivo')
    setEditando(false)
    router.refresh()
  }

  if (!editando) {
    return (
      <span className="inline-flex items-center gap-2 flex-wrap" data-teste="aditivo-contrato">
        {atual ? (
          <Link href={`/contratos/${atual.id}`} className="text-blue-700 hover:underline">
            {atual.numero}
          </Link>
        ) : (
          <span className="text-gray-500">Não é aditivo</span>
        )}
        {podeEditar && contratoOptions.length > 0 && (
          <button type="button" onClick={() => setEditando(true)} className="text-xs text-gray-600 underline underline-offset-2 hover:text-gray-900">
            alterar
          </button>
        )}
      </span>
    )
  }

  return (
    <span className="flex items-center gap-2 flex-wrap" data-teste="aditivo-editar">
      <Select
        id="aditivo_contrato"
        options={[{ value: '', label: 'Não é aditivo' }, ...contratoOptions]}
        value={valor}
        onChange={(e) => setValor(e.target.value)}
        disabled={salvando}
      />
      <button type="button" onClick={salvar} disabled={salvando} className="px-3 py-1.5 text-sm font-medium rounded-md bg-gray-900 text-white hover:bg-gray-800 disabled:opacity-50">
        Salvar
      </button>
      <button type="button" onClick={() => { setValor(atual?.id ?? ''); setEditando(false) }} disabled={salvando} className="text-sm text-gray-600 hover:text-gray-900">
        Cancelar
      </button>
    </span>
  )
}
