import test from 'node:test'
import assert from 'node:assert/strict'

import {
  contatoSchema,
  contatoToFormValues,
  emptyContatoFormValues,
  formValuesToPayload,
  identificadorDoContato,
  mensagemDeErroContato,
  normalizarChatId,
  rotuloCanal,
} from './contatos.ts'

test('normalizarChatId tira espaço', () => {
  assert.equal(normalizarChatId(' 884 349 214 '), '884349214')
  assert.equal(normalizarChatId(null), '')
})

test('schema aceita código numérico e obra', () => {
  const r = contatoSchema.safeParse({ nome: 'Lúcio', telegram_chat_id: '884349214', obra_id: 'obra-1' })
  assert.equal(r.success, true)
  if (r.success) assert.equal(r.data.telegram_chat_id, '884349214')
})

test('schema aceita código colado com espaço', () => {
  const r = contatoSchema.safeParse({ telegram_chat_id: '884 349 214', obra_id: 'obra-1' })
  assert.ok(r.success && r.data.telegram_chat_id === '884349214')
})

test('schema recusa código vazio, com letra ou curto demais', () => {
  for (const v of ['', 'abc123', '12a45678', '1234']) {
    const r = contatoSchema.safeParse({ telegram_chat_id: v, obra_id: 'obra-1' })
    assert.equal(r.success, false, `deveria recusar ${JSON.stringify(v)}`)
  }
})

test('schema exige obra', () => {
  const r = contatoSchema.safeParse({ telegram_chat_id: '884349214', obra_id: '' })
  assert.equal(r.success, false)
  if (!r.success) assert.match(r.error.issues.map((i) => i.message).join(' '), /Escolha a obra/)
})

test('schema aceita chat_id de grupo (negativo)', () => {
  assert.equal(contatoSchema.safeParse({ telegram_chat_id: '-5521155438', obra_id: 'o' }).success, true)
})

test('formValuesToPayload: sempre Telegram, nome vazio vira null, telefone null', () => {
  assert.deepEqual(formValuesToPayload({ nome: '  ', telegram_chat_id: ' 884349214', obra_id: 'o' }), {
    canal: 'TELEGRAM',
    telegram_chat_id: '884349214',
    telefone: null,
    obra_id: 'o',
    nome: null,
  })
})

test('ida e volta do formulário', () => {
  const item = { id: '1', nome: 'Lúcio', canal: 'TELEGRAM', telegram_chat_id: '884349214', telefone: null, obra_id: 'o', created_at: null, obra: null }
  assert.deepEqual(contatoToFormValues(item), { nome: 'Lúcio', telegram_chat_id: '884349214', obra_id: 'o' })
  assert.deepEqual(emptyContatoFormValues(), { nome: '', telegram_chat_id: '', obra_id: '' })
})

test('identificador: código no Telegram, telefone no WhatsApp', () => {
  assert.equal(identificadorDoContato({ canal: 'TELEGRAM', telegram_chat_id: '884349214', telefone: null }), '884349214')
  assert.equal(identificadorDoContato({ canal: 'WHATSAPP', telegram_chat_id: null, telefone: '5585988335991' }), '5585988335991')
  assert.equal(identificadorDoContato({ canal: 'TELEGRAM', telegram_chat_id: null, telefone: null }), '—')
})

test('rotuloCanal', () => {
  assert.equal(rotuloCanal('TELEGRAM'), 'Telegram')
  assert.equal(rotuloCanal('WHATSAPP'), 'WhatsApp (desativado)')
  assert.equal(rotuloCanal('OUTRO'), 'OUTRO')
})

test('mensagemDeErroContato traduz as constraints', () => {
  assert.equal(mensagemDeErroContato('duplicate key value violates unique constraint "idx_contatos_chat_id_telegram"'), 'Esse código já está cadastrado')
  assert.equal(mensagemDeErroContato('violates check constraint "contatos_whatsapp_identidade_do_canal"'), 'Informe o código do Telegram')
  assert.equal(mensagemDeErroContato('violates foreign key constraint "contatos_whatsapp_obra_fk"'), 'Obra inválida para esta empresa')
  assert.equal(mensagemDeErroContato('outro erro'), 'outro erro')
})
