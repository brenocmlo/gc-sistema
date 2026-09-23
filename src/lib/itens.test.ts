import test from 'node:test'
import assert from 'node:assert/strict'

import {
  CAMPOS_EDITAVEIS_ITEM,
  COLUNAS_GERADAS_ITEM,
  ajustarValorUnit,
  camposEditaveisItem,
  camposParaDuplicar,
  previaAjuste,
  validarPercentual,
  vizinhoParaMover,
  divergenciaDeValor,
  acrescentarObservacao,
  areaDoItem,
  formatArea,
  formatDimensao,
  formatDimensoes,
  formatUnidade,
  formatUnidadeSufixo,
  isUnidade,
  limparColunasGeradas,
  normalizarUnidade,
  notaDeInferencia,
  numeroItemDoDocumento,
  proximoNumeroItem,
  resolverValorUnit,
  somaItens,
  valorTotalDoItem,
  vinculoValido,
} from './itens.ts'

// ============================================================
// Colunas geradas
// ============================================================

test('COLUNAS_GERADAS_ITEM lista exatamente as duas do schema', () => {
  assert.deepEqual([...COLUNAS_GERADAS_ITEM], ['valor_total', 'area_m2'])
})

test('limparColunasGeradas tira valor_total e area_m2 e preserva o resto', () => {
  const limpo = limparColunasGeradas({
    descricao: 'Janela',
    quantidade: 2,
    valor_unit: 100,
    valor_total: 200,
    area_m2: 4.8,
  })
  assert.deepEqual(limpo, {
    descricao: 'Janela',
    quantidade: 2,
    valor_unit: 100,
  })
})

test('limparColunasGeradas não muta a entrada', () => {
  const original = { valor_total: 200, descricao: 'x' }
  limparColunasGeradas(original)
  assert.equal(original.valor_total, 200)
})

test('limparColunasGeradas é inofensivo quando as colunas não estão lá', () => {
  assert.deepEqual(limparColunasGeradas({ descricao: 'x' }), { descricao: 'x' })
})

// ============================================================
// Unidade
// ============================================================

test('isUnidade aceita só os dois valores do CHECK', () => {
  assert.equal(isUnidade('QTD'), true)
  assert.equal(isUnidade('M2'), true)
  // 'ML' foi removido de propósito na revisão de schema
  assert.equal(isUnidade('ML'), false)
  assert.equal(isUnidade('un'), false)
  assert.equal(isUnidade(null), false)
})

test('normalizarUnidade reconhece as grafias de metro quadrado', () => {
  for (const g of ['M2', 'm2', 'm²', 'M²', ' mq ', 'metro quadrado', 'Metros Quadrados']) {
    const r = normalizarUnidade(g)
    assert.equal(r.unidade, 'M2', `falhou em "${g}"`)
    assert.equal(r.reconhecida, true, `"${g}" devia ser reconhecida`)
  }
})

test('normalizarUnidade manda as grafias de peça para QTD, reconhecidas', () => {
  for (const g of ['QTD', 'un', 'UND', 'unid', 'unidade', 'pç', 'peça', 'peças', 'cj']) {
    const r = normalizarUnidade(g)
    assert.equal(r.unidade, 'QTD', `falhou em "${g}"`)
    assert.equal(r.reconhecida, true, `"${g}" devia ser reconhecida`)
  }
})

test('normalizarUnidade cai em QTD não-reconhecida no desconhecido e no vazio', () => {
  for (const g of ['ML', 'kg', 'xyz', '', '   ', null, undefined, 42]) {
    const r = normalizarUnidade(g)
    assert.equal(r.unidade, 'QTD', `falhou em ${JSON.stringify(g)}`)
    assert.equal(r.reconhecida, false, `${JSON.stringify(g)} não devia ser reconhecida`)
  }
})

test('normalizarUnidade manda ML para QTD — nunca reintroduzir ML', () => {
  // A revisão de schema removeu 'ML' do CHECK e migrou os dados existentes
  // pra 'QTD'. Devolver 'ML' aqui estouraria itens_unidade_check no insert.
  assert.equal(normalizarUnidade('ML').unidade, 'QTD')
})

test('formatUnidade e o sufixo tratam nulo', () => {
  assert.equal(formatUnidade('M2'), 'Metro quadrado')
  assert.equal(formatUnidade(null), '—')
  assert.equal(formatUnidadeSufixo('M2'), 'm²')
  assert.equal(formatUnidadeSufixo('QTD'), 'un')
  assert.equal(formatUnidadeSufixo(null), '')
})

