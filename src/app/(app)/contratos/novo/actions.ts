'use server'

import { revalidatePath } from 'next/cache'

import { mensagemDeErroContrato } from '@/lib/contratos'
import { validarPayloadContrato, type ContratoPayload } from '@/lib/contratos-form'
import { createClient } from '@/lib/supabase/server'
import type { ContratoStatus } from '@/lib/types'

export type CreateContratoResult =
  | { ok: true; id: string; numero: string }
  | { ok: false; error: string }

/**
 * Contrato avulso (bloco 6.3): o caminho manual, sem proposta de origem.
 * O contrato gerado de proposta passa por `gerarContratoDeProposta` (6.2).
 */
export async function createContrato(
  input: ContratoPayload,
): Promise<CreateContratoResult> {
  const supabase = createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Não autenticado' }

  const { data: profile } = await supabase
    .from('profiles')
    .select('empresa_id, perfil')
    .eq('id', user.id)
    .maybeSingle()

  if (!profile) return { ok: false, error: 'Perfil não configurado' }

  // O guard do layout protege a rota; a action repete por conta própria.
  if (profile.perfil !== 'admin' && profile.perfil !== 'comercial') {
    return { ok: false, error: 'Sem permissão pra criar contratos' }
  }

  // O zod do form roda no navegador; aqui a mesma regra, sobre o payload.
  const valido = validarPayloadContrato(input)
  if (!valido.ok) return { ok: false, error: valido.error }

  // Todo contrato nasce ativo — status muda pelo diálogo do detalhe (6.5).
  const status: ContratoStatus = 'ativo'

  // Campos listados um a um, e não `...input`: status, proposta_origem_id,
  // anexos e histórico não vêm do corpo da requisição.
  const { data, error } = await supabase
    .from('contratos')
    .insert({
      empresa_id: profile.empresa_id,
      created_by: user.id,
      status,
      proposta_origem_id: null,
      numero: input.numero.trim(),
      obra_id: input.obra_id,
      descricao: input.descricao,
      data_assinatura: input.data_assinatura,
      prazo_execucao: input.prazo_execucao,
      valor_total: input.valor_total,
      desconto: input.desconto,
      pct_sinal: input.pct_sinal,
      pct_fd: input.pct_fd,
      pct_entrega_material: input.pct_entrega_material,
      pct_medicao_instalacao: input.pct_medicao_instalacao,
      condicoes_pagamento: input.condicoes_pagamento,
      observacao: input.observacao,
    })
    .select('id, numero')
    .single()

  if (error) return { ok: false, error: mensagemDeErroContrato(error.message) }

  revalidatePath('/contratos')
  return { ok: true, id: data.id, numero: data.numero }
}
