'use client'

import { Search } from 'lucide-react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useState } from 'react'

import { PERIODO_OPTIONS } from '@/lib/listagem'

const STATUS_OPTIONS = [
  { value: '', label: 'Todos os status' },
  { value: 'pendente', label: 'Pendente' },
  { value: 'pago', label: 'Pago' },
  { value: 'vencido', label: 'Vencido' },
]

type FdFiltersProps = {
  obraOptions: readonly { value: string; label: string }[]
}

export default function FdFilters({ obraOptions }: FdFiltersProps) {
  const router = useRouter()
  const searchParams = useSearchParams()

  const urlBusca = searchParams.get('busca') ?? ''
  const obra = searchParams.get('obra') ?? ''
  const status = searchParams.get('status') ?? ''
  const periodo = searchParams.get('periodo') ?? ''

  const [busca, setBusca] = useState(urlBusca)

  useEffect(() => {
    setBusca(urlBusca)
  }, [urlBusca])

  useEffect(() => {
    if (busca === urlBusca) return
    const handle = setTimeout(() => {
      const params = new URLSearchParams(searchParams.toString())
      if (busca) params.set('busca', busca)
      else params.delete('busca')
      params.delete('page')
      router.push(`/fd?${params.toString()}`)
    }, 300)
    return () => clearTimeout(handle)
  }, [busca, urlBusca, router, searchParams])

  function updateParam(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString())
    if (value) params.set(key, value)
    else params.delete(key)
    params.delete('page')
    router.push(`/fd?${params.toString()}`)
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
          placeholder="Buscar por pedido, fornecedor, código ou especificação"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          className="w-full pl-9 pr-3 py-2 bg-white border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent"
        />
      </div>
      <select
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
        value={status}
        onChange={(e) => updateParam('status', e.target.value)}
        className="px-3 py-2 bg-white border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent"
      >
        {STATUS_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      <select
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
