'use client'

import { FileText } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import { validarPeriodo, type Periodo } from '@/lib/medicao'

/** Relatório de medição por obra (8.4): o período e o download do PDF, como o do FD. */
export default function RelatorioMedicaoButton({ obraId, periodoInicial }: { obraId: string; periodoInicial: Periodo }) {
  const [de, setDe] = useState(periodoInicial.de)
  const [ate, setAte] = useState(periodoInicial.ate)
  const [loading, setLoading] = useState(false)
  const periodo = validarPeriodo(de, ate)

  async function baixar() {
    if (!periodo.ok) return
    setLoading(true)
    try {
      const res = await fetch(`/api/relatorio/medicao/${obraId}?de=${de}&ate=${ate}`)
      if (!res.ok) {
        const corpo = await res.json().catch(() => null)
        throw new Error(corpo?.error ?? `Falha (${res.status})`)
      }
      const blob = await res.blob()
      const dlUrl = URL.createObjectURL(blob)
      const match = (res.headers.get('Content-Disposition') ?? '').match(/filename="([^"]+)"/)
      const a = document.createElement('a')
      a.href = dlUrl
      a.download = match?.[1] ?? `medicao-${obraId}.pdf`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(dlUrl)
      toast.success('Relatório de medição baixado')
    } catch (err) {
      toast.error(`Falha ao gerar: ${err instanceof Error ? err.message : 'erro desconhecido'}`)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex items-end gap-2 flex-wrap" aria-label="Relatório de medição">
      <label className="text-xs font-medium text-gray-600">
        De
        <input
          type="date"
          value={de}
          onChange={(e) => setDe(e.target.value)}
          aria-label="Início do período"
          className="block mt-1 px-3 py-2 border border-gray-300 rounded-md text-base sm:text-sm"
        />
      </label>
      <label className="text-xs font-medium text-gray-600">
        Até
        <input
          type="date"
          value={ate}
          onChange={(e) => setAte(e.target.value)}
          aria-label="Fim do período"
          className="block mt-1 px-3 py-2 border border-gray-300 rounded-md text-base sm:text-sm"
        />
      </label>
      <button
        type="button"
        onClick={baixar}
        disabled={loading || !periodo.ok}
        title={periodo.ok ? undefined : periodo.error}
        className="inline-flex items-center gap-2 px-3 py-2.5 rounded-md bg-gray-900 text-white text-sm font-medium hover:bg-gray-800 disabled:bg-gray-400"
      >
        <FileText size={14} />
        {loading ? 'Gerando PDF...' : 'Relatório de medição (PDF)'}
      </button>
      {!periodo.ok && <p className="w-full text-xs text-red-700">{periodo.error}</p>}
    </div>
  )
}
