// Regra pura de quem pode mandar documento ao bot do Telegram (conversa privada e grupo).
// Sem React, sem Supabase: serve a rota POST /api/ingestao/triagem-telegram e é testada por
// `node --test`. Especificação: seção 4 da spec do envio pelo grupo (decisões 33 a 38).

export type StatusGrupo = 'PENDENTE' | 'LIBERADO' | 'BLOQUEADO'
export type StatusPedido = 'PENDENTE' | 'APROVADO' | 'RECUSADO'

/** Subconjunto do Update da Bot API que a triagem lê. */
export type UsuarioTelegram = { id: number; is_bot?: boolean; first_name?: string; last_name?: string; username?: string }
export type ChatTelegram = { id: number; type: 'private' | 'group' | 'supergroup' | 'channel'; title?: string }
export type DocumentoTelegram = { file_id: string; file_name?: string; mime_type?: string; file_size?: number }
export type MensagemTelegram = {
  message_id: number
  from?: UsuarioTelegram
  sender_chat?: { id: number; type: string }
  chat: ChatTelegram
  text?: string
  caption?: string
  document?: DocumentoTelegram
  photo?: unknown[]
  reply_to_message?: { message_id: number; from?: UsuarioTelegram }
  new_chat_members?: UsuarioTelegram[]
  migrate_to_chat_id?: number
}
export type UpdateTelegram = { update_id: number; message?: MensagemTelegram }

export type BotTelegram = { id: string | null; username: string | null }

export type ContextoTriagem = {
  bot: BotTelegram
  /** TELEGRAM_ADMIN_CHAT_ID || ADMIN_CHAT_ID_PADRAO (src/lib/telegram.ts). */
  adminChatId: string
  /** contatos_whatsapp com canal TELEGRAM e telegram_chat_id = from.id. */
  contato: { id: string; empresaId: string; nome: string | null; ativo: boolean } | null
  /** bot_grupos com telegram_chat_id = chat.id. Sempre nulo na conversa privada. */
  grupo: { id: string; empresaId: string; nome: string | null; status: StatusGrupo } | null
  /** bot_pedidos_acesso da empresa do grupo para from.id. Só consultado com grupo e sem contato. */
  pedido: { id: string; status: StatusPedido } | null
}

export type MotivoIgnorar =
  | 'sem_mensagem' | 'canal' | 'grupo_admin' | 'sem_chamada' | 'anonimo'
  | 'grupo_desconhecido' | 'grupo_conhecido' | 'grupo_pendente' | 'grupo_bloqueado'
  | 'outra_empresa' | 'contato_inativo' | 'texto_de_desconhecido'
  | 'pedido_pendente' | 'pedido_recusado' | 'acesso_removido'

export type AcaoTriagem =
  | { tipo: 'ignorar'; motivo: MotivoIgnorar }
  | { tipo: 'responder'; empresaId: string | null; chatId: string; responderA: number | null; texto: string; avisoAdmin: string | null }
  | { tipo: 'processar'; empresaId: string; chatId: string; remetenteId: string; mensagemId: number | null; fileId: string; nomeArquivo: string; caminho: string }
  | { tipo: 'resposta_obra'; empresaId: string; chatId: string; remetenteId: string; mensagemId: number | null; texto: string }
  | { tipo: 'registrar_grupo'; empresaId: string; telegramChatId: string; nome: string | null; responderA: number | null; nomeContato: string }
  | { tipo: 'pedir_acesso'; empresaId: string; grupoId: string; chatId: string; telegramUserId: string; nome: string; username: string | null; responderA: number; nomeGrupo: string | null }
  | { tipo: 'migrar_grupo'; de: string; para: string }

export type Identidade =
  | { relevante: false; motivo: MotivoIgnorar }
  | { relevante: true; tipoChat: 'privado' | 'grupo'; chatId: string; remetenteId: string | null }

/** O que o n8n recebe: mesmo formato dos itens que o 'Triar mensagem' produz hoje, mais remetente_id, mensagem_id e reply_to. */
export type ItemN8n =
  | { acao: 'processar'; empresa_id: string; obra_id: null; chat_id: string; remetente_id: string; mensagem_id: number | null; file_id: string; nome_arquivo: string; caminho: string }
  | { acao: 'resposta'; empresa_id: string; chat_id: string; remetente_id: string; mensagem_id: number | null; texto: string }
  | { acao: 'responder'; destino: 'CLIENTE' | 'ADMIN'; canal: 'TELEGRAM'; chat_id: string | null; reply_to: number | null; texto: string; opcoes: null; contexto: { documentoId: null; empresaId: string | null; origem: 'telegram-entrada' } }

