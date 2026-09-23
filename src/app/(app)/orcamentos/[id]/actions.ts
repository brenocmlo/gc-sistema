'use server'

import { revalidatePath } from 'next/cache'

import { autorizarExclusaoDeAnexo, removeuDoStorage, STATUS_MUDOU_NO_MEIO } from '@/lib/anexos'
import { buildStoragePath, validateFile, fileErrorMessage } from '@/lib/files'
import {
  appendHistorico,
  novaEntradaHistoricoOrcamento,
} from '@/lib/historico'
import { createClient } from '@/lib/supabase/server'
import type {
  Anexo,
  MotivoRejeicaoOrcamento,
  OrcamentoStatus,
  OrcamentoUpdate,
} from '@/lib/types'

// ============================================================
// Delete
// ============================================================

export type DeleteOrcamentoResult =
  | { ok: true }
  | { ok: false; error: string }

export async function deleteOrcamento(
  id: string,
): Promise<DeleteOrcamentoResult> {
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

  // DELETE é só admin (regra de negócio geral do projeto).
  if (profile.perfil !== 'admin') {
    return { ok: false, error: 'Apenas admin pode excluir orçamentos' }
  }

  const { error } = await supabase.from('orcamentos').delete().eq('id', id)
  if (error) return { ok: false, error: error.message }

  revalidatePath('/orcamentos')
  return { ok: true }
}

// ============================================================
// Change status
// ============================================================

export type ChangeStatusInput = {
  novo_status: OrcamentoStatus
  data_envio: string | null
  data_decisao: string | null
  motivo_rejeicao: MotivoRejeicaoOrcamento | null
  detalhe_rejeicao: string | null
  /**
   * Quando novo_status = 'aprovado' e o user marcou "Vincular a obra",
   * vem o uuid da obra; null = não mexe / desvincula.
   */
  obra_id_vinculada: string | null
  /** Se o user marcou "Vincular a obra" mas sem selecionar, tratamos no validator. */
  vincular_obra: boolean
}

export type ChangeStatusResult =
  | { ok: true }
  | { ok: false; error: string }

export async function changeOrcamentoStatus(
  id: string,
  input: ChangeStatusInput,
): Promise<ChangeStatusResult> {
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
    return { ok: false, error: 'Sem permissão pra mudar status' }
  }

  // Estado atual, pra registrar de-onde-pra-onde no histórico. Lido do banco e
  // não da tela: entre abrir o detalhe e salvar, alguém pode ter mudado.
  const { data: atual, error: readErr } = await supabase
    .from('orcamentos')
    .select('status, historico')
    .eq('id', id)
    .maybeSingle()

  if (readErr) return { ok: false, error: readErr.message }
  if (!atual) return { ok: false, error: 'Orçamento não encontrado' }

  const statusAtual = atual.status as OrcamentoStatus

  // Monta o update baseado no status escolhido. Campos não aplicáveis ao
  // novo status são limpos pra não ficar lixo (ex: motivo_rejeicao se voltar
  // pra pendente).
  const update: OrcamentoUpdate = { status: input.novo_status }

  if (input.novo_status === 'enviado' && input.data_envio) {
    update.data_envio = input.data_envio
  }

  if (input.novo_status === 'aprovado' || input.novo_status === 'rejeitado') {
    if (input.data_decisao) update.data_decisao = input.data_decisao
  }

  if (input.novo_status === 'rejeitado') {
    update.motivo_rejeicao = input.motivo_rejeicao
    update.detalhe_rejeicao = input.detalhe_rejeicao
  } else {
    update.motivo_rejeicao = null
    update.detalhe_rejeicao = null
  }

  if (input.novo_status === 'aprovado' && input.vincular_obra) {
    update.obra_id = input.obra_id_vinculada
  }

  // Histórico append-only, no mesmo update do status: sem janela em que o
  // status mudou e o registro não. Mesmo formato de propostas.
  if (statusAtual !== input.novo_status) {
    const entrada = novaEntradaHistoricoOrcamento({
      de: statusAtual,
      para: input.novo_status,
      por: user.id,
      motivo_rejeicao: input.motivo_rejeicao,
      detalhe_rejeicao: input.detalhe_rejeicao,
    })

    update.historico = appendHistorico(
      atual.historico,
      entrada,
    ) as unknown as OrcamentoUpdate['historico']
  }

  // Lock otimista pelo status: o update só vale se o status ainda é o lido.
  // Sem isso, duas mudanças simultâneas liam o mesmo histórico e a segunda
  // gravação apagava a entrada da primeira.
  const { data: gravado, error } = await supabase
    .from('orcamentos')
    .update(update)
    .eq('id', id)
    .eq('status', statusAtual)
    .select('id')

  if (error) return { ok: false, error: error.message }
  if (!gravado || gravado.length === 0) return { ok: false, error: STATUS_MUDOU_NO_MEIO }

  revalidatePath('/orcamentos')
  revalidatePath(`/orcamentos/${id}`)
  return { ok: true }
}

