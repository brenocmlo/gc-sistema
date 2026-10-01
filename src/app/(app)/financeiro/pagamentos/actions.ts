'use server'

import { revalidatePath } from 'next/cache'

import { BUCKET_COMPROVANTE } from '@/lib/pagamento-comprovante'
import { motivoParaNaoEstornar } from '@/lib/pagamentos'
import { createClient } from '@/lib/supabase/server'

export type EstornarPagamentoResult = { ok: true } | { ok: false; error: string }

/**
 * Estorno (10.3, a partir da aba Pagamentos da NF; 10.4, da listagem): exclui
 * o pagamento. O trigger trg_pagamento_atualiza_* recalcula o status da NF ou
 * da parcela na mesma transação.
 */
export async function estornarPagamento(id: string): Promise<EstornarPagamentoResult> {
  const supabase = createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Não autenticado' }

  const { data: profile } = await supabase.from('profiles').select('perfil').eq('id', user.id).maybeSingle()
  if (!profile) return { ok: false, error: 'Perfil não configurado' }

  const { data: pagamento } = await supabase
    .from('pagamentos')
    .select('id, nota_id, anexo, nota:notas_fiscais(status)')
    .eq('id', id)
    .maybeSingle()
  if (!pagamento) return { ok: false, error: 'Pagamento não encontrado' }

  // A policy deixa o financeiro excluir; a regra da tela é só o admin, e a
  // action repete (a checagem do botão não protege um POST direto).
  const nota = pagamento.nota as { status: string } | null
  const bloqueio = motivoParaNaoEstornar(profile.perfil, nota?.status)
  if (bloqueio) return { ok: false, error: bloqueio }

  const { error, count } = await supabase.from('pagamentos').delete({ count: 'exact' }).eq('id', id)
  if (error) return { ok: false, error: error.message }
  if (count === 0) return { ok: false, error: 'Pagamento não encontrado' }
  // O comprovante sai junto (o estorno é do admin, que pode apagar no bucket).
  if (pagamento.anexo) await supabase.storage.from(BUCKET_COMPROVANTE).remove([pagamento.anexo])

  revalidatePath('/financeiro/pagamentos')
  if (pagamento.nota_id) {
    revalidatePath('/financeiro/notas-fiscais')
    revalidatePath(`/financeiro/notas-fiscais/${pagamento.nota_id}`)
  }
  return { ok: true }
}
