'use client'

import { Ban, HandCoins, Pencil, Plus } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { toast } from 'sonner'

import ConfirmDialog from '@/components/ConfirmDialog'
import Input from '@/components/form/Input'
import Modal from '@/components/Modal'
import { motivoParaNaoCancelarParcela, type SituacaoParcela } from '@/lib/acordos'
import { validarParcelaPayload } from '@/lib/acordos-form'
import { formatCurrency, formatDate } from '@/lib/format'
import type { ParcelaStatus } from '@/lib/types'

import { SituacaoParcelaBadge } from '../status-badge'
import { adicionarParcela, cancelarParcela, editarParcela } from './actions'

export type LinhaParcela = {
  id: string
  numero: number
  data_vencimento: string
  valor_previsto: number
  observacao: string | null
  status: ParcelaStatus
  situacao: SituacaoParcela
  pago: number
  saldo: number
  qtdPagamentos: number
}

type Props = {
  acordoId: string
  parcelas: LinhaParcela[]
  /** Por que não dá para mexer nas parcelas (perfil ou acordo fechado), ou null. */
  bloqueio: string | null
  /** Admin ou financeiro, com o acordo aberto: o botão de baixa. */
  podeRegistrar: boolean
}

type Edicao = { modo: 'nova' } | { modo: 'editar'; parcela: LinhaParcela }

