'use client'

import { UserCheck } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { toast } from 'sonner'

import {
  acoesDoPedido,
  ordenarPedidos,
  STATUS_PEDIDO_LABELS,
  type PedidoAcessoListItem,
} from '@/lib/bot-config'
import { formatDateTime } from '@/lib/format'

import { permitirPedidoAcesso, recusarPedidoAcesso } from '../actions'

export default function PedidosPanel({ pedidos }: { pedidos: PedidoAcessoListItem[] }) {
  const router = useRouter()
  const [ocupado, setOcupado] = useState<string | null>(null)
  const lista = ordenarPedidos(pedidos)

  async function agir(p: PedidoAcessoListItem, tipo: 'permitir' | 'recusar') {
    setOcupado(p.id)
    const r = tipo === 'permitir' ? await permitirPedidoAcesso(p.id) : await recusarPedidoAcesso(p.id)
    setOcupado(null)
    if (!r.ok) {
      toast.error(`Não foi possível ${tipo}: ${r.error}`)
      return
    }
    toast.success(tipo === 'permitir' ? 'Acesso permitido' : 'Pedido recusado')
    router.refresh()
  }

  return (
    <div className="max-w-5xl mx-auto bg-white rounded-lg border border-gray-200 shadow-sm overflow-x-auto">
      {lista.length === 0 ? (
        <div className="px-4 py-12 text-center">
          <UserCheck className="h-8 w-8 text-gray-300 mx-auto" aria-hidden />
          <p className="mt-2 text-sm text-gray-600">Nenhum pedido de acesso</p>
        </div>
      ) : (
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase">
            <tr>
              <th className="px-4 py-2">Nome</th>
              <th className="px-4 py-2">Usuário</th>
              <th className="px-4 py-2">Código</th>
              <th className="px-4 py-2">Grupo</th>
              <th className="px-4 py-2">Pedido em</th>
              <th className="px-4 py-2">Situação</th>
              <th className="px-4 py-2 sr-only">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {lista.map((p) => {
              const acoes = acoesDoPedido(p.status)
              return (
                <tr key={p.id}>
                  <td className="px-4 py-2 text-gray-900">{p.nome}</td>
                  <td className="px-4 py-2 text-gray-600">{p.telegram_username ? `@${p.telegram_username}` : '—'}</td>
                  <td className="px-4 py-2 font-mono text-gray-700">{p.telegram_user_id}</td>
                  <td className="px-4 py-2 text-gray-600">{p.grupo ? (p.grupo.nome ?? p.grupo.telegram_chat_id) : '—'}</td>
                  <td className="px-4 py-2 text-gray-600 tabular-nums">{formatDateTime(p.created_at)}</td>
                  <td className="px-4 py-2 text-gray-700">{STATUS_PEDIDO_LABELS[p.status]}</td>
                  <td className="px-4 py-2">
                    <div className="flex justify-end gap-2">
                      {acoes.permitir && (
                        <button
                          type="button"
                          disabled={ocupado === p.id}
                          onClick={() => agir(p, 'permitir')}
                          aria-label={`Permitir ${p.nome}`}
                          className="px-2 py-1 text-xs text-white bg-gray-900 rounded hover:bg-gray-800 disabled:opacity-60"
                        >
                          Permitir
                        </button>
                      )}
                      {acoes.recusar && (
                        <button
                          type="button"
                          disabled={ocupado === p.id}
                          onClick={() => agir(p, 'recusar')}
                          aria-label={`Recusar ${p.nome}`}
                          className="px-2 py-1 text-xs text-gray-700 border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-60"
                        >
                          Recusar
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </div>
  )
}
