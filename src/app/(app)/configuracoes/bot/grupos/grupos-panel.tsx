'use client'

import { Users } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { toast } from 'sonner'

import ConfirmDialog from '@/components/ConfirmDialog'
import { acoesDoGrupo, STATUS_GRUPO_LABELS, type GrupoBotListItem } from '@/lib/bot-config'
import { formatDateTime } from '@/lib/format'

import { bloquearGrupoBot, liberarGrupoBot } from '../actions'

export default function GruposPanel({ grupos }: { grupos: GrupoBotListItem[] }) {
  const router = useRouter()
  const [ocupado, setOcupado] = useState<string | null>(null)
  const [bloqueando, setBloqueando] = useState<GrupoBotListItem | null>(null)

  async function liberar(g: GrupoBotListItem) {
    setOcupado(g.id)
    const r = await liberarGrupoBot(g.id)
    setOcupado(null)
    if (!r.ok) {
      toast.error(`Não foi possível liberar: ${r.error}`)
      return
    }
    toast.success('Grupo liberado')
    router.refresh()
  }

  async function bloquear() {
    if (!bloqueando) return
    const r = await bloquearGrupoBot(bloqueando.id)
    if (!r.ok) {
      toast.error(`Não foi possível bloquear: ${r.error}`)
      return
    }
    toast.success('Grupo bloqueado')
    setBloqueando(null)
    router.refresh()
  }

  return (
    <div className="max-w-5xl mx-auto bg-white rounded-lg border border-gray-200 shadow-sm overflow-x-auto">
      {grupos.length === 0 ? (
        <div className="px-4 py-12 text-center">
          <Users className="h-8 w-8 text-gray-300 mx-auto" aria-hidden />
          <p className="mt-2 text-sm text-gray-600">Nenhum grupo</p>
        </div>
      ) : (
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase">
            <tr>
              <th className="px-4 py-2">Nome do grupo</th>
              <th className="px-4 py-2">Código</th>
              <th className="px-4 py-2">Situação</th>
              <th className="px-4 py-2">Registrado em</th>
              <th className="px-4 py-2 sr-only">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {grupos.map((g) => {
              const acoes = acoesDoGrupo(g.status)
              const rotulo = g.nome ?? g.telegram_chat_id
              return (
                <tr key={g.id}>
                  <td className="px-4 py-2 text-gray-900">{g.nome ?? <span className="text-gray-400">sem nome</span>}</td>
                  <td className="px-4 py-2 font-mono text-gray-700">{g.telegram_chat_id}</td>
                  <td className="px-4 py-2 text-gray-700">{STATUS_GRUPO_LABELS[g.status]}</td>
                  <td className="px-4 py-2 text-gray-600 tabular-nums">{formatDateTime(g.created_at)}</td>
                  <td className="px-4 py-2">
                    <div className="flex justify-end gap-2">
                      {acoes.liberar && (
                        <button
                          type="button"
                          disabled={ocupado === g.id}
                          onClick={() => liberar(g)}
                          aria-label={`Liberar ${rotulo}`}
                          className="px-2 py-1 text-xs text-white bg-gray-900 rounded hover:bg-gray-800 disabled:opacity-60"
                        >
                          Liberar
                        </button>
                      )}
                      {acoes.bloquear && (
                        <button
                          type="button"
                          onClick={() => setBloqueando(g)}
                          aria-label={`Bloquear ${rotulo}`}
                          className="px-2 py-1 text-xs text-red-700 border border-gray-300 rounded hover:bg-red-50"
                        >
                          Bloquear
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

      <ConfirmDialog
        open={bloqueando !== null}
        onOpenChange={(open) => !open && setBloqueando(null)}
        title="Bloquear grupo"
        description="Ninguém mais consegue enviar documentos por este grupo até ele ser liberado de novo."
        confirmLabel="Bloquear"
        variant="danger"
        onConfirm={bloquear}
      />
    </div>
  )
}