// ============================================================
// Dimensões
// ============================================================

test('formatDimensao usa vírgula decimal e sufixo em metros', () => {
  assert.equal(formatDimensao(1.2), '1,2 m')
  assert.equal(formatDimensao(2), '2 m')
  assert.equal(formatDimensao(null), '—')
  assert.equal(formatDimensao(undefined), '—')
})

test('formatDimensoes exige as duas medidas', () => {
  assert.equal(formatDimensoes(1.2, 2.4), '1,2 × 2,4 m')
  assert.equal(formatDimensoes(1.2, null), '—')
  assert.equal(formatDimensoes(null, 2.4), '—')
})

test('formatArea fixa duas casas', () => {
  assert.equal(formatArea(5.76), '5,76 m²')
  assert.equal(formatArea(4), '4,00 m²')
  assert.equal(formatArea(null), '—')
})

// ============================================================
// Espelhos das colunas geradas
// ============================================================

test('areaDoItem repete largura × altura × quantidade', () => {
  assert.equal(areaDoItem(1.2, 2.4, 2), 5.76)
})

test('areaDoItem devolve null se faltar qualquer fator — zero seria mentira', () => {
  assert.equal(areaDoItem(null, 2.4, 2), null)
  assert.equal(areaDoItem(1.2, null, 2), null)
  assert.equal(areaDoItem(1.2, 2.4, null), null)
})

test('valorTotalDoItem repete valor_unit × quantidade', () => {
  assert.equal(valorTotalDoItem(1986.08, 2), 3972.16)
  assert.equal(valorTotalDoItem(null, 2), null)
  assert.equal(valorTotalDoItem(100, null), null)
})

test('somaItens soma e trata item sem valor como zero', () => {
  assert.equal(
    somaItens([{ valor_total: 100 }, { valor_total: null }, { valor_total: 50.5 }]),
    150.5,
  )
  assert.equal(somaItens([]), 0)
})

// ============================================================
// Numeração
// ============================================================

test('proximoNumeroItem é maior + 1, não length + 1', () => {
  // Item 2 foi excluído: length seria 2 e colidiria com o numero 3 existente.
  assert.equal(proximoNumeroItem([{ numero: 1 }, { numero: 3 }]), 4)
})

test('proximoNumeroItem começa em 1 na lista vazia', () => {
  assert.equal(proximoNumeroItem([]), 1)
})

test('proximoNumeroItem ignora nulos', () => {
  assert.equal(proximoNumeroItem([{ numero: null }, { numero: 2 }, { numero: null }]), 3)
  assert.equal(proximoNumeroItem([{ numero: null }]), 1)
})

test('numeroItemDoDocumento aceita inteiro positivo, inclusive com zero à esquerda', () => {
  // '01' e '13' são os casos reais do PDF de referência
  assert.deepEqual(numeroItemDoDocumento('01'), { numero: 1, original: null })
  assert.deepEqual(numeroItemDoDocumento('13'), { numero: 13, original: null })
  assert.deepEqual(numeroItemDoDocumento(7), { numero: 7, original: null })
})

test('numeroItemDoDocumento devolve null e guarda o original no que não é inteiro', () => {
  assert.deepEqual(numeroItemDoDocumento('1.1'), { numero: null, original: '1.1' })
  assert.deepEqual(numeroItemDoDocumento('1A'), { numero: null, original: '1A' })
  assert.deepEqual(numeroItemDoDocumento('—'), { numero: null, original: '—' })
  assert.deepEqual(numeroItemDoDocumento(0), { numero: null, original: '0' })
  assert.deepEqual(numeroItemDoDocumento(-3), { numero: null, original: '-3' })
})

test('numeroItemDoDocumento trata vazio e não-string sem inventar original', () => {
  assert.deepEqual(numeroItemDoDocumento(''), { numero: null, original: null })
  assert.deepEqual(numeroItemDoDocumento('  '), { numero: null, original: null })
  assert.deepEqual(numeroItemDoDocumento(null), { numero: null, original: null })
})

// ============================================================
// Valor unitário ausente
// ============================================================

test('resolverValorUnit usa o unitário quando ele veio', () => {
  const r = resolverValorUnit({ valorUnit: 1986.08, valorTotal: 3972.16, quantidade: 2 })
  assert.equal(r.ok, true)
  assert.equal(r.ok && r.valorUnit, 1986.08)
  assert.equal(r.ok && r.inferido, false)
})

