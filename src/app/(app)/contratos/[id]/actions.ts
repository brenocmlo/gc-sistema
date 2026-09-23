'use server'

import { revalidatePath } from 'next/cache'

import {
  canChangeContratoStatus,
  mensagemDeErroContrato,
  novaEntradaHistoricoContrato,
  validarRescisao,
} from '@/lib/contratos'
import { autorizarExclusaoDeAnexo, removeuDoStorage, STATUS_MUDOU_NO_MEIO } from '@/lib/anexos'
import { buildStoragePath, fileErrorMessage, validateFile } from '@/lib/files'
import { appendHistorico } from '@/lib/historico'
import { createClient } from '@/lib/supabase/server'
import type {
  Anexo,
  ContratoStatus,
  ContratoUpdate,
  MotivoRescisaoContrato,
} from '@/lib/types'

type Autorizacao =
  | { ok: true; userId: string; empresaId: string; perfil: string }
  | { ok: false; error: string }

/**
 * Guard das actions. O layout de /contratos libera visualizador, e guard de
 * layout protege rota, não ação — então toda escrita repete a checagem.
 */
async function autorizarEscrita(
  supabase: ReturnType<typeof createClient>,
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

  // Mesmos perfis das policies "Contratos: comercial insere/atualiza".
  if (profile.perfil !== 'admin' && profile.perfil !== 'comercial') {
    return { ok: false, error: `Sem permissão pra ${acao}` }
  }

  return { ok: true, userId: user.id, empresaId: profile.empresa_id, perfil: profile.perfil }
}

// ============================================================
// Mudança de status e rescisão (bloco 6.5)
// ============================================================

export type ChangeContratoStatusInput = {
  novo_status: ContratoStatus
  motivo_rescisao: MotivoRescisaoContrato | null
  detalhe_rescisao: string | null
}

export type ChangeContratoStatusResult = { ok: true } | { ok: false; error: string }

export async function changeContratoStatus(
  id: string,
  input: ChangeContratoStatusInput,
): Promise<ChangeContratoStatusResult> {
  const supabase = createClient()

  const auth = await autorizarEscrita(supabase, 'mudar status')
  if (!auth.ok) return { ok: false, error: auth.error }

  // O fluxo é regra de aplicação (o CHECK valida só a lista de valores), então
  // a transição é conferida contra o status atual do banco, não contra o que a
  // tela mandou.
  const { data: atual, error: readErr } = await supabase
    .from('contratos')
    .select('status, historico')
    .eq('id', id)
    .maybeSingle()

  if (readErr) return { ok: false, error: readErr.message }
  if (!atual) return { ok: false, error: 'Contrato não encontrado' }

  const statusAtual = atual.status as ContratoStatus

  if (!canChangeContratoStatus(statusAtual, input.novo_status)) {
    return {
      ok: false,
      error: `Transição de ${statusAtual} para ${input.novo_status} não é permitida`,
    }
  }

  const detalhe = input.detalhe_rescisao?.trim() || null
  const rescisao = validarRescisao(input.novo_status, input.motivo_rescisao, detalhe)
  if (!rescisao.ok) return { ok: false, error: rescisao.error }

  // O CHECK contratos_rescindido_motivo proíbe motivo fora de 'rescindido':
  // os dois campos só são gravados na rescisão, e nulos em qualquer outra.
  const rescindiu = input.novo_status === 'rescindido'
  const entrada = novaEntradaHistoricoContrato({
    de: statusAtual,
    para: input.novo_status,
    por: auth.userId,
    motivo_rescisao: rescindiu ? input.motivo_rescisao : null,
    detalhe_rescisao: rescindiu ? detalhe : null,
  })

  // Histórico no mesmo update do status: não existe janela em que o status
  // mudou e o registro não. E lock otimista pelo status: o update só vale se
  // o status ainda é o lido — senão duas mudanças simultâneas liam o mesmo
  // histórico e a segunda apagava a entrada da primeira.
  const { data: gravado, error } = await supabase
    .from('contratos')
    .update({
      status: input.novo_status,
      motivo_rescisao: rescindiu ? input.motivo_rescisao : null,
      detalhe_rescisao: rescindiu ? detalhe : null,
      historico: appendHistorico(atual.historico, entrada) as unknown as ContratoUpdate['historico'],
    })
    .eq('id', id)
    .eq('status', statusAtual)
    .select('id')

  if (error) return { ok: false, error: mensagemDeErroContrato(error.message) }
  if (!gravado || gravado.length === 0) return { ok: false, error: STATUS_MUDOU_NO_MEIO }

  revalidatePath('/contratos')
  revalidatePath(`/contratos/${id}`)
  return { ok: true }
}

