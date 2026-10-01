import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  avisoDoEstorno,
  documentoDoPagamento,
  FORMA_PAGAMENTO_LABELS,
  isPagamentoForma,
  isPagamentoOrigem,
  motivoParaNaoEstornar,
  ORIGEM_PAGAMENTO_LABELS,
  rotuloForma,
  totalDosPagamentos,
} from './pagamentos.ts'

const MIG = (f: string) => readFileSync(new URL(`../../supabase/migrations/${f}`, import.meta.url), 'utf8')
const lista = (m: RegExpMatchArray) => m[1].match(/'([a-z_]+)'/g)!.map((x) => x.slice(1, -1)).sort()

test('origens e formas batem com os CHECKs do banco (forma com cartão, da migration 004)', () => {
  const origem = MIG('20260424121550_initial.sql').match(/origem text not null default 'avulso' check \(origem in \(([^)]*)\)\)/)
  assert.ok(origem, 'CHECK de origem não encontrado')
  assert.deepEqual(Object.keys(ORIGEM_PAGAMENTO_LABELS).sort(), lista(origem))
  const forma = MIG('20260511151924_revisao_schema.sql').match(/pagamentos_forma_check\s+check \(forma in \(([^)]*)\)\)/)
  assert.ok(forma, 'CHECK de forma não encontrado')
  assert.deepEqual(Object.keys(FORMA_PAGAMENTO_LABELS).sort(), lista(forma))
  assert.ok(isPagamentoForma('cartao'))
})

test('guards e rótulo da forma', () => {
  assert.equal(isPagamentoOrigem('nf'), true)
  assert.equal(isPagamentoOrigem('parcela'), false)
  assert.equal(isPagamentoForma('boleto'), true)
  assert.equal(isPagamentoForma('credito'), false)
  assert.equal(rotuloForma('deposito'), 'Depósito')
  assert.equal(rotuloForma(null), '—')
})

test('documentoDoPagamento: NF com série, acordo com parcela, avulso sem documento', () => {
  assert.equal(documentoDoPagamento({ origem: 'nf', nota: { numero: '123', serie: '1' }, parcela: null }), 'NF 123 / 1')
  assert.equal(documentoDoPagamento({ origem: 'nf', nota: { numero: '124', serie: null }, parcela: null }), 'NF 124')
  assert.equal(
    documentoDoPagamento({ origem: 'acordo', nota: null, parcela: { numero_parcela: 2, acordo: { descricao: 'Sinal outubro' } } }),
    'Sinal outubro · parcela 2',
  )
  assert.equal(documentoDoPagamento({ origem: 'avulso', nota: null, parcela: null }), '—')
  assert.equal(documentoDoPagamento({ origem: 'nf', nota: null, parcela: null }), 'NF', 'JOIN nulo não vira avulso')
})

test('totalDosPagamentos soma em centavos exatos', () => {
  assert.equal(totalDosPagamentos([{ valor: 0.1 }, { valor: 0.2 }]), 0.3)
  assert.equal(totalDosPagamentos([{ valor: '1200.00' }, { valor: '800.50' }]), 2000.5)
  assert.equal(totalDosPagamentos(null), 0)
})

test('estorno: só o admin, e nunca de NF cancelada; o aviso diz o que é recalculado', () => {
  assert.equal(motivoParaNaoEstornar('admin', 'paga'), null)
  assert.equal(motivoParaNaoEstornar('admin', null), null, 'avulso e acordo não têm nota')
  assert.match(motivoParaNaoEstornar('financeiro', 'paga') ?? '', /Só o admin/)
  assert.match(motivoParaNaoEstornar('admin', 'cancelada') ?? '', /histórico/)
  assert.match(avisoDoEstorno('nf'), /nota fiscal é recalculado/)
  assert.match(avisoDoEstorno('acordo'), /parcela é recalculado/)
  assert.match(avisoDoEstorno('avulso'), /total recebido/)
})
