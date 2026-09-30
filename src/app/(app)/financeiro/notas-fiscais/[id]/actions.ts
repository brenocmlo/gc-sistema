'use server'

import { revalidatePath } from 'next/cache'

import { hojeISO } from '@/lib/execucao'
import { motivoParaNaoExcluir, validarMotivoCancelamento } from '@/lib/notas-fiscais'
import { mensagemDeErroNf } from '@/lib/notas-fiscais-form'
import { createClient } from '@/lib/supabase/server'
import type { NotaFiscalStatus } from '@/lib/types'

type Resultado = { ok: true } | { ok: false; error: string }

async function sessao() {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false as const, error: 'Não autenticado' }
  const { data: profile } = await supabase.from('profiles').select('perfil').eq('id', user.id).maybeSingle()
  if (!profile) return { ok: false as const, error: 'Perfil não configurado' }
  return { ok: true as const, supabase, perfil: profile.perfil }
}

function revalidar(id: string) {
  revalidatePath('/financeiro/notas-fiscais')
  revalidatePath(`/financeiro/notas-fiscais/${id}`)
}

/**
 * Cancelar a NF (9.4): irreversível. Motivo obrigatório e data de hoje. Só
 * admin e financeiro. Depois disso, o trigger trg_nf_cancelada_imutavel
 * (20260929100000) recusa qualquer alteração, e trg_pagamento_recusa_nf_cancelada
 * recusa pagamento novo.
 */
export async function cancelarNotaFiscal(id: string, motivo: string): Promise<Resultado> {
  const s = await sessao()
  if (!s.ok) return s
  if (s.perfil !== 'admin' && s.perfil !== 'financeiro') {
    return { ok: false, error: 'Sem permissão pra cancelar notas fiscais' }
  }
  const m = validarMotivoCancelamento(motivo)
  if (!m.ok) return m

  // `neq cancelada` no próprio update: dois cancelamentos ao mesmo tempo não
  // trocam o motivo do primeiro.
  const { data, error } = await s.supabase
    .from('notas_fiscais')
    .update({ status: 'cancelada', motivo_cancelamento: m.motivo, data_cancelamento: hojeISO() })
    .eq('id', id)
    .neq('status', 'cancelada')
    .select('id')
    .maybeSingle()
  if (error) return { ok: false, error: mensagemDeErroNf(error.message) }
  if (!data) return { ok: false, error: 'A nota fiscal já está cancelada, ou não existe' }

  revalidar(id)
  return { ok: true }
}

/** Excluir a NF (9.4): só admin, nunca a cancelada nem a que tem pagamento. */
export async function excluirNotaFiscal(id: string): Promise<Resultado> {
  const s = await sessao()
  if (!s.ok) return s

  const { data: nf } = await s.supabase.from('notas_fiscais').select('status, pagamentos(id)').eq('id', id).maybeSingle()
  if (!nf) return { ok: false, error: 'Nota fiscal não encontrada' }
  const bloqueio = motivoParaNaoExcluir(
    { status: nf.status as NotaFiscalStatus, qtdPagamentos: (nf.pagamentos ?? []).length },
    s.perfil,
  )
  if (bloqueio) return { ok: false, error: bloqueio }

  // A policy também exige admin; `neq cancelada` cobre o cancelamento no meio.
  const { data, error } = await s.supabase
    .from('notas_fiscais')
    .delete()
    .eq('id', id)
    .neq('status', 'cancelada')
    .select('id')
  if (error) return { ok: false, error: mensagemDeErroNf(error.message) }
  if ((data ?? []).length === 0) return { ok: false, error: 'A nota fiscal não pôde ser excluída' }

  revalidatePath('/financeiro/notas-fiscais')
  return { ok: true }
}
