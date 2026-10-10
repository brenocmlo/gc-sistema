'use client'

import { Search } from 'lucide-react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useState } from 'react'

const STATUS_OPTIONS = [
  { value: '', label: 'Todas' },
  { value: 'ativa', label: 'Ativa' },
  { value: 'concluida', label: 'Concluída' },
  { value: 'suspensa', label: 'Suspensa' },
  { value: 'cancelada', label: 'Cancelada' },
]

export default function ObrasFilters() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const urlQ = searchParams.get('q') ?? ''
  const status = searchParams.get('status') ?? ''

  const [q, setQ] = useState(urlQ)

  // Se a URL mudar externamente (ex: paginação), sincroniza o input
  useEffect(() => {
    setQ(urlQ)
  }, [urlQ])

  // Debounce da busca: 300ms após parar de digitar, atualiza a URL
  useEffect(() => {
    if (q === urlQ) return

    const handle = setTimeout(() => {
      const params = new URLSearchParams(searchParams.toString())
      if (q) params.set('q', q)
      else params.delete('q')
      params.delete('page')
      router.push(`/obras?${params.toString()}`)
    }, 300)

    return () => clearTimeout(handle)
  }, [q, urlQ, router, searchParams])

  function handleStatusChange(value: string) {
    const params = new URLSearchParams(searchParams.toString())
    if (value) params.set('status', value)
    else params.delete('status')
    params.delete('page')
    router.push(`/obras?${params.toString()}`)
  }

  return (
    <div className="flex flex-col sm:flex-row gap-3 w-full">
      <div className="relative flex-1">
        <Search
          size={16}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"
        />
        <input
          type="text"
          placeholder="Buscar por nome, código ou cliente"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="w-full pl-9 pr-3 py-2 bg-white border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent"
        />
      </div>
      <select
        value={status}
        onChange={(e) => handleStatusChange(e.target.value)}
        className="px-3 py-2 bg-white border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent max-w-full"
      >
        {STATUS_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  )
}
