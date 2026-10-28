'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const ABAS = [
  { href: '/configuracoes/bot', label: 'Usuários permitidos' },
  { href: '/configuracoes/bot/pedidos', label: 'Pedidos de acesso' },
  { href: '/configuracoes/bot/grupos', label: 'Grupos' },
] as const

export default function BotAbas({ pendentes }: { pendentes: number }) {
  const pathname = usePathname()
  return (
    <nav className="max-w-5xl mx-auto flex gap-4 text-sm overflow-x-auto" aria-label="Seções do bot">
      {ABAS.map((aba) => {
        const ativa = pathname === aba.href
        return (
          <Link
            key={aba.href}
            href={aba.href}
            aria-current={ativa ? 'page' : undefined}
            className={`px-3 py-1.5 rounded-md whitespace-nowrap inline-flex items-center gap-1.5 ${ativa ? 'bg-gray-900 text-white font-medium' : 'text-gray-600 hover:bg-gray-100'}`}
          >
            {aba.label}
            {aba.href.endsWith('/pedidos') && pendentes > 0 && (
              <span
                aria-label={`${pendentes} pedidos pendentes`}
                className="min-w-5 h-5 px-1.5 inline-flex items-center justify-center rounded-full bg-amber-500 text-white text-xs font-medium"
              >
                {pendentes}
              </span>
            )}
          </Link>
        )
      })}
    </nav>
  )
}
