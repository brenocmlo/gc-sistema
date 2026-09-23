'use client'

import { ArrowRightLeft, FileText, Pencil } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

import StatusBadge from '@/components/StatusBadge'
import { isContratoEditavel, isContratoFinalizado } from '@/lib/contratos'
import type { ContratoStatus, Perfil } from '@/lib/types'

import StatusDialog from './status-dialog'

type DetailHeaderProps = {
  id: string
  numero: string
  obraLabel: string
  clienteNome: string
  status: ContratoStatus
  perfil: Perfil
  /** Proposta de que o contrato foi gerado (6.2); nulo no avulso (6.3). */
  propostaOrigem: { id: string; numero: string } | null
}

/**
 * Excluir não existe: `itens.contrato_id` é `on delete set null`, e o
 * contrato apagado deixaria os itens sem pai — contrato se encerra por
 * rescisão, pelo "Mudar status" (bloco 6.5).
 */
export default function DetailHeader({
  id,
  numero,
  obraLabel,
  clienteNome,
  status,
  perfil,
  propostaOrigem,
}: DetailHeaderProps) {
  const podeEscrever = perfil === 'admin' || perfil === 'comercial'
  // Ativo é o único status editável: fora dele o botão fica desabilitado e
  // explica o porquê, em vez de sumir sem motivo aparente.
  const canEdit = podeEscrever && isContratoEditavel(status)
  const canChangeStatus = podeEscrever && !isContratoFinalizado(status)
  const router = useRouter()
  const [statusOpen, setStatusOpen] = useState(false)

  return (
    <>
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Contrato {numero}</h1>
          <p className="text-sm text-gray-500 mt-1">
            {obraLabel} · {clienteNome}
          </p>
          {propostaOrigem && (
            <Link
              href={`/propostas/${propostaOrigem.id}`}
              className="inline-flex items-center gap-1 mt-1 text-sm text-blue-700 hover:underline"
            >
              <FileText size={14} />
              Gerado da proposta {propostaOrigem.numero}
            </Link>
          )}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <StatusBadge status={status} />
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
                href={`/contratos/${id}/editar`}
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
                  isContratoFinalizado(status)
                    ? 'Contrato encerrado não é editável'
                    : 'Só contrato ativo é editável — retome pelo "Mudar status"'
                }
                className="inline-flex items-center gap-2 bg-white border border-gray-200 text-gray-400 px-3 py-1.5 rounded-md text-sm font-medium cursor-not-allowed"
              >
                <Pencil size={14} />
                Editar
              </button>
            ))}
        </div>
      </div>

      {canChangeStatus && (
        <StatusDialog
          open={statusOpen}
          onOpenChange={setStatusOpen}
          contratoId={id}
          currentStatus={status}
          onSuccess={() => router.refresh()}
        />
      )}
    </>
  )
}
