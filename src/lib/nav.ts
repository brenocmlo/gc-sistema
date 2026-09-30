import {
  Activity,
  ArrowLeftRight,
  Building2,
  FileCheck,
  FileText,
  Inbox,
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
  /**
   * Prefixo da seção, quando o link não é a raiz dela: o item fica ativo (e
   * dá o título) em qualquer rota sob ele. Ver o Financeiro.
   */
  secao?: string
}

/** A rota a partir da qual o item conta como ativo: a seção, ou o próprio link. */
export function prefixoDoItem(item: MenuItem): string {
  return item.secao ?? item.href
}

export function itemAtivo(item: MenuItem, pathname: string): boolean {
  const base = prefixoDoItem(item)
  return pathname === base || (base !== '/' && pathname.startsWith(`${base}/`))
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
    // Automação, Fase 7: o que chega pelo bot do Telegram ou pela tela.
    label: 'Documentos',
    href: '/documentos',
    icon: Inbox,
    perfis: ['admin', 'comercial', 'visualizador'],
  },
  {
    label: 'Execução',
    href: '/execucao',
    icon: Wrench,
    perfis: ['admin', 'producao', 'medicao', 'visualizador'],
  },
  {
    // O link vai direto à listagem de NFs. `/financeiro` redireciona para lá,
    // mas redirect() numa page quebra a navegação pelo Link no Next 14 (o
    // clique usa o prefetch e não sai do lugar) — foi o "Em construção" que
    // continuou aparecendo no fechamento do 9.5.
    label: 'Financeiro',
    href: '/financeiro/notas-fiscais',
    secao: '/financeiro',
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
    (item) => itemAtivo(item, pathname),
  )
  return match?.label ?? 'Gestão de Contratos'
}
