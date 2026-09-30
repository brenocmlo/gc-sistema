'use server'

import { revalidatePath } from 'next/cache'

import { isNfEditavel, recebidoDaNf } from '@/lib/notas-fiscais'
import { mensagemDeErroNf, validarPayloadNf, type NotaFiscalPayload } from '@/lib/notas-fiscais-form'
import { createClient } from '@/lib/supabase/server'
import type { NotaFiscalStatus } from '@/lib/types'

export type UpdateNotaFiscalResult = { ok: true; id: string } | { ok: false; error: string }

const PERFIS_QUE_ESCREVEM = ['admin', 'financeiro']

/** Edição da NF (9.3), com o mesmo form da criação. NF cancelada não edita. */
export async function updateNotaFiscal(id: string, input: NotaFiscalPayload): Promise<UpdateNotaFiscalResult> {
  const supabase = createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Não autenticado' }

  const { data: profile } = await supabase.from('profiles').select('perfil').eq('id', user.id).maybeSingle()
  if (!profile) return { ok: false, error: 'Perfil não configurado' }
  if (!PERFIS_QUE_ESCREVEM.includes(profile.perfil)) {
    return { ok: false, error: 'Sem permissão pra editar notas fiscais' }
  }

  const valido = validarPayloadNf(input)
  if (!valido.ok) return { ok: false, error: valido.error }

  const { data: atual, error: readErr } = await supabase
    .from('notas_fiscais')
    .select('status, pagamentos(valor)')
    .eq('id', id)
    .maybeSingle()
  if (readErr) return { ok: false, error: readErr.message }
  if (!atual) return { ok: false, error: 'Nota fiscal não encontrada' }
  if (!isNfEditavel(atual.status as NotaFiscalStatus)) {
    return { ok: false, error: 'Nota fiscal cancelada não pode ser editada' }
  }
  // O trigger trg_nf_valor_atualiza_status recalcula o status quando o valor
  // muda; abaixo do recebido, a NF viraria "paga" com sobra.
  const recebido = recebidoDaNf(atual.pagamentos)
  if (input.valor_total < recebido) {
    return { ok: false, error: `O valor não pode ficar abaixo do já recebido (${recebido.toFixed(2).replace('.', ',')})` }
  }

  // `neq cancelada` no próprio update: se alguém cancelou entre a leitura e
  // aqui, nada é gravado.
  const { data, error } = await supabase
    .from('notas_fiscais')
    .update({
      obra_id: input.obra_id,
      numero: input.numero.trim(),
      serie: input.serie,
      chave_nfe: input.chave_nfe,
      contrato_id: input.contrato_id,
      proposta_id: input.proposta_id,
      tipo: input.tipo,
      data_emissao: input.data_emissao,
      data_vencimento: input.data_vencimento,
      valor_total: input.valor_total,
      observacao: input.observacao,
    })
    .eq('id', id)
    .neq('status', 'cancelada')
    .select('id')
    .maybeSingle()

  if (error) return { ok: false, error: mensagemDeErroNf(error.message) }
  if (!data) return { ok: false, error: 'Nota fiscal cancelada não pode ser editada' }

  revalidatePath('/financeiro/notas-fiscais')
  revalidatePath(`/financeiro/notas-fiscais/${id}`)
  return { ok: true, id }
}
