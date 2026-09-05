'use client'

import { Search } from 'lucide-react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useState } from 'react'

import { PERIODO_OPTIONS } from '@/lib/listagem'
import { STATUS_PROPOSTA_OPTIONS } from '@/lib/propostas'

/**
 * "Vencidas" ocupa uma linha do mesmo select de status, mas não é status do
 * banco: viaja na URL como `?vencidas=1` (ver pendência 3 do bloco 4.2). Ficar
 * no mesmo select é o que impede a combinação contraditória
 * `?status=aprovada&vencidas=1`, que não retornaria nada.
 */
const VENCIDAS_VALUE = '__vencidas__'

const STATUS_OPTIONS: readonly { value: string; label: string }[] = [
  { value: '', label: 'Todos os status' },
  ...STATUS_PROPOSTA_OPTIONS,
  { value: VENCIDAS_VALUE, label: 'Vencidas' },
]

type PropostasFiltersProps = {
  obraOptions: readonly { value: string; label: string }[]
}

export default function PropostasFilters({
  obraOptions,
}: PropostasFiltersProps) {
  const router = useRouter()
  const searchParams = useSearchParams()

  const urlBusca = searchParams.get('busca') ?? ''
  const obra = searchParams.get('obra') ?? ''
  const status = searchParams.get('status') ?? ''
  const vencidas = searchParams.get('vencidas') === '1'
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
      router.push(`/propostas?${params.toString()}`)
    }, 300)
    return () => clearTimeout(handle)
  }, [busca, urlBusca, router, searchParams])

  function pushParams(params: URLSearchParams) {
    params.delete('page')
    router.push(`/propostas?${params.toString()}`)
  }

  function updateParam(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString())
    if (value) params.set(key, value)
    else params.delete(key)
    pushParams(params)
  }

  // `status` e `vencidas` são mutuamente exclusivos: um sempre apaga o outro.
  function updateStatus(value: string) {
    const params = new URLSearchParams(searchParams.toString())
    if (value === VENCIDAS_VALUE) {
      params.set('vencidas', '1')
      params.delete('status')
    } else {
      params.delete('vencidas')
      if (value) params.set('status', value)
      else params.delete('status')
    }
    pushParams(params)
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
          placeholder="Buscar por número, obra ou cliente"
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
        value={vencidas ? VENCIDAS_VALUE : status}
        onChange={(e) => updateStatus(e.target.value)}
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