// ============================================================
// Anexos (Storage + jsonb)
// ============================================================

const BUCKET = 'anexos'

// As actions levam o sufixo "Orcamento" porque a camada escrita do plano acha
// a action pelo nome no build, e `uploadAnexo`/`deleteAnexo` já são os da
// proposta — com o mesmo nome, o orçamento não tinha como ser testado.

export type UploadAnexoResult =
  | { ok: true }
  | { ok: false; error: string }

export async function uploadAnexoOrcamento(
  orcamentoId: string,
  formData: FormData,
): Promise<UploadAnexoResult> {
  const file = formData.get('file')
  if (!(file instanceof File)) {
    return { ok: false, error: 'Arquivo ausente no upload' }
  }

  const validation = validateFile(file)
  if (validation) return { ok: false, error: fileErrorMessage(validation) }

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

  if (!profile) return { ok: false, error: 'Perfil não configurado' }

  if (profile.perfil !== 'admin' && profile.perfil !== 'comercial') {
    return { ok: false, error: 'Sem permissão pra anexar arquivos' }
  }

  // Lê o orçamento atual pra pegar a lista de anexos existentes (e confirmar
  // que existe — a RLS já restringe por empresa).
  const { data: current, error: readErr } = await supabase
    .from('orcamentos')
    .select('anexos')
    .eq('id', orcamentoId)
    .maybeSingle()

  if (readErr) return { ok: false, error: readErr.message }
  if (!current) return { ok: false, error: 'Orçamento não encontrado' }

  // Path no padrão esperado pelo RLS do Storage: {empresa}/orcamentos/{id}/{ts}_{nome}
  const path = buildStoragePath(
    profile.empresa_id,
    'orcamentos',
    orcamentoId,
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
    uploaded_by: user.id,
  }

  const existentes = (current.anexos as Anexo[] | null) ?? []
  const atualizados = [...existentes, novo]

  const { error: updateErr } = await supabase
    .from('orcamentos')
    .update({ anexos: atualizados as unknown as OrcamentoUpdate['anexos'] })
    .eq('id', orcamentoId)

  if (updateErr) {
    // Rollback: tenta remover o arquivo que acabou de subir pra não ficar
    // órfão no Storage. Best-effort, não reportamos falha do rollback.
    await supabase.storage.from(BUCKET).remove([path])
    return { ok: false, error: updateErr.message }
  }

  revalidatePath(`/orcamentos/${orcamentoId}`)
  return { ok: true }
}

export type AnexoUrlResult =
  | { ok: true; url: string }
  | { ok: false; error: string }

/** Gera URL temporária pra visualizar/baixar o anexo (1h de expiração). */
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

export type DeleteAnexoResult =
  | { ok: true }
  | { ok: false; error: string }

export async function deleteAnexoOrcamento(
  orcamentoId: string,
  path: string,
): Promise<DeleteAnexoResult> {
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
    return { ok: false, error: 'Sem permissão pra excluir anexos' }
  }

  const { data: current, error: readErr } = await supabase
    .from('orcamentos')
    .select('anexos')
    .eq('id', orcamentoId)
    .maybeSingle()

  if (readErr) return { ok: false, error: readErr.message }
  if (!current) return { ok: false, error: 'Orçamento não encontrado' }

  // O path vem do corpo da requisição: só apaga o que é anexo deste
  // orçamento, e só se quem pede for admin ou quem subiu (a policy do Storage).
  const permitido = autorizarExclusaoDeAnexo(current.anexos, path, {
    perfil: profile.perfil,
    userId: user.id,
  })
  if (!permitido.ok) return { ok: false, error: permitido.error }
  const atualizados = permitido.restantes

  // Remove do Storage primeiro. Se falhar, abortamos sem mexer no jsonb.
  // Recusa da policy não vem como erro, vem como lista vazia.
  const { data: removidos, error: rmErr } = await supabase.storage.from(BUCKET).remove([path])
  if (rmErr) return { ok: false, error: rmErr.message }
  if (!removeuDoStorage(removidos)) {
    return { ok: false, error: 'O armazenamento não removeu o arquivo; o anexo foi mantido' }
  }

  const { error: updateErr } = await supabase
    .from('orcamentos')
    .update({ anexos: atualizados as unknown as OrcamentoUpdate['anexos'] })
    .eq('id', orcamentoId)

  if (updateErr) return { ok: false, error: updateErr.message }

  revalidatePath(`/orcamentos/${orcamentoId}`)
  return { ok: true }
}
