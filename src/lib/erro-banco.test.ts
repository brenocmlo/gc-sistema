import assert from 'node:assert/strict'
import test from 'node:test'

import { mensagemDeErroBanco, mensagemDeErroHttp } from './erro-banco.ts'

test('mensagemDeErroBanco: cada família do Postgres vira frase de usuário, pelo código ou pelo texto', () => {
  assert.equal(mensagemDeErroBanco({ code: '42501', message: 'new row violates row-level security policy for table "obras"' }), 'Você não tem permissão para fazer isso.')
  assert.equal(mensagemDeErroBanco('permission denied for function atualizar_status_nf_by_id'), 'Você não tem permissão para fazer isso.')
  assert.equal(mensagemDeErroBanco({ code: '23505', message: 'duplicate key value violates unique constraint "clientes_cnpj_key"' }), 'Já existe um registro com esses dados.')
  assert.equal(mensagemDeErroBanco('update or delete on table "obras" violates foreign key constraint "itens_obra_fk" on table "itens"'), 'Não dá para excluir: há outros registros ligados a este.')
  assert.equal(mensagemDeErroBanco('insert or update on table "itens" violates foreign key constraint "itens_obra_fk"'), 'Um registro ligado a este não existe mais. Recarregue a página e tente de novo.')
  assert.equal(mensagemDeErroBanco('null value in column "nome" of relation "clientes" violates not-null constraint'), 'Falta preencher um campo obrigatório.')
  assert.equal(mensagemDeErroBanco('new row for relation "itens" violates check constraint "itens_unidade_check"'), 'Algum valor está fora do permitido. Confira os campos.')
  assert.equal(mensagemDeErroBanco('invalid input syntax for type uuid: "abc"'), 'Algum valor está num formato inválido.')
  assert.equal(mensagemDeErroBanco({ code: '22001', message: 'value too long for type character varying(20)' }), 'Algum texto passou do tamanho máximo.')
  assert.equal(mensagemDeErroBanco('deadlock detected'), 'Outra pessoa mexeu nisso ao mesmo tempo. Tente de novo.')
  assert.equal(mensagemDeErroBanco('canceling statement due to statement timeout'), 'A operação demorou demais e foi interrompida. Tente de novo.')
})

test('mensagemDeErroBanco: sessão, conexão e Storage', () => {
  assert.equal(mensagemDeErroBanco('JWT expired'), 'Sua sessão expirou. Entre de novo.')
  assert.equal(mensagemDeErroBanco('TypeError: fetch failed'), 'Sem conexão com o servidor. Confira a internet e tente de novo.')
  assert.equal(mensagemDeErroBanco('The resource already exists'), 'Já existe um arquivo com esse nome.')
  assert.equal(mensagemDeErroBanco('Payload too large'), 'O arquivo passa do tamanho máximo.')
  assert.equal(mensagemDeErroBanco('mime type application/zip is not supported'), 'Esse tipo de arquivo não é aceito.')
  assert.equal(mensagemDeErroBanco('Object not found'), 'Arquivo não encontrado.')
})

test('mensagemDeErroBanco: frase nossa passa; inglês de sistema desconhecido e vazio viram a genérica', () => {
  assert.equal(mensagemDeErroBanco('Só o admin muda o perfil, a situação ou o e-mail de um usuário'), 'Só o admin muda o perfil, a situação ou o e-mail de um usuário')
  assert.equal(mensagemDeErroBanco({ code: 'P0001', message: 'A empresa precisa de ao menos um admin ativo' }), 'A empresa precisa de ao menos um admin ativo')
  const generica = 'Não foi possível concluir. Tente de novo; se continuar, avise o administrador.'
  assert.equal(mensagemDeErroBanco('relation "foo" does not exist'), generica)
  assert.equal(mensagemDeErroBanco('Internal Server Error'), generica)
  assert.equal(mensagemDeErroBanco(''), generica)
  assert.equal(mensagemDeErroBanco(null), generica)
})

test('mensagemDeErroHttp: sessão, perfil, frase nossa do 400 e erro de banco do 500', () => {
  assert.equal(mensagemDeErroHttp(401, '{"error":"Unauthorized"}'), 'Sua sessão expirou. Entre de novo.')
  assert.equal(mensagemDeErroHttp(403, '{"error":"Forbidden"}'), 'Seu perfil não tem acesso a isto.')
  assert.equal(mensagemDeErroHttp(404, ''), 'Não encontrado. Recarregue a página e tente de novo.')
  assert.equal(mensagemDeErroHttp(400, '{"error":"Escolha uma obra"}'), 'Escolha uma obra')
  assert.equal(mensagemDeErroHttp(500, '{"error":"canceling statement due to statement timeout"}'), 'A operação demorou demais e foi interrompida. Tente de novo.')
  assert.equal(mensagemDeErroHttp(502, '<html><body>Bad Gateway</body></html>'), 'Não foi possível concluir. Tente de novo; se continuar, avise o administrador.')
})