export const LIMITE_ARQUIVO_BYTES = 20 * 1024 * 1024
/** Id fixo que o Telegram usa para administrador anônimo (GroupAnonymousBot). */
export const ID_ADMIN_ANONIMO = 1087968824

export const TEXTOS_BOT = {
  NAO_CADASTRADO: (nome: string, codigo: string) =>
    `Olá, ${nome}! Este canal recebe propostas e contratos de pessoas cadastradas. Seu código de acesso é ${codigo}. Passe esse número ao administrador para liberar o envio.`,
  AVISO_NOVO_CONTATO: (nome: string, codigo: string) =>
    `[NOVO CONTATO] ${nome} (código ${codigo}) escreveu no bot e não está cadastrado. Se for alguém da equipe, cadastre o código em Configurações → Bot → Usuários permitidos.`,
  CONTATO_DESATIVADO:
    'Seu envio de documentos por este bot está desativado. Se precisar voltar a enviar, fale com o administrador.',
  FOTO: 'Recebemos uma foto, mas por aqui aceitamos somente a proposta em PDF. Pode enviar o arquivo PDF (clipe → Arquivo)?',
  NAO_PDF: (nomeArquivo: string) =>
    `Recebemos o arquivo "${nomeArquivo}", mas por aqui aceitamos somente PDF. Pode reenviar a proposta em PDF?`,
  GRANDE: (nomeArquivo: string) =>
    `O arquivo "${nomeArquivo}" passa de 20 MB, o limite do Telegram para este canal. Pode enviar uma versão menor?`,
  GRUPO_REGISTRADO:
    'Este grupo ainda não está liberado para enviar documentos. O administrador foi avisado e libera em Configurações → Bot → Grupos. Enquanto isso, mande o PDF na conversa privada com o bot.',
  AVISO_NOVO_GRUPO: (nomeContato: string, nomeGrupo: string, chatId: string) =>
    `[NOVO GRUPO] ${nomeContato} chamou o bot no grupo "${nomeGrupo}" (código ${chatId}). Para aceitar documentos enviados ali, libere em Configurações → Bot → Grupos.`,
  GRUPO_PENDENTE:
    'Este grupo ainda aguarda a liberação do administrador. Enquanto isso, mande o PDF na conversa privada com o bot.',
  PEDIDO_CRIADO: (nome: string) =>
    `${nome}, você ainda não tem permissão para enviar documentos por este bot. Pedimos a liberação ao administrador; quando ele permitir, é só mandar o PDF de novo.`,
  AVISO_PEDIDO: (nome: string, username: string | null, nomeGrupo: string) =>
    `[PEDIDO DE ACESSO] ${nome}${username ? ` (@${username})` : ''} quer enviar documentos pelo grupo "${nomeGrupo}". Permita ou recuse em Configurações → Bot → Pedidos de acesso.`,
  ANONIMO:
    'Não dá para saber quem enviou: a mensagem saiu como anônima. Envie o PDF de novo pela sua própria conta, sem o modo anônimo.',
}

