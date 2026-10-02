import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  avisoDaConversao,
  motivoParaNaoCancelarAcordo,
  planoDoCancelamento,
  avisoDoCancelamento,
  motivoParaNaoQuitar,
  observacaoComCancelamento,
  computeStatusParcela,
  motivoParaNaoConverter,
  tipoNfDoMotivo,
  linhaDaParcela,
  motivoParaNaoCancelarParcela,
  motivoParaNaoEditarParcela,
  motivoParaNaoMexerNoAcordo,
  resumoFinanceiroDoAcordo,
  isAcordoMotivo,
  isAcordoStatus,
  MOTIVO_ACORDO_LABELS,
  resumoDasParcelas,
  SITUACAO_PARCELA_LABELS,
  STATUS_ACORDO_LABELS,
  valorTotalDoAcordo,
} from './acordos.ts'

const MIG = (f: string) => readFileSync(new URL(`../../supabase/migrations/${f}`, import.meta.url), 'utf8')
const lista = (m: RegExpMatchArray) => m[1].match(/'([a-z_]+)'/g)!.map((x) => x.slice(1, -1)).sort()

test('status e motivo do acordo e status da parcela batem com os CHECKs (a parcela, da migration 004)', () => {
  const ini = MIG('20260424121550_initial.sql')
  const status = ini.match(/status text not null default 'aberto' check \(status in \(([^)]*)\)\)/)
  assert.ok(status, 'CHECK de status do acordo não encontrado')
  assert.deepEqual(Object.keys(STATUS_ACORDO_LABELS).sort(), lista(status))
  const motivo = ini.match(/motivo text check \(motivo in \(([\s\S]*?)\)\)/)
  assert.ok(motivo, 'CHECK de motivo não encontrado')
  assert.deepEqual(Object.keys(MOTIVO_ACORDO_LABELS).sort(), lista(motivo))
  const parcela = MIG('20260511151924_revisao_schema.sql').match(/acordo_parcelas_status_check\s+check \(status in \(([^)]*)\)\)/)
  assert.ok(parcela, 'CHECK de status da parcela não encontrado')
  const doBanco = Object.keys(SITUACAO_PARCELA_LABELS).filter((s) => s !== 'atrasada').sort()
  assert.deepEqual(doBanco, lista(parcela))
  assert.ok(!lista(parcela).includes('atrasada'), "'atrasada' não é mais coluna")
})

test('computeStatusParcela: atrasada sobrepõe pendente e paga parcialmente; vencer hoje ainda não é atrasar', () => {
  const hoje = '2026-10-21'
  assert.equal(computeStatusParcela({ status: 'pendente', data_vencimento: '2026-10-20' }, hoje), 'atrasada')
  assert.equal(computeStatusParcela({ status: 'paga_parcialmente', data_vencimento: '2026-01-01' }, hoje), 'atrasada')
  assert.equal(computeStatusParcela({ status: 'pendente', data_vencimento: hoje }, hoje), 'pendente')
  assert.equal(computeStatusParcela({ status: 'paga', data_vencimento: '2026-01-01' }, hoje), 'paga')
  assert.equal(computeStatusParcela({ status: 'cancelada', data_vencimento: '2026-01-01' }, hoje), 'cancelada')
})

test('valor total e resumo: a cancelada não conta, em centavos exatos', () => {
  const ps = [
    { valor_previsto: '1000.10', status: 'paga' as const, data_vencimento: '2026-09-01' },
    { valor_previsto: 0.2, status: 'pendente' as const, data_vencimento: '2026-10-01' },
    { valor_previsto: 500, status: 'cancelada' as const, data_vencimento: '2026-10-01' },
    { valor_previsto: 300, status: 'pendente' as const, data_vencimento: '2026-12-01' },
  ]
  assert.equal(valorTotalDoAcordo(ps), 1300.3)
  assert.deepEqual(resumoDasParcelas(ps, '2026-10-21'), { validas: 3, canceladas: 1, atrasadas: 1 })
  assert.equal(valorTotalDoAcordo(null), 0)
})

