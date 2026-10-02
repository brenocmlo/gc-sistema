import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  avisoDeExcesso,
  formParaPayloadPagamento,
  inicioDaBaixa,
  mensagemDeErroPagamento,
  pagamentoSchema,
  pagamentoVazioFormValues,
  saldoEmAberto,
  validarPayloadPagamento,
  type PagamentoPayload,
} from './pagamentos-form.ts'

const OBRA = '11111111-1111-4111-8111-111111111111'
const NF = '22222222-2222-4222-8222-222222222222'
const PARCELA = '33333333-3333-4333-8333-333333333333'
const ACORDO = '44444444-4444-4444-8444-444444444444'

const erros = (v: object) => {
  const r = pagamentoSchema.safeParse(v)
  return r.success ? {} : Object.fromEntries(r.error.issues.map((i) => [i.path.join('.'), i.message]))
}

test('as três combinações de pagamento_vinculo_consistente são as da migration', () => {
  const sql = readFileSync(new URL('../../supabase/migrations/20260424121550_initial.sql', import.meta.url), 'utf8')
  const bloco = sql.match(/constraint pagamento_vinculo_consistente check \(([\s\S]*?)\n  \),/)
  assert.ok(bloco, 'constraint não encontrada')
  assert.match(bloco[1], /origem = 'nf' and nota_id is not null and parcela_acordo_id is null/)
  assert.match(bloco[1], /origem = 'acordo' and parcela_acordo_id is not null and nota_id is null/)
  assert.match(bloco[1], /origem = 'avulso' and nota_id is null and parcela_acordo_id is null/)
})

test('form vazio: data de hoje, origem NF, e os obrigatórios barrados', () => {
  const v = pagamentoVazioFormValues('2026-10-14')
  assert.equal(v.data_pagamento, '2026-10-14')
  assert.equal(v.origem, 'nf')
  const e = erros(v)
  assert.equal(e.obra_id, 'Selecione uma obra')
  assert.equal(e.valor, 'O valor tem de ser maior que zero')
  assert.equal(e.forma, 'Selecione a forma')
  // O vínculo vem do superRefine, que o zod só roda com os campos básicos
  // válidos (como no form de NF): a mensagem dele aparece no envio seguinte.
  assert.equal(e.nota_id, undefined)
  // A baixa rápida (10.3) começa com a origem e o vínculo preenchidos.
  assert.equal(pagamentoVazioFormValues('2026-10-14', { origem: 'acordo', parcela_acordo_id: PARCELA }).parcela_acordo_id, PARCELA)
})

test('zod condicional: cada origem exige o seu vínculo, e o avulso a observação', () => {
  const base = { obra_id: OBRA, data_pagamento: '2026-10-14', valor: 100, forma: 'pix' }
  assert.deepEqual(erros({ ...base, origem: 'nf', nota_id: NF }), {})
  assert.equal(erros({ ...base, origem: 'acordo' }).acordo_id, 'Selecione o acordo')
  assert.equal(erros({ ...base, origem: 'acordo', acordo_id: ACORDO }).parcela_acordo_id, 'Selecione a parcela')
  assert.deepEqual(erros({ ...base, origem: 'acordo', acordo_id: ACORDO, parcela_acordo_id: PARCELA }), {})
  assert.equal(erros({ ...base, origem: 'avulso', observacao: 'ok' }).observacao, 'No avulso, diga do que é o pagamento')
  assert.deepEqual(erros({ ...base, origem: 'avulso', observacao: 'Taxa de visita técnica' }), {})
  assert.equal(erros({ ...base, origem: 'nf', nota_id: NF, forma: 'credito' }).forma, 'Selecione a forma')
  assert.deepEqual(erros({ ...base, origem: 'nf', nota_id: NF, forma: 'cartao' }), {}, 'cartão vale (migration 004)')
})

test('o payload leva só o vínculo da origem escolhida', () => {
  const v = { obra_id: OBRA, data_pagamento: '2026-10-14', valor: '150.5', forma: 'ted', nota_id: NF, acordo_id: ACORDO, parcela_acordo_id: PARCELA, observacao: '  ' }
  const nf = formParaPayloadPagamento({ ...v, origem: 'nf' } as never)
  assert.deepEqual([nf.nota_id, nf.parcela_acordo_id, nf.valor, nf.observacao], [NF, null, 150.5, null])
  const ac = formParaPayloadPagamento({ ...v, origem: 'acordo' } as never)
  assert.deepEqual([ac.nota_id, ac.parcela_acordo_id], [null, PARCELA])
  const av = formParaPayloadPagamento({ ...v, origem: 'avulso', observacao: 'Adiantamento' } as never)
  assert.deepEqual([av.nota_id, av.parcela_acordo_id, av.observacao], [null, null, 'Adiantamento'])
})