/** Aba Parcelas do acordo (11.3): onde o financeiro acompanha e dá baixa. */
export default function ParcelasTab({ acordoId, parcelas, bloqueio, podeRegistrar }: Props) {
  const router = useRouter()
  const [edicao, setEdicao] = useState<Edicao | null>(null)
  const [cancelando, setCancelando] = useState<LinhaParcela | null>(null)
  const podeMexer = bloqueio === null

  async function cancelar() {
    if (!cancelando) return
    const r = await cancelarParcela(acordoId, cancelando.id)
    if (!r.ok) return void toast.error(`Não foi possível cancelar: ${r.error}`)
    toast.success(`Parcela ${cancelando.numero} cancelada`)
    router.refresh()
  }

  return (
    <div className="space-y-3">
      {!podeMexer && bloqueio && <p className="text-sm text-gray-500">{bloqueio}.</p>}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm" aria-label="Parcelas do acordo">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-gray-700">Nº</th>
                <th className="px-4 py-3 text-left font-medium text-gray-700">Vencimento</th>
                <th className="px-4 py-3 text-left font-medium text-gray-700">Previsto</th>
                <th className="px-4 py-3 text-left font-medium text-gray-700">Pago</th>
                <th className="px-4 py-3 text-left font-medium text-gray-700">Saldo</th>
                <th className="px-4 py-3 text-left font-medium text-gray-700">Status</th>
                <th className="px-4 py-3" aria-label="Ações" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {parcelas.map((p) => {
                const cancelada = p.status === 'cancelada'
                const bloqueioCancelar = motivoParaNaoCancelarParcela({ status: p.status, qtdPagamentos: p.qtdPagamentos })
                return (
                  <tr key={p.id} data-parcela-acordo={p.numero} className={cancelada ? 'text-gray-400' : undefined}>
                    <td className="px-4 py-3 tabular-nums">{p.numero}</td>
                    <td className="px-4 py-3 tabular-nums">
                      {formatDate(p.data_vencimento)}
                      {p.observacao && <span className="block text-xs text-gray-500">{p.observacao}</span>}
                    </td>
                    <td className="px-4 py-3 tabular-nums">{formatCurrency(p.valor_previsto)}</td>
                    <td className="px-4 py-3 tabular-nums">{formatCurrency(p.pago)}</td>
                    <td className="px-4 py-3 tabular-nums">{cancelada ? '—' : formatCurrency(p.saldo)}</td>
                    <td className="px-4 py-3"><SituacaoParcelaBadge situacao={p.situacao} /></td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-3 whitespace-nowrap">
                        {podeRegistrar && !cancelada && p.saldo > 0 && (
                          <Link
                            href={`/financeiro/pagamentos/novo?parcela=${p.id}`}
                            className="inline-flex items-center gap-1 text-sm font-medium text-gray-900 hover:underline"
                            aria-label={`Registrar pagamento da parcela ${p.numero}`}
                          >
                            <HandCoins size={14} />
                            Registrar pagamento
                          </Link>
                        )}
                        {podeMexer && !cancelada && (
                          <>
                            <button type="button" onClick={() => setEdicao({ modo: 'editar', parcela: p })}
                              aria-label={`Editar a parcela ${p.numero}`}
                              className="inline-flex items-center gap-1 text-sm font-medium text-gray-700 hover:text-gray-900">
                              <Pencil size={14} />
                              Editar
                            </button>
                            <button type="button" onClick={() => setCancelando(p)} disabled={bloqueioCancelar !== null}
                              title={bloqueioCancelar ?? undefined} aria-label={`Cancelar a parcela ${p.numero}`}
                              className="inline-flex items-center gap-1 text-sm font-medium text-red-600 hover:text-red-700 disabled:text-gray-400 disabled:cursor-not-allowed">
                              <Ban size={14} />
                              Cancelar
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
      {podeMexer && (
        <button type="button" onClick={() => setEdicao({ modo: 'nova' })}
          className="inline-flex items-center gap-1 text-sm font-medium text-gray-700 hover:text-gray-900">
          <Plus size={14} />
          Adicionar parcela
        </button>
      )}

      {edicao && (
        <ParcelaDialog
          key={edicao.modo === 'editar' ? edicao.parcela.id : 'nova'}
          titulo={edicao.modo === 'nova' ? 'Nova parcela' : `Editar a parcela ${edicao.parcela.numero}`}
          inicial={edicao.modo === 'editar' ? edicao.parcela : null}
          onClose={() => setEdicao(null)}
          onSalvar={async (dados) => {
            const r = edicao.modo === 'nova'
              ? await adicionarParcela(acordoId, dados)
              : await editarParcela(acordoId, edicao.parcela.id, dados)
            if (!r.ok) return r.error
            toast.success(edicao.modo === 'nova' ? 'Parcela adicionada' : `Parcela ${edicao.parcela.numero} atualizada`)
            setEdicao(null)
            router.refresh()
            return null
          }}
        />
      )}
      <ConfirmDialog
        open={cancelando !== null}
        onOpenChange={(o) => !o && setCancelando(null)}
        title={`Cancelar a parcela ${cancelando?.numero ?? ''}?`}
        description="A parcela sai do valor total e do saldo do acordo e não recebe mais pagamento. Se todas as outras estiverem pagas, o acordo passa a quitado."
        variant="danger"
        confirmLabel="Cancelar parcela"
        cancelLabel="Voltar"
        onConfirm={cancelar}
      />
    </div>
  )
}

function ParcelaDialog({
  titulo,
  inicial,
  onClose,
  onSalvar,
}: {
  titulo: string
  inicial: LinhaParcela | null
  onClose: () => void
  /** Devolve a mensagem de erro, ou null quando salvou. */
  onSalvar: (dados: { data_vencimento: string; valor_previsto: number; observacao: string | null }) => Promise<string | null>
}) {
  const [data, setData] = useState(inicial?.data_vencimento ?? '')
  const [valor, setValor] = useState(inicial ? String(inicial.valor_previsto) : '')
  const [obs, setObs] = useState(inicial?.observacao ?? '')
  const [erro, setErro] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)

  async function salvar() {
    const dados = { data_vencimento: data, valor_previsto: Number(valor), observacao: obs.trim() || null }
    const v = validarParcelaPayload(dados)
    if (!v.ok) return setErro(v.error)
    setSalvando(true)
    const e = await onSalvar(dados)
    setSalvando(false)
    if (e) setErro(e)
  }

  return (
    <Modal
      open
      onOpenChange={(o) => !o && !salvando && onClose()}
      title={titulo}
      dismissible={!salvando}
      footer={
        <>
          <button type="button" onClick={onClose} disabled={salvando}
            className="px-4 py-2 rounded-md border border-gray-300 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">
            Voltar
          </button>
          <button type="button" onClick={salvar} disabled={salvando}
            className="px-4 py-2 rounded-md bg-gray-900 text-white text-sm font-medium hover:bg-gray-800 disabled:bg-gray-400">
            {salvando ? 'Salvando...' : 'Salvar parcela'}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        {inicial && inicial.pago > 0 && (
          <p className="text-xs text-gray-500">{`Já foram pagos ${formatCurrency(inicial.pago)}: o valor não pode ficar abaixo disso.`}</p>
        )}
        <label className="block text-sm text-gray-700">
          Vencimento
          <Input id="parcela_vencimento" type="date" value={data} onChange={(e) => setData(e.target.value)} disabled={salvando} />
        </label>
        <label className="block text-sm text-gray-700">
          Valor previsto (R$)
          <Input id="parcela_valor" type="number" inputMode="decimal" step="0.01" min="0.01" value={valor} onChange={(e) => setValor(e.target.value)} disabled={salvando} />
        </label>
        <label className="block text-sm text-gray-700">
          Observação
          <Input id="parcela_obs" type="text" value={obs} onChange={(e) => setObs(e.target.value)} disabled={salvando} />
        </label>
        {erro && <p role="alert" className="text-sm text-red-700">{erro}</p>}
      </div>
    </Modal>
  )
}
