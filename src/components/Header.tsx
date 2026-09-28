'use client'

import { ChevronDown, LogOut, Menu } from 'lucide-react'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

import { getTitleForPathname } from '@/lib/nav'
import { createClient } from '@/lib/supabase/client'
import { PERFIL_LABELS, type Perfil } from '@/lib/types'

type HeaderProps = {
  title?: string
  user: {
    nome: string
    email: string
    perfil: Perfil
  }
  /** Botão do menu, só abaixo de `md` (8.2). */
  onAbrirMenu?: () => void
}

export default function Header({ title, user, onAbrirMenu }: HeaderProps) {
  const pathname = usePathname()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const displayTitle = title ?? getTitleForPathname(pathname)

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  async function handleSignOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  return (
    <header className="bg-white shadow-sm border-b border-gray-200 px-4 md:px-8 py-3 md:py-4 flex items-center justify-between gap-3">
      <div className="flex items-center gap-2 min-w-0">
        {onAbrirMenu && (
          <button
            type="button"
            onClick={onAbrirMenu}
            aria-label="Abrir menu"
            className="md:hidden -ml-2 p-3 rounded-md text-gray-700 hover:bg-gray-100"
          >
            <Menu size={22} />
          </button>
        )}
        <h1 className="text-lg md:text-xl font-semibold text-gray-900 truncate">{displayTitle}</h1>
      </div>

      <div className="relative" ref={dropdownRef}>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-2 px-2 md:px-3 py-2 rounded-md hover:bg-gray-100 transition-colors shrink-0"
        >
          <div className="text-right leading-tight">
            <p className="text-sm font-medium text-gray-900 truncate max-w-[120px] md:max-w-none">{user.nome}</p>
            <p className="text-xs text-gray-500">{PERFIL_LABELS[user.perfil]}</p>
          </div>
          <ChevronDown size={16} className="text-gray-500" />
        </button>

        {open && (
          <div className="absolute right-0 mt-2 w-56 bg-white rounded-md shadow-lg border border-gray-200 py-1 z-20">
            <div className="px-4 py-2 border-b border-gray-100">
              <p className="text-sm font-medium text-gray-900 truncate">
                {user.nome}
              </p>
              <p className="text-xs text-gray-500 truncate">{user.email}</p>
            </div>
            <button
              type="button"
              onClick={handleSignOut}
              className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-gray-50 flex items-center gap-2"
            >
              <LogOut size={14} />
              Sair
            </button>
          </div>
        )}
      </div>
    </header>
  )
}
