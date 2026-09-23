import test from 'node:test'
import assert from 'node:assert/strict'

import {
  COLUNAS_IMPORTACAO,
  criarItemFormSchema,
  itemFormParaPayload,
  itemFormVazio,
  resumoDaPlanilha,
  validarLinhaImportacao,
  validarPlanilha,
} from './itens-form.ts'

const schema = criarItemFormSchema({ numerosEmUso: [] })

/** Atalho: valores válidos mínimos, para variar um campo por teste. */
function base(over: Record<string, unknown> = {}) {
  return { ...itemFormVazio(1), ...over }
}

function erros(valores: Record<string, unknown>, ctx = { numerosEmUso: [] as number[] }) {
  const r = criarItemFormSchema(ctx).safeParse(valores)
  return r.success ? [] : r.error.issues.map((i) => `${String(i.path[0])}: ${i.message}`)
}

// ============================================================
// Schema — as regras que o bloco 5.3 pede
// ============================================================

test('valores mínimos válidos passam', () => {
  const r = schema.safeParse(base())
  assert.equal(r.success, true, JSON.stringify(erros(base())))
})

test('quantidade tem de ser maior que zero', () => {
  assert.match(erros(base({ quantidade: 0 })).join(), /Quantidade tem de ser maior/)
  assert.match(erros(base({ quantidade: -3 })).join(), /Quantidade tem de ser maior/)
  assert.equal(erros(base({ quantidade: 0.5 })).length, 0)
})

test('quantidade vazia é recusada — é dela que saem as colunas geradas', () => {
  assert.ok(erros(base({ quantidade: '' })).length > 0)
})

test('valor_unit aceita vazio e recusa negativo', () => {
  assert.equal(erros(base({ valor_unit: '' })).length, 0)
  assert.equal(erros(base({ valor_unit: 0 })).length, 0)
  assert.match(erros(base({ valor_unit: -1 })).join(), /não pode ser negativa/)
})

test('unidade aceita só QTD e M2', () => {
  assert.equal(erros(base({ unidade: 'QTD' })).length, 0)
  assert.equal(erros(base({ unidade: 'M2' })).length, 0)
  // ML foi removido do CHECK na revisão de schema
  assert.ok(erros(base({ unidade: 'ML' })).length > 0)
  assert.ok(erros(base({ unidade: '' })).length > 0)
})

test('largura e altura aceitam vazio e recusam negativo', () => {
  assert.equal(erros(base({ largura: '', altura: '' })).length, 0)
  assert.match(erros(base({ largura: -2 })).join(), /Largura não pode ser negativa/)
  assert.match(erros(base({ altura: -2 })).join(), /Altura não pode ser negativa/)
})

test('numero tem de ser inteiro positivo, e aceita vazio', () => {
  assert.equal(erros(base({ numero: '' })).length, 0)
  assert.match(erros(base({ numero: 1.5 })).join(), /inteiro/)
  assert.match(erros(base({ numero: 0 })).join(), /maior que zero/)
  assert.match(erros(base({ numero: -1 })).join(), /maior que zero/)
})

test('numero já em uso é recusado antes do banco', () => {
  const ctx = { numerosEmUso: [1, 2, 5] }
  assert.match(erros(base({ numero: 2 }), ctx).join(), /Já existe um item com esse número/)
  assert.equal(erros(base({ numero: 3 }), ctx).length, 0)
  // vazio nunca colide: o unique parcial do Postgres não deduplica null
  assert.equal(erros(base({ numero: '' }), ctx).length, 0)
})

// ============================================================
// Payload — o que chega na Server Action
// ============================================================

test('itemFormParaPayload converte texto vazio em null', () => {
  const r = schema.safeParse(base({ tipo: '', descricao: '  ', observacao: 'algo' }))
  assert.equal(r.success, true)
  if (!r.success) return
  const p = itemFormParaPayload(r.data)
  assert.equal(p.tipo, null)
  assert.equal(p.descricao, null, 'só espaços também vira null')
  assert.equal(p.observacao, 'algo')
})

test('itemFormParaPayload NÃO inclui as colunas geradas', () => {
  const r = schema.safeParse(base({ largura: 2, altura: 1.5, valor_unit: 100 }))
  assert.equal(r.success, true)
  if (!r.success) return
  const p = itemFormParaPayload(r.data) as Record<string, unknown>
  assert.equal('valor_total' in p, false)
  assert.equal('area_m2' in p, false)
})

