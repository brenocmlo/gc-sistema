// Rodar: npm test
//
// Sem runner instalado: `node --test` do Node 24 executa .ts direto (type
// stripping nativo). Por isso o import traz a extensão .ts explícita — o Node
// não resolve extensão nem o alias `@/`.
import assert from 'node:assert/strict'
import test from 'node:test'

import {
  canChangePropostaStatus,
  formatPct,
  fractionToPct,
  isEditavel,
  isFinalizada,
  isPctCompleto,
  isPropostaStatus,
  isPropostaVencida,
  obraIdsDaBusca,
  parcelasDaProposta,
  pctRestante,
  pctToFraction,
  requiresDataDecisao,
  requiresDataEnvio,
  requiresMotivoRejeicao,
  somaPct,
  validarMotivoRejeicao,
  validarSomaPct,
  valorBaseProposta,
  valorParcela,
} from './propostas.ts'

// ============================================================
// Status
// ============================================================

test('isPropostaStatus aceita só os valores do CHECK do banco', () => {
  for (const s of ['rascunho', 'enviada', 'aprovada', 'rejeitada']) {
    assert.equal(isPropostaStatus(s), true, s)
  }
  // Os de orçamento são masculinos e NÃO valem pra proposta.
  assert.equal(isPropostaStatus('aprovado'), false)
  assert.equal(isPropostaStatus('expirada'), false)
  assert.equal(isPropostaStatus(''), false)
})

test('campos exigidos por status', () => {
  assert.equal(requiresDataEnvio('enviada'), true)
  assert.equal(requiresDataEnvio('rascunho'), false)

  assert.equal(requiresDataDecisao('aprovada'), true)
  assert.equal(requiresDataDecisao('rejeitada'), true)
  assert.equal(requiresDataDecisao('enviada'), false)

  assert.equal(requiresMotivoRejeicao('rejeitada'), true)
  assert.equal(requiresMotivoRejeicao('aprovada'), false)
})

test('rascunho é o único editável; aprovada e rejeitada são terminais', () => {
  assert.equal(isEditavel('rascunho'), true)
  assert.equal(isEditavel('enviada'), false)

  assert.equal(isFinalizada('aprovada'), true)
  assert.equal(isFinalizada('rejeitada'), true)
  assert.equal(isFinalizada('rascunho'), false)
})

test('transições permitidas', () => {
  assert.equal(canChangePropostaStatus('rascunho', 'enviada'), true)
  assert.equal(canChangePropostaStatus('enviada', 'aprovada'), true)
  assert.equal(canChangePropostaStatus('enviada', 'rejeitada'), true)
  // Volta pra correção.
  assert.equal(canChangePropostaStatus('enviada', 'rascunho'), true)

  // Pular a fase de envio não vale.
  assert.equal(canChangePropostaStatus('rascunho', 'aprovada'), false)
  // Terminais não voltam pro funil.
  assert.equal(canChangePropostaStatus('aprovada', 'enviada'), false)
  assert.equal(canChangePropostaStatus('rejeitada', 'rascunho'), false)

  // Salvar sem mudar status nunca é bloqueado.
  assert.equal(canChangePropostaStatus('aprovada', 'aprovada'), true)
})

test('validarMotivoRejeicao espelha o CHECK propostas_rejeitada_motivo', () => {
  assert.equal(validarMotivoRejeicao('rejeitada', 'preco_alto').ok, true)
  assert.equal(validarMotivoRejeicao('aprovada', null).ok, true)

  // Rejeitada sem motivo: o banco recusaria.
  assert.equal(validarMotivoRejeicao('rejeitada', null).ok, false)
  // Motivo em status que não é rejeitada: o banco também recusaria.
  assert.equal(validarMotivoRejeicao('aprovada', 'preco_alto').ok, false)
})

// ============================================================
// Validade (derivada em runtime)
// ============================================================

function diaRelativo(offset: number): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() + offset)
  return d.toISOString().slice(0, 10)
}

