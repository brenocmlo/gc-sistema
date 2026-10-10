'use client'

import { useRouter, useSearchParams } from 'next/navigation'

import { PERIODO_FINANCEIRO_OPTIONS } from '@/lib/financeiro-empresa'

type Props = {
  obraOptions: readonly { value: string; label: string }[]
}

/** Obra e período da visão geral (12.2), na URL. Sem busca: a tela não é uma listagem. */
export default function VisaoGeralFiltros({ obraOptions }: Props) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const obra = searchParams.get('obra') ?? ''
  const periodo = searchParams.get('periodo') ?? 'mes'

  function updateParam(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString())
    if (value) params.set(key, value)
    else params.delete(key)
    router.push(`/financeiro/visao-geral?${params.toString()}`)
  }

  const select = 'px-3 py-2 bg-white border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent max-w-full'
  return (
    <div className="flex flex-col sm:flex-row gap-3 flex-wrap max-w-full">
      <select aria-label="Obra" value={obra} onChange={(e) => updateParam('obra', e.target.value)} className={select}>
        <option value="">Todas as obras</option>
        {obraOptions.map((opt) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
      <select aria-label="Período" value={periodo} onChange={(e) => updateParam('periodo', e.target.value === 'mes' ? '' : e.target.value)} className={select}>
        {PERIODO_FINANCEIRO_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
    </div>
  )
}
