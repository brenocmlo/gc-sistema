'use client'

import { usePathname } from 'next/navigation'
import { useEffect, useState, type ReactNode } from 'react'

import Header from '@/components/Header'
import Sidebar from '@/components/Sidebar'
import type { Perfil } from '@/lib/types'

type AppShellProps = {
  user: { nome: string; email: string; perfil: Perfil }
  children: ReactNode
}

/**
 * Sidebar + header + conteúdo. Existe só para guardar o estado da gaveta do
 * menu no celular (bloco 8.2): abaixo de `md` a sidebar sai do fluxo e abre
 * pelo botão do header, e o conteúdo usa a largura toda.
 */
export default function AppShell({ user, children }: AppShellProps) {
  const pathname = usePathname()
  const [menuAberto, setMenuAberto] = useState(false)

  // Navegou pelo menu: a gaveta fecha.
  useEffect(() => {
    setMenuAberto(false)
  }, [pathname])

  return (
    <div className="flex min-h-screen bg-[#f8f9fa]">
      <Sidebar perfil={user.perfil} aberta={menuAberto} onFechar={() => setMenuAberto(false)} />
      <div className="flex-1 flex flex-col min-w-0">
        <Header user={user} onAbrirMenu={() => setMenuAberto(true)} />
        <main className="flex-1 p-4 md:p-8">{children}</main>
      </div>
    </div>
  )
}
