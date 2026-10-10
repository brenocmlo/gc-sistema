'use client'

import { Download } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { mensagemDeErroHttp } from '@/lib/erro-banco'

type ExportButtonProps = {
  /** Endpoint completo: ex "/api/export/orcamentos" */
  endpoint: string
  /** Query string atual da listagem (sem o "?"). Vai virar params da API. */
  searchParams?: Record<string, string>
  /** Nome do arquivo sugerido (sem extensão) */
  filename: string
  /** Label opcional, default "Exportar XLSX" */
  label?: string
}

export default function ExportButton({
  endpoint,
  searchParams,
  filename,
  label = 'Exportar XLSX',
}: ExportButtonProps) {
  const [loading, setLoading] = useState(false)

  async function handleClick() {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (searchParams) {
        for (const [k, v] of Object.entries(searchParams)) {
          if (v) params.set(k, v)
        }
      }
      const url = `${endpoint}${params.toString() ? `?${params.toString()}` : ''}`

      const res = await fetch(url)
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        throw new Error(mensagemDeErroHttp(res.status, text))
      }

      const blob = await res.blob()
      const dlUrl = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = dlUrl
      a.download = `${filename}.xlsx`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(dlUrl)

      toast.success('Planilha baixada')
    } catch (err) {
      const msg = err instanceof Error ? err.message : mensagemDeErroHttp(0, '')
      toast.error(`Não foi possível baixar a planilha: ${msg}`)
    } finally {
      setLoading(false)
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={loading}
      className="inline-flex items-center gap-2 px-3 py-2 rounded-md border border-gray-300 bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition-colors"
    >
      <Download size={16} />
      {loading ? 'Gerando...' : label}
    </button>
  )
}
