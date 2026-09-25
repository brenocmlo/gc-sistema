import type { ReactNode } from 'react'

import { requirePerfil } from '@/lib/auth-guards'

// Mesmos perfis de Propostas e Contratos: o que chega pelo bot vira um deles.
export default async function DocumentosLayout({ children }: { children: ReactNode }) {
  await requirePerfil(['admin', 'comercial', 'visualizador'])
  return <>{children}</>
}