function ehObjeto(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** Lê o corpo da requisição sem confiar nele: null se não tem update_id numérico. */
export function lerUpdateTelegram(corpo: unknown): UpdateTelegram | null {
  if (!ehObjeto(corpo) || typeof corpo.update_id !== 'number' || !Number.isFinite(corpo.update_id)) return null
  const m = corpo.message
  const valida =
    ehObjeto(m) && typeof m.message_id === 'number' && ehObjeto(m.chat) && typeof m.chat.id === 'number' && typeof m.chat.type === 'string'
  return valida
    ? { update_id: corpo.update_id, message: m as MensagemTelegram }
    : { update_id: corpo.update_id }
}

/** O id do bot é o número antes do ':' no token. null sem token ou com formato estranho. */
export function botDoToken(token: string | undefined | null): string | null {
  const achado = /^(\d+):/.exec(token ?? '')
  return achado ? achado[1] : null
}

/** A mensagem é do próprio bot? Com bot.id, compara o id; sem, aceita qualquer is_bot. */
export function ehDoBot(u: UsuarioTelegram | undefined, bot: BotTelegram): boolean {
  if (!u) return false
  if (bot.id) return String(u.id) === bot.id
  return u.is_bot === true
}

/**
 * A pessoa chamou o bot? Legenda com /enviar (sem sufixo, ou com @ igual a
 * bot.username; com bot.username nulo, aceita qualquer sufixo), legenda com
 * @bot.username (sem diferenciar maiúsculas), ou resposta a uma mensagem do bot.
 */
export function chamouOBot(m: MensagemTelegram, bot: BotTelegram): boolean {
  if (ehDoBot(m.reply_to_message?.from, bot)) return true
  const legenda = m.caption ?? ''
  const usuario = bot.username?.toLowerCase() ?? null
  const comando = /(?:^|\s)\/enviar(?:@(\w+))?(?=\s|$)/i.exec(legenda)
  if (comando && (!comando[1] || !usuario || comando[1].toLowerCase() === usuario)) return true
  if (usuario) {
    const menciona = new RegExp(`(?:^|[^\\w])@${usuario.replace(/[^\w]/g, '')}(?![\\w])`, 'i')
    if (menciona.test(legenda)) return true
  }
  return false
}

const ehEnvio = (m: MensagemTelegram) => !!m.document || (Array.isArray(m.photo) && m.photo.length > 0)

// Sem `from` também conta como anônimo: sem ele não há de quem é o envio, e o
// id do chat (o grupo) nunca pode virar remetente nem pedido de acesso.
function ehAnonimo(m: MensagemTelegram): boolean {
  return !m.from || !!m.sender_chat || m.from.is_bot === true || m.from.id === ID_ADMIN_ANONIMO
}

/**
 * Filtro barato, ANTES de consultar o banco: diz se a mensagem merece contexto
 * e quais chaves consultar. No grupo, só é relevante: migrate_to_chat_id, o bot
 * entre os new_chat_members, documento ou foto com chamouOBot, e texto em
 * resposta a uma mensagem do bot. remetenteId é null para anônimo e canal.
 */
export function lerIdentidade(u: UpdateTelegram, bot: BotTelegram, adminChatId: string): Identidade {
  const m = u.message
  if (!m) return { relevante: false, motivo: 'sem_mensagem' }
  if (m.chat.type === 'channel') return { relevante: false, motivo: 'canal' }
  const chatId = String(m.chat.id)
  if (m.chat.type === 'private') {
    return { relevante: true, tipoChat: 'privado', chatId, remetenteId: String(m.from?.id ?? m.chat.id) }
  }
  if (m.migrate_to_chat_id !== undefined) return { relevante: true, tipoChat: 'grupo', chatId, remetenteId: null }
  if (chatId === adminChatId) return { relevante: false, motivo: 'grupo_admin' }
  const botEntrou = !!bot.id && (m.new_chat_members ?? []).some((x) => String(x.id) === bot.id)
  const envioChamado = ehEnvio(m) && chamouOBot(m, bot)
  const textoRespondido = !ehEnvio(m) && ehDoBot(m.reply_to_message?.from, bot)
  if (!botEntrou && !envioChamado && !textoRespondido) return { relevante: false, motivo: 'sem_chamada' }
  const remetenteId = m.from && !ehAnonimo(m) ? String(m.from.id) : null
  return { relevante: true, tipoChat: 'grupo', chatId, remetenteId }
}

/** Mesmo saneamento do nó de hoje: `${empresaId}/telegram/${updateId}-${nomeLimpo}`, nome com no máximo 80 caracteres. */
export function caminhoDoArquivo(empresaId: string, updateId: number, nomeArquivo: string): string {
  const limpo = nomeArquivo
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/_+/g, '_')
    .slice(-80)
  return `${empresaId}/telegram/${updateId}-${limpo}`
}

/** Nome do contato criado ao permitir: "Nome (@usuario)", no máximo 120 caracteres. */
export function nomeDoContatoDoPedido(p: { nome: string; telegram_username: string | null }): string {
  return (p.telegram_username ? `${p.nome} (@${p.telegram_username})` : p.nome).slice(0, 120)
}

function nomeDe(u: UsuarioTelegram | undefined): string {
  return [u?.first_name, u?.last_name].filter(Boolean).join(' ') || 'Sem nome'
}

