'use client'

import { AlertTriangle } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import Modal from '@/components/Modal'
import { formatCurrency } from '@/lib/format'
import { MOTIVO_CANCELAMENTO_MAX, validarMotivoCancelamento } from '@/lib/notas-fiscais'

import { cancelarNotaFiscal } from './actions'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  nfId: string
  numeroLabel: string
  recebido: number
  onCancelada: () => void
}

/** Diálogo de cancelamento (9.4): motivo obrigatório e o aviso de irreversível. */
export default function CancelarDialog({ open, onOpenChange, nfId, numeroLabel, recebido, onCancelada }: Props) {
  const [motivo, setMotivo] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)

  function fechar() {
    if (enviando) return
    setMotivo('')
    setErro(null)
    onOpenChange(false)
  }

  async function confirmar() {
    const v = validarMotivoCancelamento(motivo)
    if (!v.ok) return setErro(v.error)
    setErro(null)
    setEnviando(true)
    const r = await cancelarNotaFiscal(nfId, v.motivo)
    setEnviando(false)
    if (!r.ok) {
      toast.error(`Não foi possível cancelar: ${r.error}`)
      return
    }
    toast.success(`Nota fiscal ${numeroLabel} cancelada`)
    setMotivo('')
    onOpenChange(false)
    onCancelada()
  }

  return (
    <Modal open={open} onOpenChange={(o) => !o && fechar()} title="Cancelar nota fiscal" dismissible={!enviando}>
      <div className="space-y-4">
        <div role="alert" className="flex gap-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          <AlertTriangle size={18} className="shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="font-medium">Esta ação é irreversível.</p>
            <p>
              A nota fiscal {numeroLabel} fica cancelada para sempre: não pode mais ser editada, excluída nem
              receber pagamento.
            </p>
            {recebido > 0 && (
              <p>{`Ela já tem ${formatCurrency(recebido)} recebidos, que continuam registrados.`}</p>
            )}
          </div>
        </div>
        <div>
          <label htmlFor="motivo_cancelamento" className="block text-sm font-medium text-gray-700">
            Motivo do cancelamento <span className="text-red-600">*</span>
          </label>
          <textarea
            id="motivo_cancelamento"
            rows={3}
            maxLength={MOTIVO_CANCELAMENTO_MAX}
            value={motivo}
            disabled={enviando}
            onChange={(e) => setMotivo(e.target.value)}
            className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md text-base sm:text-sm"
          />
          {erro && (
            <p id="erro-motivo" role="alert" className="mt-1 text-sm text-red-700">
              {erro}
            </p>
          )}
        </div>
        <div className="flex justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={fechar}
            disabled={enviando}
            className="px-4 py-2 rounded-md border border-gray-300 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Voltar
          </button>
          <button
            type="button"
            onClick={confirmar}
            disabled={enviando}
            className="px-4 py-2 rounded-md bg-red-600 text-white text-sm font-medium hover:bg-red-700 disabled:bg-red-300"
          >
            {enviando ? 'Cancelando...' : 'Cancelar nota fiscal'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
