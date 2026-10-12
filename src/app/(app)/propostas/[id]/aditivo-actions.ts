'use server'

import { revalidatePath } from 'next/cache'

import { createClient } from '@/lib/supabase/server'

export type AditivoResult = { ok: true } | { ok: false; error: string }

/**
 * Opção 1.a (Breno, 10/10): marca a proposta como aditivo de um contrato da
 * mesma obra, ou desfaz (contratoId vazio). O bot faz isso sozinho quando o
 * PDF se declara aditivo; aqui é a correção à mão. Admin e comercial, como a
 * edição da proposta — a action repete a regra do layout.
 */
export async function definirContratoAditivo(propostaId: string, contratoId: string): Promise<AditivoResult> {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Não autenticado' }
  const { data: profile } = await supabase.from('profiles').select('empresa_id, perfil').eq('id', user.id).maybeSingle()
  if (!profile) return { ok: false, error: 'Perfil não configurado' }
  if (profile.perfil !== 'admin' && profile.perfil !== 'comercial') {
    return { ok: false, error: 'Sem permissão para alterar a proposta' }
  }

  const { data: proposta } = await supabase
    .from('propostas')
    .select('id, obra_id, contrato_aditivo_id')
    .eq('id', propostaId)
    .eq('empresa_id', profile.empresa_id)
    .maybeSingle()
  if (!proposta) return { ok: false, error: 'Proposta não encontrada' }

  let alvo: string | null = null
  if (contratoId) {
    // Mesma obra e mesma empresa: é o que a FK composta exige no banco.
    const { data: ct } = await supabase
      .from('contratos')
      .select('id, proposta_origem_id')
      .eq('id', contratoId)
      .eq('empresa_id', profile.empresa_id)
      .eq('obra_id', proposta.obra_id)
      .maybeSingle()
    if (!ct) return { ok: false, error: 'Contrato não encontrado nesta obra' }
    if (ct.proposta_origem_id === propostaId) {
      return { ok: false, error: 'Esta proposta é a origem do contrato; ela não pode ser aditivo dele' }
    }
    alvo = ct.id
  }
  if (alvo === proposta.contrato_aditivo_id) return { ok: true }

  const { error } = await supabase.from('propostas').update({ contrato_aditivo_id: alvo }).eq('id', propostaId)
  if (error) return { ok: false, error: error.message }

  revalidatePath(`/propostas/${propostaId}`)
  if (alvo) revalidatePath(`/contratos/${alvo}`)
  if (proposta.contrato_aditivo_id) revalidatePath(`/contratos/${proposta.contrato_aditivo_id}`)
  return { ok: true }
}