const ehPdf = (d: DocumentoTelegram) =>
  d.mime_type === 'application/pdf' || /\.pdf$/i.test(String(d.file_name ?? ''))

function triar(u: UpdateTelegram, ctx: ContextoTriagem): AcaoTriagem {
  const ignorar = (motivo: MotivoIgnorar): AcaoTriagem => ({ tipo: 'ignorar', motivo })
  const m = u.message
  if (!m) return ignorar('sem_mensagem')
  if (m.chat.type === 'channel') return ignorar('canal')
  const chatId = String(m.chat.id)
  if (m.migrate_to_chat_id !== undefined) return { tipo: 'migrar_grupo', de: chatId, para: String(m.migrate_to_chat_id) }
  if (chatId === ctx.adminChatId) return ignorar('grupo_admin')

  const { contato, grupo } = ctx
  const noGrupo = m.chat.type !== 'private'
  const mensagemId = noGrupo ? m.message_id : null
  const remetenteId = String(m.from?.id ?? m.chat.id)
  const doc = m.document ?? null
  const foto = !doc && Array.isArray(m.photo) && m.photo.length > 0

  // Foto, não PDF, grande demais, texto ou PDF: igual na conversa privada e no grupo.
  const tratarEnvio = (empresaId: string): AcaoTriagem => {
    const resp = (texto: string): AcaoTriagem => ({ tipo: 'responder', empresaId, chatId, responderA: mensagemId, texto, avisoAdmin: null })
    if (!doc) {
      if (foto) return resp(TEXTOS_BOT.FOTO)
      return { tipo: 'resposta_obra', empresaId, chatId, remetenteId, mensagemId, texto: String(m.text ?? '').slice(0, 200) }
    }
    const nomeArquivo = String(doc.file_name || 'documento.pdf')
    if (!ehPdf(doc)) return resp(TEXTOS_BOT.NAO_PDF(nomeArquivo))
    if (Number(doc.file_size || 0) > LIMITE_ARQUIVO_BYTES) return resp(TEXTOS_BOT.GRANDE(nomeArquivo))
    return {
      tipo: 'processar', empresaId, chatId, remetenteId, mensagemId,
      fileId: doc.file_id, nomeArquivo, caminho: caminhoDoArquivo(empresaId, u.update_id, nomeArquivo),
    }
  }

  // Conversa privada
  if (!noGrupo) {
    if (!contato) {
      const nome = m.from?.first_name || 'cliente'
      return {
        tipo: 'responder', empresaId: null, chatId, responderA: null,
        texto: TEXTOS_BOT.NAO_CADASTRADO(nome, chatId), avisoAdmin: TEXTOS_BOT.AVISO_NOVO_CONTATO(nome, chatId),
      }
    }
    if (!contato.ativo) {
      return { tipo: 'responder', empresaId: contato.empresaId, chatId, responderA: null, texto: TEXTOS_BOT.CONTATO_DESATIVADO, avisoAdmin: null }
    }
    return tratarEnvio(contato.empresaId)
  }

  // Grupo
  const ident = lerIdentidade(u, ctx.bot, ctx.adminChatId)
  if (!ident.relevante) return ignorar(ident.motivo)
  const envio = ehEnvio(m)
  const botEntrou = !!ctx.bot.id && (m.new_chat_members ?? []).some((x) => String(x.id) === ctx.bot.id)

  if (ehAnonimo(m)) {
    if (grupo?.status === 'LIBERADO' && envio) {
      return { tipo: 'responder', empresaId: grupo.empresaId, chatId, responderA: m.message_id, texto: TEXTOS_BOT.ANONIMO, avisoAdmin: null }
    }
    return ignorar('anonimo')
  }
  if (botEntrou && grupo) return ignorar('grupo_conhecido')
  if (!grupo) {
    if (contato?.ativo) {
      return {
        tipo: 'registrar_grupo', empresaId: contato.empresaId, telegramChatId: chatId, nome: m.chat.title ?? null,
        responderA: botEntrou ? null : m.message_id, nomeContato: contato.nome || nomeDe(m.from),
      }
    }
    return ignorar('grupo_desconhecido')
  }
  if (grupo.status === 'BLOQUEADO') return ignorar('grupo_bloqueado')
  if (grupo.status === 'PENDENTE') {
    if (contato?.ativo && envio) {
      return { tipo: 'responder', empresaId: grupo.empresaId, chatId, responderA: m.message_id, texto: TEXTOS_BOT.GRUPO_PENDENTE, avisoAdmin: null }
    }
    return ignorar('grupo_pendente')
  }
  // Grupo LIBERADO
  if (contato && contato.ativo && contato.empresaId !== grupo.empresaId) return ignorar('outra_empresa')
  if (contato && !contato.ativo) return ignorar('contato_inativo')
  if (!contato) {
    if (!envio) return ignorar('texto_de_desconhecido')
    if (!ctx.pedido) {
      return {
        tipo: 'pedir_acesso', empresaId: grupo.empresaId, grupoId: grupo.id, chatId, telegramUserId: remetenteId,
        nome: nomeDe(m.from), username: m.from?.username ?? null, responderA: m.message_id, nomeGrupo: grupo.nome,
      }
    }
    if (ctx.pedido.status === 'PENDENTE') return ignorar('pedido_pendente')
    if (ctx.pedido.status === 'RECUSADO') return ignorar('pedido_recusado')
    return ignorar('acesso_removido')
  }
  return tratarEnvio(contato.empresaId)
}

