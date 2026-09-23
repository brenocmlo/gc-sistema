'use client'

import { ArrowRightLeft, Pencil, Trash2 } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { toast } from 'sonner'

import ConfirmDialog from '@/components/ConfirmDialog'
import StatusBadge from '@/components/StatusBadge'
import { isEditavel, isFinalizada } from '@/lib/propostas'
import type { Perfil, PropostaStatus } from '@/lib/types'

import { deleteProposta } from './actions'
import StatusDialog from './status-dialog'

type DetailHeaderProps = {
  id: string
  numero: string
  obraLabel: string
  clienteNome: string
  status: PropostaStatus
  vencida: boolean
  perfil: Perfil
  /** Quantos itens vão junto na exclusão — o diálogo avisa. */
  totalItens: number
}

export default function DetailHeader({
  id,
  numero,
  obraLabel,
  clienteNome,
  status,
  vencida,
  perfil,
  totalItens,
}: DetailHeaderProps) {
  const router = useRouter()
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [statusOpen, setStatusOpen] = useState(false)

  const podeEscrever = perfil === 'admin' || perfil === 'comercial'
  // Editar aparece pra admin/comercial (checklist do 4.5), mas rascunho é o
  // único status editável (isEditavel, do 4.2): fora dele o botão fica
  // desabilitado e explica o porquê, em vez de sumir sem motivo aparente.
  const canEdit = podeEscrever && isEditavel(status)
  const canChangeStatus = podeEscrever && !isFinalizada(status)
  const canDelete = perfil === 'admin'

  async function handleDelete() {
    const result = await deleteProposta(id)
    if (!result.ok) {
      toast.error(`Não foi possível excluir: ${result.error}`)
      return
    }
    toast.success('Proposta excluída')
    router.push('/propostas')
    router.refresh()
  }

  return (
    <>
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">
            Proposta {numero}
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            {obraLabel} · {clienteNome}
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <StatusBadge status={status} />
          {vencida && (
            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border bg-amber-100 text-amber-700 border-amber-200">
              Vencida
            </span>
          )}
          {canChangeStatus && (
            <button
              type="button"
              onClick={() => setStatusOpen(true)}
              className="inline-flex items-center gap-2 bg-white border border-gray-300 text-gray-700 px-3 py-1.5 rounded-md text-sm font-medium hover:bg-gray-50 transition-colors"
            >
              <ArrowRightLeft size={14} />
              Mudar status
            </button>
          )}
          {podeEscrever &&
            (canEdit ? (
              <Link
                href={`/propostas/${id}/editar`}
                className="inline-flex items-center gap-2 bg-white border border-gray-300 text-gray-700 px-3 py-1.5 rounded-md text-sm font-medium hover:bg-gray-50 transition-colors"
              >
                <Pencil size={14} />
                Editar
              </Link>
            ) : (
              <button
                type="button"
                disabled
                title={
                  isFinalizada(status)
                    ? 'Proposta com decisão registrada não é editável'
                    : 'Só rascunho é editável — volte o status pra rascunho'
                }
                className="inline-flex items-center gap-2 bg-white border border-gray-200 text-gray-400 px-3 py-1.5 rounded-md text-sm font-medium cursor-not-allowed"
              >
                <Pencil size={14} />
                Editar
              </button>
            ))}
          {canDelete && (
            <button
              type="button"
              onClick={() => setDeleteOpen(true)}
              className="inline-flex items-center gap-2 bg-white border border-red-300 text-red-700 px-3 py-1.5 rounded-md text-sm font-medium hover:bg-red-50 transition-colors"
            >
              <Trash2 size={14} />
              Excluir
            </button>
          )}
        </div>
      </div>

      {podeEscrever && !isEditavel(status) && (
        <p className="text-sm text-gray-500 bg-gray-50 border border-gray-200 rounded-md px-4 py-3">
          {isFinalizada(status)
            ? 'Proposta com decisão registrada não é editável nem muda de status. Para corrigir, crie uma proposta nova.'
            : 'Proposta enviada não é editável. Volte pra rascunho pelo botão "Mudar status" se precisar corrigir.'}
        </p>
      )}

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Excluir proposta?"
        description={
          totalItens > 0
            ? `Esta ação não pode ser desfeita. A proposta e ${totalItens} ${
                totalItens === 1 ? 'item' : 'itens'
              } serão removidos permanentemente.`
            : 'Esta ação não pode ser desfeita. A proposta será removida permanentemente.'
        }
        variant="danger"
        confirmLabel="Excluir"
        onConfirm={handleDelete}
      />

      <StatusDialog
        open={statusOpen}
        onOpenChange={setStatusOpen}
        propostaId={id}
        currentStatus={status}
        onSuccess={() => router.refresh()}
      />
    </>
  )
}
