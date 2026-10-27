'use server'

import { createAdminClient } from '@/lib/supabase/admin'
import { deveRegistrarPedido, esqueciSchema, MENSAGEM_PEDIDO_ENVIADO } from '@/lib/usuarios'

type Resultado = { ok: true; mensagem: string } | { ok: false; error: string }

/**
 * "Esqueci minha senha" (19/10): registra o pedido para o administrador, que
 * manda o link de acesso pela tela de Usuários. Quem pede não tem sessão, por
 * isso a chave de serviço.
 *
 * A resposta é sempre a mesma quando o e-mail é válido: com conta, sem conta,
 * inativo ou pedido repetido. Assim a tela não serve para descobrir quem tem
 * acesso. Só o e-mail mal digitado volta como erro.
 */
export async function pedirNovoAcesso(input: unknown): Promise<Resultado> {
  const parsed = esqueciSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'E-mail inválido' }

  const enviado = { ok: true as const, mensagem: MENSAGEM_PEDIDO_ENVIADO }
  try {
    const admin = createAdminClient()
    const { data: perfil } = await admin
      .from('profiles')
      .select('id, empresa_id, ativo')
      .eq('email', parsed.data.email)
      .maybeSingle()
    if (!perfil || perfil.ativo === false) return enviado

    const { data: ultimo } = await admin
      .from('pedidos_acesso')
      .select('pedido_em')
      .eq('profile_id', perfil.id)
      .order('pedido_em', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (!deveRegistrarPedido(ultimo?.pedido_em ?? null)) return enviado

    await admin.from('pedidos_acesso').insert({ empresa_id: perfil.empresa_id, profile_id: perfil.id })
  } catch {
    // Sem a chave de serviço ou o banco fora: para quem pede, a resposta não muda.
  }
  return enviado
}
