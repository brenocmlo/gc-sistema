import test from 'node:test'
import assert from 'node:assert/strict'

import {
  TEXTOS_BOT,
  botDoToken,
  caminhoDoArquivo,
  chamouOBot,
  itensDaAcao,
  lerIdentidade,
  lerUpdateTelegram,
  nomeDoContatoDoPedido,
  triarMensagemTelegram,
  type AcaoTriagem,
  type ContextoTriagem,
  type MensagemTelegram,
  type UpdateTelegram,
} from './bot-acesso.ts'

const BOT = { id: '777', username: 'ObraBot' }
const ADMIN = '-5521155438'
const GRUPO_ID = -100123
const PESSOA = { id: 42, first_name: 'Ana', last_name: 'Lima', username: 'ana' }
const EMPRESA = 'emp-1'

const contatoOk = { id: 'c1', empresaId: EMPRESA, nome: 'Ana (obra)', ativo: true }
const grupoOk = (status: 'PENDENTE' | 'LIBERADO' | 'BLOQUEADO' = 'LIBERADO') => ({ id: 'g1', empresaId: EMPRESA, nome: 'Equipe', status })
const PDF = { file_id: 'f1', file_name: 'Proposta Açaí+1.pdf', mime_type: 'application/pdf', file_size: 1000 }

function ctx(p: Partial<ContextoTriagem> = {}): ContextoTriagem {
  return { bot: BOT, adminChatId: ADMIN, contato: null, grupo: null, pedido: null, ...p }
}
function upd(m: Partial<MensagemTelegram>, tipo: 'private' | 'group' | 'supergroup' | 'channel' = 'supergroup'): UpdateTelegram {
  const id = tipo === 'private' ? PESSOA.id : GRUPO_ID
  return { update_id: 900, message: { message_id: 7, from: PESSOA, chat: { id: id, type: tipo, title: 'Equipe' }, ...m } }
}
const chamado = { caption: '/enviar' }
const tria = (u: UpdateTelegram, c: ContextoTriagem) => triarMensagemTelegram(u, c)
const ignora = (a: AcaoTriagem, motivo: string) => assert.deepEqual(a, { tipo: 'ignorar', motivo })

// ---------- Antes de tudo ----------

test('T1 update sem message', () => ignora(tria({ update_id: 1 }, ctx()), 'sem_mensagem'))
test('T2 canal', () => ignora(tria(upd({}, 'channel'), ctx()), 'canal'))
test('T3 migração de grupo', () => {
  assert.deepEqual(tria(upd({ migrate_to_chat_id: -100999 }, 'group'), ctx()), { tipo: 'migrar_grupo', de: String(GRUPO_ID), para: '-100999' })
})
test('T4 grupo de admin é ignorado', () => {
  const u = upd({ document: PDF, ...chamado })
  u.message!.chat.id = Number(ADMIN)
  ignora(tria(u, ctx({ contato: contatoOk })), 'grupo_admin')
  assert.deepEqual(lerIdentidade(u, BOT, ADMIN), { relevante: false, motivo: 'grupo_admin' })
})

// ---------- Conversa privada ----------

