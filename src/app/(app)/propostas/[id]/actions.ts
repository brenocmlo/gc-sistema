'use server'

import { revalidatePath } from 'next/cache'

import { autorizarExclusaoDeAnexo, removeuDoStorage, STATUS_MUDOU_NO_MEIO } from '@/lib/anexos'
import { buildStoragePath, fileErrorMessage, validateFile } from '@/lib/files'
import { BUCKET_FOTOS, pathEhDoItem } from '@/lib/fotos'
import {
  appendHistorico,
  canChangePropostaStatus,
  mensagemDeErroProposta,
  novaEntradaHistoricoProposta,
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

  // Itens primeiro, e de propósito.
  //
  // A FK é `itens_proposta_fk ... on delete set null (proposta_id)`: apagar a
  // proposta NÃO apaga os itens, só desliga o vínculo. Eles ficariam em
  // `itens` como itens "soltos" — estado que o DDL admite, mas que NENHUMA
  // tela do sistema mostra. Ou seja: somem da interface e continuam no banco,
  // contando em qualquer soma futura que varra a tabela.
  //
  // Cascata aqui, na aplicação, em vez de trocar a FK: a semântica de "solto"
  // pode ser proposital para o caminho de contrato (a automação repontua item
  // de proposta para contrato), e mexer no schema mudaria isso também. O que
  // a pessoa espera ao excluir uma proposta é que os itens dela vão junto, e
  // o diálogo avisa quantos são.
  // As fotos dos itens (bloco 5.5) saem do Storage depois do delete, pela
  // mesma razão do deleteItem: nunca deixar item apontando para arquivo que
  // não existe. Lidas antes, porque depois do delete não há de onde ler.
  const { data: comFoto } = await supabase
    .from('itens')
    .select('id, foto_url')
    .eq('proposta_id', id)
    .not('foto_url', 'is', null)

  const { error: erroItens } = await supabase
    .from('itens')
    .delete()
    .eq('proposta_id', id)
  if (erroItens) {
    return { ok: false, error: mensagemDeErroProposta(erroItens.message) }
  }

  const { error } = await supabase.from('propostas').delete().eq('id', id)
  if (error) return { ok: false, error: mensagemDeErroProposta(error.message) }

  const paths = (comFoto ?? [])
    .filter((i) => pathEhDoItem(i.foto_url, auth.empresaId, i.id))
    .map((i) => i.foto_url as string)
  if (paths.length > 0) await supabase.storage.from(BUCKET_FOTOS).remove(paths)

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
    const entrada = novaEntradaHistoricoProposta({
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

  // Lock otimista pelo status: o update só vale se o status ainda é o lido.
  // Sem isso, duas mudanças simultâneas liam o mesmo histórico e a segunda
  // gravação apagava a entrada da primeira.
  const { data: gravado, error } = await supabase
    .from('propostas')
    .update(update)
    .eq('id', id)
    .eq('status', statusAtual)
    .select('id')
  if (error) return { ok: false, error: mensagemDeErroProposta(error.message) }
  if (!gravado || gravado.length === 0) return { ok: false, error: STATUS_MUDOU_NO_MEIO }

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

  // O path vem do corpo da requisição: só apaga o que é anexo desta proposta,
  // e só se quem pede for admin ou quem subiu (a policy do Storage).
  const permitido = autorizarExclusaoDeAnexo(current.anexos, path, {
    perfil: auth.perfil,
    userId: auth.userId,
  })
  if (!permitido.ok) return { ok: false, error: permitido.error }
  const atualizados = permitido.restantes

  // Storage primeiro: se falhar, o jsonb continua consistente com o bucket.
  // Recusa da policy não vem como erro, vem como lista vazia.
  const { data: removidos, error: rmErr } = await supabase.storage.from(BUCKET).remove([path])
  if (rmErr) return { ok: false, error: rmErr.message }
  if (!removeuDoStorage(removidos)) {
    return { ok: false, error: 'O armazenamento não removeu o arquivo; o anexo foi mantido' }
  }

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
