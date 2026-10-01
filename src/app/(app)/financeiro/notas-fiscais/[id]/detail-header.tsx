'use client'

import { Ban, HandCoins, Pencil, Trash2 } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { toast } from 'sonner'

import ConfirmDialog from '@/components/ConfirmDialog'

import { formatCurrency } from '@/lib/format'
import { isNfEditavel, motivoParaNaoExcluir, numeroComSerie, type SituacaoNf } from '@/lib/notas-fiscais'
import type { NotaFiscalStatus, Perfil } from '@/lib/types'

import SituacaoBadge from '../situacao-badge'
import { excluirNotaFiscal } from './actions'
import CancelarDialog from './cancelar-dialog'

type DetailHeaderProps = {
  id: string
  numero: string
  serie: string | null
  obraLabel: string
  status: NotaFiscalStatus
  situacao: SituacaoNf
  valorTotal: number
  recebido: number
  qtdPagamentos: number
  perfil: Perfil
}

/** Cabeçalho do detalhe da NF (9.3): selo, valor total e recebido, e as ações. */
export default function DetailHeader({
  id,
  numero,
  serie,
  obraLabel,
  status,
  situacao,
  valorTotal,
  recebido,
  qtdPagamentos,
  perfil,
}: DetailHeaderProps) {
  const router = useRouter()
  const [cancelando, setCancelando] = useState(false)
  const [excluindo, setExcluindo] = useState(false)
  const podeEscrever = perfil === 'admin' || perfil === 'financeiro'
  const canEdit = podeEscrever && isNfEditavel(status)
  // Excluir só aparece para o admin; fora das regras, vem desabilitado com o porquê.
  const bloqueioExcluir = perfil === 'admin' ? motivoParaNaoExcluir({ status, qtdPagamentos }, perfil) : null
  const rotulo = numeroComSerie(numero, serie)

  async function excluir() {
    const r = await excluirNotaFiscal(id)
    if (!r.ok) {
      toast.error(`Não foi possível excluir: ${r.error}`)
      return
    }
    toast.success(`Nota fiscal ${rotulo} excluída`)
    router.push('/financeiro/notas-fiscais')
    router.refresh()
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-5 space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">{`Nota fiscal ${numeroComSerie(numero, serie)}`}</h1>
          <p className="text-sm text-gray-500 mt-1">{obraLabel}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <SituacaoBadge situacao={situacao} />
          {/* Baixa rápida (10.3): o formulário de pagamento já com a origem NF,
              esta nota e o saldo como valor. Cancelada não recebe (9.4). */}
          {podeEscrever && status !== 'cancelada' && (
            <Link
              href={`/financeiro/pagamentos/novo?nota=${id}`}
              className="inline-flex items-center gap-2 bg-gray-900 text-white px-3 py-1.5 rounded-md text-sm font-medium hover:bg-gray-800 transition-colors"
            >
              <HandCoins size={14} />
              Registrar pagamento
            </Link>
          )}
          {podeEscrever &&
            (canEdit ? (
              <Link
                href={`/financeiro/notas-fiscais/${id}/editar`}
                className="inline-flex items-center gap-2 bg-white border border-gray-300 text-gray-700 px-3 py-1.5 rounded-md text-sm font-medium hover:bg-gray-50 transition-colors"
              >
                <Pencil size={14} />
                Editar
              </Link>
            ) : (
              <button
                type="button"
                disabled
                title="Nota fiscal cancelada não é editável"
                className="inline-flex items-center gap-2 bg-white border border-gray-200 text-gray-400 px-3 py-1.5 rounded-md text-sm font-medium cursor-not-allowed"
              >
                <Pencil size={14} />
                Editar
              </button>
            ))}
          {podeEscrever && isNfEditavel(status) && (
            <button
              type="button"
              onClick={() => setCancelando(true)}
              className="inline-flex items-center gap-2 bg-white border border-red-300 text-red-700 px-3 py-1.5 rounded-md text-sm font-medium hover:bg-red-50 transition-colors"
            >
              <Ban size={14} />
              Cancelar NF
            </button>
          )}
          {perfil === 'admin' && (
            <button
              type="button"
              onClick={() => setExcluindo(true)}
              disabled={bloqueioExcluir !== null}
              title={bloqueioExcluir ?? undefined}
              aria-label="Excluir nota fiscal"
              className="inline-flex items-center gap-2 bg-white border border-gray-300 text-red-600 px-3 py-1.5 rounded-md text-sm font-medium hover:bg-red-50 transition-colors disabled:border-gray-200 disabled:text-gray-400 disabled:hover:bg-white disabled:cursor-not-allowed"
            >
              <Trash2 size={14} />
              Excluir
            </button>
          )}
        </div>
      </div>
      <dl className="grid grid-cols-2 sm:grid-cols-3 gap-4" aria-label="Valores da nota fiscal">
        <div>
          <dt className="text-xs text-gray-500">Valor total</dt>
          <dd className="text-lg font-semibold text-gray-900 tabular-nums">{formatCurrency(valorTotal)}</dd>
        </div>
        <div>
          <dt className="text-xs text-gray-500">Recebido</dt>
          <dd className="text-lg font-semibold text-gray-900 tabular-nums">{formatCurrency(recebido)}</dd>
        </div>
        <div>
          <dt className="text-xs text-gray-500">A receber</dt>
          <dd className="text-lg font-semibold text-gray-900 tabular-nums">
            {status === 'cancelada' ? '—' : formatCurrency(Math.max(valorTotal - recebido, 0))}
          </dd>
        </div>
      </dl>

      {podeEscrever && isNfEditavel(status) && (
        <CancelarDialog
          open={cancelando}
          onOpenChange={setCancelando}
          nfId={id}
          numeroLabel={rotulo}
          recebido={recebido}
          onCancelada={() => router.refresh()}
        />
      )}
      <ConfirmDialog
        open={excluindo}
        onOpenChange={setExcluindo}
        title="Excluir nota fiscal?"
        description={`A nota fiscal ${rotulo} será apagada permanentemente. Para registrar que ela não vale mais, prefira cancelar.`}
        variant="danger"
        confirmLabel="Excluir"
        onConfirm={excluir}
      />
    </div>
  )
}
