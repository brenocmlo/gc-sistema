'use client'

import { Search } from 'lucide-react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useState } from 'react'

import {
  ACAO_OPTIONS,
  ENTIDADE_OPTIONS,
  ORIGEM_OPTIONS,
  RESULTADO_OPTIONS,
} from '@/lib/auditoria'
import { PERIODO_OPTIONS } from '@/lib/listagem'

const SELECT_CLASS =
  'px-3 py-2 bg-white border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent'

type Opcao = { value: string; label: string }

type LogsFiltersProps = {
  autorOptions: readonly Opcao[]
}

export default function LogsFilters({ autorOptions }: LogsFiltersProps) {
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
      router.push(`/logs?${params.toString()}`)
    }, 300)
    return () => clearTimeout(handle)
  }, [busca, urlBusca, router, searchParams])

  function updateParam(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString())
    if (value) params.set(key, value)
    else params.delete(key)
    params.delete('page')
    router.push(`/logs?${params.toString()}`)
  }

  const selects: { key: string; todos: string; options: readonly Opcao[] }[] = [
    { key: 'origem', todos: 'Todas as origens', options: ORIGEM_OPTIONS },
    { key: 'resultado', todos: 'Sucesso e erro', options: RESULTADO_OPTIONS },
    { key: 'entidade', todos: 'Todas as entidades', options: ENTIDADE_OPTIONS },
    { key: 'acao', todos: 'Todas as ações', options: ACAO_OPTIONS },
    { key: 'autor', todos: 'Todos os autores', options: autorOptions },
    { key: 'periodo', todos: '', options: PERIODO_OPTIONS },
  ]

  return (
    <div className="flex flex-col sm:flex-row gap-3 w-full flex-wrap">
      <div className="relative flex-1 min-w-[240px]">
        <Search
          size={16}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"
        />
        <input
          type="text"
          placeholder="Buscar na mensagem ou colar o id do registro"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          className="w-full pl-9 pr-3 py-2 bg-white border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent"
        />
      </div>
      {selects.map((s) => (
        <select
          key={s.key}
          aria-label={s.key}
          value={searchParams.get(s.key) ?? ''}
          onChange={(e) => updateParam(s.key, e.target.value)}
          className={SELECT_CLASS}
        >
          {/* PERIODO_OPTIONS já traz a opção vazia ("Todos os períodos"). */}
          {s.todos && <option value="">{s.todos}</option>}
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
