import { createClient } from '@supabase/supabase-js'

import type { Database } from './types'

/**
 * Cliente com a service role, para a API de administração do Auth (criar o
 * usuário do convite, gerar link de acesso, bloquear quem foi desativado).
 * Só em código de servidor (Server Action, Route Handler): a chave ignora o
 * RLS. Os dados de negócio continuam pelo cliente do usuário, sob RLS.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (typeof window !== 'undefined') throw new Error('createAdminClient só roda no servidor')
  if (!url || !serviceRole) throw new Error('SUPABASE_SERVICE_ROLE_KEY ausente: a gestão de usuários não está configurada neste ambiente')
  return createClient<Database>(url, serviceRole, { auth: { persistSession: false, autoRefreshToken: false } })
}
