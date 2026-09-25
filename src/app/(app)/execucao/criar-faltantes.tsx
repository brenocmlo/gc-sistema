'use client'

import { ListPlus } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { toast } from 'sonner'

import ConfirmDialog from '@/components/ConfirmDialog'

import { criarExecucoesFaltantes } from './actions'

type CriarFaltantesProps = {
  obraId: string
  quantidade: number
}

export default function CriarFaltantes({ obraId, quantidade }: CriarFaltantesProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)

  async function handleConfirm() {
    const r = await criarExecucoesFaltantes(obraId)
    if (!r.ok) {
      toast.error(`Não foi possível criar: ${r.error}`)
      return
    }
    toast.success(
      r.criadas === 1 ? '1 execução criada' : `${r.criadas} execuções criadas`,
    )
    setOpen(false)
    router.refresh()
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 bg-gray-900 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-gray-800 transition-colors whitespace-nowrap"
      >
        <ListPlus size={16} />
        {quantidade === 1
          ? 'Criar execução para 1 item'
          : `Criar execução para ${quantidade} itens`}
      </button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Criar execuções?"
        description={`${
          quantidade === 1 ? '1 item de contrato desta obra ainda não tem' : `${quantidade} itens de contrato desta obra ainda não têm`
        } execução. Cada um ganha uma execução zerada, com a quantidade total do item.`}
        confirmLabel="Criar"
        onConfirm={handleConfirm}
      />
    </>
  )
}
