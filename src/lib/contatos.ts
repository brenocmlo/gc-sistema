// Contatos autorizados a mandar documentos pelo bot (Fase 7 da automação).
// Helpers puros — sem 'use client' e sem React — pra servirem a página, as
// Server Actions e o formulário, e serem testáveis por node --test.
//
// Tabela `contatos_whatsapp` (o nome é histórico: desde a Fase 1 ela guarda
// os dois canais). Decisão 4: cadastro manual — a pessoa escreve ao bot,
// recebe o próprio código (chat_id do Telegram) e o admin cadastra aqui.
// Decisão 14: a Z-API saiu, então contato novo é sempre Telegram; os de
// WhatsApp antigos aparecem na lista e podem ser excluídos.
import { z } from 'zod'

export type Canal = 'TELEGRAM' | 'WHATSAPP'

export const CANAL_LABELS: Record<Canal, string> = {
  TELEGRAM: 'Telegram',
  WHATSAPP: 'WhatsApp (desativado)',
}

/**
 * chat_id de conversa privada no Telegram é inteiro positivo (o de grupo é
 * negativo; aceito também, pra não barrar um caso válido). O bot manda o
 * número sem formatação, mas a pessoa pode colar com espaço.
 */
export const CHAT_ID_REGEX = /^-?\d{5,15}$/

export function normalizarChatId(bruto: unknown): string {
  return String(bruto ?? '').replace(/\s+/g, '').trim()
}

export const contatoSchema = z.object({
  nome: z.string().trim().max(120, 'Máximo 120 caracteres').optional().default(''),
  telegram_chat_id: z
    .string()
    .transform(normalizarChatId)
    .refine((v) => v !== '', { message: 'Informe o código que o bot enviou à pessoa' })
    .refine((v) => v === '' || CHAT_ID_REGEX.test(v), {
      message: 'O código tem só números (ex.: 884349214)',
    }),
  // Sem obra, todo documento do contato vai para revisão humana ("não
  // conseguimos confirmar a que obra"). Obrigatório pra isso não virar rotina.
  obra_id: z.string().trim().min(1, 'Escolha a obra'),
})

export type ContatoFormValues = z.input<typeof contatoSchema>

export type ContatoPayload = {
  canal: 'TELEGRAM'
  telegram_chat_id: string
  telefone: null
  obra_id: string
  nome: string | null
}

export function formValuesToPayload(values: ContatoFormValues): ContatoPayload {
  const nome = (values.nome ?? '').trim()
  return {
    canal: 'TELEGRAM',
    telegram_chat_id: normalizarChatId(values.telegram_chat_id),
    telefone: null,
    obra_id: (values.obra_id ?? '').trim(),
    nome: nome === '' ? null : nome,
  }
}

export function emptyContatoFormValues(): ContatoFormValues {
  return { nome: '', telegram_chat_id: '', obra_id: '' }
}

/** Linha da listagem, com a obra resolvida pelo join. */
export type ContatoListItem = {
  id: string
  nome: string | null
  canal: string
  telegram_chat_id: string | null
  telefone: string | null
  obra_id: string | null
  created_at: string | null
  obra: { codigo_obra: string | null; nome: string | null } | null
}

export function contatoToFormValues(c: ContatoListItem): ContatoFormValues {
  return {
    nome: c.nome ?? '',
    telegram_chat_id: c.telegram_chat_id ?? '',
    obra_id: c.obra_id ?? '',
  }
}

/** O identificador que aparece na tela: código do Telegram ou telefone. */
export function identificadorDoContato(c: Pick<ContatoListItem, 'canal' | 'telegram_chat_id' | 'telefone'>): string {
  if (c.canal === 'TELEGRAM') return c.telegram_chat_id ?? '—'
  return c.telefone ?? '—'
}

export function rotuloCanal(canal: string): string {
  return canal === 'TELEGRAM' || canal === 'WHATSAPP' ? CANAL_LABELS[canal] : canal
}

/**
 * Traduz a violação de constraint pro que a pessoa precisa fazer. O índice de
 * chat_id é único no banco inteiro (idx_contatos_chat_id_telegram), não por
 * empresa — um código só pode estar cadastrado uma vez.
 */
export function mensagemDeErroContato(raw: string): string {
  if (raw.includes('idx_contatos_chat_id_telegram')) {
    return 'Esse código já está cadastrado'
  }
  if (raw.includes('contatos_whatsapp_identidade_do_canal')) {
    return 'Informe o código do Telegram'
  }
  if (raw.includes('contatos_whatsapp_obra_fk')) {
    return 'Obra inválida para esta empresa'
  }
  return raw
}
