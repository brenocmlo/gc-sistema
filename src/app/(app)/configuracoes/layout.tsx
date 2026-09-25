import type { ReactNode } from 'react'

import { requirePerfil } from '@/lib/auth-guards'

import ConfiguracoesAbas from './abas'

export default async function ConfiguracoesLayout({
  children,
}: {
  children: ReactNode
}) {
  await requirePerfil(['admin'])
  return (
    <div className="space-y-4">
      <ConfiguracoesAbas />
      {children}
    </div>
  )
}
