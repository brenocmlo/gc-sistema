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
  appendHistorico,
  calcularValorFinal,
  historicoOrdenado,
  isPropostaVencida,
  novaEntradaHistoricoProposta,
  obraIdsDaBusca,
  pctFormToPayload,
  pctPayloadToForm,
  validarDesconto,
  validarSomaPctForm,
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

// ============================================================
// Regras do formulário
// ============================================================

test('validarDesconto: aceita desconto menor e igual ao total', () => {
  assert.equal(validarDesconto(1000, 0).ok, true)
  assert.equal(validarDesconto(1000, 999.99).ok, true)
  // Igual ao total é válido: o CHECK do banco é <=, não <.
  assert.equal(validarDesconto(1000, 1000).ok, true)
})

test('validarDesconto: recusa desconto maior que o total', () => {
  const r = validarDesconto(1000, 1000.01)
  assert.equal(r.ok, false)
  assert.match(r.ok === false ? r.error : '', /maior que o valor total/)
})

test('validarDesconto: recusa negativos', () => {
  assert.equal(validarDesconto(-1, 0).ok, false)
  assert.equal(validarDesconto(100, -1).ok, false)
})

test('validarDesconto: não recusa por float de duas casas', () => {
  // 0.1 + 0.2 = 0.30000000000000004; o banco guarda numeric(14,2) e aceitaria.
  assert.equal(validarDesconto(0.1 + 0.2, 0.3).ok, true)
})

test('calcularValorFinal reproduz a coluna generated', () => {
  assert.equal(calcularValorFinal(1000, 250), 750)
  assert.equal(calcularValorFinal(0.1 + 0.2, 0.1), 0.2)
})

test('pct: form (0..100) vai e volta do payload (0..1)', () => {
  const form = {
    pct_sinal: 30,
    pct_fd: 20,
    pct_entrega_material: 12.5,
    pct_medicao_instalacao: 37.5,
  }
  const payload = pctFormToPayload(form)
  assert.deepEqual(payload, {
    pct_sinal: 0.3,
    pct_fd: 0.2,
    pct_entrega_material: 0.125,
    pct_medicao_instalacao: 0.375,
  })
  assert.deepEqual(pctPayloadToForm(payload), form)
})

test('validarSomaPctForm: 100% em percentual é aceito', () => {
  // O ponto da função: 30+20+12.5+37.5 = 100 seria recusado contra o
  // limite 1.0 se não convertesse antes.
  const r = validarSomaPctForm({
    pct_sinal: 30,
    pct_fd: 20,
    pct_entrega_material: 12.5,
    pct_medicao_instalacao: 37.5,
  })
  assert.equal(r.ok, true)
  assert.equal(r.restante, 0)
})

test('validarSomaPctForm: acima de 100% é recusado', () => {
  const r = validarSomaPctForm({
    pct_sinal: 50,
    pct_fd: 50,
    pct_entrega_material: 10,
    pct_medicao_instalacao: 0,
  })
  assert.equal(r.ok, false)
})

// ============================================================
// Histórico de transições
// ============================================================

test('novaEntradaHistorico registra de/para/quem/quando', () => {
  const e = novaEntradaHistoricoProposta({
    de: 'rascunho',
    para: 'enviada',
    por: 'user-1',
    em: '2026-09-05T12:00:00.000Z',
  })
  assert.deepEqual(e, {
    de: 'rascunho',
    para: 'enviada',
    em: '2026-09-05T12:00:00.000Z',
    por: 'user-1',
    motivo_rejeicao: null,
    detalhe_rejeicao: null,
  })
})

test('novaEntradaHistorico só guarda motivo quando o destino é rejeitada', () => {
  const rejeitada = novaEntradaHistoricoProposta({
    de: 'enviada',
    para: 'rejeitada',
    por: 'u',
    motivo_rejeicao: 'preco_alto',
    detalhe_rejeicao: 'acima do orçado',
  })
  assert.equal(rejeitada.motivo_rejeicao, 'preco_alto')

  // Espelha o CHECK propostas_rejeitada_motivo: motivo fora de rejeitada é
  // descartado em vez de virar registro que a linha não tem.
  const voltou = novaEntradaHistoricoProposta({
    de: 'enviada',
    para: 'rascunho',
    por: 'u',
    motivo_rejeicao: 'preco_alto',
  })
  assert.equal(voltou.motivo_rejeicao, null)
})

test('appendHistorico é append-only e tolera valor inválido', () => {
  const e1 = novaEntradaHistoricoProposta({
    de: 'rascunho', para: 'enviada', por: 'u', em: '2026-01-01T00:00:00.000Z',
  })
  const e2 = novaEntradaHistoricoProposta({
    de: 'enviada', para: 'aprovada', por: 'u', em: '2026-02-01T00:00:00.000Z',
  })

  assert.deepEqual(appendHistorico(null, e1), [e1])
  assert.deepEqual(appendHistorico([e1], e2), [e1, e2])
  // jsonb aceitaria um objeto solto gravado antes do CHECK; não pode derrubar
  // o append.
  assert.deepEqual(appendHistorico({ ruim: true }, e1), [e1])
})

test('historicoOrdenado devolve o mais recente primeiro', () => {
  const antigo = novaEntradaHistoricoProposta({
    de: 'rascunho', para: 'enviada', por: 'u', em: '2026-01-01T00:00:00.000Z',
  })
  const novo = novaEntradaHistoricoProposta({
    de: 'enviada', para: 'aprovada', por: 'u', em: '2026-02-01T00:00:00.000Z',
  })
  assert.deepEqual(historicoOrdenado([antigo, novo]), [novo, antigo])
})
