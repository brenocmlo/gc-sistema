'use server'

import { revalidatePath } from 'next/cache'

import { nomeDoContatoDoPedido } from '@/lib/bot-acesso'
import {
  contatoSchema,
  formValuesToPayload,
  mensagemDeErroContato,
  type ContatoFormValues,
} from '@/lib/contatos'
import { mensagemDeErroBanco } from '@/lib/erro-banco'
import { createClient } from '@/lib/supabase/server'

export type BotActionResult = { ok: true; id: string } | { ok: false; error: string }
/** Alias: o painel de contatos continua importando este nome. */
export type ContatoActionResult = BotActionResult

// O layout de /configuracoes/bot já barra quem não é admin; a action repete a
// checagem por conta própria (Server Action é endpoint público — CLAUDE.md).
// A RLS deixaria o comercial criar e editar contato; a tela fica com admin.
async function autorizarAdmin() {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false as const, error: 'Não autenticado' }
  const { data: profile } = await supabase
    .from('profiles')
    .select('empresa_id, perfil')
    .eq('id', user.id)
    .maybeSingle()
  if (!profile) return { ok: false as const, error: 'Perfil não configurado' }
  if (profile.perfil !== 'admin') {
    return { ok: false as const, error: 'Só o administrador configura o bot' }
  }
  return { ok: true as const, supabase, userId: user.id, empresaId: profile.empresa_id }
}

function validar(values: ContatoFormValues) {
  const parsed = contatoSchema.safeParse(values)
  if (!parsed.success) {
    return { ok: false as const, error: parsed.error.issues[0]?.message ?? 'Dados inválidos' }
  }
  return { ok: true as const, payload: formValuesToPayload(values) }
}

function revalidar() {
  revalidatePath('/configuracoes/bot', 'layout')
}

export async function createContato(values: ContatoFormValues): Promise<BotActionResult> {
  const auth = await autorizarAdmin()
  if (!auth.ok) return auth
  const v = validar(values)
  if (!v.ok) return v

  const { data, error } = await auth.supabase
    .from('contatos_whatsapp')
    .insert({ ...v.payload, empresa_id: auth.empresaId, created_by: auth.userId })
    .select('id')
    .single()
  if (error) return { ok: false, error: mensagemDeErroContato(error.message) }

  revalidar()
  return { ok: true, id: data.id }
}

export async function updateContato(id: string, values: ContatoFormValues): Promise<BotActionResult> {
  const auth = await autorizarAdmin()
  if (!auth.ok) return auth
  const v = validar(values)
  if (!v.ok) return v

  // Editar vale só para Telegram: o WhatsApp saiu (decisão 14), e um contato
  // antigo de WhatsApp editado aqui viraria Telegram sem a pessoa saber.
  const { data, error } = await auth.supabase
    .from('contatos_whatsapp')
    .update(v.payload)
    .eq('id', id)
    .eq('empresa_id', auth.empresaId)
    .eq('canal', 'TELEGRAM')
    .select('id')
    .maybeSingle()
  if (error) return { ok: false, error: mensagemDeErroContato(error.message) }
  if (!data) return { ok: false, error: 'Contato não encontrado' }

  revalidar()
  return { ok: true, id: data.id }
}

export async function deleteContato(id: string): Promise<BotActionResult> {
  const auth = await autorizarAdmin()
  if (!auth.ok) return auth

  const { data, error } = await auth.supabase
    .from('contatos_whatsapp')
    .delete()
    .eq('id', id)
    .eq('empresa_id', auth.empresaId)
    .select('id')
    .maybeSingle()
  if (error) return { ok: false, error: mensagemDeErroContato(error.message) }
  if (!data) return { ok: false, error: 'Contato não encontrado' }

  revalidar()
  return { ok: true, id: data.id }
}

/** Desativa ou reativa o envio da pessoa sem apagar o cadastro. */
export async function definirContatoAtivo(id: string, ativo: boolean): Promise<BotActionResult> {
  const auth = await autorizarAdmin()
  if (!auth.ok) return auth

  const { data, error } = await auth.supabase
    .from('contatos_whatsapp')
    .update({ ativo })
    .eq('id', id)
    .eq('empresa_id', auth.empresaId)
    .eq('canal', 'TELEGRAM')
    .select('id')
    .maybeSingle()
  if (error) return { ok: false, error: mensagemDeErroContato(error.message) }
  if (!data) return { ok: false, error: 'Contato não encontrado' }

  revalidar()
  return { ok: true, id: data.id }
}

