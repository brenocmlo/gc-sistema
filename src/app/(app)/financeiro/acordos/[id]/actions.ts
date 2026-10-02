'use server'

import { revalidatePath } from 'next/cache'

import {
  linhaDaParcela,
  MOTIVO_CANCELAMENTO_ACORDO_MIN,
  motivoParaNaoCancelarAcordo,
  motivoParaNaoCancelarParcela,
  motivoParaNaoConverter,
  motivoParaNaoEditarParcela,
  motivoParaNaoMexerNoAcordo,
  motivoParaNaoQuitar,
  observacaoComCancelamento,
  planoDoCancelamento,
  resumoFinanceiroDoAcordo,
} from '@/lib/acordos'
import { mensagemDeErroAcordo, validarParcelaPayload, type ParcelaPayload } from '@/lib/acordos-form'
import { autorizarExclusaoDeAnexo, removeuDoStorage } from '@/lib/anexos'
import { hojeISO } from '@/lib/execucao'
import { buildStoragePath, fileErrorMessage, validateFile } from '@/lib/files'
import { mensagemDeErroNf, validarPayloadNf, type NotaFiscalPayload } from '@/lib/notas-fiscais-form'
import { createClient } from '@/lib/supabase/server'
import type { AcordoPagamentoUpdate, AcordoStatus, Anexo, ParcelaStatus } from '@/lib/types'

// Detalhe do acordo (11.3): as parcelas uma a uma e os anexos. O layout de
// /financeiro libera o visualizador; as actions repetem a regra de perfil
// (admin e financeiro, as policies "financeiro gerencia") e a de status
// (parcela só muda com o acordo aberto).

type Resultado = { ok: true } | { ok: false; error: string }

const BUCKET = 'anexos'

async function contexto(acordoId: string) {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false as const, error: 'Não autenticado' }
  const { data: profile } = await supabase.from('profiles').select('empresa_id, perfil').eq('id', user.id).maybeSingle()
  if (!profile) return { ok: false as const, error: 'Perfil não configurado' }
  const { data: acordo } = await supabase
    .from('acordos_pagamento')
    .select('id, empresa_id, obra_id, status, anexos')
    .eq('id', acordoId)
    .maybeSingle()
  if (!acordo || acordo.empresa_id !== profile.empresa_id) return { ok: false as const, error: 'Acordo não encontrado' }
  return { ok: true as const, supabase, userId: user.id, perfil: profile.perfil, acordo }
}

function revalidar(acordoId: string) {
  revalidatePath('/financeiro/acordos')
  revalidatePath(`/financeiro/acordos/${acordoId}`)
}

/** Parcela nova no fim do acordo: o número é o próximo depois do maior (as canceladas contam, o número é único). */
export async function adicionarParcela(acordoId: string, input: ParcelaPayload): Promise<Resultado> {
  const c = await contexto(acordoId)
  if (!c.ok) return c
  const bloqueio = motivoParaNaoMexerNoAcordo(c.perfil, c.acordo.status as AcordoStatus)
  if (bloqueio) return { ok: false, error: bloqueio }
  const valido = validarParcelaPayload(input)
  if (!valido.ok) return valido

  const { data: ultima } = await c.supabase
    .from('acordo_parcelas')
    .select('numero_parcela')
    .eq('acordo_id', acordoId)
    .order('numero_parcela', { ascending: false })
    .limit(1)
    .maybeSingle()
  const { error } = await c.supabase.from('acordo_parcelas').insert({
    empresa_id: c.acordo.empresa_id,
    acordo_id: acordoId,
    obra_id: c.acordo.obra_id,
    numero_parcela: (ultima?.numero_parcela ?? 0) + 1,
    data_vencimento: input.data_vencimento,
    valor_previsto: input.valor_previsto,
    observacao: input.observacao?.trim() || null,
  })
  if (error) return { ok: false, error: mensagemDeErroAcordo(error.message) }
  revalidar(acordoId)
  return { ok: true }
}

async function parcelaDoAcordo(c: Extract<Awaited<ReturnType<typeof contexto>>, { ok: true }>, parcelaId: string) {
  const { data } = await c.supabase
    .from('acordo_parcelas')
    .select('id, acordo_id, status, valor_previsto, data_vencimento, pagamentos(valor)')
    .eq('id', parcelaId)
    .maybeSingle()
  return data && data.acordo_id === c.acordo.id ? data : null
}