test('isPropostaVencida só vale pra enviada com validade no passado', () => {
  const ontem = diaRelativo(-1)
  const amanha = diaRelativo(1)
  const hoje = diaRelativo(0)

  assert.equal(
    isPropostaVencida({ status: 'enviada', data_validade: ontem }),
    true,
  )
  assert.equal(
    isPropostaVencida({ status: 'enviada', data_validade: amanha }),
    false,
  )
  // Vence no fim do dia: hoje ainda não está vencida.
  assert.equal(
    isPropostaVencida({ status: 'enviada', data_validade: hoje }),
    false,
  )
  // Sem validade preenchida não há o que expirar.
  assert.equal(
    isPropostaVencida({ status: 'enviada', data_validade: null }),
    false,
  )
  // Decisão já tomada: validade passada não é mais "vencida".
  assert.equal(
    isPropostaVencida({ status: 'aprovada', data_validade: ontem }),
    false,
  )
  assert.equal(
    isPropostaVencida({ status: 'rascunho', data_validade: ontem }),
    false,
  )
})

// ============================================================
// Percentuais
// ============================================================

test('somaPct trata null/ausente como 0, igual ao COALESCE do CHECK', () => {
  assert.equal(somaPct({}), 0)
  assert.equal(somaPct({ pct_sinal: 0.3, pct_fd: null }), 0.3)
  assert.equal(
    somaPct({
      pct_sinal: 0.25,
      pct_fd: 0.25,
      pct_entrega_material: 0.25,
      pct_medicao_instalacao: 0.25,
    }),
    1,
  )
})

test('validarSomaPct aceita soma exata de 100% apesar do float', () => {
  // 0.1 + 0.2 = 0.30000000000000004 em float. Sem o round4 antes de
  // comparar, esta soma legítima seria recusada.
  const r = validarSomaPct({
    pct_sinal: 0.1,
    pct_fd: 0.2,
    pct_entrega_material: 0.3,
    pct_medicao_instalacao: 0.4,
  })
  assert.equal(r.ok, true)
  assert.equal(r.soma, 1)
  assert.equal(r.restante, 0)
})

test('validarSomaPct aceita soma parcial e devolve o restante', () => {
  // O CHECK é <= 1.0, não = 1.0: o resto vai pro campo livre
  // condicoes_pagamento.
  const r = validarSomaPct({ pct_sinal: 0.3, pct_fd: 0.2 })
  assert.equal(r.ok, true)
  assert.equal(r.soma, 0.5)
  assert.equal(r.restante, 0.5)
})

test('validarSomaPct recusa soma acima de 100%', () => {
  const r = validarSomaPct({
    pct_sinal: 0.5,
    pct_fd: 0.5,
    pct_entrega_material: 0.1,
  })
  assert.equal(r.ok, false)
  assert.equal(r.soma, 1.1)
  assert.match(r.ok === false ? r.error : '', /110%/)
})

test('validarSomaPct recusa parcela fora da faixa 0..1', () => {
  const negativo = validarSomaPct({ pct_sinal: -0.1 })
  assert.equal(negativo.ok, false)
  assert.match(negativo.ok === false ? negativo.error : '', /Sinal/)

  // 1.5 viola o CHECK do campo mesmo sendo a única parcela.
  const acima = validarSomaPct({ pct_fd: 1.5 })
  assert.equal(acima.ok, false)
  assert.match(acima.ok === false ? acima.error : '', /FD/)

  // A mensagem lista todas as parcelas problemáticas.
  const duas = validarSomaPct({ pct_sinal: -0.1, pct_fd: 2 })
  assert.match(duas.ok === false ? duas.error : '', /Sinal, FD/)
})

test('pctRestante e isPctCompleto', () => {
  assert.equal(pctRestante({}), 1)
  assert.equal(pctRestante({ pct_sinal: 0.4 }), 0.6)
  assert.equal(isPctCompleto({ pct_sinal: 0.4 }), false)
  assert.equal(isPctCompleto({ pct_sinal: 0.5, pct_fd: 0.5 }), true)
  // 0.1+0.2+0.3+0.4 em float não fecha 1 sem arredondar.
  assert.equal(
    isPctCompleto({
      pct_sinal: 0.1,
      pct_fd: 0.2,
      pct_entrega_material: 0.3,
      pct_medicao_instalacao: 0.4,
    }),
    true,
  )
})

test('conversão entre a UI (0..100) e o banco (0..1)', () => {
  assert.equal(pctToFraction(50), 0.5)
  assert.equal(pctToFraction(12.5), 0.125)
  assert.equal(pctToFraction(0), 0)
  // Campo vazio no form vira null, não 0 — o banco tem default 0 e a
  // coluna é nullable.
  assert.equal(pctToFraction(null), null)
  assert.equal(pctToFraction(undefined), null)
  assert.equal(pctToFraction(Number.NaN), null)
  // numeric(5,4) só guarda 4 casas: 33.333% arredonda em 0.3333.
  assert.equal(pctToFraction(33.333), 0.3333)

  assert.equal(fractionToPct(0.125), 12.5)
  assert.equal(fractionToPct(null), 0)
  assert.equal(fractionToPct(Number.NaN), 0)

  // Ida e volta preserva o valor da UI.
  assert.equal(fractionToPct(pctToFraction(37.5)), 37.5)
})

