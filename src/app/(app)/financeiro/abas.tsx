'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

// Uma aba por tela do Financeiro. O menu tem um item só (Financeiro, que abre
// na visão geral, 12.2); daqui se chega às NFs, aos pagamentos (10.1) e aos
// acordos (11.1). A aba fica ativa em toda a subárvore (/novo, /[id]).
const ABAS = [
  { href: '/financeiro/visao-geral', label: 'Visão geral' },
  { href: '/financeiro/notas-fiscais', label: 'Notas fiscais' },
  { href: '/financeiro/pagamentos', label: 'Pagamentos' },
  { href: '/financeiro/acordos', label: 'Acordos' },
] as const

export default function FinanceiroAbas() {
  const pathname = usePathname()
  return (
    <nav className="flex gap-4 border-b border-gray-200 text-sm overflow-x-auto" aria-label="Seções do financeiro">
      {ABAS.map((aba) => {
        const ativa = pathname === aba.href || pathname.startsWith(`${aba.href}/`)
        return (
          <Link
            key={aba.href}
            href={aba.href}
            aria-current={ativa ? 'page' : undefined}
            className={`-mb-px px-1 pb-2 border-b-2 whitespace-nowrap ${ativa ? 'border-gray-900 text-gray-900 font-medium' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
          >
            {aba.label}
          </Link>
        )
      })}
    </nav>
  )
}
