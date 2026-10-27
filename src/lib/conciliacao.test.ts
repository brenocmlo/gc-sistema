import assert from 'node:assert/strict'
import test from 'node:test'

import {
  bate,
  conciliar,
  conciliarLinha,
  conferirStatusNf,
  entradasPorObra,
  formatarValor,
  resumoDaConciliacao,
} from './conciliacao.ts'

test('moeda: tolerância de um centavo, e não mais', () => {
  assert.equal(bate(627959.83, 627959.83, 'moeda'), true)
  assert.equal(bate(627959.83, 627959.84, 'moeda'), true)
  assert.equal(bate(0.1 + 0.2, 0.3, 'moeda'), true)
  assert.equal(bate(627959.83, 627959.85, 'moeda'), false)
  assert.equal(bate(8, 8, 'contagem'), true)
  assert.equal(bate(8, 9, 'contagem'), false)
})

test('linha que bate nas três fontes', () => {
  const l = conciliarLinha({ metrica: 'NF emitida', obra: null, tipo: 'moeda', planilha: 627959.83, banco: '627959.83', esperado: 627959.83 })
  assert.equal(l.ok, true)
  assert.equal(l.diferenca, 0)
  assert.equal(l.banco, 627959.83)
  assert.equal(l.motivo, '')
})

test('faltando no banco, faltando na planilha e ausente dos dois lados', () => {
  const sem = conciliarLinha({ metrica: 'obras', obra: null, tipo: 'contagem', planilha: 3, banco: null })
  assert.equal(sem.ok, false)
  assert.equal(sem.diferenca, null)
  assert.match(sem.motivo, /faltando no banco/)
  assert.match(conciliarLinha({ metrica: 'x', obra: 'O1', tipo: 'moeda', banco: 10 }).motivo, /faltando na planilha/)
  assert.match(conciliarLinha({ metrica: 'x', obra: 'O1', tipo: 'moeda' }).motivo, /nem no banco/)
})

test('diferença é banco − planilha, e a referência é conferida contra os dois', () => {
  const l = conciliarLinha({ metrica: 'recebido', obra: null, tipo: 'moeda', planilha: 489498.13, banco: 489398.13, esperado: 489498.13 })
  assert.equal(l.ok, false)
  assert.equal(l.diferenca, -100)
  assert.match(l.motivo, /banco difere da planilha em -R\$ 100,00/)
  assert.match(l.motivo, /banco difere da referência/)
  assert.doesNotMatch(l.motivo, /planilha difere da referência/)

  const r = conciliarLinha({ metrica: 'obras', obra: null, tipo: 'contagem', planilha: 7, banco: 7, esperado: 8 })
  assert.equal(r.ok, false)
  assert.equal(r.diferenca, 0)
  assert.match(r.motivo, /planilha difere da referência em -1/)
})

test('por obra: junta as obras dos dois lados, a que falta vira divergência', () => {
  const e = entradasPorObra('NF emitida', 'moeda', {
    planilha: { 'OB-01': 1000, 'OB-02': 500 },
    banco: { 'OB-01': 1000, 'OB-03': 10 },
  })
  assert.deepEqual(e.map((x) => x.obra), ['OB-01', 'OB-02', 'OB-03'])
  const l = conciliar(e)
  assert.deepEqual(l.map((x) => x.ok), [true, false, false])
  assert.match(l[1].motivo, /faltando no banco/)
  assert.match(l[2].motivo, /faltando na planilha/)
})

test('status de NF: igual bate; emitida aceita paga parcialmente; paga × emitida não', () => {
  assert.equal(conferirStatusNf('paga', 'paga').ok, true)
  assert.equal(conferirStatusNf('emitida', 'paga_parcialmente').ok, true)
  assert.equal(conferirStatusNf(null, 'emitida').ok, true)
  const d = conferirStatusNf('paga', 'emitida')
  assert.equal(d.ok, false)
  assert.match(d.motivo, /planilha diz paga, o banco calculou emitida/)
  assert.equal(conferirStatusNf('paga', null).ok, false)
})

test('resumo: informativa divergente não reprova', () => {
  const linhas = conciliar([
    { metrica: 'a', obra: null, tipo: 'contagem', planilha: 1, banco: 1 },
    { metrica: 'b', obra: null, tipo: 'moeda', planilha: 10, banco: 9, informativa: true },
  ])
  assert.deepEqual(resumoDaConciliacao(linhas), { linhas: 2, ok: 1, divergentes: 0, informativas_divergentes: 1, bateu: true })
  linhas.push(conciliarLinha({ metrica: 'c', obra: null, tipo: 'contagem', planilha: 1, banco: null }))
  assert.equal(resumoDaConciliacao(linhas).bateu, false)
})

test('formatação: R$ no padrão brasileiro, contagem inteira, traço para vazio', () => {
  assert.equal(formatarValor(627959.83, 'moeda'), 'R$ 627.959,83')
  assert.equal(formatarValor(2060290.51, 'moeda'), 'R$ 2.060.290,51')
  assert.equal(formatarValor(-100, 'moeda'), '-R$ 100,00')
  assert.equal(formatarValor(248, 'contagem'), '248')
  assert.equal(formatarValor(null, 'moeda'), '—')
})
