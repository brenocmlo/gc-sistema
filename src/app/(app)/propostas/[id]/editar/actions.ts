'use server'

import { revalidatePath } from 'next/cache'

import { somaItens } from '@/lib/itens'
import { isEditavel, mensagemDeErroProposta } from '@/lib/propostas'
import { createClient } from '@/lib/supabase/server'
import type { PropostaStatus } from '@/lib/types'

import type { PropostaPayload } from '../../proposta-form-helpers'

export type UpdatePropostaResult =
  | { ok: true; id: string }
  | { ok: false; error: string }

export async function updateProposta(
  id: string,
  input: PropostaPayload,
): Promise<UpdatePropostaResult> {
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

  if (profile.perfil !== 'admin' && profile.perfil !== 'comercial') {
    return { ok: false, error: 'Sem permissão pra editar propostas' }
  }

  // Rascunho é o único status editável. A checagem é contra o banco, não
  // contra o que a tela mandou: entre abrir o form e salvar, alguém pode ter
  // enviado a proposta.
  const { data: atual, error: readErr } = await supabase
    .from('propostas')
    .select('status, obra_id')
    .eq('id', id)
    .maybeSingle()

  if (readErr) return { ok: false, error: readErr.message }
  if (!atual) return { ok: false, error: 'Proposta não encontrada' }

  if (!isEditavel(atual.status as PropostaStatus)) {
    return {
      ok: false,
      error:
        'Só proposta em rascunho pode ser editada. Volte o status pra rascunho antes.',
    }
  }

  // status, empresa_id, created_by e as datas de envio/decisão ficam fora:
  // quem muda isso é o diálogo de status.
  // Bloco 5.6 — com itens, dois campos deixam de ser do formulário.
  const { data: itens } = await supabase
    .from('itens')
    .select('valor_total')
    .eq('proposta_id', id)

  const payload = { ...input }
  if (itens && itens.length > 0) {
    // Obra: `itens` tem FK composta (proposta_id, empresa_id, obra_id) sem
    // `on update cascade`. Trocar a obra de uma proposta com itens estouraria a
    // FK com erro cru — e, se não estourasse, os itens ficariam na obra velha.
    if (payload.obra_id !== atual.obra_id) {
      return {
        ok: false,
        error:
          'Esta proposta tem itens, que pertencem à obra atual. Para trocar a obra, remova os itens antes.',
      }
    }
    // Valor total: é a soma dos itens (trigger trg_itens_recalcula_pai). O
    // formulário mostra o campo travado, mas o POST é de quem mandou — o valor
    // que vale é o do banco, não o do corpo da requisição.
    payload.valor_total = somaItens(itens as { valor_total: number | null }[])
  }

  const { error } = await supabase.from('propostas').update(payload).eq('id', id)

  if (error) return { ok: false, error: mensagemDeErroProposta(error.message) }

  revalidatePath('/propostas')
  revalidatePath(`/propostas/${id}`)

  return { ok: true, id }
}
