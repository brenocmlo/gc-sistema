'use client'

import { Search } from 'lucide-react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useState } from 'react'

import { STATUS_DOCUMENTO_OPTIONS } from '@/lib/documentos'
import { PERIODO_OPTIONS } from '@/lib/listagem'

const STATUS_OPTIONS = [{ value: '', label: 'Todos os status' }, ...STATUS_DOCUMENTO_OPTIONS]
const TIPO_OPTIONS = [
  { value: '', label: 'Todos os tipos' },
  { value: 'PROPOSTA', label: 'Proposta' },
  { value: 'CONTRATO', label: 'Contrato' },
]
const SELECT_CLASS =
  'px-3 py-2 bg-white border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent'

export default function DocumentosFilters({
  obraOptions,
}: {
  obraOptions: readonly { value: string; label: string }[]
}) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const urlBusca = searchParams.get('busca') ?? ''
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
      router.push(`/documentos?${params.toString()}`)
    }, 300)
    return () => clearTimeout(handle)
  }, [busca, urlBusca, router, searchParams])

  function updateParam(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString())
    if (value) params.set(key, value)
    else params.delete(key)
    params.delete('page')
    router.push(`/documentos?${params.toString()}`)
  }

  const selects: { key: string; label: string; options: readonly { value: string; label: string }[] }[] = [
    { key: 'status', label: 'Status', options: STATUS_OPTIONS },
    { key: 'tipo', label: 'Tipo', options: TIPO_OPTIONS },
    { key: 'obra', label: 'Obra', options: [{ value: '', label: 'Todas as obras' }, ...obraOptions] },
    { key: 'periodo', label: 'Período', options: PERIODO_OPTIONS },
  ]

  return (
    <div className="flex flex-col sm:flex-row gap-3 w-full flex-wrap">
      <div className="relative flex-1 min-w-[240px]">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
        <input
          type="text"
          placeholder="Buscar por motivo de revisão"
          aria-label="Buscar documentos"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          className="w-full pl-9 pr-3 py-2 bg-white border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent"
        />
      </div>
      {selects.map((s) => (
        <select
          key={s.key}
          aria-label={s.label}
          value={searchParams.get(s.key) ?? ''}
          onChange={(e) => updateParam(s.key, e.target.value)}
          className={SELECT_CLASS}
        >
          {s.options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      ))}
    </div>
  )
}
