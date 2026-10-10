import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

import { urlNoMesmoHost } from '../redirecionar'

import type { Database } from './types'

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => {
            request.cookies.set(name, value)
          })
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) => {
            supabaseResponse.cookies.set(name, value, options)
          })
        },
      },
    },
  )

  // IMPORTANTE: não escrever lógica entre createServerClient e getUser().
  // Qualquer coisa entre os dois pode causar logout aleatório dos usuários.
  const {
    data: { user },
    error: erroDoUsuario,
  } = await supabase.auth.getUser()

  const { pathname } = request.nextUrl
  // Rota de máquina (Fase 6 da automação): autentica por x-ingestao-token dentro
  // do próprio handler, sem sessão. Sem esta exceção o n8n recebe 307 → /login.
  if (pathname.startsWith('/api/ingestao/')) return supabaseResponse

  const isLoginRoute = pathname === '/login' || pathname.startsWith('/login/')
  // /convite troca o token do link pela sessão e /sair encerra a sessão (13.1):
  // os dois atendem quem não tem (ou não tem mais) usuário válido.
  if (pathname === '/convite' || pathname === '/sair') return supabaseResponse

  // Usuário desativado com a sessão aberta: o Auth recusa (banned). Sai pelo
  // /sair, que limpa os cookies e leva ao login com o recado.
  if (!user && erroDoUsuario && /banned/i.test(erroDoUsuario.message)) {
    // No mesmo host do pedido: o /sair precisa receber os cookies para apagá-los.
    return copyCookies(supabaseResponse, NextResponse.redirect(urlNoMesmoHost(request.headers, request.url, '/sair?erro=inativo')))
  }

  if (!user && !isLoginRoute) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return copyCookies(supabaseResponse, NextResponse.redirect(url))
  }

  if (user && isLoginRoute) {
    const url = request.nextUrl.clone()
    url.pathname = '/'
    return copyCookies(supabaseResponse, NextResponse.redirect(url))
  }

  return supabaseResponse
}

// Ao criar uma nova response (ex: redirect), é preciso copiar os cookies
// que o supabase client setou em supabaseResponse, senão a sessão se perde.
function copyCookies(from: NextResponse, to: NextResponse) {
  from.cookies.getAll().forEach((cookie) => {
    to.cookies.set(cookie)
  })
  return to
}
