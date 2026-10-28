// POST /api/ingestao/triagem-telegram — quem pode mandar documento ao bot.
//
// O n8n entrega o update do Telegram como veio e recebe de volta os itens que
// ele já sabe executar (responder, processar, resposta). A regra mora em
// src/lib/bot-acesso.ts (pura e testada); aqui só se consulta o banco e se
// grava o que a regra pediu (grupo novo, pedido de acesso, migração de grupo).
// Esta rota não manda mensagem ao Telegram: quem envia é o n8n.
//
// Máquina chamando: x-ingestao-token, service role.
import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

import {
  botDoToken,
  itensDaAcao,
  lerIdentidade,
  lerUpdateTelegram,
  triarMensagemTelegram,
  type ContextoTriagem,
  type StatusGrupo,
  type StatusPedido,
} from '@/lib/bot-acesso'
import { tokenConfere } from '@/lib/ingestao'
import type { Database } from '@/lib/supabase/types'
import { ADMIN_CHAT_ID_PADRAO } from '@/lib/telegram'

export const dynamic = 'force-dynamic'

function resposta(status: number, corpo: Record<string, unknown>) {
  return NextResponse.json(corpo, { status })
}

export async function POST(req: Request) {
  const tokenEsperado = process.env.INGESTAO_TOKEN
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!tokenEsperado || !url || !serviceRole) {
    return resposta(500, { ok: false, error: 'Rota de ingestão não configurada neste ambiente' })
  }
  if (!tokenConfere(req.headers.get('x-ingestao-token'), tokenEsperado)) {
    return resposta(401, { ok: false, error: 'Token de ingestão inválido' })
  }

  let corpo: unknown
  try {
    corpo = await req.json()
  } catch {
    return resposta(422, { ok: false, error: 'Corpo da requisição não é JSON' })
  }
  const update = lerUpdateTelegram(corpo)
  if (!update) return resposta(200, { ok: true, acao: 'ignorar', motivo: 'sem_mensagem', itens: [] })

  const bot = {
    id: botDoToken(process.env.TELEGRAM_BOT_TOKEN),
    username: process.env.TELEGRAM_BOT_USERNAME?.replace(/^@/, '') || null,
  }
  const adminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID || ADMIN_CHAT_ID_PADRAO

  // Filtro barato: conversa de grupo que não chamou o bot não toca o banco.
  const id = lerIdentidade(update, bot, adminChatId)
  if (!id.relevante) return resposta(200, { ok: true, acao: 'ignorar', motivo: id.motivo, itens: [] })

  const supabase = createClient<Database>(url, serviceRole, { auth: { persistSession: false } })

  let contato: ContextoTriagem['contato'] = null
  if (id.remetenteId) {
    const { data, error } = await supabase
      .from('contatos_whatsapp')
      .select('id, empresa_id, nome, ativo')
      .eq('canal', 'TELEGRAM')
      .eq('telegram_chat_id', id.remetenteId)
      .maybeSingle()
    if (error) return resposta(500, { ok: false, error: error.message })
    if (data) {
      const c = data as { id: string; empresa_id: string; nome: string | null; ativo: boolean }
      contato = { id: c.id, empresaId: c.empresa_id, nome: c.nome, ativo: c.ativo }
    }
  }

  let grupo: ContextoTriagem['grupo'] = null
  if (id.tipoChat === 'grupo') {
    const { data, error } = await supabase
      .from('bot_grupos')
      .select('id, empresa_id, nome, status')
      .eq('telegram_chat_id', id.chatId)
      .maybeSingle()
    if (error) return resposta(500, { ok: false, error: error.message })
    if (data) {
      const g = data as { id: string; empresa_id: string; nome: string | null; status: string }
      grupo = { id: g.id, empresaId: g.empresa_id, nome: g.nome, status: g.status as StatusGrupo }
    }
  }

  let pedido: ContextoTriagem['pedido'] = null
  if (grupo && !contato && id.remetenteId) {
    const { data, error } = await supabase
      .from('bot_pedidos_acesso')
      .select('id, status')
      .eq('empresa_id', grupo.empresaId)
      .eq('telegram_user_id', id.remetenteId)
      .maybeSingle()
    if (error) return resposta(500, { ok: false, error: error.message })
    if (data) {
      const p = data as { id: string; status: string }
      pedido = { id: p.id, status: p.status as StatusPedido }
    }
  }

  const acao = triarMensagemTelegram(update, { bot, adminChatId, contato, grupo, pedido })

  let criado = false
  let aviso: string | undefined
  if (acao.tipo === 'registrar_grupo') {
    const { data, error } = await supabase
      .from('bot_grupos')
      .upsert(
        { empresa_id: acao.empresaId, telegram_chat_id: acao.telegramChatId, nome: acao.nome, status: 'PENDENTE' },
        { onConflict: 'telegram_chat_id', ignoreDuplicates: true },
      )
      .select('id')
    if (error) return resposta(500, { ok: false, error: error.message })
    criado = (data ?? []).length > 0
  } else if (acao.tipo === 'pedir_acesso') {
    const { data, error } = await supabase
      .from('bot_pedidos_acesso')
      .upsert(
        {
          empresa_id: acao.empresaId,
          telegram_user_id: acao.telegramUserId,
          nome: acao.nome,
          telegram_username: acao.username,
          grupo_id: acao.grupoId,
          status: 'PENDENTE',
        },
        { onConflict: 'empresa_id,telegram_user_id', ignoreDuplicates: true },
      )
      .select('id')
    if (error) return resposta(500, { ok: false, error: error.message })
    criado = (data ?? []).length > 0
  } else if (acao.tipo === 'migrar_grupo') {
    const { error } = await supabase.from('bot_grupos').update({ telegram_chat_id: acao.para }).eq('telegram_chat_id', acao.de)
    if (error) {
      // 23505 = o destino já existe: não muda nada e avisa.
      if (error.code === '23505') aviso = 'o grupo de destino já está cadastrado; nada foi alterado'
      else return resposta(500, { ok: false, error: error.message })
    }
  }

  return resposta(200, {
    ok: true,
    acao: acao.tipo,
    ...(acao.tipo === 'ignorar' ? { motivo: acao.motivo } : {}),
    ...(aviso ? { aviso } : {}),
    itens: itensDaAcao(acao, { criado }),
  })
}