/** A regra. Tabela de casos em 4.3 da spec. Nunca lança. */
export function triarMensagemTelegram(u: UpdateTelegram, ctx: ContextoTriagem): AcaoTriagem {
  try {
    return triar(u, ctx)
  } catch {
    return { tipo: 'ignorar', motivo: 'sem_mensagem' }
  }
}

/**
 * A ação vira os itens do n8n. registrar_grupo e pedir_acesso só geram itens
 * quando a rota de fato criou a linha (criado = true); migrar_grupo e
 * ignorar não geram item.
 */
export function itensDaAcao(acao: AcaoTriagem, efeito?: { criado: boolean }): ItemN8n[] {
  const criado = efeito?.criado === true
  const cliente = (empresaId: string | null, chatId: string, replyTo: number | null, texto: string): ItemN8n => ({
    acao: 'responder', destino: 'CLIENTE', canal: 'TELEGRAM', chat_id: chatId, reply_to: replyTo, texto, opcoes: null,
    contexto: { documentoId: null, empresaId, origem: 'telegram-entrada' },
  })
  const admin = (empresaId: string | null, texto: string): ItemN8n => ({
    acao: 'responder', destino: 'ADMIN', canal: 'TELEGRAM', chat_id: null, reply_to: null, texto, opcoes: null,
    contexto: { documentoId: null, empresaId, origem: 'telegram-entrada' },
  })
  switch (acao.tipo) {
    case 'ignorar':
    case 'migrar_grupo':
      return []
    case 'processar':
      return [{
        acao: 'processar', empresa_id: acao.empresaId, obra_id: null, chat_id: acao.chatId, remetente_id: acao.remetenteId,
        mensagem_id: acao.mensagemId, file_id: acao.fileId, nome_arquivo: acao.nomeArquivo, caminho: acao.caminho,
      }]
    case 'resposta_obra':
      return [{
        acao: 'resposta', empresa_id: acao.empresaId, chat_id: acao.chatId, remetente_id: acao.remetenteId,
        mensagem_id: acao.mensagemId, texto: acao.texto,
      }]
    case 'responder': {
      const itens = [cliente(acao.empresaId, acao.chatId, acao.responderA, acao.texto)]
      if (acao.avisoAdmin) itens.push(admin(acao.empresaId, acao.avisoAdmin))
      return itens
    }
    case 'registrar_grupo':
      if (!criado) return []
      return [
        cliente(acao.empresaId, acao.telegramChatId, acao.responderA, TEXTOS_BOT.GRUPO_REGISTRADO),
        admin(acao.empresaId, TEXTOS_BOT.AVISO_NOVO_GRUPO(acao.nomeContato, acao.nome ?? '', acao.telegramChatId)),
      ]
    case 'pedir_acesso':
      if (!criado) return []
      return [
        cliente(acao.empresaId, acao.chatId, acao.responderA, TEXTOS_BOT.PEDIDO_CRIADO(acao.nome)),
        admin(acao.empresaId, TEXTOS_BOT.AVISO_PEDIDO(acao.nome, acao.username, acao.nomeGrupo ?? '')),
      ]
  }
}
