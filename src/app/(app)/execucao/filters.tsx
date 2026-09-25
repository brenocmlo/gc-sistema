'use client'

import { Search } from 'lucide-react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useState } from 'react'

import { ETAPAS, ETAPA_LABELS, STATUS_ETAPA_LABELS } from '@/lib/execucao'

const ETAPA_OPTIONS = [
  { value: '', label: 'Todas as etapas' },
  ...ETAPAS.map((e) => ({ value: e, label: `Em ${ETAPA_LABELS[e].toLowerCase()}` })),
]

const STATUS_OPTIONS = [
  { value: '', label: 'Todos os status' },
  ...(['pendente', 'andamento', 'concluido'] as const).map((s) => ({
    value: s,
    label: STATUS_ETAPA_LABELS[s],
  })),
]

const ORDEM_OPTIONS = [
  { value: '', label: 'Ordem: número do item' },
  { value: 'atraso', label: 'Ordem: etapa mais atrasada' },
]

const CLASSE_SELECT =
  'px-3 py-2 bg-white border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent'

type ExecucaoFiltersProps = {
  obraOptions: readonly { value: string; label: string }[]
  responsaveis: readonly string[]
}

export default function ExecucaoFilters({ obraOptions, responsaveis }: ExecucaoFiltersProps) {
  const router = useRouter()
  const searchParams = useSearchParams()

  const obra = searchParams.get('obra') ?? ''
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
      router.push(`/execucao?${params.toString()}`)
    }, 300)
    return () => clearTimeout(handle)
  }, [busca, urlBusca, router, searchParams])

  function updateParam(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString())
    if (value) params.set(key, value)
    else params.delete(key)
    params.delete('page')
    router.push(`/execucao?${params.toString()}`)
  }

  // Trocar de obra zera os outros filtros: responsável e busca são da obra anterior.
  function trocarObra(value: string) {
    router.push(value ? `/execucao?obra=${encodeURIComponent(value)}` : '/execucao')
  }

  return (
    <div className="space-y-3 w-full">
      <select
        aria-label="Obra"
        value={obra}
        onChange={(e) => trocarObra(e.target.value)}
        className={`${CLASSE_SELECT} w-full sm:w-auto sm:min-w-[320px] font-medium`}
      >
        <option value="">Selecione uma obra</option>
        {obraOptions.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>

      {obra && (
        <div className="flex flex-col sm:flex-row gap-3 w-full flex-wrap">
          <div className="relative flex-1 min-w-[240px]">
            <Search
              size={16}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"
            />
            <input
              type="text"
              placeholder="Buscar pela descrição do item"
              aria-label="Buscar itens"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              className="w-full pl-9 pr-3 py-2 bg-white border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent"
            />
          </div>
          <select
            aria-label="Etapa"
            value={searchParams.get('etapa') ?? ''}
            onChange={(e) => updateParam('etapa', e.target.value)}
            className={CLASSE_SELECT}
          >
            {ETAPA_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <select
            aria-label="Status"
            value={searchParams.get('status') ?? ''}
            onChange={(e) => updateParam('status', e.target.value)}
            className={CLASSE_SELECT}
          >
            {STATUS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <select
            aria-label="Responsável"
            value={searchParams.get('responsavel') ?? ''}
            onChange={(e) => updateParam('responsavel', e.target.value)}
            className={CLASSE_SELECT}
          >
            <option value="">Todos os responsáveis</option>
            {responsaveis.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
          <select
            aria-label="Prazo"
            value={searchParams.get('atrasados') ?? ''}
            onChange={(e) => updateParam('atrasados', e.target.value)}
            className={CLASSE_SELECT}
          >
            <option value="">Todos os prazos</option>
            <option value="1">Só atrasados</option>
          </select>
          <select
            aria-label="Ordenação"
            value={searchParams.get('ordem') ?? ''}
            onChange={(e) => updateParam('ordem', e.target.value)}
            className={CLASSE_SELECT}
          >
            {ORDEM_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  )
}
