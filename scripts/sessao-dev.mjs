/**
 * Sessão de qualquer perfil de teste em gc-dev, **sem senha**.
 *
 * Antes, cada perfil da validação exigia um par
 * `VALIDACAO_EMAIL_<PERFIL>` / `VALIDACAO_SENHA_<PERFIL>` no `.env.local` — oito
 * linhas de credencial em texto claro para quatro contas, e cada perfil novo
 * pedia mais duas, mais um reset de senha.
 *
 * O service role (que o `.env.local` já precisa ter, e que não dá pra evitar)
 * gera um magiclink pelo Admin API; `verifyOtp` troca o token por sessão. Não
 * passa senha em nenhum momento, nada novo é guardado, e perfil novo é só
 * acrescentar o e-mail numa lista.
 *
 * Só `@teste.com` e só gc-dev: gerar sessão de conta real, mesmo em dev, é
 * fabricar acesso ao usuário de alguém.
 */
import { createClient } from '@supabase/supabase-js'

import { exigirGcDev } from './gc-dev-guard.mjs'

/** Os perfis de teste criados por `supabase/setup_inicial_dev.sql`. */
export const PERFIS_DE_TESTE = {
  comercial: 'comercial@teste.com',
  financeiro: 'financeiro@teste.com',
  medicao: 'medicao@teste.com',
  producao: 'producao@teste.com',
  visualizador: 'visualizador@teste.com',
}

/**
 * Devolve `{ session, user }` do perfil pedido. `perfil` pode ser uma chave de
 * PERFIS_DE_TESTE ou um e-mail `@teste.com` direto.
 */
export async function sessaoDePerfil(perfil) {
  // Uma sessão por perfil e por processo. A camada escrita pede a do mesmo
  // perfil dezenas de vezes, e cada pedido é um verifyOtp; no fechamento da
  // sprint 7 isso estourou o rate limit do Auth no meio da rodada. A sessão
  // vale 1 h e nenhum script faz signOut, então reaproveitar é seguro.
  if (!SESSOES.has(perfil)) {
    const pedido = gerarSessao(perfil)
    SESSOES.set(perfil, pedido)
    pedido.catch(() => SESSOES.delete(perfil))
  }
  return SESSOES.get(perfil)
}

const SESSOES = new Map()

async function gerarSessao(perfil) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY

  exigirGcDev(url, `gerar sessão de ${perfil}`)

  if (!service) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY ausente no .env.local')
  }

  const email = PERFIS_DE_TESTE[perfil] ?? perfil

  if (!email.endsWith('@teste.com')) {
    throw new Error(
      `sessaoDePerfil só gera sessão de @teste.com (pedido: ${email}). ` +
        'Conta real entra pela tela de login, com a senha de quem é dono dela.',
    )
  }

  const admin = createClient(url, service, { auth: { persistSession: false } })

  const { data, error } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email,
  })
  if (error) throw new Error(`generateLink de ${email}: ${error.message}`)

  const cliente = createClient(url, anon, { auth: { persistSession: false } })
  let sessao = null
  let erroSessao = null
  // Rate limit ainda pode vir de rodadas seguidas: espera e tenta de novo, com
  // um link novo a cada vez (o token do anterior pode ter sido consumido).
  for (let tentativa = 1; tentativa <= 5; tentativa++) {
    const link = tentativa === 1
      ? data
      : (await admin.auth.admin.generateLink({ type: 'magiclink', email })).data
    ;({ data: sessao, error: erroSessao } = await cliente.auth.verifyOtp({
      type: 'magiclink',
      token_hash: link.properties.hashed_token,
    }))
    if (!erroSessao || !/rate limit/i.test(erroSessao.message)) break
    await new Promise((r) => setTimeout(r, 30_000 * tentativa))
  }
  if (erroSessao) throw new Error(`verifyOtp de ${email}: ${erroSessao.message}`)

  return { session: sessao.session, user: sessao.user, email }
}