// ============================================================
// Anexos (bloco 6.4)
// ============================================================
//
// Mesmo desenho dos anexos de proposta: arquivo no bucket `anexos`, metadado
// no jsonb `contratos.anexos`. Os nomes levam o sufixo "Contrato" porque a
// camada escrita do plano acha a action pelo nome, e `uploadAnexo` já é o da
// proposta. A URL assinada não depende da entidade: a page usa `getAnexoUrl`.
// Anexo não depende do status: contrato encerrado continua recebendo o termo
// de rescisão ou de entrega.

const BUCKET = 'anexos'

export type UploadAnexoContratoResult = { ok: true } | { ok: false; error: string }

export async function uploadAnexoContrato(
  contratoId: string,
  formData: FormData,
): Promise<UploadAnexoContratoResult> {
  const file = formData.get('file')
  if (!(file instanceof File)) {
    return { ok: false, error: 'Arquivo ausente no upload' }
  }

  const validation = validateFile(file)
  if (validation) return { ok: false, error: fileErrorMessage(validation) }

  const supabase = createClient()

  const auth = await autorizarEscrita(supabase, 'anexar arquivos')
  if (!auth.ok) return { ok: false, error: auth.error }

  const { data: current, error: readErr } = await supabase
    .from('contratos')
    .select('anexos')
    .eq('id', contratoId)
    .maybeSingle()

  if (readErr) return { ok: false, error: readErr.message }
  if (!current) return { ok: false, error: 'Contrato não encontrado' }

  // Path no padrão que a RLS do Storage exige: {empresa}/contratos/{id}/{ts}_{nome}
  const path = buildStoragePath(auth.empresaId, 'contratos', contratoId, file.name)

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
    .from('contratos')
    .update({
      anexos: [...existentes, novo] as unknown as ContratoUpdate['anexos'],
    })
    .eq('id', contratoId)

  if (updateErr) {
    // Rollback best-effort: sem isso o arquivo fica órfão no Storage.
    await supabase.storage.from(BUCKET).remove([path])
    return { ok: false, error: updateErr.message }
  }

  revalidatePath(`/contratos/${contratoId}`)
  return { ok: true }
}

export type DeleteAnexoContratoResult = { ok: true } | { ok: false; error: string }

export async function deleteAnexoContrato(
  contratoId: string,
  path: string,
): Promise<DeleteAnexoContratoResult> {
  const supabase = createClient()

  const auth = await autorizarEscrita(supabase, 'excluir anexos')
  if (!auth.ok) return { ok: false, error: auth.error }

  const { data: current, error: readErr } = await supabase
    .from('contratos')
    .select('anexos')
    .eq('id', contratoId)
    .maybeSingle()

  if (readErr) return { ok: false, error: readErr.message }
  if (!current) return { ok: false, error: 'Contrato não encontrado' }

  // Só apaga do bucket o que é anexo deste contrato (o path vem do corpo da
  // requisição), e só se quem pede for admin ou quem subiu.
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
    .from('contratos')
    .update({
      anexos: atualizados as unknown as ContratoUpdate['anexos'],
    })
    .eq('id', contratoId)

  if (updateErr) return { ok: false, error: updateErr.message }

  revalidatePath(`/contratos/${contratoId}`)
  return { ok: true }
}
