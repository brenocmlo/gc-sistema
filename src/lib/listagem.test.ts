// Rodar: npm test
//
// Sem runner instalado: `node --test` do Node 24 executa .ts direto (type
// stripping nativo). Por isso o import traz a extensão .ts explícita — o Node
// não resolve extensão nem o alias `@/`.
import assert from 'node:assert/strict'
import test from 'node:test'

import {
  PERIODO_OPTIONS,
  computePeriodoCutoff,
  isRangeForaDoAlcance,
  sanitizeBusca,
  urlSemPagina,
} from './listagem.ts'

const HOJE = new Date('2026-03-15T12:00:00Z')

test('computePeriodoCutoff: 30d volta 30 dias', () => {
  assert.equal(computePeriodoCutoff('30d', HOJE), '2026-02-13')
})

test('computePeriodoCutoff: 90d volta 90 dias', () => {
  assert.equal(computePeriodoCutoff('90d', HOJE), '2025-12-15')
})

test('computePeriodoCutoff: ano começa em 1º de janeiro', () => {
  assert.equal(computePeriodoCutoff('ano', HOJE), '2026-01-01')
})

test('computePeriodoCutoff: vazio e valor desconhecido não filtram', () => {
  // A querystring é input externo: qualquer coisa fora das três opções tem
  // que virar "sem filtro", nunca um cutoff inventado.
  assert.equal(computePeriodoCutoff('', HOJE), null)
  assert.equal(computePeriodoCutoff('30D', HOJE), null)
  assert.equal(computePeriodoCutoff('semana', HOJE), null)
})

test('computePeriodoCutoff: não muta a data recebida', () => {
  const d = new Date(HOJE)
  computePeriodoCutoff('30d', d)
  assert.equal(d.getTime(), HOJE.getTime())
})

test('PERIODO_OPTIONS: a primeira opção é "todos" com value vazio', () => {
  assert.equal(PERIODO_OPTIONS[0]?.value, '')
  assert.deepEqual(
    PERIODO_OPTIONS.map((o) => o.value),
    ['', '30d', '90d', 'ano'],
  )
})

test('sanitizeBusca: remove o que quebra o parser do .or()', () => {
  // Vírgula separa filtros e parêntese delimita o in.(...) — se passarem
  // direto, a query inteira falha em vez de não achar nada.
  assert.equal(sanitizeBusca('PROP-001, obra'), 'PROP-001 obra')
  assert.equal(sanitizeBusca('in.(1)'), 'in.1')
  assert.equal(sanitizeBusca('"aspas"'), 'aspas')
})

test('sanitizeBusca: preserva acento, hífen e barra', () => {
  assert.equal(sanitizeBusca('  Edifício São João / 2ª etapa  '), 'Edifício São João / 2ª etapa')
})

test('isRangeForaDoAlcance reconhece só o PGRST103', () => {
  assert.equal(isRangeForaDoAlcance({ code: 'PGRST103' }), true)
  assert.equal(isRangeForaDoAlcance({ code: 'PGRST116' }), false)
  assert.equal(isRangeForaDoAlcance(null), false)
  assert.equal(isRangeForaDoAlcance(undefined), false)
})

test('urlSemPagina preserva filtros e descarta a página', () => {
  assert.equal(
    urlSemPagina('/propostas', {
      busca: 'aurora',
      status: 'enviada',
      page: '99',
      periodo: '',
    }),
    '/propostas?busca=aurora&status=enviada',
  )
})

test('urlSemPagina sem filtro nenhum devolve a rota limpa', () => {
  assert.equal(urlSemPagina('/propostas', { page: '9' }), '/propostas')
})