test('guards', () => {
  assert.equal(isAcordoStatus('convertido_nf'), true)
  assert.equal(isAcordoStatus('quitada'), false)
  assert.equal(isAcordoMotivo('sem_nf_cliente'), true)
  assert.equal(isAcordoMotivo('outros'), false)
})

test('linha da parcela e resumo do acordo: o recebido conta tudo, o saldo só as válidas e nunca negativo', () => {
  const hoje = '2026-10-21'
  const ps = [
    { valor_previsto: 1000, status: 'paga' as const, data_vencimento: '2026-09-01', pagamentos: [{ valor: 600 }, { valor: '400' }] },
    { valor_previsto: 1000, status: 'paga_parcialmente' as const, data_vencimento: '2026-10-01', pagamentos: [{ valor: 250.5 }] },
    { valor_previsto: 500, status: 'pendente' as const, data_vencimento: '2026-12-01', pagamentos: [] },
    { valor_previsto: 300, status: 'cancelada' as const, data_vencimento: '2026-08-01', pagamentos: [{ valor: 100 }] },
    { valor_previsto: 200, status: 'paga' as const, data_vencimento: '2026-08-01', pagamentos: [{ valor: 260 }] },
  ]
  assert.deepEqual(linhaDaParcela(ps[1], hoje), { pago: 250.5, saldo: 749.5, situacao: 'atrasada' })
  assert.deepEqual(linhaDaParcela(ps[3], hoje), { pago: 100, saldo: 0, situacao: 'cancelada' })
  assert.deepEqual(linhaDaParcela(ps[4], hoje).saldo, 0, 'pago a mais não vira saldo negativo')
  assert.deepEqual(resumoFinanceiroDoAcordo(ps), { total: 2700, recebido: 1610.5, saldo: 1249.5 })
})

test('quem mexe nas parcelas, e quando cancelar ou editar é recusado', () => {
  assert.equal(motivoParaNaoMexerNoAcordo('financeiro', 'aberto'), null)
  assert.match(motivoParaNaoMexerNoAcordo('visualizador', 'aberto') ?? '', /admin e financeiro/)
  assert.match(motivoParaNaoMexerNoAcordo('admin', 'quitado') ?? '', /quitado/)
  assert.match(motivoParaNaoMexerNoAcordo('admin', 'convertido_nf') ?? '', /convertido em NF/)
  assert.equal(motivoParaNaoCancelarParcela({ status: 'pendente', qtdPagamentos: 0 }), null)
  assert.match(motivoParaNaoCancelarParcela({ status: 'paga_parcialmente', qtdPagamentos: 1 }) ?? '', /estorne/)
  assert.match(motivoParaNaoCancelarParcela({ status: 'cancelada', qtdPagamentos: 0 }) ?? '', /já está cancelada/)
  assert.equal(motivoParaNaoEditarParcela({ status: 'paga_parcialmente', pago: 250 }, 250), null)
  assert.match(motivoParaNaoEditarParcela({ status: 'paga_parcialmente', pago: 250 }, 249.99) ?? '', /abaixo do que já foi pago/)
  assert.match(motivoParaNaoEditarParcela({ status: 'cancelada', pago: 0 }, 10) ?? '', /não é editável/)
})

test('conversão em NF: quem converte, o tipo sugerido e o aviso dos pagamentos', () => {
  assert.equal(motivoParaNaoConverter('financeiro', 'aberto', 1600), null)
  assert.match(motivoParaNaoConverter('visualizador', 'aberto', 1600) ?? '', /admin e financeiro/)
  assert.match(motivoParaNaoConverter('admin', 'quitado', 0) ?? '', /quitado não é convertido/)
  assert.match(motivoParaNaoConverter('admin', 'convertido_nf', 100) ?? '', /convertido em NF não é convertido/)
  assert.match(motivoParaNaoConverter('admin', 'aberto', 0) ?? '', /sem saldo|não tem saldo/)
  assert.equal(tipoNfDoMotivo('sinal'), 'sinal')
  assert.equal(tipoNfDoMotivo('adiantamento_material'), 'entrega_material')
  assert.equal(tipoNfDoMotivo(null), 'outro')
  const com = avisoDaConversao({ recebido: 400, qtdPagamentos: 2, saldo: 1600 }).join(' ')
  assert.match(com, /saldo do acordo \(R\$ 1\.600,00\)/)
  assert.match(com, /2 pagamentos já lançados \(R\$ 400,00\) ficam arquivados/)
  assert.match(com, /Não dá para desfazer/)
  assert.match(avisoDaConversao({ recebido: 0, qtdPagamentos: 0, saldo: 10 }).join(' '), /nada fica arquivado/)
  assert.match(avisoDaConversao({ recebido: 100, qtdPagamentos: 1, saldo: 900 }).join(' '), /O pagamento já lançado \(R\$ 100,00\) fica arquivado/)
})