test('validarPayloadPagamento recusa as combinações que a constraint recusa, e o resto', () => {
  const ok: PagamentoPayload = { obra_id: OBRA, origem: 'nf', nota_id: NF, parcela_acordo_id: null, data_pagamento: '2026-10-14', valor: 100, forma: 'pix', observacao: null }
  assert.deepEqual(validarPayloadPagamento(ok), { ok: true })
  const recusa = (p: Partial<PagamentoPayload>) => {
    const r = validarPayloadPagamento({ ...ok, ...p })
    assert.equal(r.ok, false, JSON.stringify(p))
    return r.ok ? '' : r.error
  }
  assert.match(recusa({ parcela_acordo_id: PARCELA }), /só ela/, 'NF com parcela junto')
  assert.match(recusa({ nota_id: null }), /nota fiscal/)
  assert.match(recusa({ origem: 'acordo' }), /parcela/, 'acordo com a NF no lugar da parcela')
  assert.match(recusa({ origem: 'avulso', observacao: 'Taxa de visita' }), /não tem nota fiscal/)
  assert.match(recusa({ origem: 'avulso', nota_id: null, observacao: null }), /diga do que é/)
  assert.match(recusa({ origem: 'boleto' as never }), /Origem/)
  assert.match(recusa({ valor: 0 }), /maior que zero/)
  assert.match(recusa({ valor: 10.005 }), /2 casas/)
  assert.match(recusa({ forma: 'credito' as never }), /Forma/)
  assert.match(recusa({ data_pagamento: '14/10/2026' }), /Data/)
  assert.equal(validarPayloadPagamento(null).ok, false)
})

test('mensagemDeErroPagamento traduz as constraints, e o resto passa', () => {
  assert.match(mensagemDeErroPagamento('new row violates check constraint "pagamento_vinculo_consistente"'), /não combinam/)
  assert.match(mensagemDeErroPagamento('pagamento_nf_cancelada: ...'), /cancelada/)
  assert.match(mensagemDeErroPagamento('pagamento_parcela_cancelada'), /Parcela cancelada/, 'o trigger da migration 035')
  assert.match(mensagemDeErroPagamento('pagamento_acordo_fechado'), /convertido em nota fiscal/, 'o trigger da migration 037')
  assert.match(mensagemDeErroPagamento('insert or update on table "pagamentos" violates foreign key constraint "pagamentos_nota_fk"'), /mesma obra/)
  assert.equal(mensagemDeErroPagamento('outra coisa'), 'outra coisa')
})

test('saldo em centavos e o aviso de excesso', () => {
  assert.equal(saldoEmAberto(5000, [{ valor: 2000 }]), 3000)
  assert.equal(saldoEmAberto('0.30', [{ valor: 0.1 }, { valor: '0.2' }]), 0)
  assert.equal(saldoEmAberto(100, [{ valor: 150 }]), 0, 'nunca negativo')
  assert.equal(avisoDeExcesso(3000, 3000, 'nota fiscal'), null, 'igual ao saldo não avisa')
  assert.match(avisoDeExcesso(3000.5, 3000, 'nota fiscal') ?? '', /passa em R\$\s0,50 o saldo da nota fiscal/)
  assert.match(avisoDeExcesso(10, 0, 'parcela') ?? '', /já está quitada/)
  assert.equal(avisoDeExcesso(10, null, 'parcela'), null, 'avulso não tem saldo')
})

test('inicioDaBaixa: a NF ou a parcela preenchem origem, vínculo, obra e o saldo; id desconhecido é ignorado', () => {
  const opcoes = {
    notas: [{ id: NF, obra_id: OBRA, saldo: 3000 }, { id: 'nf-quitada', obra_id: OBRA, saldo: 0 }],
    parcelas: [{ id: PARCELA, acordo_id: ACORDO, saldo: 2000 }],
    acordos: [{ id: ACORDO, obra_id: OBRA }],
  }
  assert.deepEqual(inicioDaBaixa({ nota: NF }, opcoes), {
    inicio: { obra_id: OBRA, origem: 'nf', nota_id: NF, valor: 3000 },
    voltarPara: `/financeiro/notas-fiscais/${NF}`,
  })
  assert.equal(inicioDaBaixa({ nota: 'nf-quitada' }, opcoes).inicio?.valor, undefined, 'saldo zero não sugere valor')
  assert.deepEqual(inicioDaBaixa({ parcela: PARCELA }, opcoes), {
    inicio: { obra_id: OBRA, origem: 'acordo', acordo_id: ACORDO, parcela_acordo_id: PARCELA, valor: 2000 },
    voltarPara: `/financeiro/acordos/${ACORDO}`,
  }, 'a baixa pela parcela volta para o acordo (11.3)')
  assert.deepEqual(inicioDaBaixa({ nota: 'cancelada-ou-alheia' }, opcoes), { inicio: {}, voltarPara: '/financeiro/pagamentos' })
  assert.deepEqual(inicioDaBaixa({}, opcoes), { inicio: {}, voltarPara: '/financeiro/pagamentos' })
})