test('itemFormParaPayload preserva número vazio como null', () => {
  const r = schema.safeParse(base({ numero: '', valor_unit: '' }))
  assert.equal(r.success, true)
  if (!r.success) return
  const p = itemFormParaPayload(r.data)
  assert.equal(p.numero, null)
  assert.equal(p.valor_unit, null)
})

// ============================================================
// Importação (bloco 5.4) — a MESMA validação, por linha
// ============================================================

test('COLUNAS_IMPORTACAO cobre os campos do formulário', () => {
  const chaves = COLUNAS_IMPORTACAO.map((c) => c.chave)
  for (const esperada of [
    'numero', 'tipo', 'descricao', 'linha', 'acabamento', 'localizacao',
    'vidros', 'largura', 'altura', 'quantidade', 'unidade', 'valor_unit',
    'observacao',
  ]) {
    assert.ok(chaves.includes(esperada as never), `falta a coluna ${esperada}`)
  }
})

test('linha válida da planilha passa e devolve os valores convertidos', () => {
  const r = validarLinhaImportacao(2, {
    numero: 1, tipo: 'Janela', descricao: 'Correr 2 folhas',
    largura: 1.5, altura: 1.2, quantidade: 4, unidade: 'M2', valor_unit: 890.5,
  }, [])
  assert.equal(r.ok, true)
  if (r.ok) {
    assert.equal(r.valores.quantidade, 4)
    assert.equal(r.valores.unidade, 'M2')
    assert.equal(r.linha, 2)
  }
})

test('célula de unidade vazia cai em QTD, não reprova a linha', () => {
  const r = validarLinhaImportacao(2, { quantidade: 1 }, [])
  assert.equal(r.ok, true)
  if (r.ok) assert.equal(r.valores.unidade, 'QTD')
})

test('linha inválida devolve erro com o TÍTULO da coluna, não a chave', () => {
  const r = validarLinhaImportacao(7, { quantidade: 0, unidade: 'ML' }, [])
  assert.equal(r.ok, false)
  if (!r.ok) {
    assert.equal(r.linha, 7)
    assert.match(r.erros.join(' '), /Quantidade:/)
    assert.match(r.erros.join(' '), /Unidade \(QTD ou M2\):/)
  }
})

test('linha sem quantidade é recusada', () => {
  const r = validarLinhaImportacao(2, { tipo: 'Janela' }, [])
  assert.equal(r.ok, false)
})

test('validarPlanilha numera as linhas a partir de 2 (linha 1 é cabeçalho)', () => {
  const r = validarPlanilha(
    [{ quantidade: 1 }, { quantidade: 2 }, { quantidade: 3 }],
    [],
  )
  assert.deepEqual(r.map((l) => l.linha), [2, 3, 4])
})

test('validarPlanilha acusa número repetido DENTRO do arquivo', () => {
  // Sem o acumulador, as duas linhas passariam no preview e a segunda
  // estouraria o unique parcial no meio do insert.
  const r = validarPlanilha(
    [
      { numero: 1, quantidade: 1 },
      { numero: 1, quantidade: 2 },
    ],
    [],
  )
  assert.equal(r[0].ok, true)
  assert.equal(r[1].ok, false)
  if (!r[1].ok) assert.match(r[1].erros.join(' '), /Já existe um item com esse número/)
})

test('validarPlanilha acusa número que já existe no banco', () => {
  const r = validarPlanilha([{ numero: 5, quantidade: 1 }], [5])
  assert.equal(r[0].ok, false)
})

test('validarPlanilha deixa passar várias linhas sem numero', () => {
  const r = validarPlanilha(
    [{ quantidade: 1 }, { quantidade: 1 }, { quantidade: 1 }],
    [],
  )
  assert.equal(r.filter((l) => l.ok).length, 3)
})

test('resumoDaPlanilha conta válidas e com erro', () => {
  const linhas = validarPlanilha(
    [{ quantidade: 1 }, { quantidade: 0 }, { quantidade: 2 }],
    [],
  )
  assert.deepEqual(resumoDaPlanilha(linhas), { total: 3, validas: 2, comErro: 1 })
})
