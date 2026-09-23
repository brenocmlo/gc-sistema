'use server'

import { revalidatePath } from 'next/cache'

import { isContratoEditavel, mensagemDeErroContrato } from '@/lib/contratos'
import { validarPayloadContrato, type ContratoPayload } from '@/lib/contratos-form'
import { somaItens } from '@/lib/itens'
import { createClient } from '@/lib/supabase/server'
import type { ContratoStatus } from '@/lib/types'

export type UpdateContratoResult =
  | { ok: true; id: string }
  | { ok: false; error: string }

/** Edição do contrato (bloco 6.4), com o mesmo form do avulso (6.3). */
export async function updateContrato(
  id: string,
  input: ContratoPayload,
): Promise<UpdateContratoResult> {
  const supabase = createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Não autenticado' }

  const { data: profile } = await supabase
    .from('profiles')
    .select('perfil')
    .eq('id', user.id)
    .maybeSingle()

  if (!profile) return { ok: false, error: 'Perfil não configurado' }

  // O guard do layout protege a rota; a action repete por conta própria.
  if (profile.perfil !== 'admin' && profile.perfil !== 'comercial') {
    return { ok: false, error: 'Sem permissão pra editar contratos' }
  }

  const valido = validarPayloadContrato(input)
  if (!valido.ok) return { ok: false, error: valido.error }

  // Ativo é o único status editável. A checagem é contra o banco, não contra o
  // que a tela mandou: entre abrir o form e salvar, alguém pode ter suspendido
  // o contrato.
  const { data: atual, error: readErr } = await supabase
    .from('contratos')
    .select('status, obra_id, proposta_origem_id')
    .eq('id', id)
    .maybeSingle()

  if (readErr) return { ok: false, error: readErr.message }
  if (!atual) return { ok: false, error: 'Contrato não encontrado' }

  if (!isContratoEditavel(atual.status as ContratoStatus)) {
    return { ok: false, error: 'Só contrato ativo pode ser editado' }
  }

  // FK contratos_proposta_fk: contrato gerado de proposta fica na obra dela.
  if (atual.proposta_origem_id && input.obra_id !== atual.obra_id) {
    return {
      ok: false,
      error: 'Contrato gerado de proposta fica na obra da proposta de origem.',
    }
  }

  const { data: itens } = await supabase
    .from('itens')
    .select('valor_total')
    .eq('contrato_id', id)

  let valorTotal = input.valor_total
  if (itens && itens.length > 0) {
    // Obra: a FK composta dos itens (contrato_id, empresa_id, obra_id) não tem
    // `on update cascade` — trocar a obra de contrato com itens estouraria.
    if (input.obra_id !== atual.obra_id) {
      return {
        ok: false,
        error:
          'Este contrato tem itens, que pertencem à obra atual. Para trocar a obra, remova os itens antes.',
      }
    }
    // Valor total é a soma dos itens (trigger trg_itens_recalcula_pai): o que
    // vale é o do banco, não o do corpo da requisição.
    valorTotal = somaItens(itens as { valor_total: number | null }[])
  }

  // Campos listados um a um, e não `...input`: status, proposta_origem_id,
  // anexos, histórico e empresa não se editam por aqui.
  const { error } = await supabase
    .from('contratos')
    .update({
      numero: input.numero.trim(),
      obra_id: input.obra_id,
      descricao: input.descricao,
      data_assinatura: input.data_assinatura,
      prazo_execucao: input.prazo_execucao,
      valor_total: valorTotal,
      desconto: input.desconto,
      pct_sinal: input.pct_sinal,
      pct_fd: input.pct_fd,
      pct_entrega_material: input.pct_entrega_material,
      pct_medicao_instalacao: input.pct_medicao_instalacao,
      condicoes_pagamento: input.condicoes_pagamento,
      observacao: input.observacao,
    })
    .eq('id', id)

  if (error) return { ok: false, error: mensagemDeErroContrato(error.message) }

  revalidatePath('/contratos')
  revalidatePath(`/contratos/${id}`)
  return { ok: true, id }
}
