'use client'

import { Search } from 'lucide-react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useState } from 'react'

import { PERIODO_OPTIONS } from '@/lib/listagem'
import { MOTIVO_ACORDO_OPTIONS, STATUS_ACORDO_OPTIONS } from '@/lib/acordos'

const STATUS_OPTIONS: readonly { value: string; label: string }[] = [
  { value: '', label: 'Todos os status' },
  ...STATUS_ACORDO_OPTIONS,
]

const MOTIVO_OPTIONS: readonly { value: string; label: string }[] = [
  { value: '', label: 'Todos os motivos' },
  ...MOTIVO_ACORDO_OPTIONS,
]

type AcordosFiltrosProps = {
  obraOptions: readonly { value: string; label: string }[]
}

export default function AcordosFiltros({
  obraOptions,
}: AcordosFiltrosProps) {
  const router = useRouter()
  const searchParams = useSearchParams()

  const urlBusca = searchParams.get('busca') ?? ''
  const obra = searchParams.get('obra') ?? ''
  const status = searchParams.get('status') ?? ''
  const motivo = searchParams.get('motivo') ?? ''
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
      router.push(`/financeiro/acordos?${params.toString()}`)
    }, 300)
    return () => clearTimeout(handle)
  }, [busca, urlBusca, router, searchParams])

  function updateParam(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString())
    if (value) params.set(key, value)
    else params.delete(key)
    params.delete('page')
    router.push(`/financeiro/acordos?${params.toString()}`)
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
          placeholder="Buscar por descrição, período ou obra"
          aria-label="Buscar acordos"
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
        aria-label="Status"
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
        aria-label="Motivo"
        value={motivo}
        onChange={(e) => updateParam('motivo', e.target.value)}
        className="px-3 py-2 bg-white border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent"
      >
        {MOTIVO_OPTIONS.map((opt) => (
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
