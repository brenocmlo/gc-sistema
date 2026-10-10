'use server'

import { revalidatePath } from 'next/cache'

import { mensagemDeErroBanco } from '@/lib/erro-banco'
import { createClient } from '@/lib/supabase/server'
import type { OrcamentoStatus } from '@/lib/types'

export type CreateOrcamentoInput = {
  numero: string | null
  data_solicitacao: string
  cliente_id: string
  descricao: string | null
  escopo_resumo: string | null
  valor_estimado: number
  prazo_estimado: string | null
  responsavel: string | null
  obra_id: string | null
  observacao: string | null
}

export type CreateOrcamentoResult =
  | { ok: true; id: string }
  | { ok: false; error: string }

export async function createOrcamento(
  input: CreateOrcamentoInput,
): Promise<CreateOrcamentoResult> {
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

  if (!profile) {
    return { ok: false, error: 'Perfil não configurado' }
  }

  if (profile.perfil !== 'admin' && profile.perfil !== 'comercial') {
    return { ok: false, error: 'Sem permissão pra criar orçamentos' }
  }

  const status: OrcamentoStatus = 'pendente'

  const { data, error } = await supabase
    .from('orcamentos')
    .insert({
      empresa_id: profile.empresa_id,
      created_by: user.id,
      status,
      ...input,
    })
    .select('id')
    .single()

  if (error) {
    return { ok: false, error: mensagemDeErroBanco(error) }
  }

  // Invalida a lista pra mostrar o novo orçamento quando a usuária voltar.
  revalidatePath('/orcamentos')

  return { ok: true, id: data.id }
}