test('encerrar à mão: quitar (sem parcial e com alguma paga) e cancelar (sem pagamento)', () => {
  const ps = (...st: string[]) => st.map((status, i) => ({ numero_parcela: i + 1, status: status as never }))
  assert.equal(motivoParaNaoQuitar('financeiro', 'aberto', ps('paga', 'pendente')), null)
  assert.match(motivoParaNaoQuitar('financeiro', 'aberto', ps('paga', 'paga_parcialmente')) ?? '', /parcela 2 está paga parcialmente/)
  assert.match(motivoParaNaoQuitar('admin', 'aberto', ps('pendente', 'cancelada')) ?? '', /cancele o acordo/)
  assert.match(motivoParaNaoQuitar('admin', 'convertido_nf', ps('paga')) ?? '', /convertido em NF já está encerrado/)
  assert.match(motivoParaNaoQuitar('visualizador', 'aberto', ps('paga')) ?? '', /admin e financeiro/)
  assert.equal(motivoParaNaoCancelarAcordo('admin', 'aberto'), null)
  assert.match(motivoParaNaoCancelarAcordo('admin', 'quitado') ?? '', /já está encerrado/)
  assert.equal(observacaoComCancelamento(null, ' cliente desistiu ', '2026-10-21'), 'Cancelado em 21/10/2026: cliente desistiu')
  assert.equal(observacaoComCancelamento('Combinado por WhatsApp', 'desistiu', '2026-10-21'), 'Combinado por WhatsApp\nCancelado em 21/10/2026: desistiu')
})

test('cancelar com pagamento: encerra pelo recebido (parcial desce ao pago, sem pagamento cancela)', () => {
  const parc = (id: string, n: number, status: string, previsto: number, pago: number) => ({ id, numero_parcela: n, status: status as never, valor_previsto: previsto, pago })
  const sem = planoDoCancelamento([parc('a', 1, 'pendente', 500, 0), parc('b', 2, 'pendente', 500, 0)])
  assert.deepEqual(sem, { recebido: 0, ajustar: [], cancelar: ['a', 'b'], semReceber: 1000 })
  assert.match(avisoDoCancelamento(sem), /ficam cancelados e saem do a receber/)

  const com = planoDoCancelamento([
    parc('a', 1, 'paga', 500, 500),
    parc('b', 2, 'paga_parcialmente', 500, 120.1),
    parc('c', 3, 'pendente', 300, 0),
    parc('d', 4, 'cancelada', 200, 0),
  ])
  assert.deepEqual(com, { recebido: 620.1, ajustar: [{ id: 'b', numero: 2, valor: 120.1 }], cancelar: ['c'], semReceber: 679.9 })
  const aviso = avisoDoCancelamento(com)
  assert.match(aviso, /já recebeu R\$ 620,10, e esse valor continua no recebido da obra/)
  assert.match(aviso, /O que faltava \(R\$ 679,90\) sai do a receber/)
  assert.match(aviso, /A parcela 2, paga em parte, fica com o valor pago/)
  assert.match(aviso, /encerrado como quitado pelo valor recebido/)
  assert.equal(observacaoComCancelamento(null, 'cliente desistiu', '2026-10-21', 620.1), 'Cancelado em 21/10/2026, encerrado pelo recebido (R$ 620,10): cliente desistiu')
})
