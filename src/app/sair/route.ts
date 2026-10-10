import { NextResponse, type NextRequest } from 'next/server'

import { urlNoMesmoHost } from '@/lib/redirecionar'
import { createClient } from '@/lib/supabase/server'

/**
 * Encerra a sessão no servidor (onde dá para apagar os cookies) e volta ao
 * login. É para onde o layout manda quem foi desativado com a sessão aberta
 * (13.1): Server Component não apaga cookie.
 */
export async function GET(request: NextRequest) {
  // scope local: o usuário bloqueado não consegue encerrar a sessão no Auth, mas os cookies saem.
  await createClient().auth.signOut({ scope: 'local' })
  const erro = request.nextUrl.searchParams.get('erro')
  const recado = erro === 'inativo' || erro === 'link' ? `?erro=${erro}` : ''
  return NextResponse.redirect(urlNoMesmoHost(request.headers, request.url, `/login${recado}`))
}