test('resolverValorUnit infere o unitário do total — o caso comum do PDF', () => {
  const r = resolverValorUnit({ valorUnit: null, valorTotal: 1000, quantidade: 4 })
  assert.equal(r.ok, true)
  assert.equal(r.ok && r.valorUnit, 250)
  assert.equal(r.ok && r.inferido, true)
})

test('resolverValorUnit recusa quantidade zero em vez de dividir por zero', () => {
  const r = resolverValorUnit({ valorUnit: null, valorTotal: 1000, quantidade: 0 })
  assert.equal(r.ok, false)
  assert.match(r.ok === false ? r.motivo : '', /quantidade/)
})

test('resolverValorUnit recusa item sem nenhum dos dois valores', () => {
  const r = resolverValorUnit({ valorUnit: null, valorTotal: null, quantidade: 3 })
  assert.equal(r.ok, false)
  assert.match(r.ok === false ? r.motivo : '', /sem valor total/)
})

test('resolverValorUnit NUNCA devolve zero como unitário válido', () => {
  // Gravar zero seria pior que recusar: a proposta fecharia com valor errado
  // e ninguém veria, porque a tela mostra R$ 0,00 sem reclamar.
  for (const e of [
    { valorUnit: 0, valorTotal: null, quantidade: 2 },
    { valorUnit: null, valorTotal: 0, quantidade: 2 },
  ]) {
    assert.equal(resolverValorUnit(e).ok, false, JSON.stringify(e))
  }
})

test('notaDeInferencia e acrescentarObservacao montam o rastro', () => {
  const nota = notaDeInferencia({ valorTotal: 1000, quantidade: 4 })
  assert.equal(nota, '[valor unitário inferido de 1000 / 4]')
  assert.equal(acrescentarObservacao(null, nota), nota)
  assert.equal(acrescentarObservacao('', nota), nota)
  assert.equal(acrescentarObservacao('Vidro temperado.', nota), `Vidro temperado. ${nota}`)
})

// ============================================================
// Vínculo
// ============================================================

test('vinculoValido reflete o CHECK item_vinculo_xor', () => {
  assert.equal(vinculoValido({ proposta_id: 'p', contrato_id: null }), true)
  assert.equal(vinculoValido({ proposta_id: null, contrato_id: 'c' }), true)
  // item "solto" é permitido pelo schema
  assert.equal(vinculoValido({ proposta_id: null, contrato_id: null }), true)
  // os dois juntos, não
  assert.equal(vinculoValido({ proposta_id: 'p', contrato_id: 'c' }), false)
})

// ============================================================
// Conferência contra o documento real
// ============================================================
// Extraído em 2026-09-21 de
// keen-mendel/relatorios/documentos-fonte/PROP. COM. - EF _ ADITIVOS_15 12 2025.pdf
// (proposta EB-25-08-0048) com `pdftotext -layout`. Os casos abaixo são o que o
// documento TEM, não o que eu imaginei que ele teria — e a extração corrigiu
// duas coisas que o plano de migração afirmava:
//
//   1. O documento tem **16 itens**, não 12.
//   2. A numeração é inteiro simples de 1 a 16 — não há "1.1" nem "1A".
//      O caminho de `numero` não-inteiro segue coberto por caso hipotético,
//      e isso está registrado como pendência nominal.

test('PDF real: os 16 números de item são inteiros simples', () => {
  const doDocumento = [
    '1', '2', '3', '4', '5', '6', '7', '8',
    '9', '10', '11', '12', '13', '14', '15', '16',
  ]
  const convertidos = doDocumento.map((n) => numeroItemDoDocumento(n))

  assert.equal(convertidos.length, 16)
  for (let i = 0; i < convertidos.length; i++) {
    assert.equal(convertidos[i].numero, i + 1, `item ${doDocumento[i]}`)
    assert.equal(
      convertidos[i].original,
      null,
      `item ${doDocumento[i]} não devia guardar original`,
    )
  }
})

test('PDF real: quantidade vem com zero à esquerda (01, 02, 13)', () => {
  // O documento escreve "01" e "02". Number() resolve, mas o teste existe pra
  // fixar que ninguém vai trocar por parseInt com radix errado.
  assert.equal(Number('01'), 1)
  assert.equal(Number('02'), 2)
  assert.equal(Number('13'), 13)
})