/** Vencimento, valor e observação. O trigger recalcula o status pelo valor novo. */
export async function editarParcela(acordoId: string, parcelaId: string, input: ParcelaPayload): Promise<Resultado> {
  const c = await contexto(acordoId)
  if (!c.ok) return c
  const bloqueio = motivoParaNaoMexerNoAcordo(c.perfil, c.acordo.status as AcordoStatus)
  if (bloqueio) return { ok: false, error: bloqueio }
  const valido = validarParcelaPayload(input)
  if (!valido.ok) return valido
  const parcela = await parcelaDoAcordo(c, parcelaId)
  if (!parcela) return { ok: false, error: 'Parcela não encontrada neste acordo' }
  const { pago } = linhaDaParcela({ ...parcela, status: parcela.status as ParcelaStatus }, '0000-00-00')
  const recusa = motivoParaNaoEditarParcela({ status: parcela.status as ParcelaStatus, pago }, input.valor_previsto)
  if (recusa) return { ok: false, error: recusa }

  const { error } = await c.supabase
    .from('acordo_parcelas')
    .update({ data_vencimento: input.data_vencimento, valor_previsto: input.valor_previsto, observacao: input.observacao?.trim() || null })
    .eq('id', parcelaId)
    .neq('status', 'cancelada')
  if (error) return { ok: false, error: mensagemDeErroAcordo(error.message) }
  revalidar(acordoId)
  return { ok: true }
}

/** Cancela a parcela que não recebeu pagamento. O trigger refaz o status do acordo. */
export async function cancelarParcela(acordoId: string, parcelaId: string): Promise<Resultado> {
  const c = await contexto(acordoId)
  if (!c.ok) return c
  const bloqueio = motivoParaNaoMexerNoAcordo(c.perfil, c.acordo.status as AcordoStatus)
  if (bloqueio) return { ok: false, error: bloqueio }
  const parcela = await parcelaDoAcordo(c, parcelaId)
  if (!parcela) return { ok: false, error: 'Parcela não encontrada neste acordo' }
  const recusa = motivoParaNaoCancelarParcela({ status: parcela.status as ParcelaStatus, qtdPagamentos: (parcela.pagamentos ?? []).length })
  if (recusa) return { ok: false, error: recusa }

  const { error } = await c.supabase.from('acordo_parcelas').update({ status: 'cancelada' }).eq('id', parcelaId).neq('status', 'cancelada')
  if (error) return { ok: false, error: mensagemDeErroAcordo(error.message) }
  revalidar(acordoId)
  return { ok: true }
}

// Anexos do acordo (a conversa do WhatsApp, o documento assinado), no desenho
// dos anexos de contrato: arquivo no bucket `anexos`, metadado no jsonb
// `acordos_pagamento.anexos`. Anexo não depende do status: o acordo quitado
// continua recebendo o recibo.

export async function uploadAnexoAcordo(acordoId: string, formData: FormData): Promise<Resultado> {
  const file = formData.get('file')
  if (!(file instanceof File)) return { ok: false, error: 'Arquivo ausente no upload' }
  const validation = validateFile(file)
  if (validation) return { ok: false, error: fileErrorMessage(validation) }

  const c = await contexto(acordoId)
  if (!c.ok) return c
  if (c.perfil !== 'admin' && c.perfil !== 'financeiro') return { ok: false, error: 'Sem permissão pra anexar arquivos' }

  // Path no padrão que a RLS do Storage exige: {empresa}/acordos/{id}/{ts}_{nome}
  const path = buildStoragePath(c.acordo.empresa_id, 'acordos', acordoId, file.name)
  const { error: uploadErr } = await c.supabase.storage
    .from(BUCKET)
    .upload(path, file, { contentType: file.type || 'application/octet-stream', upsert: false })
  if (uploadErr) return { ok: false, error: uploadErr.message }

  const novo: Anexo = {
    nome: file.name,
    path,
    tipo: file.type || 'application/octet-stream',
    tamanho: file.size,
    uploaded_at: new Date().toISOString(),
    uploaded_by: c.userId,
  }
  const existentes = (c.acordo.anexos as Anexo[] | null) ?? []
  const { error: updateErr } = await c.supabase
    .from('acordos_pagamento')
    .update({ anexos: [...existentes, novo] as unknown as AcordoPagamentoUpdate['anexos'] })
    .eq('id', acordoId)
  if (updateErr) {
    // Rollback best-effort: sem isso o arquivo fica órfão no Storage.
    await c.supabase.storage.from(BUCKET).remove([path])
    return { ok: false, error: updateErr.message }
  }
  revalidatePath(`/financeiro/acordos/${acordoId}`)
  return { ok: true }
}

