import test from 'node:test'
import assert from 'node:assert/strict'

import {
  conviteSchema,
  linkDeAcesso,
  mensagemDeErroUsuario,
  senhaSchema,
  situacaoDoUsuario,
  tipoDeLinkValido,
  usuarioPayload,
  usuarioSchema,
} from './usuarios.ts'

test('convite: e-mail normalizado, perfil conhecido, telefone opcional no formato', () => {
  const ok = conviteSchema.safeParse({ nome: ' Ana ', email: ' Ana@Empresa.COM ', perfil: 'comercial', telefone: '' })
  assert.ok(ok.success)
  assert.equal(ok.data.email, 'ana@empresa.com')
  assert.deepEqual(usuarioPayload(ok.data), { nome: 'Ana', perfil: 'comercial', telefone: null })
  assert.equal(conviteSchema.safeParse({ nome: 'Ana', email: 'ana', perfil: 'comercial' }).success, false)
  assert.equal(conviteSchema.safeParse({ nome: 'Ana', email: 'ana@x.com', perfil: 'dono' }).success, false)
  assert.equal(usuarioSchema.safeParse({ nome: 'A', perfil: 'admin' }).success, false)
  assert.equal(usuarioSchema.safeParse({ nome: 'Ana', perfil: 'admin', telefone: '8599999' }).success, false)
  assert.equal(usuarioSchema.safeParse({ nome: 'Ana', perfil: 'admin', telefone: '(85) 99999-1234' }).success, true)
})

test('situação: inativo vence; quem nunca entrou nem confirmou está com o convite pendente', () => {
  assert.equal(situacaoDoUsuario({ ativo: false, ultimo_acesso: '2026-10-01', email_confirmado: true }), 'inativo')
  assert.equal(situacaoDoUsuario({ ativo: true, ultimo_acesso: null, email_confirmado: false }), 'convite_pendente')
  assert.equal(situacaoDoUsuario({ ativo: null, ultimo_acesso: null, email_confirmado: true }), 'ativo')
  assert.equal(situacaoDoUsuario({ ativo: true, ultimo_acesso: '2026-10-01', email_confirmado: false }), 'ativo')
})

test('link de acesso: aponta para /convite do sistema com o token e o tipo', () => {
  assert.equal(linkDeAcesso('https://gc.exemplo.com', 'abc123', 'invite'), 'https://gc.exemplo.com/convite?token_hash=abc123&type=invite')
  assert.equal(linkDeAcesso('http://localhost:3000/', 'x y', 'recovery'), 'http://localhost:3000/convite?token_hash=x+y&type=recovery')
  assert.ok(tipoDeLinkValido('invite') && tipoDeLinkValido('recovery'))
  assert.equal(tipoDeLinkValido('signup'), false)
})

test('senha: mínimo de 8 e confirmação igual', () => {
  assert.equal(senhaSchema.safeParse({ senha: '1234567', confirmacao: '1234567' }).success, false)
  const dif = senhaSchema.safeParse({ senha: '12345678', confirmacao: '12345679' })
  assert.equal(dif.success, false)
  assert.equal(dif.error?.issues[0].path[0], 'confirmacao')
  assert.equal(senhaSchema.safeParse({ senha: '12345678', confirmacao: '12345678' }).success, true)
})

test('erros do banco e do Auth viram mensagem de quem administra', () => {
  assert.equal(mensagemDeErroUsuario('A empresa precisa de ao menos um admin ativo'), 'A empresa precisa de ao menos um admin ativo')
  assert.equal(mensagemDeErroUsuario('duplicate key value violates unique constraint "idx_profiles_email_empresa_unique"'), 'Já existe um usuário com esse e-mail na empresa')
  assert.equal(mensagemDeErroUsuario('A user with this email address has already been registered'), 'Esse e-mail já tem acesso ao sistema')
  assert.equal(mensagemDeErroUsuario('outra coisa'), 'outra coisa')
})
