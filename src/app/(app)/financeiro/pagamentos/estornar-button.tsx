'use client'

import { Undo2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { toast } from 'sonner'

import ConfirmDialog from '@/components/ConfirmDialog'
import { avisoDoEstorno } from '@/lib/pagamentos'
import type { PagamentoOrigem } from '@/lib/types'

import { estornarPagamento } from './actions'

type Props = {
  pagamentoId: string
  origem: PagamentoOrigem
  /** "R$ 1.000,00 de 14/10/2026", para o diálogo e o toast. */
  descricao: string
  /** Por que não pode estornar (motivoParaNaoEstornar), ou null. */
  bloqueio: string | null
}

/** Botão "Estornar" com a confirmação (10.3), usado na aba da NF e na listagem (10.4). */
export default function EstornarButton({ pagamentoId, origem, descricao, bloqueio }: Props) {
  const router = useRouter()
  const [aberto, setAberto] = useState(false)

  async function estornar() {
    const r = await estornarPagamento(pagamentoId)
    if (!r.ok) {
      toast.error(`Não foi possível estornar: ${r.error}`)
      return
    }
    toast.success(`Pagamento de ${descricao} estornado`)
    router.refresh()
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setAberto(true)}
        disabled={bloqueio !== null}
        title={bloqueio ?? undefined}
        aria-label={`Estornar pagamento de ${descricao}`}
        className="inline-flex items-center gap-1.5 text-sm font-medium text-red-600 hover:text-red-700 disabled:text-gray-400 disabled:cursor-not-allowed"
      >
        <Undo2 size={14} />
        Estornar
      </button>
      <ConfirmDialog
        open={aberto}
        onOpenChange={setAberto}
        title="Estornar pagamento?"
        description={`O pagamento de ${descricao} será excluído. ${avisoDoEstorno(origem)} Não dá para desfazer: para voltar atrás, registre o pagamento de novo.`}
        variant="danger"
        confirmLabel="Estornar"
        onConfirm={estornar}
      />
    </>
  )
}