/**
 * Permite o envio a quem pediu acesso: cria o contato (ou reativa o que já
 * existe com o mesmo código) e marca o pedido como APROVADO.
 */
export async function permitirPedidoAcesso(id: string): Promise<BotActionResult> {
  const auth = await autorizarAdmin()
  if (!auth.ok) return auth

  const { data: pedido, error: erroPedido } = await auth.supabase
    .from('bot_pedidos_acesso')
    .select('id, nome, telegram_username, telegram_user_id, status')
    .eq('id', id)
    .eq('empresa_id', auth.empresaId)
    .in('status', ['PENDENTE', 'RECUSADO'])
    .maybeSingle()
  if (erroPedido) return { ok: false, error: mensagemDeErroBanco(erroPedido.message) }
  if (!pedido) return { ok: false, error: 'Pedido não encontrado' }

  let contatoId: string
  const { data: criado, error: erroInsert } = await auth.supabase
    .from('contatos_whatsapp')
    .insert({
      canal: 'TELEGRAM',
      telegram_chat_id: pedido.telegram_user_id,
      telefone: null,
      nome: nomeDoContatoDoPedido(pedido),
      empresa_id: auth.empresaId,
      created_by: auth.userId,
    })
    .select('id')
    .single()
  if (criado) {
    contatoId = criado.id
  } else {
    // Já cadastrado (talvez desativado): reativa, se for da mesma empresa.
    if (!erroInsert?.message.includes('idx_contatos_chat_id_telegram')) {
      return { ok: false, error: mensagemDeErroContato(erroInsert?.message ?? '') }
    }
    const { data: existente, error: erroUpdate } = await auth.supabase
      .from('contatos_whatsapp')
      .update({ ativo: true })
      .eq('empresa_id', auth.empresaId)
      .eq('canal', 'TELEGRAM')
      .eq('telegram_chat_id', pedido.telegram_user_id)
      .select('id')
      .maybeSingle()
    if (erroUpdate) return { ok: false, error: mensagemDeErroContato(erroUpdate.message) }
    if (!existente) return { ok: false, error: mensagemDeErroContato(erroInsert.message) }
    contatoId = existente.id
  }

  const { error: erroStatus } = await auth.supabase
    .from('bot_pedidos_acesso')
    .update({ status: 'APROVADO' })
    .eq('id', pedido.id)
    .eq('empresa_id', auth.empresaId)
  if (erroStatus) return { ok: false, error: mensagemDeErroBanco(erroStatus.message) }

  revalidar()
  return { ok: true, id: contatoId }
}

async function mudarStatus(
  tabela: 'bot_pedidos_acesso' | 'bot_grupos',
  id: string,
  status: string,
  deStatus: string[],
  naoEncontrado: string,
): Promise<BotActionResult> {
  const auth = await autorizarAdmin()
  if (!auth.ok) return auth

  const { data, error } = await auth.supabase
    .from(tabela)
    .update({ status })
    .eq('id', id)
    .eq('empresa_id', auth.empresaId)
    .in('status', deStatus)
    .select('id')
    .maybeSingle()
  if (error) return { ok: false, error: mensagemDeErroBanco(error.message) }
  if (!data) return { ok: false, error: naoEncontrado }

  revalidar()
  return { ok: true, id: data.id }
}

export async function recusarPedidoAcesso(id: string): Promise<BotActionResult> {
  return mudarStatus('bot_pedidos_acesso', id, 'RECUSADO', ['PENDENTE'], 'Pedido não encontrado')
}

export async function liberarGrupoBot(id: string): Promise<BotActionResult> {
  return mudarStatus('bot_grupos', id, 'LIBERADO', ['PENDENTE', 'BLOQUEADO'], 'Grupo não encontrado')
}

export async function bloquearGrupoBot(id: string): Promise<BotActionResult> {
  return mudarStatus('bot_grupos', id, 'BLOQUEADO', ['PENDENTE', 'LIBERADO'], 'Grupo não encontrado')
}
