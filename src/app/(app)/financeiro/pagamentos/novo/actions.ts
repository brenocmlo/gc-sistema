'use server'

import { revalidatePath } from 'next/cache'

import { mensagemDeErroPagamento, validarPayloadPagamento, type PagamentoPayload } from '@/lib/pagamentos-form'
import { createClient } from '@/lib/supabase/server'

export type CreatePagamentoResult = { ok: true; id: string } | { ok: false; error: string }

/** A policy "Pagamentos: financeiro gerencia". */
const PERFIS_QUE_ESCREVEM = ['admin', 'financeiro']

export async function createPagamento(input: PagamentoPayload): Promise<CreatePagamentoResult> {
  const supabase = createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Não autenticado' }

  const { data: profile } = await supabase.from('profiles').select('empresa_id, perfil').eq('id', user.id).maybeSingle()
  if (!profile) return { ok: false, error: 'Perfil não configurado' }

  // O guard do layout protege a rota (e libera o visualizador); a action repete.
  if (!PERFIS_QUE_ESCREVEM.includes(profile.perfil)) {
    return { ok: false, error: 'Sem permissão pra registrar pagamentos' }
  }

  // O zod do form roda no navegador; aqui a mesma regra, sobre o payload.
  const valido = validarPayloadPagamento(input)
  if (!valido.ok) return { ok: false, error: valido.error }

  // A NF cancelada o banco recusa (pagamento_nf_cancelada, 9.4). A parcela não
  // tem trigger assim: a cancelada, ou de acordo que não está aberto, é
  // recusada aqui.
  if (input.origem === 'acordo' && input.parcela_acordo_id) {
    const { data: parcela } = await supabase
      .from('acordo_parcelas')
      .select('status, acordo:acordos_pagamento(status)')
      .eq('id', input.parcela_acordo_id)
      .maybeSingle()
    if (!parcela) return { ok: false, error: 'Parcela não encontrada' }
    if (parcela.status === 'cancelada') return { ok: false, error: 'Parcela cancelada não recebe pagamento' }
    const acordo = parcela.acordo as { status: string } | null
    if (acordo && acordo.status !== 'aberto') return { ok: false, error: 'O acordo desta parcela não está aberto' }
  }

  // Campos um a um: anexo e datas de controle não vêm do corpo. A mesma obra
  // da NF e da parcela é garantida pelas FKs compostas pagamentos_nota_fk e
  // pagamentos_parcela_fk; o status da NF ou da parcela, pelo trigger.
  const { data, error } = await supabase
    .from('pagamentos')
    .insert({
      empresa_id: profile.empresa_id,
      created_by: user.id,
      obra_id: input.obra_id,
      origem: input.origem,
      nota_id: input.nota_id,
      parcela_acordo_id: input.parcela_acordo_id,
      data_pagamento: input.data_pagamento,
      valor: input.valor,
      forma: input.forma,
      observacao: input.observacao?.trim() || null,
    })
    .select('id')
    .single()

  if (error) return { ok: false, error: mensagemDeErroPagamento(error.message) }

  revalidatePath('/financeiro/pagamentos')
  if (input.nota_id) {
    revalidatePath('/financeiro/notas-fiscais')
    revalidatePath(`/financeiro/notas-fiscais/${input.nota_id}`)
  }
  return { ok: true, id: data.id }
}
