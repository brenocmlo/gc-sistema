'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const ABAS = [
  { href: '/configuracoes', label: 'Empresa', soAdmin: true },
  { href: '/configuracoes/contatos', label: 'Contatos do bot', soAdmin: true },
  { href: '/configuracoes/usuarios', label: 'Usuários', soAdmin: true },
  { href: '/configuracoes/perfil', label: 'Meu perfil', soAdmin: false },
] as const

export default function ConfiguracoesAbas({ admin }: { admin: boolean }) {
  const pathname = usePathname()
  const abas = ABAS.filter((aba) => admin || !aba.soAdmin)
  return (
    <nav className="max-w-5xl mx-auto flex gap-4 border-b border-gray-200 text-sm overflow-x-auto" aria-label="Seções de configurações">
      {abas.map((aba) => {
        const ativa = pathname === aba.href
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
