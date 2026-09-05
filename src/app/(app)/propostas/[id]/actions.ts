'use server'

import { revalidatePath } from 'next/cache'

import { buildStoragePath, fileErrorMessage, validateFile } from '@/lib/files'
import {
  appendHistorico,
  canChangePropostaStatus,
  mensagemDeErroProposta,
  novaEntradaHistorico,
  requiresDataDecisao,
  requiresDataEnvio,
  validarMotivoRejeicao,
} from '@/lib/propostas'
import { createClient } from '@/lib/supabase/server'
import type {
  Anexo,
  MotivoRejeicao,
  PropostaStatus,
  PropostaUpdate,
} from '@/lib/types'

type Autorizacao =
  | { ok: true; userId: string; empresaId: string; perfil: string }
  | { ok: false; error: string }

/**
 * Guard das actions. O layout de /propostas libera visualizador, e guard de
 * layout protege rota, não ação — então toda escrita repete a checagem.
 */
async function autorizarEscrita(
  supabase: ReturnType<typeof createClient>,
  perfisPermitidos: readonly string[],
  acao: string,
): Promise<Autorizacao> {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Não autenticado' }

  const { data: profile } = await supabase
    .from('profiles')
    .select('empresa_id, perfil')
    .eq('id', user.id)
    .maybeSingle()

  if (!profile) return { ok: false, error: 'Perfil não configurado' }

  if (!perfisPermitidos.includes(profile.perfil)) {
    return { ok: false, error: `Sem permissão pra ${acao}` }
  }

  return {
    ok: true,
    userId: user.id,
    empresaId: profile.empresa_id,
    perfil: profile.perfil,
  }
}

// ============================================================
// Delete
// ============================================================

export type DeletePropostaResult = { ok: true } | { ok: false; error: string }

export async function deleteProposta(
  id: string,
): Promise<DeletePropostaResult> {
  const supabase = createClient()

  const auth = await autorizarEscrita(supabase, ['admin'], 'excluir propostas')
  if (!auth.ok) return { ok: false, error: auth.error }

  const { error } = await supabase.from('propostas').delete().eq('id', id)
  if (error) return { ok: false, error: mensagemDeErroProposta(error.message) }

  revalidatePath('/propostas')
  return { ok: true }
}

// ============================================================
// Mudança de status
// ============================================================

export type ChangeStatusInput = {
  novo_status: PropostaStatus
  data_envio: string | null
  data_decisao: string | null
  motivo_rejeicao: MotivoRejeicao | null
  detalhe_rejeicao: string | null
}

export type ChangeStatusResult = { ok: true } | { ok: false; error: string }

export async function changePropostaStatus(
  id: string,
  input: ChangeStatusInput,
): Promise<ChangeStatusResult> {
  const supabase = createClient()

  const auth = await autorizarEscrita(
    supabase,
    ['admin', 'comercial'],
    'mudar status',
  )
  if (!auth.ok) return { ok: false, error: auth.error }

  // O fluxo de status é regra de aplicação (o CHECK do banco valida só a lista
  // de valores), então a transição é conferida contra o status atual do banco,
  // não contra o que a tela mandou.
  const { data: atual, error: readErr } = await supabase
    .from('propostas')
    .select('status, historico')
    .eq('id', id)
    .maybeSingle()

  if (readErr) return { ok: false, error: readErr.message }
  if (!atual) return { ok: false, error: 'Proposta não encontrada' }

  const statusAtual = atual.status as PropostaStatus

  if (!canChangePropostaStatus(statusAtual, input.novo_status)) {
    return {
      ok: false,
      error: `Transição de ${statusAtual} para ${input.novo_status} não é permitida`,
    }
  }

  if (requiresDataEnvio(input.novo_status) && !input.data_envio) {
    return { ok: false, error: 'Data de envio é obrigatória' }
  }

  if (requiresDataDecisao(input.novo_status) && !input.data_decisao) {
    return { ok: false, error: 'Data da decisão é obrigatória' }
  }

  const motivo = validarMotivoRejeicao(input.novo_status, input.motivo_rejeicao)
  if (!motivo.ok) return { ok: false, error: motivo.error }

  const update: PropostaUpdate = { status: input.novo_status }

  if (requiresDataEnvio(input.novo_status) && input.data_envio) {
    update.data_envio = input.data_envio
  }

  if (requiresDataDecisao(input.novo_status) && input.data_decisao) {
    update.data_decisao = input.data_decisao
  }

  // O CHECK propostas_rejeitada_motivo proíbe motivo fora de 'rejeitada':
  // voltar pra rascunho sem limpar quebraria o insert do banco.
  if (input.novo_status === 'rejeitada') {
    update.motivo_rejeicao = input.motivo_rejeicao
    update.detalhe_rejeicao = input.detalhe_rejeicao
  } else {
    update.motivo_rejeicao = null
    update.detalhe_rejeicao = null
  }

  // Histórico append-only: uma entrada por transição, no jsonb criado pela
  // migration 20260905180000. Vai no mesmo update do status pra não existir
  // janela em que o status mudou e o registro não.
  if (statusAtual !== input.novo_status) {
    const entrada = novaEntradaHistorico({
      de: statusAtual,
      para: input.novo_status,
      por: auth.userId,
      motivo_rejeicao: input.motivo_rejeicao,
      detalhe_rejeicao: input.detalhe_rejeicao,
    })

    update.historico = appendHistorico(
      atual.historico,
      entrada,
    ) as unknown as PropostaUpdate['historico']
  }

  const { error } = await supabase.from('propostas').update(update).eq('id', id)
  if (error) return { ok: false, error: mensagemDeErroProposta(error.message) }

  revalidatePath('/propostas')
  revalidatePath(`/propostas/${id}`)
  return { ok: true }
}

