import type { ReactNode } from 'react'

import { requirePerfil } from '@/lib/auth-guards'

// Só admin, como /configuracoes. A RLS de auditoria_eventos também só deixa
// admin ler: o guard é a porta, a policy é a parede.
export default async function LogsLayout({
  children,
}: {
  children: ReactNode
}) {
  await requirePerfil(['admin'])
  return <>{children}</>
}