test('P1 contato nulo recebe o código e avisa o admin', () => {
  const a = tria(upd({ text: 'oi' }, 'private'), ctx())
  assert.deepEqual(a, {
    tipo: 'responder', empresaId: null, chatId: '42', responderA: null,
    texto: TEXTOS_BOT.NAO_CADASTRADO('Ana', '42'), avisoAdmin: TEXTOS_BOT.AVISO_NOVO_CONTATO('Ana', '42'),
  })
})
test('P2 contato desativado', () => {
  const a = tria(upd({ document: PDF }, 'private'), ctx({ contato: { ...contatoOk, ativo: false } }))
  assert.equal(a.tipo, 'responder')
  if (a.tipo === 'responder') {
    assert.equal(a.texto, TEXTOS_BOT.CONTATO_DESATIVADO)
    assert.equal(a.avisoAdmin, null)
  }
})
test('P3 foto', () => {
  const a = tria(upd({ photo: [{}] }, 'private'), ctx({ contato: contatoOk }))
  assert.equal(a.tipo === 'responder' && a.texto, TEXTOS_BOT.FOTO)
})
test('P4 texto vira resposta_obra, cortado em 200 e sem citação', () => {
  const a = tria(upd({ text: 'x'.repeat(300) }, 'private'), ctx({ contato: contatoOk }))
  assert.equal(a.tipo, 'resposta_obra')
  if (a.tipo === 'resposta_obra') {
    assert.equal(a.texto.length, 200)
    assert.equal(a.mensagemId, null)
    assert.equal(a.remetenteId, '42')
  }
})
test('P5 documento que não é PDF', () => {
  const a = tria(upd({ document: { file_id: 'f', file_name: 'a.docx', mime_type: 'application/msword' } }, 'private'), ctx({ contato: contatoOk }))
  assert.equal(a.tipo === 'responder' && a.texto, TEXTOS_BOT.NAO_PDF('a.docx'))
})
test('P6 PDF acima de 20 MB', () => {
  const a = tria(upd({ document: { ...PDF, file_size: 21 * 1024 * 1024 } }, 'private'), ctx({ contato: contatoOk }))
  assert.equal(a.tipo === 'responder' && a.texto, TEXTOS_BOT.GRANDE(PDF.file_name))
})
test('P7 PDF vira processar, sem mensagemId', () => {
  const a = tria(upd({ document: PDF }, 'private'), ctx({ contato: contatoOk }))
  assert.deepEqual(a, {
    tipo: 'processar', empresaId: EMPRESA, chatId: '42', remetenteId: '42', mensagemId: null,
    fileId: 'f1', nomeArquivo: PDF.file_name, caminho: `${EMPRESA}/telegram/900-Proposta_Acai_1.pdf`,
  })
})

// ---------- Grupo ----------