export async function deleteAnexoAcordo(acordoId: string, path: string): Promise<Resultado> {
  const c = await contexto(acordoId)
  if (!c.ok) return c
  if (c.perfil !== 'admin' && c.perfil !== 'financeiro') return { ok: false, error: 'Sem permissão pra excluir anexos' }

  // Só apaga do bucket o que é anexo deste acordo (o path vem do corpo da
  // requisição), e só se quem pede for admin ou quem subiu.
  const permitido = autorizarExclusaoDeAnexo(c.acordo.anexos, path, { perfil: c.perfil, userId: c.userId })
  if (!permitido.ok) return { ok: false, error: permitido.error }

  // Storage primeiro: se falhar, o jsonb continua consistente com o bucket.
  const { data: removidos, error: rmErr } = await c.supabase.storage.from(BUCKET).remove([path])
  if (rmErr) return { ok: false, error: rmErr.message }
  if (!removeuDoStorage(removidos)) return { ok: false, error: 'O armazenamento não removeu o arquivo; o anexo foi mantido' }

  const { error: updateErr } = await c.supabase
    .from('acordos_pagamento')
    .update({ anexos: permitido.restantes as unknown as AcordoPagamentoUpdate['anexos'] })
    .eq('id', acordoId)
  if (updateErr) return { ok: false, error: updateErr.message }
  revalidatePath(`/financeiro/acordos/${acordoId}`)
  return { ok: true }
}

/** O que a pessoa preenche ao converter: a NF, sem obra e sem vínculo (vêm do acordo). */
export type ConversaoPayload = Omit<NotaFiscalPayload, 'obra_id' | 'contrato_id' | 'proposta_id'>

/**
 * Converte o acordo em nota fiscal (11.4, regra 7 do CONTEXT): a NF de saldo
 * e o acordo convertido numa transação (RPC converter_acordo_em_nf, migration
 * 037). A NF herda a obra e o vínculo do acordo; as views passam a arquivar os
 * pagamentos do acordo.
 */
export async function converterAcordoEmNf(
  acordoId: string,
  input: ConversaoPayload,
): Promise<{ ok: true; nfId: string } | { ok: false; error: string }> {
  const c = await contexto(acordoId)
  if (!c.ok) return c

  const { data: acordo } = await c.supabase
    .from('acordos_pagamento')
    .select('contrato_id, proposta_id, parcelas:acordo_parcelas(valor_previsto, status, data_vencimento, pagamentos(valor))')
    .eq('id', acordoId)
    .single()
  const parcelas = (acordo?.parcelas ?? []) as { valor_previsto: number; status: ParcelaStatus; data_vencimento: string; pagamentos: { valor: number }[] | null }[]
  const { saldo } = resumoFinanceiroDoAcordo(parcelas)
  const bloqueio = motivoParaNaoConverter(c.perfil, c.acordo.status as AcordoStatus, saldo)
  if (bloqueio) return { ok: false, error: bloqueio }

  // A mesma regra da criação de NF (9.2), com a obra e o vínculo do acordo.
  const nf: NotaFiscalPayload = {
    ...input,
    obra_id: c.acordo.obra_id,
    contrato_id: acordo?.contrato_id ?? null,
    proposta_id: acordo?.proposta_id ?? null,
  }
  const valido = validarPayloadNf(nf)
  if (!valido.ok) return valido

  const { data: nfId, error } = await c.supabase.rpc('converter_acordo_em_nf', {
    p_acordo_id: acordoId,
    p_numero: nf.numero.trim(),
    p_tipo: nf.tipo,
    p_valor_total: nf.valor_total,
    p_data_emissao: nf.data_emissao,
    p_serie: nf.serie ?? undefined,
    p_chave_nfe: nf.chave_nfe ?? undefined,
    p_data_vencimento: nf.data_vencimento ?? undefined,
    p_observacao: nf.observacao ?? undefined,
  })
  if (error || !nfId) {
    const raw = error?.message ?? 'Conversão não gravada'
    return { ok: false, error: /acordo_/.test(raw) ? mensagemDeErroAcordo(raw) : mensagemDeErroNf(raw) }
  }

  revalidar(acordoId)
  revalidatePath('/financeiro/notas-fiscais')
  return { ok: true, nfId }
}

// Encerramento à mão (11.5). O quitado pelo trigger (todas as parcelas
// válidas pagas, 10.5) continua valendo; isto é para quando o combinado acaba
// antes: o cliente não vai pagar o resto, ou desistiu.

/**
 * Encerra como quitado: cancela as parcelas pendentes (sem pagamento) num
 * UPDATE só, e o trigger atualizar_status_acordo quita o acordo, com a data de
 * encerramento. Parcela paga parcialmente impede (motivoParaNaoQuitar).
 */
