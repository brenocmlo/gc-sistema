import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

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
  } = await supabase.auth.getUser()

  const { pathname } = request.nextUrl
  // Rota de máquina (Fase 6 da automação): autentica por x-ingestao-token dentro
  // do próprio handler, sem sessão. Sem esta exceção o n8n recebe 307 → /login.
  if (pathname.startsWith('/api/ingestao/')) return supabaseResponse

  const isLoginRoute = pathname === '/login' || pathname.startsWith('/login/')

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