test('G1 conversa, foto ou PDF sem chamar o bot: sem chamada', () => {
  const c = ctx({ contato: contatoOk, grupo: grupoOk() })
  ignora(tria(upd({ text: 'bom dia' }), c), 'sem_chamada')
  ignora(tria(upd({ photo: [{}] }), c), 'sem_chamada')
  ignora(tria(upd({ document: PDF, caption: 'segue' }), c), 'sem_chamada')
  assert.deepEqual(lerIdentidade(upd({ text: 'oi' }), BOT, ADMIN), { relevante: false, motivo: 'sem_chamada' })
})
test('G2 anônimo com grupo liberado e envio recebe aviso', () => {
  const u = upd({ document: PDF, ...chamado })
  u.message!.sender_chat = { id: GRUPO_ID, type: 'supergroup' }
  const a = tria(u, ctx({ grupo: grupoOk() }))
  assert.equal(a.tipo === 'responder' && a.texto, TEXTOS_BOT.ANONIMO)
  assert.equal(a.tipo === 'responder' && a.responderA, 7)
})
test('G3 anônimo em qualquer outro caso é ignorado', () => {
  const u = upd({ document: PDF, ...chamado })
  u.message!.from = { id: 1087968824, is_bot: true, first_name: 'Group' }
  ignora(tria(u, ctx({ grupo: grupoOk('PENDENTE') })), 'anonimo')
  ignora(tria(u, ctx()), 'anonimo')
  assert.equal(lerIdentidade(u, BOT, ADMIN).relevante && (lerIdentidade(u, BOT, ADMIN) as { remetenteId: string | null }).remetenteId, null)
})
test('G3 mensagem de grupo sem from é anônima e não vira pedido com o id do grupo', () => {
  const u = upd({ document: PDF, ...chamado })
  delete u.message!.from
  const id = lerIdentidade(u, BOT, ADMIN)
  assert.equal(id.relevante && id.remetenteId, null)
  const a = tria(u, ctx({ grupo: grupoOk() }))
  assert.equal(a.tipo === 'responder' && a.texto, TEXTOS_BOT.ANONIMO)
  ignora(tria(u, ctx({ grupo: grupoOk('PENDENTE') })), 'anonimo')
})
const entradaDoBot = () => upd({ new_chat_members: [{ id: 777, is_bot: true }] })
test('G4 bot entra em grupo já registrado', () => {
  ignora(tria(entradaDoBot(), ctx({ contato: contatoOk, grupo: grupoOk('PENDENTE') })), 'grupo_conhecido')
})
test('G5 grupo novo com contato ativo vira registrar_grupo (entrada e envio)', () => {
  const porEntrada = tria(entradaDoBot(), ctx({ contato: contatoOk }))
  assert.deepEqual(porEntrada, { tipo: 'registrar_grupo', empresaId: EMPRESA, telegramChatId: String(GRUPO_ID), nome: 'Equipe', responderA: null, nomeContato: 'Ana (obra)' })
  const porEnvio = tria(upd({ document: PDF, ...chamado }), ctx({ contato: contatoOk }))
  assert.equal(porEnvio.tipo === 'registrar_grupo' && porEnvio.responderA, 7)
})
test('G6 grupo novo sem contato ativo é ignorado', () => {
  ignora(tria(upd({ document: PDF, ...chamado }), ctx()), 'grupo_desconhecido')
  ignora(tria(upd({ document: PDF, ...chamado }), ctx({ contato: { ...contatoOk, ativo: false } })), 'grupo_desconhecido')
})
test('G7 grupo bloqueado', () => {
  ignora(tria(upd({ document: PDF, ...chamado }), ctx({ contato: contatoOk, grupo: grupoOk('BLOQUEADO') })), 'grupo_bloqueado')
})
test('G8 grupo pendente, contato ativo e envio: avisa em citação', () => {
  const a = tria(upd({ document: PDF, ...chamado }), ctx({ contato: contatoOk, grupo: grupoOk('PENDENTE') }))
  assert.equal(a.tipo === 'responder' && a.texto, TEXTOS_BOT.GRUPO_PENDENTE)
  assert.equal(a.tipo === 'responder' && a.responderA, 7)
})
test('G9 grupo pendente em qualquer outro caso', () => {
  ignora(tria(upd({ document: PDF, ...chamado }), ctx({ grupo: grupoOk('PENDENTE') })), 'grupo_pendente')
})
test('G10 contato de outra empresa', () => {
  ignora(tria(upd({ document: PDF, ...chamado }), ctx({ contato: { ...contatoOk, empresaId: 'outra' }, grupo: grupoOk() })), 'outra_empresa')
})
test('G11 contato inativo no grupo: silêncio', () => {
  ignora(tria(upd({ document: PDF, ...chamado }), ctx({ contato: { ...contatoOk, ativo: false }, grupo: grupoOk() })), 'contato_inativo')
})
test('G12 contato nulo, texto', () => {
  const u = upd({ text: 'obra X', reply_to_message: { message_id: 3, from: { id: 777, is_bot: true } } })
  ignora(tria(u, ctx({ grupo: grupoOk() })), 'texto_de_desconhecido')
})
test('G13 contato nulo, envio, pedido nulo: pedir_acesso', () => {
  const a = tria(upd({ document: PDF, ...chamado }), ctx({ grupo: grupoOk() }))
  assert.deepEqual(a, {
    tipo: 'pedir_acesso', empresaId: EMPRESA, grupoId: 'g1', chatId: String(GRUPO_ID), telegramUserId: '42',
    nome: 'Ana Lima', username: 'ana', responderA: 7, nomeGrupo: 'Equipe',
  })
})
test('G14 pedido pendente', () => {
  ignora(tria(upd({ document: PDF, ...chamado }), ctx({ grupo: grupoOk(), pedido: { id: 'p', status: 'PENDENTE' } })), 'pedido_pendente')
})
test('G15 pedido recusado', () => {
  ignora(tria(upd({ document: PDF, ...chamado }), ctx({ grupo: grupoOk(), pedido: { id: 'p', status: 'RECUSADO' } })), 'pedido_recusado')
})
test('G16 pedido aprovado e contato apagado', () => {
  ignora(tria(upd({ document: PDF, ...chamado }), ctx({ grupo: grupoOk(), pedido: { id: 'p', status: 'APROVADO' } })), 'acesso_removido')
})
test('G17 texto em resposta ao bot vira resposta_obra com mensagemId', () => {
  const u = upd({ text: 'Obra Centro', reply_to_message: { message_id: 3, from: { id: 777, is_bot: true } } })
  const a = tria(u, ctx({ contato: contatoOk, grupo: grupoOk() }))
  assert.deepEqual(a, { tipo: 'resposta_obra', empresaId: EMPRESA, chatId: String(GRUPO_ID), remetenteId: '42', mensagemId: 7, texto: 'Obra Centro' })
})
test('G18 foto chamando o bot, em citação', () => {
  const a = tria(upd({ photo: [{}], ...chamado }), ctx({ contato: contatoOk, grupo: grupoOk() }))
  assert.equal(a.tipo === 'responder' && a.texto, TEXTOS_BOT.FOTO)
  assert.equal(a.tipo === 'responder' && a.responderA, 7)
})
test('G19 documento que não é PDF, em citação', () => {
  const a = tria(upd({ document: { file_id: 'f', file_name: 'a.xlsx' }, ...chamado }), ctx({ contato: contatoOk, grupo: grupoOk() }))
  assert.equal(a.tipo === 'responder' && a.texto, TEXTOS_BOT.NAO_PDF('a.xlsx'))
  assert.equal(a.tipo === 'responder' && a.responderA, 7)
})
test('G20 PDF acima do limite, em citação', () => {
  const a = tria(upd({ document: { ...PDF, file_size: 30 * 1024 * 1024 }, ...chamado }), ctx({ contato: contatoOk, grupo: grupoOk() }))
  assert.equal(a.tipo === 'responder' && a.texto, TEXTOS_BOT.GRANDE(PDF.file_name))
})
test('G21 PDF liberado vira processar no grupo, com mensagemId', () => {
  const a = tria(upd({ document: PDF, caption: '/enviar@obrabot' }), ctx({ contato: contatoOk, grupo: grupoOk() }))
  assert.deepEqual(a, {
    tipo: 'processar', empresaId: EMPRESA, chatId: String(GRUPO_ID), remetenteId: '42', mensagemId: 7,
    fileId: 'f1', nomeArquivo: PDF.file_name, caminho: `${EMPRESA}/telegram/900-Proposta_Acai_1.pdf`,
  })
})
test('PDF em resposta ao bot (sem legenda) também é chamada', () => {
  const u = upd({ document: PDF, reply_to_message: { message_id: 3, from: { id: 777, is_bot: true } } })
  assert.equal(tria(u, ctx({ contato: contatoOk, grupo: grupoOk() })).tipo, 'processar')
})
test('triarMensagemTelegram nunca lança', () => {
  const lixo = { update_id: 1, message: { chat: null } } as unknown as UpdateTelegram
  assert.equal(tria(lixo, ctx()).tipo, 'ignorar')
})

