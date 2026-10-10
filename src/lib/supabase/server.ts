import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

import { eventoDeErroDaRequisicao } from '@/lib/auditoria'

import type { Database } from './types'

export function createClient() {
  const cookieStore = cookies()

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options)
            })
          } catch {
            // Chamado a partir de um Server Component — pode ser ignorado
            // desde que o middleware esteja refrescando a sessão.
          }
        },
      },
      global: { fetch: fetchComAuditoria },
    },
  )
}

/**
 * Etapa B do 13.2: escrita que o banco recusou vira evento de erro em
 * `auditoria_eventos`. O trigger não vê esse caso (o rollback leva o log
 * junto), e lembrar de registrar em cada uma das Server Actions não escala.
 * Aqui toda escrita do servidor passa por um lugar só.
 *
 * O evento vai pela RPC `registrar_evento` com a MESMA sessão da escrita, então
 * empresa e autor saem dela. Falha ao registrar não muda a resposta original
 * (decisão 2 do 13.2: auditoria nunca derruba a operação).
 */
async function fetchComAuditoria(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const resposta = await fetch(input, init)
  if (resposta.ok) return resposta

  try {
    const metodo = init?.method ?? (input instanceof Request ? input.method : 'GET')
    const url = input instanceof Request ? input.url : String(input)
    if (metodo === 'GET' || metodo === 'HEAD') return resposta
    const evento = eventoDeErroDaRequisicao({
      metodo,
      url,
      status: resposta.status,
      corpo: await resposta.clone().text(),
    })
    if (!evento) return resposta

    const original = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined))
    const headers = new Headers({ 'Content-Type': 'application/json' })
    for (const nome of ['apikey', 'Authorization']) {
      const v = original.get(nome)
      if (v) headers.set(nome, v)
    }
    await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/registrar_evento`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        p_entidade: evento.entidade,
        p_acao: evento.acao,
        p_resultado: 'erro',
        p_mensagem: evento.mensagem,
        p_registro_id: evento.registroId,
        p_detalhe: evento.detalhe,
      }),
    })
  } catch {
    // Sem log, a operação segue com a resposta que teve.
  }
  return resposta
}
