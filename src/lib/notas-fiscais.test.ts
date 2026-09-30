import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  filtroDaSituacao,
  isNfTipo,
  isSituacaoNf,
  numeroComSerie,
  recebidoDaNf,
  situacaoDaNf,
  SITUACAO_NF_OPTIONS,
  STATUS_NF_LABELS,
  TIPO_NF_LABELS,
} from './notas-fiscais.ts'

const MIG = (f: string) => readFileSync(new URL(`../../supabase/migrations/${f}`, import.meta.url), 'utf8')

test('os 4 status e os 6 tipos batem com os CHECKs do banco', () => {
  const status = MIG('20260511151924_revisao_schema.sql').match(/notas_fiscais_status_check\s+check \(status in \(([^)]*)\)\)/)
  assert.ok(status, 'CHECK de status não encontrado')
  assert.deepEqual(Object.keys(STATUS_NF_LABELS).sort(), status[1].match(/'([a-z_]+)'/g)!.map((x) => x.slice(1, -1)).sort())
  const tipo = MIG('20260424121550_initial.sql').match(/tipo text not null check \(tipo in \(([^)]*)\)\)/)
  assert.ok(tipo, 'CHECK de tipo não encontrado')
  assert.deepEqual(Object.keys(TIPO_NF_LABELS).sort(), tipo[1].match(/'([a-z_]+)'/g)!.map((x) => x.slice(1, -1)).sort())
})

test('situacaoDaNf: vencida sobrepõe emitida e paga parcialmente, e vencer hoje ainda não é vencida', () => {
  const hoje = '2026-09-28'
  assert.equal(situacaoDaNf({ status: 'emitida', data_vencimento: '2026-09-27' }, hoje), 'vencida')
  assert.equal(situacaoDaNf({ status: 'paga_parcialmente', data_vencimento: '2026-01-01' }, hoje), 'vencida')
  assert.equal(situacaoDaNf({ status: 'emitida', data_vencimento: hoje }, hoje), 'emitida')
  assert.equal(situacaoDaNf({ status: 'emitida', data_vencimento: null }, hoje), 'emitida')
  assert.equal(situacaoDaNf({ status: 'paga', data_vencimento: '2026-01-01' }, hoje), 'paga')
  assert.equal(situacaoDaNf({ status: 'cancelada', data_vencimento: '2026-01-01' }, hoje), 'cancelada')
})

test('filtroDaSituacao traduz a situação para o banco com a mesma regra', () => {
  const hoje = '2026-09-28'
  assert.deepEqual(filtroDaSituacao('vencida', hoje), { status: ['emitida', 'paga_parcialmente'], vencimentoAntesDe: hoje })
  assert.deepEqual(filtroDaSituacao('emitida', hoje), { status: ['emitida'], naoVencidaEm: hoje })
  assert.deepEqual(filtroDaSituacao('paga', hoje), { status: ['paga'] })
  assert.deepEqual(SITUACAO_NF_OPTIONS.map((o) => o.value), ['emitida', 'vencida', 'paga_parcialmente', 'paga', 'cancelada'])
})

test('guards, número com série e recebido', () => {
  assert.equal(isSituacaoNf('vencida'), true)
  assert.equal(isSituacaoNf('parcial'), false, 'o status antigo da migration 004 não vale mais')
  assert.equal(isNfTipo('fat_direto'), true)
  assert.equal(isNfTipo('boleto'), false)
  assert.equal(numeroComSerie('123', '1'), '123 / 1')
  assert.equal(numeroComSerie('123', '  '), '123')
  assert.equal(numeroComSerie('123', null), '123')
  assert.equal(recebidoDaNf([{ valor: 0.1 }, { valor: '0.2' }]), 0.3)
  assert.equal(recebidoDaNf(null), 0)
})

test('isNfEditavel: só a cancelada é terminal', async () => {
  const { isNfEditavel } = await import('./notas-fiscais.ts')
  assert.deepEqual(['emitida', 'paga_parcialmente', 'paga', 'cancelada'].map((s) => isNfEditavel(s as never)), [true, true, true, false])
})

test('9.4: motivo do cancelamento obrigatório e aparado; quem e o que pode ser excluído', async () => {
  const { validarMotivoCancelamento, motivoParaNaoExcluir } = await import('./notas-fiscais.ts')
  assert.deepEqual(validarMotivoCancelamento('  Valor errado  '), { ok: true, motivo: 'Valor errado' })
  assert.match((validarMotivoCancelamento('   ') as { error: string }).error, /motivo/)
  assert.match((validarMotivoCancelamento('abc') as { error: string }).error, /5 caracteres/)
  assert.match((validarMotivoCancelamento(null) as { error: string }).error, /motivo/)
  assert.match((validarMotivoCancelamento('x'.repeat(1001)) as { error: string }).error, /1000/)
  assert.equal(motivoParaNaoExcluir({ status: 'emitida', qtdPagamentos: 0 }, 'admin'), null)
  assert.match(motivoParaNaoExcluir({ status: 'emitida', qtdPagamentos: 0 }, 'financeiro') ?? '', /Só o admin/)
  assert.match(motivoParaNaoExcluir({ status: 'cancelada', qtdPagamentos: 0 }, 'admin') ?? '', /cancelada/)
  assert.match(motivoParaNaoExcluir({ status: 'paga', qtdPagamentos: 2 }, 'admin') ?? '', /pagamento/)
})

test('9.4: mensagemDeErroNf traduz os triggers novos', async () => {
  const { mensagemDeErroNf } = await import('./notas-fiscais-form.ts')
  assert.match(mensagemDeErroNf('nf_cancelada_imutavel'), /não pode ser alterada/)
  assert.match(mensagemDeErroNf('pagamento_nf_cancelada'), /não recebe pagamento/)
  assert.match(mensagemDeErroNf('violates foreign key constraint "pagamentos_nota_fk"'), /não pode ser excluída/)
})
