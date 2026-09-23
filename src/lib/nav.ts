import {
  Activity,
  ArrowLeftRight,
  Building2,
  FileCheck,
  FileText,
  LayoutDashboard,
  ScrollText,
  Settings,
  Users,
  Wallet,
  Wrench,
  type LucideIcon,
} from 'lucide-react'

import type { Perfil } from './types'

export type MenuItem = {
  label: string
  href: string
  icon: LucideIcon
  perfis: readonly Perfil[]
}

const TODOS: readonly Perfil[] = [
  'admin',
  'comercial',
  'producao',
  'medicao',
  'financeiro',
  'visualizador',
]

export const MENU_ITEMS: readonly MenuItem[] = [
  { label: 'Dashboard', href: '/', icon: LayoutDashboard, perfis: TODOS },
  {
    label: 'Clientes',
    href: '/clientes',
    icon: Users,
    perfis: ['admin', 'comercial', 'visualizador'],
  },
  {
    label: 'Orçamentos',
    href: '/orcamentos',
    icon: FileText,
    perfis: ['admin', 'comercial', 'visualizador'],
  },
  { label: 'Obras', href: '/obras', icon: Building2, perfis: TODOS },
  {
    label: 'Propostas',
    href: '/propostas',
    icon: ScrollText,
    perfis: ['admin', 'comercial', 'visualizador'],
  },
  {
    label: 'Contratos',
    href: '/contratos',
    icon: FileCheck,
    perfis: ['admin', 'comercial', 'visualizador'],
  },
  {
    label: 'Execução',
    href: '/execucao',
    icon: Wrench,
    perfis: ['admin', 'producao', 'medicao', 'visualizador'],
  },
  {
    label: 'Financeiro',
    href: '/financeiro',
    icon: Wallet,
    perfis: ['admin', 'financeiro', 'visualizador'],
  },
  {
    label: 'Faturamento Direto',
    href: '/fd',
    icon: ArrowLeftRight,
    perfis: ['admin', 'financeiro', 'visualizador'],
  },
  // Bloco 13.2. Só admin: a RLS de auditoria_eventos também só deixa admin ler.
  { label: 'Logs e auditoria', href: '/logs', icon: Activity, perfis: ['admin'] },
]

export const SETTINGS_ITEM: MenuItem = {
  label: 'Configurações',
  href: '/configuracoes',
  icon: Settings,
  perfis: ['admin'],
}

export function getMenuItemsForPerfil(perfil: Perfil): MenuItem[] {
  return MENU_ITEMS.filter((item) => item.perfis.includes(perfil))
}

export function getTitleForPathname(pathname: string): string {
  const all = [...MENU_ITEMS, SETTINGS_ITEM]
  const match = all.find(
    (item) => item.href === pathname || pathname.startsWith(`${item.href}/`),
  )
  return match?.label ?? 'Gestão de Contratos'
}
