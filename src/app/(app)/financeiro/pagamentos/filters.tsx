'use client'

import { Search } from 'lucide-react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useState } from 'react'

import { PERIODO_OPTIONS } from '@/lib/listagem'
import { FORMA_PAGAMENTO_OPTIONS, ORIGEM_PAGAMENTO_OPTIONS } from '@/lib/pagamentos'

const ORIGEM_OPTIONS: readonly { value: string; label: string }[] = [
  { value: '', label: 'Todas as origens' },
  ...ORIGEM_PAGAMENTO_OPTIONS,
]

const FORMA_OPTIONS: readonly { value: string; label: string }[] = [
  { value: '', label: 'Todas as formas' },
  ...FORMA_PAGAMENTO_OPTIONS,
]

type PagamentosFiltrosProps = {
  obraOptions: readonly { value: string; label: string }[]
}

export default function PagamentosFiltros({
  obraOptions,
}: PagamentosFiltrosProps) {
  const router = useRouter()
  const searchParams = useSearchParams()

  const urlBusca = searchParams.get('busca') ?? ''
  const obra = searchParams.get('obra') ?? ''
  const origem = searchParams.get('origem') ?? ''
  const forma = searchParams.get('forma') ?? ''
  const periodo = searchParams.get('periodo') ?? ''

  const [busca, setBusca] = useState(urlBusca)

  useEffect(() => {
    setBusca(urlBusca)
  }, [urlBusca])

  // Debounce 300ms da busca antes de escrever na URL
  useEffect(() => {
    if (busca === urlBusca) return
    const handle = setTimeout(() => {
      const params = new URLSearchParams(searchParams.toString())
      if (busca) params.set('busca', busca)
      else params.delete('busca')
      params.delete('page')
      router.push(`/financeiro/pagamentos?${params.toString()}`)
    }, 300)
    return () => clearTimeout(handle)
  }, [busca, urlBusca, router, searchParams])

  function updateParam(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString())
    if (value) params.set(key, value)
    else params.delete(key)
    params.delete('page')
    router.push(`/financeiro/pagamentos?${params.toString()}`)
  }

  return (
    <div className="flex flex-col sm:flex-row gap-3 w-full flex-wrap">
      <div className="relative flex-1 min-w-[240px]">
        <Search
          size={16}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"
        />
        <input
          type="text"
          placeholder="Buscar por obra, número da NF ou observação"
          aria-label="Buscar pagamentos"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          className="w-full pl-9 pr-3 py-2 bg-white border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent"
        />
      </div>
      <select
        aria-label="Obra"
        value={obra}
        onChange={(e) => updateParam('obra', e.target.value)}
        className="px-3 py-2 bg-white border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent"
      >
        <option value="">Todas as obras</option>
        {obraOptions.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      <select
        aria-label="Origem"
        value={origem}
        onChange={(e) => updateParam('origem', e.target.value)}
        className="px-3 py-2 bg-white border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent"
      >
        {ORIGEM_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      <select
        aria-label="Forma"
        value={forma}
        onChange={(e) => updateParam('forma', e.target.value)}
        className="px-3 py-2 bg-white border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent"
      >
        {FORMA_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      <select
        aria-label="Período"
        value={periodo}
        onChange={(e) => updateParam('periodo', e.target.value)}
        className="px-3 py-2 bg-white border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent"
      >
        {PERIODO_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  )
}
