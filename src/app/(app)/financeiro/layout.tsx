import type { ReactNode } from 'react'

import { requirePerfil } from '@/lib/auth-guards'

import FinanceiroAbas from './abas'

export default async function FinanceiroLayout({
  children,
}: {
  children: ReactNode
}) {
  await requirePerfil(['admin', 'financeiro', 'visualizador'])
  return (
    <div className="space-y-4">
      <FinanceiroAbas />
      {children}
    </div>
  )
}