test('PDF real: 11 dos 16 itens não têm valor unitário — a inferência é obrigatória', () => {
  // (quantidade, valorTotal) dos itens sem unitário no documento.
  const semUnitario: [number, number][] = [
    [1, 9975.0], [1, 2175.0], [1, 31575.0], [1, 18000.0],
    [1, 38750.98], [1, 3500.0], [1, 2400.0], [1, 1700.0],
    [2, 3972.16], [1, 1881.7], [1, 1680.52],
  ]

  let somaRecuperada = 0
  for (const [quantidade, valorTotal] of semUnitario) {
    const r = resolverValorUnit({ valorUnit: null, valorTotal, quantidade })
    assert.equal(r.ok, true, `qtd=${quantidade} total=${valorTotal}`)
    if (r.ok) {
      assert.equal(r.inferido, true)
      // O total volta a bater depois de o banco recalcular valor_unit × qtd.
      assert.ok(
        Math.abs(r.valorUnit * quantidade - valorTotal) < 0.01,
        `${r.valorUnit} × ${quantidade} != ${valorTotal}`,
      )
      somaRecuperada += r.valorUnit * quantidade
    }
  }

  // É este o número que se perderia gravando valor_unit nulo: como
  // itens.valor_total é coluna GENERATED, os 11 itens entrariam valendo zero.
  const esperado = semUnitario.reduce((a, [, t]) => a + t, 0)
  assert.ok(Math.abs(somaRecuperada - esperado) < 0.01)
  assert.ok(somaRecuperada > 115000, `recuperado ${somaRecuperada}`)
})

test('PDF real: item 9 (qtd 13 × 120) confere com o total impresso', () => {
  // O único item do documento com quantidade > 2 e unitário presente: serve
  // de controle de que a conta do banco bate com o papel.
  assert.equal(valorTotalDoItem(120, 13), 1560)
})

// ============================================================
// Whitelist de escrita (furo encontrado no bloco 5.5)
// ============================================================

test('camposEditaveisItem descarta tudo que o servidor resolve', () => {
  const r = camposEditaveisItem({
    descricao: 'ok',
    proposta_id: 'outra-proposta',
    obra_id: 'outra-obra',
    empresa_id: 'outra-empresa',
    contrato_id: 'um-contrato',
    created_by: 'alguem',
    foto_url: 'empresa/itens/outro/foto.jpg',
    valor_total: 999999,
    area_m2: 999,
    id: 'x',
  })
  assert.deepEqual(r, { descricao: 'ok' })
})

test('camposEditaveisItem mantém ausente como ausente, não como null', () => {
  // A tabela do 5.2 não manda observacao: omitir tem de preservar no banco.
  const r = camposEditaveisItem({ quantidade: 2 })
  assert.equal('observacao' in r, false)
  assert.equal('localizacao' in r, false)
})

test('camposEditaveisItem preserva null explícito, que é intenção de limpar', () => {
  const r = camposEditaveisItem({ observacao: null })
  assert.equal('observacao' in r, true)
  assert.equal(r.observacao, null)
})

test('camposEditaveisItem tolera entrada que não é objeto', () => {
  assert.deepEqual(camposEditaveisItem(null), {})
  assert.deepEqual(camposEditaveisItem('texto'), {})
  assert.deepEqual(camposEditaveisItem(undefined), {})
})

test('CAMPOS_EDITAVEIS_ITEM não contém coluna gerada nem foto_url', () => {
  const lista = [...CAMPOS_EDITAVEIS_ITEM] as string[]
  for (const proibido of ['valor_total', 'area_m2', 'foto_url', 'proposta_id', 'obra_id', 'empresa_id']) {
    assert.equal(lista.includes(proibido), false, proibido)
  }
})

// ============================================================
// Divergência valor × itens (bloco 5.6)
// ============================================================

test('divergenciaDeValor: sem itens nunca diverge — o valor é digitado', () => {
  const r = divergenciaDeValor(185000, [])
  assert.equal(r.temItens, false)
  assert.equal(r.diverge, false)
})

test('divergenciaDeValor: com itens e valor igual à soma não diverge', () => {
  const r = divergenciaDeValor(67021.79, [{ valor_total: 67000 }, { valor_total: 21.79 }])
  assert.equal(r.diverge, false)
  assert.equal(r.diferenca, 0)
})

test('divergenciaDeValor: acusa a diferença com sinal', () => {
  // O caso real encontrado em gc-dev: proposta digitada em 1000 com um item de 300.
  const r = divergenciaDeValor(1000, [{ valor_total: 300 }])
  assert.equal(r.diverge, true)
  assert.equal(r.diferenca, 700)
  assert.equal(divergenciaDeValor(200, [{ valor_total: 300 }]).diferenca, -100)
})