// ---------- Auxiliares ----------

test('chamouOBot: /enviar, /enviar@bot, outro bot, menção, resposta', () => {
  const m = (p: Partial<MensagemTelegram>) => upd({ document: PDF, ...p }).message!
  assert.equal(chamouOBot(m({ caption: '/enviar' }), BOT), true)
  assert.equal(chamouOBot(m({ caption: '/enviar@ObraBot proposta' }), BOT), true)
  assert.equal(chamouOBot(m({ caption: '/enviar@outrobot' }), BOT), false)
  assert.equal(chamouOBot(m({ caption: '/enviar@outrobot' }), { id: null, username: null }), true)
  assert.equal(chamouOBot(m({ caption: 'veja @OBRABOT' }), BOT), true)
  assert.equal(chamouOBot(m({ caption: 'veja @obrabot2' }), BOT), false)
  assert.equal(chamouOBot(m({ caption: 'segue' }), BOT), false)
  assert.equal(chamouOBot(m({ reply_to_message: { message_id: 1, from: { id: 777, is_bot: true } } }), BOT), true)
  assert.equal(chamouOBot(m({ reply_to_message: { message_id: 1, from: { id: 5 } } }), BOT), false)
})

test('lerIdentidade: privado e remetente', () => {
  assert.deepEqual(lerIdentidade(upd({ text: 'oi' }, 'private'), BOT, ADMIN), { relevante: true, tipoChat: 'privado', chatId: '42', remetenteId: '42' })
  assert.deepEqual(lerIdentidade(upd({ document: PDF, ...chamado }), BOT, ADMIN), { relevante: true, tipoChat: 'grupo', chatId: String(GRUPO_ID), remetenteId: '42' })
})

