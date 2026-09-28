'use client'

import { X } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect } from 'react'

import { getMenuItemsForPerfil, SETTINGS_ITEM, type MenuItem } from '@/lib/nav'
import type { Perfil } from '@/lib/types'

type SidebarProps = {
  perfil: Perfil
  /** Só abaixo de `md`: a gaveta do menu está aberta. */
  aberta: boolean
  onFechar: () => void
}

/**
 * Menu lateral. No desktop, coluna fixa de 240px. Abaixo de `md` (8.2), vira
 * gaveta por cima do conteúdo, aberta pelo botão do header: a coluna fixa
 * comia 240 dos 390px de um celular.
 */
export default function Sidebar({ perfil, aberta, onFechar }: SidebarProps) {
  // ESC fecha a gaveta, como o Modal.
  useEffect(() => {
    if (!aberta) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onFechar()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [aberta, onFechar])

  return (
    <>
      <aside className="hidden md:flex w-60 shrink-0 bg-white border-r border-gray-200 flex-col">
        <Conteudo perfil={perfil} />
      </aside>

      {aberta && (
        <div className="md:hidden fixed inset-0 z-40 flex" role="dialog" aria-modal="true" aria-label="Menu">
          <div className="absolute inset-0 bg-black/40" onClick={onFechar} aria-hidden />
          <aside className="relative w-72 max-w-[85%] h-full bg-white shadow-xl flex flex-col">
            <button
              type="button"
              onClick={onFechar}
              aria-label="Fechar menu"
              className="absolute top-4 right-3 p-2.5 rounded-md text-gray-500 hover:bg-gray-100"
            >
              <X size={20} />
            </button>
            <Conteudo perfil={perfil} />
          </aside>
        </div>
      )}
    </>
  )
}

function Conteudo({ perfil }: { perfil: Perfil }) {
  const pathname = usePathname()
  const items = getMenuItemsForPerfil(perfil)

  return (
    <>
      <div className="px-6 py-5 border-b border-gray-200">
        <div className="flex items-center gap-3">
          <div
            aria-hidden
            className="w-9 h-9 rounded-md bg-gray-900 shrink-0"
          />
          <span className="text-sm font-semibold text-gray-900 leading-tight">
            Gestão de
            <br />
            Contratos
          </span>
        </div>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        {items.map((item) => (
          <NavLink key={item.href} item={item} pathname={pathname} />
        ))}
      </nav>

      {perfil === 'admin' && (
        <div className="px-3 py-3 border-t border-gray-200">
          <NavLink item={SETTINGS_ITEM} pathname={pathname} />
        </div>
      )}
    </>
  )
}

function NavLink({ item, pathname }: { item: MenuItem; pathname: string }) {
  const active =
    pathname === item.href ||
    (item.href !== '/' && pathname.startsWith(`${item.href}/`))
  const Icon = item.icon

  return (
    <Link
      href={item.href}
      className={`flex items-center gap-3 px-3 py-3 md:py-2 rounded-md text-sm font-medium transition-colors ${
        active
          ? 'bg-gray-900 text-white'
          : 'text-gray-700 hover:bg-gray-100'
      }`}
    >
      <Icon size={18} className="shrink-0" />
      <span className="truncate">{item.label}</span>
    </Link>
  )
}