// ============================================================
// Anexos (Storage + coluna jsonb)
// ============================================================

const BUCKET = 'anexos'

export type UploadAnexoResult = { ok: true } | { ok: false; error: string }

export async function uploadAnexo(
  propostaId: string,
  formData: FormData,
): Promise<UploadAnexoResult> {
  const file = formData.get('file')
  if (!(file instanceof File)) {
    return { ok: false, error: 'Arquivo ausente no upload' }
  }

  const validation = validateFile(file)
  if (validation) return { ok: false, error: fileErrorMessage(validation) }

  const supabase = createClient()

  const auth = await autorizarEscrita(
    supabase,
    ['admin', 'comercial'],
    'anexar arquivos',
  )
  if (!auth.ok) return { ok: false, error: auth.error }

  const { data: current, error: readErr } = await supabase
    .from('propostas')
    .select('anexos')
    .eq('id', propostaId)
    .maybeSingle()

  if (readErr) return { ok: false, error: readErr.message }
  if (!current) return { ok: false, error: 'Proposta não encontrada' }

  // Path no padrão que a RLS do Storage exige: {empresa}/propostas/{id}/{ts}_{nome}
  const path = buildStoragePath(
    auth.empresaId,
    'propostas',
    propostaId,
    file.name,
  )

  const { error: uploadErr } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, {
      contentType: file.type || 'application/octet-stream',
      upsert: false,
    })

  if (uploadErr) return { ok: false, error: uploadErr.message }

  const novo: Anexo = {
    nome: file.name,
    path,
    tipo: file.type || 'application/octet-stream',
    tamanho: file.size,
    uploaded_at: new Date().toISOString(),
    uploaded_by: auth.userId,
  }

  const existentes = (current.anexos as Anexo[] | null) ?? []

  const { error: updateErr } = await supabase
    .from('propostas')
    .update({
      anexos: [...existentes, novo] as unknown as PropostaUpdate['anexos'],
    })
    .eq('id', propostaId)

  if (updateErr) {
    // Rollback best-effort: sem isso o arquivo fica órfão no Storage.
    await supabase.storage.from(BUCKET).remove([path])
    return { ok: false, error: updateErr.message }
  }

  revalidatePath(`/propostas/${propostaId}`)
  return { ok: true }
}

export type AnexoUrlResult =
  | { ok: true; url: string }
  | { ok: false; error: string }

/** URL temporária pra visualizar/baixar o anexo (1h). */
export async function getAnexoUrl(path: string): Promise<AnexoUrlResult> {
  const supabase = createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Não autenticado' }

  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(path, 60 * 60)

  if (error) return { ok: false, error: error.message }
  return { ok: true, url: data.signedUrl }
}

export type DeleteAnexoResult = { ok: true } | { ok: false; error: string }

export async function deleteAnexo(
  propostaId: string,
  path: string,
): Promise<DeleteAnexoResult> {
  const supabase = createClient()

  const auth = await autorizarEscrita(
    supabase,
    ['admin', 'comercial'],
    'excluir anexos',
  )
  if (!auth.ok) return { ok: false, error: auth.error }

  const { data: current, error: readErr } = await supabase
    .from('propostas')
    .select('anexos')
    .eq('id', propostaId)
    .maybeSingle()

  if (readErr) return { ok: false, error: readErr.message }
  if (!current) return { ok: false, error: 'Proposta não encontrada' }

  const existentes = (current.anexos as Anexo[] | null) ?? []
  const atualizados = existentes.filter((a) => a.path !== path)

  // Storage primeiro: se falhar, o jsonb continua consistente com o bucket.
  const { error: rmErr } = await supabase.storage.from(BUCKET).remove([path])
  if (rmErr) return { ok: false, error: rmErr.message }

  const { error: updateErr } = await supabase
    .from('propostas')
    .update({
      anexos: atualizados as unknown as PropostaUpdate['anexos'],
    })
    .eq('id', propostaId)

  if (updateErr) return { ok: false, error: updateErr.message }

  revalidatePath(`/propostas/${propostaId}`)
  return { ok: true }
}
