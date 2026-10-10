import { NextResponse, type NextRequest } from 'next/server'

import { urlNoMesmoHost } from '@/lib/redirecionar'
import { createClient } from '@/lib/supabase/server'
import { tipoDeLinkValido } from '@/lib/usuarios'

/**
 * O link que o admin manda (13.1): troca o token do convite ou do link de
 * acesso pela sessão da pessoa e leva à tela de definir a senha. O token vale
 * uma vez; inválido ou vencido volta ao login com o recado.
 */
export async function GET(request: NextRequest) {
  const tokenHash = request.nextUrl.searchParams.get('token_hash')
  const tipo = request.nextUrl.searchParams.get('type')
  const para = (caminho: string) => urlNoMesmoHost(request.headers, request.url, caminho)

  if (!tokenHash || !tipoDeLinkValido(tipo)) return NextResponse.redirect(para('/login?erro=link'))

  const supabase = createClient()
  const { error } = await supabase.auth.verifyOtp({ type: tipo, token_hash: tokenHash })
  if (error) return NextResponse.redirect(para(`/login?erro=${/banned/i.test(error.message) ? 'inativo' : 'link'}`))
  return NextResponse.redirect(para(`/convite/senha?tipo=${tipo}`))
}
