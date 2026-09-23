// Rodar: npm test
import assert from 'node:assert/strict'
import test from 'node:test'

import {
  ENTIDADE_OPTIONS,
  camposAlterados,
  filtroBuscaAuditoria,
  formatarValorAuditoria,
  hrefDoRegistro,
  isAcaoDoTrigger,
  isEntidadeAuditada,
  isOrigemEvento,
  isResultadoEvento,
  labelAcao,
  labelAutor,
  labelEntidade,
  linhaDoEvento,
  resumoEvento,
} from './auditoria.ts'

const UUID = '3f2b8c1e-9a4d-4e6f-8b2a-1c3d5e7f9a0b'

test('filtros da URL: só valores conhecidos passam', () => {
  assert.equal(isOrigemEvento('automacao'), true)
  assert.equal(isOrigemEvento('prod'), false)
  assert.equal(isResultadoEvento('erro'), true)
  assert.equal(isResultadoEvento('falha'), false)
  assert.equal(isEntidadeAuditada('propostas'), true)
  assert.equal(isEntidadeAuditada('toString'), false, 'propriedade herdada não é entidade')
  assert.equal(isAcaoDoTrigger('status'), true)
  assert.equal(isAcaoDoTrigger('constructor'), false)
})

test('a lista de entidades cobre as 15 tabelas do trigger', () => {
  // Mesma lista do `foreach` da migration 019. Tabela nova no trigger sem
  // rótulo aqui apareceria crua no filtro.
  assert.deepEqual(
    ENTIDADE_OPTIONS.map((o) => o.value).sort(),
    [
      'acordo_parcelas', 'acordos_pagamento', 'clientes', 'contatos_whatsapp',
      'contratos', 'documentos_processamento', 'execucao', 'fd', 'itens',
      'notas_fiscais', 'obras', 'orcamentos', 'pagamentos', 'profiles', 'propostas',
    ],
  )
})

test('rótulo desconhecido aparece cru, não some', () => {
  assert.equal(labelEntidade('propostas'), 'Proposta')
  assert.equal(labelEntidade('ingestao'), 'ingestao')
  assert.equal(labelAcao('status'), 'Mudança de status')
  assert.equal(labelAcao('processar_documento'), 'processar_documento')
})

test('labelAutor: profile, removido, papel do banco e vazio', () => {
  const autores = new Map([['u1', 'Leticia']])
  assert.equal(labelAutor({ autor_id: 'u1', autor_descricao: null }, autores), 'Leticia')
  assert.equal(labelAutor({ autor_id: 'u9', autor_descricao: null }, autores), 'usuário removido')
  assert.equal(
    labelAutor({ autor_id: null, autor_descricao: 'service_role' }, autores),
    'Automação (chave de serviço)',
  )
  assert.equal(labelAutor({ autor_id: null, autor_descricao: 'postgres' }, autores), 'Banco (SQL direto)')
  assert.equal(labelAutor({ autor_id: null, autor_descricao: 'telegram:-100' }, autores), 'telegram:-100')
  assert.equal(labelAutor({ autor_id: null, autor_descricao: null }, autores), '—')
})

test('filtroBuscaAuditoria: uuid procura o registro, texto procura referência, mensagem e autor', () => {
  assert.equal(filtroBuscaAuditoria(''), null)
  assert.equal(filtroBuscaAuditoria('   '), null)
  assert.equal(filtroBuscaAuditoria(UUID.toUpperCase()), `registro_id.eq.${UUID}`)
  assert.equal(
    filtroBuscaAuditoria('cota'),
    'referencia.ilike.%cota%,mensagem.ilike.%cota%,autor_descricao.ilike.%cota%',
  )
})

test('camposAlterados: lê o diff do trigger em ordem alfabética', () => {
  const detalhe = {
    campos: {
      status: { de: 'rascunho', para: 'enviada' },
      desconto: { de: 0, para: 100 },
    },
  }
  assert.deepEqual(camposAlterados(detalhe), [
    { campo: 'desconto', de: 0, para: 100 },
    { campo: 'status', de: 'rascunho', para: 'enviada' },
  ])
})

test('camposAlterados e linhaDoEvento toleram formato inesperado', () => {
  for (const ruim of [null, undefined, 'x', 42, [], { campos: [] }, { campos: null }]) {
    assert.deepEqual(camposAlterados(ruim), [])
  }
  assert.deepEqual(camposAlterados({ campos: { x: 5 } }), [{ campo: 'x', de: null, para: 5 }])
  assert.equal(linhaDoEvento({ campos: {} }), null)
  assert.equal(linhaDoEvento({ linha: [] }), null)
  assert.deepEqual(linhaDoEvento({ linha: { id: 'a' } }), { id: 'a' })
})

test('formatarValorAuditoria', () => {
  assert.equal(formatarValorAuditoria(null), '—')
  assert.equal(formatarValorAuditoria(''), '—')
  assert.equal(formatarValorAuditoria(true), 'sim')
  assert.equal(formatarValorAuditoria(false), 'não')
  assert.equal(formatarValorAuditoria(0), '0')
  assert.equal(formatarValorAuditoria({ a: 1 }), '{"a":1}')
})

test('resumoEvento: mensagem, status, campos, identificador', () => {
  assert.equal(resumoEvento({ acao: 'x', mensagem: 'cota do Gemini', detalhe: null }), 'cota do Gemini')
  assert.equal(
    resumoEvento({ acao: 'status', mensagem: null, detalhe: { campos: { status: { de: 'rascunho', para: 'enviada' }, x: { de: 1, para: 2 } } } }),
    'status: rascunho → enviada',
  )
  assert.equal(resumoEvento({ acao: 'editar', mensagem: null, detalhe: { campos: { desconto: { de: 0, para: 1 } } } }), 'desconto alterado')
  assert.equal(
    resumoEvento({ acao: 'editar', mensagem: null, detalhe: { campos: { a: { de: 0, para: 1 }, b: { de: 0, para: 1 } } } }),
    '2 campos alterados',
  )
  assert.equal(resumoEvento({ acao: 'criar', mensagem: null, detalhe: { linha: { numero: 'P-9' } } }), 'registro criado')
  assert.equal(resumoEvento({ acao: 'excluir', mensagem: null, detalhe: null }), 'registro excluído')
  assert.equal(resumoEvento({ acao: 'processar_documento', mensagem: null, detalhe: null }), '—')
})

test('hrefDoRegistro: só para tela de detalhe que existe e registro que não foi excluído', () => {
  assert.equal(hrefDoRegistro({ entidade: 'propostas', registro_id: UUID, acao: 'editar' }), `/propostas/${UUID}`)
  assert.equal(hrefDoRegistro({ entidade: 'propostas', registro_id: UUID, acao: 'excluir' }), null)
  assert.equal(hrefDoRegistro({ entidade: 'itens', registro_id: UUID, acao: 'criar' }), null)
  assert.equal(hrefDoRegistro({ entidade: 'propostas', registro_id: null, acao: 'criar' }), null)
})
