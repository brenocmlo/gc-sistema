'use client'

import { FileText } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { mensagemDeErroHttp } from '@/lib/erro-banco'

export default function RelatorioFdButton({ obraId }: { obraId: string }) {
  const [loading, setLoading] = useState(false)

  async function handleClick() {
    setLoading(true)
    try {
      const res = await fetch(`/api/relatorio/fd-conciliacao/${obraId}`)
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        throw new Error(mensagemDeErroHttp(res.status, text))
      }

      const blob = await res.blob()
      const dlUrl = URL.createObjectURL(blob)
      const cd = res.headers.get('Content-Disposition') ?? ''
      const match = cd.match(/filename="([^"]+)"/)
      const filename = match?.[1] ?? `conciliacao-fd-${obraId}.pdf`

      const a = document.createElement('a')
      a.href = dlUrl
      a.download = filename
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(dlUrl)

      toast.success('Relatório baixado')
    } catch (err) {
      const msg = err instanceof Error ? err.message : mensagemDeErroHttp(0, '')
      toast.error(`Não foi possível gerar o relatório: ${msg}`)
    } finally {
      setLoading(false)
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={loading}
      className="inline-flex items-center gap-2 px-3 py-2 rounded-md border border-gray-300 bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
    >
      <FileText size={14} />
      {loading ? 'Gerando PDF...' : 'Relatório FD (PDF)'}
    </button>
  )
}
