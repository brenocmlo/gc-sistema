'use server'

import { revalidatePath } from 'next/cache'

import { mensagemDeErroAcordo, validarPayloadAcordo, type AcordoPayload } from '@/lib/acordos-form'
import { createClient } from '@/lib/supabase/server'

export type CreateAcordoResult = { ok: true; id: string } | { ok: false; error: string }

/** As policies "Acordos/Parcelas: financeiro gerencia". */
const PERFIS_QUE_ESCREVEM = ['admin', 'financeiro']

export async function createAcordo(input: AcordoPayload): Promise<CreateAcordoResult> {
  const supabase = createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Não autenticado' }

  const { data: profile } = await supabase.from('profiles').select('perfil').eq('id', user.id).maybeSingle()
  if (!profile) return { ok: false, error: 'Perfil não configurado' }

  // O guard do layout protege a rota (e libera o visualizador); a action repete.
  if (!PERFIS_QUE_ESCREVEM.includes(profile.perfil)) {
    return { ok: false, error: 'Sem permissão pra criar acordos' }
  }

  // O zod do form roda no navegador; aqui a mesma regra, sobre o payload.
  const valido = validarPayloadAcordo(input)
  if (!valido.ok) return { ok: false, error: valido.error }

  // Acordo e parcelas numa transação só (RPC da migration 036, security
  // invoker: o RLS vale). Campos um a um: status, encerramento e conversão
  // não vêm do corpo — todo acordo nasce aberto.
  const { data, error } = await supabase.rpc('criar_acordo_com_parcelas', {
    p_obra_id: input.obra_id,
    p_descricao: input.descricao.trim(),
    p_parcelas: input.parcelas.map((p) => ({
      data_vencimento: p.data_vencimento,
      valor_previsto: p.valor_previsto,
      observacao: p.observacao,
    })),
    p_motivo: input.motivo ?? undefined,
    p_periodo_ref: input.periodo_ref ?? undefined,
    p_data_abertura: input.data_abertura,
    p_contrato_id: input.contrato_id ?? undefined,
    p_proposta_id: input.proposta_id ?? undefined,
    p_observacao: input.observacao ?? undefined,
  })

  if (error || !data) return { ok: false, error: mensagemDeErroAcordo(error?.message ?? 'Acordo não criado') }

  revalidatePath('/financeiro/acordos')
  return { ok: true, id: data }
}