export async function quitarAcordo(acordoId: string): Promise<Resultado> {
  const c = await contexto(acordoId)
  if (!c.ok) return c
  const { data: parcelas } = await c.supabase.from('acordo_parcelas').select('numero_parcela, status').eq('acordo_id', acordoId)
  const bloqueio = motivoParaNaoQuitar(c.perfil, c.acordo.status as AcordoStatus, (parcelas ?? []) as { numero_parcela: number; status: ParcelaStatus }[])
  if (bloqueio) return { ok: false, error: bloqueio }

  const { error } = await c.supabase.from('acordo_parcelas').update({ status: 'cancelada' }).eq('acordo_id', acordoId).eq('status', 'pendente')
  if (error) return { ok: false, error: mensagemDeErroAcordo(error.message) }

  // O trigger quitou? Se uma baixa entrou no meio, não: avisa em vez de mentir.
  const { data: depois } = await c.supabase.from('acordos_pagamento').select('status').eq('id', acordoId).single()
  revalidar(acordoId)
  if (depois?.status !== 'quitado') return { ok: false, error: 'As parcelas pendentes foram canceladas, mas o acordo não ficou quitado; confira as parcelas' }
  return { ok: true }
}

/**
 * Cancela o acordo. Sem pagamento: status cancelado, data de encerramento e o
 * motivo na observação; as parcelas também são canceladas, e as views tiram o
 * acordo do a receber. Com pagamento (planoDoCancelamento): a parcela paga em
 * parte desce ao valor pago, as sem pagamento são canceladas, e o trigger
 * quita o acordo pelo recebido, que continua no recebido da obra.
 */
export async function cancelarAcordo(acordoId: string, motivo: string): Promise<Resultado> {
  const c = await contexto(acordoId)
  if (!c.ok) return c
  const texto = (motivo ?? '').trim()
  if (texto.length < MOTIVO_CANCELAMENTO_ACORDO_MIN) return { ok: false, error: 'Diga por que o acordo está sendo cancelado' }
  if (texto.length > 500) return { ok: false, error: 'Motivo com mais de 500 caracteres' }
  const bloqueio = motivoParaNaoCancelarAcordo(c.perfil, c.acordo.status as AcordoStatus)
  if (bloqueio) return { ok: false, error: bloqueio }

  const { data: parcelas, error: eParc } = await c.supabase
    .from('acordo_parcelas')
    .select('id, numero_parcela, status, valor_previsto, pagamentos(valor)')
    .eq('acordo_id', acordoId)
  if (eParc) return { ok: false, error: mensagemDeErroAcordo(eParc.message) }
  const plano = planoDoCancelamento((parcelas ?? []).map((p) => ({
    ...p,
    status: p.status as ParcelaStatus,
    pago: (p.pagamentos ?? []).reduce((acc, x) => acc + Number(x.valor), 0),
  })))

  const hoje = hojeISO()
  const { data: atual } = await c.supabase.from('acordos_pagamento').select('observacao').eq('id', acordoId).single()
  const observacao = observacaoComCancelamento(atual?.observacao ?? null, texto, hoje, plano.recebido)

  if (plano.recebido === 0) {
    // Acordo primeiro: com ele cancelado, o trigger das parcelas não o mexe mais
    // (só reabre o quitado). `eq aberto`: dois cancelamentos não trocam o motivo.
    const { error, count } = await c.supabase
      .from('acordos_pagamento')
      .update({ status: 'cancelado', data_encerramento: hoje, observacao }, { count: 'exact' })
      .eq('id', acordoId)
      .eq('status', 'aberto')
    if (error) return { ok: false, error: mensagemDeErroAcordo(error.message) }
    if (count === 0) return { ok: false, error: 'O acordo já não estava aberto' }
    await c.supabase.from('acordo_parcelas').update({ status: 'cancelada' }).eq('acordo_id', acordoId).neq('status', 'cancelada')
    revalidar(acordoId)
    return { ok: true }
  }

  // Com pagamento: as parcelas primeiro (o trigger quita o acordo quando a
  // última válida fica paga), e o motivo depois, só com o acordo já quitado.
  for (const a of plano.ajustar) {
    const { error } = await c.supabase.from('acordo_parcelas').update({ valor_previsto: a.valor }).eq('id', a.id).eq('acordo_id', acordoId)
    if (error) return { ok: false, error: mensagemDeErroAcordo(error.message) }
  }
  if (plano.cancelar.length > 0) {
    const { error } = await c.supabase.from('acordo_parcelas').update({ status: 'cancelada' }).in('id', plano.cancelar).eq('acordo_id', acordoId)
    if (error) return { ok: false, error: mensagemDeErroAcordo(error.message) }
  }
  const { data: depois } = await c.supabase.from('acordos_pagamento').select('status').eq('id', acordoId).single()
  revalidar(acordoId)
  if (depois?.status !== 'quitado') return { ok: false, error: 'As parcelas foram ajustadas, mas o acordo não ficou quitado; confira as parcelas' }
  const { error: eObs } = await c.supabase.from('acordos_pagamento').update({ observacao }).eq('id', acordoId)
  if (eObs) return { ok: false, error: mensagemDeErroAcordo(eObs.message) }
  return { ok: true }
}

