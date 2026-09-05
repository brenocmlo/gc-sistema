/**
 * Redefine a senha de um usuário de teste em gc-dev, via service role.
 *
 *   node --env-file=.env.local scripts/resetar-senha-dev.mjs <email> <senha>
 *
 * Existe porque a validação multiperfil precisa entrar como um usuário que
 * não é admin, e os usuários @teste.com de gc-dev tinham senha desconhecida
 * (a do setup_inicial_dev.sql não confere mais).
 *
 * Duas travas, porque isto usa service role e mexe em credencial:
 *   1. só roda contra o project ref de gc-dev;
 *   2. só aceita e-mail @teste.com — nunca uma conta de pessoa real.
 */
import { createClient } from '@supabase/supabase-js'

import { exigirGcDev } from './gc-dev-guard.mjs'

const [email, senha] = process.argv.slice(2)
const URL_SUPABASE = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!email || !senha) {
  console.error('uso: node --env-file=.env.local scripts/resetar-senha-dev.mjs <email> <senha>')
  process.exit(1)
}
if (!URL_SUPABASE || !SERVICE_ROLE) {
  console.error('FALHA: precisa de NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY em .env.local.')
  process.exit(1)
}

exigirGcDev(URL_SUPABASE, 'redefinir senha')
if (!email.endsWith('@teste.com')) {
  console.error('FALHA: só e-mail @teste.com. Conta de pessoa real se troca pelo painel.')
  process.exit(1)
}

const admin = createClient(URL_SUPABASE, SERVICE_ROLE, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const { data: lista, error: erroLista } = await admin.auth.admin.listUsers({
  page: 1,
  perPage: 200,
})
if (erroLista) {
  console.error(`FALHA ao listar usuários: ${erroLista.message}`)
  process.exit(1)
}

const alvo = lista.users.find((u) => u.email === email)
if (!alvo) {
  console.error(`FALHA: ${email} não existe em gc-dev.`)
  process.exit(1)
}

const { error } = await admin.auth.admin.updateUserById(alvo.id, {
  password: senha,
  email_confirm: true,
})
if (error) {
  console.error(`FALHA ao redefinir: ${error.message}`)
  process.exit(1)
}

console.log(`Senha redefinida para ${email} (${alvo.id.slice(0, 8)}) em gc-dev.`)