test('formatPct usa vírgula decimal', () => {
  assert.equal(formatPct(0.125), '12,5%')
  assert.equal(formatPct(0.5), '50%')
  assert.equal(formatPct(1), '100%')
  assert.equal(formatPct(null), '0%')
})

// ============================================================
// Rateio em reais
// ============================================================

test('valorBaseProposta prefere valor_final (generated no banco)', () => {
  assert.equal(
    valorBaseProposta({ valor_total: 1000, desconto: 100, valor_final: 900 }),
    900,
  )
  // Registro em memória, antes de voltar do insert.
  assert.equal(
    valorBaseProposta({ valor_total: 1000, desconto: 100, valor_final: null }),
    900,
  )
})

test('valorParcela arredonda em centavos', () => {
  assert.equal(valorParcela(1000, 0.3), 300)
  assert.equal(valorParcela(333.33, 0.3333), 111.1)
  assert.equal(valorParcela(null, 0.3), 0)
  assert.equal(valorParcela(1000, null), 0)
})

test('parcelasDaProposta omite parcela zerada e devolve o restante', () => {
  const r = parcelasDaProposta({
    valor_final: 10_000,
    pct_sinal: 0.3,
    pct_fd: 0,
    pct_entrega_material: null,
    pct_medicao_instalacao: 0.5,
  })

  assert.deepEqual(
    r.parcelas.map((p) => [p.field, p.valor]),
    [
      ['pct_sinal', 3000],
      ['pct_medicao_instalacao', 5000],
    ],
  )
  // Ordem é a de PCT_FIELDS, não a de inserção.
  assert.equal(r.parcelas[0].label, 'Sinal')
  assert.equal(r.restante, 0.2)
  assert.equal(r.valorRestante, 2000)

  // A soma das parcelas mais o restante fecha o valor final.
  const total =
    r.parcelas.reduce((acc, p) => acc + p.valor, 0) + r.valorRestante
  assert.equal(total, 10_000)
})

// ============================================================
// Busca da listagem
// ============================================================

const OBRAS = [
  { id: 'o1', nome: 'Edifício Aurora', codigo_obra: 'OB-2026-001', cliente_id: 'c1' },
  { id: 'o2', nome: 'Galpão Norte', codigo_obra: 'OB-2026-002', cliente_id: 'c2' },
  { id: 'o3', nome: 'Reforma Aurora Boreal', codigo_obra: 'OB-2025-010', cliente_id: 'c3' },
]

test('obraIdsDaBusca: casa nome da obra sem depender de caixa', () => {
  assert.deepEqual(obraIdsDaBusca(OBRAS, 'aurora'), ['o1', 'o3'])
})

test('obraIdsDaBusca: casa código da obra', () => {
  assert.deepEqual(obraIdsDaBusca(OBRAS, 'OB-2026'), ['o1', 'o2'])
})

test('obraIdsDaBusca: inclui as obras dos clientes que casaram', () => {
  // O nome do cliente não está na obra: quem resolveu foi a consulta em
  // clientes, e aqui só entram os IDs.
  assert.deepEqual(obraIdsDaBusca(OBRAS, 'galpao', ['c3']), ['o3'])
})

test('obraIdsDaBusca: nome da obra e cliente são união, sem duplicar', () => {
  assert.deepEqual(obraIdsDaBusca(OBRAS, 'aurora', ['c1', 'c2']), [
    'o1',
    'o2',
    'o3',
  ])
})

test('obraIdsDaBusca: busca vazia não devolve obra nenhuma', () => {
  // Vazio significa "sem busca" — devolver tudo faria a listagem montar um
  // obra_id.in.(...) gigante e inútil.
  assert.deepEqual(obraIdsDaBusca(OBRAS, '   ', ['c1']), [])
})

test('obraIdsDaBusca: sem match devolve vazio', () => {
  assert.deepEqual(obraIdsDaBusca(OBRAS, 'inexistente'), [])
})