test('divergenciaDeValor: ignora ruído de ponto flutuante abaixo de meio centavo', () => {
  const r = divergenciaDeValor(0.3, [{ valor_total: 0.1 }, { valor_total: 0.2 }])
  assert.equal(r.diverge, false)
})

test('divergenciaDeValor: soma abaixo do desconto é divergência esperada, sinalizada', () => {
  // Proposta com desconto de 100 recebendo o primeiro item, de 50: o trigger
  // não sincroniza (violaria o CHECK) e a tela explica em vez de oferecer botão.
  const r = divergenciaDeValor(1000, [{ valor_total: 50 }], 100)
  assert.equal(r.diverge, true)
  assert.equal(r.somaAbaixoDoDesconto, true)
  assert.equal(divergenciaDeValor(1000, [{ valor_total: 300 }], 100).somaAbaixoDoDesconto, false)
})

// ============================================================
// Duplicar, reordenar e lote (bloco 5.7)
// ============================================================

test('camposParaDuplicar copia o editável, sem número e sem foto', () => {
  const c = camposParaDuplicar({
    numero: 4, tipo: 'Janela', descricao: 'D', linha: 'L', acabamento: 'A', localizacao: 'X',
    vidros: 'V', observacao: 'O', largura: 1, altura: 2, quantidade: 3, unidade: 'M2', valor_unit: 10,
    ...({ foto_url: 'empresa/itens/x/f.jpg', proposta_id: 'p' } as object),
  } as Parameters<typeof camposParaDuplicar>[0])
  assert.equal('numero' in c, false)
  assert.equal('foto_url' in c, false)
  assert.equal('proposta_id' in c, false)
  assert.equal(c.tipo, 'Janela')
  assert.equal(c.observacao, 'O')
  assert.equal(c.valor_unit, 10)
})

test('vizinhoParaMover troca com o vizinho numerado', () => {
  const lista = [{ id: 'a', numero: 1 }, { id: 'b', numero: 3 }, { id: 'c', numero: 7 }, { id: 'z', numero: null }]
  assert.equal(vizinhoParaMover(lista, 'b', 'subir'), 'a')
  assert.equal(vizinhoParaMover(lista, 'b', 'descer'), 'c')
})

test('vizinhoParaMover não passa das pontas e ignora item sem número', () => {
  const lista = [{ id: 'a', numero: 1 }, { id: 'c', numero: 7 }, { id: 'z', numero: null }]
  assert.equal(vizinhoParaMover(lista, 'a', 'subir'), null)
  assert.equal(vizinhoParaMover(lista, 'c', 'descer'), null, 'o último numerado não desce para o sem número')
  assert.equal(vizinhoParaMover(lista, 'z', 'subir'), null, 'o sem número não se move')
  assert.equal(vizinhoParaMover(lista, 'inexistente', 'subir'), null)
})

test('validarPercentual aceita a faixa da função do banco', () => {
  assert.equal(validarPercentual(5), null)
  assert.equal(validarPercentual('-10'), null)
  assert.equal(validarPercentual('2,5'), null, 'vírgula decimal')
  assert.match(validarPercentual(0) ?? '', /0%/)
  assert.match(validarPercentual(-100) ?? '', /negativo/)
  assert.match(validarPercentual(1001) ?? '', /1000%/)
  assert.match(validarPercentual('') ?? '', /Informe/)
  assert.match(validarPercentual('abc') ?? '', /Informe/)
})

test('ajustarValorUnit arredonda para centavos como o banco', () => {
  // Conferido contra ajustar_valor_itens em gc-dev: 33,33 × 1,05 = 35,00.
  assert.equal(ajustarValorUnit(33.33, 5), 35)
  assert.equal(ajustarValorUnit(100, 5), 105)
  assert.equal(ajustarValorUnit(100, -10), 90)
  assert.equal(ajustarValorUnit(1.005, 0.0001), 1.01)
})

test('previaAjuste soma antes e depois, e conta os itens sem valor', () => {
  const r = previaAjuste([
    { valor_unit: 100, quantidade: 2, valor_total: 200 },
    { valor_unit: 33.33, quantidade: 1, valor_total: 33.33 },
    { valor_unit: null, quantidade: 1, valor_total: null },
  ], 5)
  assert.deepEqual(r, { afetados: 2, semValor: 1, antes: 233.33, depois: 245 })
})
