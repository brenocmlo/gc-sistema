'use client'

import { CheckCircle2, XCircle } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { toast } from 'sonner'

import ConfirmDialog from '@/components/ConfirmDialog'
import Textarea from '@/components/form/Textarea'
import Modal from '@/components/Modal'
import { MOTIVO_CANCELAMENTO_ACORDO_MIN } from '@/lib/acordos'
import { formatCurrency } from '@/lib/format'

import { cancelarAcordo, quitarAcordo } from './actions'

type Props = {
  acordoId: string
  /** motivoParaNaoQuitar / motivoParaNaoCancelarAcordo: o botão vem desabilitado com o porquê. */
  bloqueioQuitar: string | null
  bloqueioCancelar: string | null
  pendentes: { quantidade: number; valor: number }
  recebido: number
  /** avisoDoCancelamento: o texto muda quando o acordo já recebeu. */
  avisoCancelar: string
  /** Com pagamento, cancelar encerra o acordo como quitado pelo recebido (planoDoCancelamento). */
  cancelaPeloRecebido: boolean
}

/** "Encerrar como quitado" e "Cancelar acordo" (11.5), no cabeçalho do acordo aberto. */
export default function EncerrarAcordo({ acordoId, bloqueioQuitar, bloqueioCancelar, pendentes, recebido, avisoCancelar, cancelaPeloRecebido }: Props) {
  const router = useRouter()
  const [quitando, setQuitando] = useState(false)
  const [cancelando, setCancelando] = useState(false)
  const [motivo, setMotivo] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)

  async function quitar() {
    const r = await quitarAcordo(acordoId)
    if (!r.ok) return void toast.error(`Não foi possível encerrar: ${r.error}`)
    toast.success('Acordo encerrado como quitado')
    router.refresh()
  }

  async function cancelar() {
    if (motivo.trim().length < MOTIVO_CANCELAMENTO_ACORDO_MIN) return setErro('Diga por que o acordo está sendo cancelado')
    setSalvando(true)
    const r = await cancelarAcordo(acordoId, motivo)
    setSalvando(false)
    if (!r.ok) return setErro(r.error)
    toast.success(cancelaPeloRecebido ? 'Acordo encerrado pelo valor recebido' : 'Acordo cancelado')
    setCancelando(false)
    router.refresh()
  }

  const botao = 'inline-flex items-center gap-2 bg-white border px-3 py-1.5 rounded-md text-sm font-medium transition-colors disabled:border-gray-200 disabled:text-gray-400 disabled:hover:bg-white disabled:cursor-not-allowed'

  return (
    <>
      <button type="button" onClick={() => setQuitando(true)} disabled={bloqueioQuitar !== null} title={bloqueioQuitar ?? undefined}
        className={`${botao} border-gray-300 text-gray-700 hover:bg-gray-50`}>
        <CheckCircle2 size={14} />
        Encerrar como quitado
      </button>
      <button type="button" onClick={() => { setErro(null); setCancelando(true) }} disabled={bloqueioCancelar !== null} title={bloqueioCancelar ?? undefined}
        className={`${botao} border-red-300 text-red-700 hover:bg-red-50`}>
        <XCircle size={14} />
        Cancelar acordo
      </button>

      <ConfirmDialog
        open={quitando}
        onOpenChange={setQuitando}
        title="Encerrar o acordo como quitado?"
        description={`${pendentes.quantidade === 1 ? 'A parcela pendente' : `As ${pendentes.quantidade} parcelas pendentes`} (${formatCurrency(pendentes.valor)}) ${pendentes.quantidade === 1 ? 'será cancelada' : 'serão canceladas'}, e o acordo fica quitado com o que já foi pago (${formatCurrency(recebido)}). O que faltava sai do a receber da obra.`}
        confirmLabel="Encerrar como quitado"
        cancelLabel="Voltar"
        onConfirm={quitar}
      />
      <Modal
        open={cancelando}
        onOpenChange={(o) => !salvando && setCancelando(o)}
        title="Cancelar o acordo"
        dismissible={!salvando}
        footer={
          <>
            <button type="button" onClick={() => setCancelando(false)} disabled={salvando}
              className="px-4 py-2 rounded-md border border-gray-300 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">
              Voltar
            </button>
            <button type="button" onClick={cancelar} disabled={salvando}
              className="px-4 py-2 rounded-md bg-red-600 text-white text-sm font-medium hover:bg-red-700 disabled:bg-gray-400">
              {salvando ? 'Cancelando...' : 'Cancelar acordo'}
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <p role="note" className="text-sm text-gray-600">{avisoCancelar}</p>
          <label className="block text-sm text-gray-700">
            Motivo
            <Textarea id="cancelar_acordo_motivo" rows={3} value={motivo} onChange={(e) => setMotivo(e.target.value)} disabled={salvando} />
          </label>
          {erro && <p role="alert" className="text-sm text-red-700">{erro}</p>}
        </div>
      </Modal>
    </>
  )
}