test('lerUpdateTelegram só aceita update_id numérico', () => {
  assert.equal(lerUpdateTelegram(null), null)
  assert.equal(lerUpdateTelegram({ message: {} }), null)
  assert.deepEqual(lerUpdateTelegram({ update_id: 5, message: { foo: 1 } }), { update_id: 5 })
  assert.equal(lerUpdateTelegram(upd({ text: 'a' }))?.message?.message_id, 7)
})

test('botDoToken', () => {
  assert.equal(botDoToken('123456:ABC-def'), '123456')
  assert.equal(botDoToken(undefined), null)
  assert.equal(botDoToken('sem-dois-pontos'), null)
})

test('caminhoDoArquivo higieniza acento, + e espaço, e limita a 80 caracteres', () => {
  assert.equal(caminhoDoArquivo('e1', 5, 'Proposta Açaí+1 final.pdf'), 'e1/telegram/5-Proposta_Acai_1_final.pdf')
  const longo = caminhoDoArquivo('e1', 5, 'a'.repeat(200) + '.pdf')
  assert.equal(longo.replace('e1/telegram/5-', '').length, 80)
  assert.ok(longo.endsWith('.pdf'))
})

test('nomeDoContatoDoPedido', () => {
  assert.equal(nomeDoContatoDoPedido({ nome: 'Ana Lima', telegram_username: 'ana' }), 'Ana Lima (@ana)')
  assert.equal(nomeDoContatoDoPedido({ nome: 'Ana Lima', telegram_username: null }), 'Ana Lima')
  assert.equal(nomeDoContatoDoPedido({ nome: 'x'.repeat(200), telegram_username: 'ana' }).length, 120)
})

test('itensDaAcao: criado false não gera item; avisoAdmin gera o item ADMIN', () => {
  const pedir = tria(upd({ document: PDF, ...chamado }), ctx({ grupo: grupoOk() }))
  assert.deepEqual(itensDaAcao(pedir), [])
  assert.deepEqual(itensDaAcao(pedir, { criado: false }), [])
  const itens = itensDaAcao(pedir, { criado: true })
  assert.equal(itens.length, 2)
  assert.deepEqual(itens.map((i) => i.acao === 'responder' && i.destino), ['CLIENTE', 'ADMIN'])
  assert.equal(itens[0].acao === 'responder' && itens[0].reply_to, 7)
  assert.equal(itens[1].acao === 'responder' && itens[1].chat_id, null)

  const registrar = tria(entradaDoBot(), ctx({ contato: contatoOk }))
  assert.equal(itensDaAcao(registrar, { criado: true }).length, 2)
  assert.deepEqual(itensDaAcao(registrar), [])

  const naoCadastrado = tria(upd({ text: 'oi' }, 'private'), ctx())
  assert.deepEqual(itensDaAcao(naoCadastrado).map((i) => i.acao === 'responder' && i.destino), ['CLIENTE', 'ADMIN'])

  assert.deepEqual(itensDaAcao({ tipo: 'ignorar', motivo: 'canal' }), [])
  assert.deepEqual(itensDaAcao({ tipo: 'migrar_grupo', de: '1', para: '2' }), [])
  const proc = tria(upd({ document: PDF }, 'private'), ctx({ contato: contatoOk }))
  const [item] = itensDaAcao(proc)
  assert.equal(item.acao === 'processar' && item.obra_id, null)
})
