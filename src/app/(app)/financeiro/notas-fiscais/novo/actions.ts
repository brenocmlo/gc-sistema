'use server'

import { revalidatePath } from 'next/cache'

import { mensagemDeErroNf, validarPayloadNf, type NotaFiscalPayload } from '@/lib/notas-fiscais-form'
import { createClient } from '@/lib/supabase/server'

export type CreateNotaFiscalResult = { ok: true; id: string; numero: string } | { ok: false; error: string }

/** As policies "NFs: financeiro insere/atualiza". */
const PERFIS_QUE_ESCREVEM = ['admin', 'financeiro']

export async function createNotaFiscal(input: NotaFiscalPayload): Promise<CreateNotaFiscalResult> {
  const supabase = createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Não autenticado' }

  const { data: profile } = await supabase.from('profiles').select('empresa_id, perfil').eq('id', user.id).maybeSingle()
  if (!profile) return { ok: false, error: 'Perfil não configurado' }

  // O guard do layout protege a rota (e libera o visualizador); a action repete.
  if (!PERFIS_QUE_ESCREVEM.includes(profile.perfil)) {
    return { ok: false, error: 'Sem permissão pra criar notas fiscais' }
  }

  // O zod do form roda no navegador; aqui a mesma regra, sobre o payload.
  const valido = validarPayloadNf(input)
  if (!valido.ok) return { ok: false, error: valido.error }

  // Campos um a um: status, arquivos e cancelamento não vêm do corpo. Toda NF
  // nasce emitida; o status muda pelos pagamentos (trigger) ou pelo cancelamento (9.4).
  // A mesma obra do vínculo é garantida pelas FKs compostas nf_contrato_fk e nf_proposta_fk.
  const { data, error } = await supabase
    .from('notas_fiscais')
    .insert({
      empresa_id: profile.empresa_id,
      created_by: user.id,
      status: 'emitida',
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
    .select('id, numero')
    .single()

  if (error) return { ok: false, error: mensagemDeErroNf(error.message) }

  revalidatePath('/financeiro/notas-fiscais')
  return { ok: true, id: data.id, numero: data.numero }
}
