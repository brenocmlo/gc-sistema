// Regras puras dos acordos de pagamento e das parcelas (sprint 11). Sem React:
// serve Server Component, Server Action, rota de export e `node --test`.

import type { AcordoMotivo, AcordoStatus, NotaFiscalTipo, ParcelaStatus } from './types'

export const STATUS_ACORDO_LABELS: Record<AcordoStatus, string> = {
  aberto: 'Aberto',
  quitado: 'Quitado',
  cancelado: 'Cancelado',
  convertido_nf: 'Convertido em NF',
}

export const STATUS_ACORDO_CLASSES: Record<AcordoStatus, string> = {
  aberto: 'bg-blue-100 text-blue-700 border-blue-200',
  quitado: 'bg-green-100 text-green-700 border-green-200',
  cancelado: 'bg-gray-100 text-gray-600 border-gray-200',
  convertido_nf: 'bg-purple-100 text-purple-700 border-purple-200',
}

export const STATUS_ACORDO_OPTIONS: readonly { value: AcordoStatus; label: string }[] = (
  Object.keys(STATUS_ACORDO_LABELS) as AcordoStatus[]
).map((v) => ({ value: v, label: STATUS_ACORDO_LABELS[v] }))

export function isAcordoStatus(v: string): v is AcordoStatus {
  return v in STATUS_ACORDO_LABELS
}

export const MOTIVO_ACORDO_LABELS: Record<AcordoMotivo, string> = {
  sinal: 'Sinal',
  adiantamento_material: 'Adiantamento de material',
  sem_nf_cliente: 'Cliente sem NF',
  aditivo_informal: 'Aditivo informal',
  emergencial: 'Emergencial',
  outro: 'Outro',
}

export const MOTIVO_ACORDO_OPTIONS: readonly { value: AcordoMotivo; label: string }[] = (
  Object.keys(MOTIVO_ACORDO_LABELS) as AcordoMotivo[]
).map((v) => ({ value: v, label: MOTIVO_ACORDO_LABELS[v] }))

export function isAcordoMotivo(v: string): v is AcordoMotivo {
  return v in MOTIVO_ACORDO_LABELS
}

/**
 * O que a tela mostra da parcela: os 4 status do banco e "atrasada", que a
 * migration 004 tirou do CHECK e passou a ser calculada em runtime (como a NF
 * "vencida" do 9.1): pendente ou paga parcialmente com o vencimento antes de hoje.
 */
export type SituacaoParcela = ParcelaStatus | 'atrasada'

export const SITUACAO_PARCELA_LABELS: Record<SituacaoParcela, string> = {
  pendente: 'Pendente',
  paga_parcialmente: 'Paga parcialmente',
  paga: 'Paga',
  cancelada: 'Cancelada',
  atrasada: 'Atrasada',
}

export const SITUACAO_PARCELA_CLASSES: Record<SituacaoParcela, string> = {
  pendente: 'bg-blue-100 text-blue-700 border-blue-200',
  paga_parcialmente: 'bg-yellow-100 text-yellow-700 border-yellow-200',
  paga: 'bg-green-100 text-green-700 border-green-200',
  cancelada: 'bg-gray-100 text-gray-600 border-gray-200',
  atrasada: 'bg-red-100 text-red-700 border-red-200',
}

const EM_ABERTO: readonly ParcelaStatus[] = ['pendente', 'paga_parcialmente']

/** A situação da parcela: atrasada sobrepõe pendente e paga parcialmente. Vencer hoje ainda não é atrasar. */
export function computeStatusParcela(
  parcela: { status: ParcelaStatus; data_vencimento: string },
  hoje: string,
): SituacaoParcela {
  if (EM_ABERTO.includes(parcela.status) && parcela.data_vencimento < hoje) return 'atrasada'
  return parcela.status
}

type ParcelaResumo = { valor_previsto: number | string; status: ParcelaStatus; data_vencimento: string }

/** O "valor total do acordo" é a soma das parcelas (o acordo não tem coluna de total); a cancelada não conta. Em centavos exatos. */
export function valorTotalDoAcordo(parcelas: readonly ParcelaResumo[] | null | undefined): number {
  const centavos = (parcelas ?? [])
    .filter((p) => p.status !== 'cancelada')
    .reduce((acc, p) => acc + Math.round(Number(p.valor_previsto) * 100), 0)
  return centavos / 100
}

/** Parcelas que contam (não canceladas), e quantas delas estão atrasadas hoje. */
export function resumoDasParcelas(
  parcelas: readonly ParcelaResumo[] | null | undefined,
  hoje: string,
): { validas: number; canceladas: number; atrasadas: number } {
  const lista = parcelas ?? []
  return {
    validas: lista.filter((p) => p.status !== 'cancelada').length,
    canceladas: lista.filter((p) => p.status === 'cancelada').length,
    atrasadas: lista.filter((p) => computeStatusParcela(p, hoje) === 'atrasada').length,
  }
}

// ------------------------------------------------------------
// Detalhe do acordo (11.3)
// ------------------------------------------------------------

type ParcelaComPagamentos = ParcelaResumo & { pagamentos?: readonly { valor: number | string }[] | null }

const emCentavos = (v: number | string) => Math.round(Number(v) * 100)

/** "Convertido em NF" → "convertido em NF": só a primeira letra, para a sigla ficar. */
const minusculaInicial = (t: string) => t.charAt(0).toLowerCase() + t.slice(1)

/** Uma linha da tabela de parcelas: o que entrou, o que falta e a situação de hoje. */
export function linhaDaParcela(p: ParcelaComPagamentos, hoje: string): { pago: number; saldo: number; situacao: SituacaoParcela } {
  const pago = (p.pagamentos ?? []).reduce((acc, x) => acc + emCentavos(x.valor), 0)
  const saldo = p.status === 'cancelada' ? 0 : Math.max(0, emCentavos(p.valor_previsto) - pago)
  return { pago: pago / 100, saldo: saldo / 100, situacao: computeStatusParcela(p, hoje) }
}

/**
 * O cabeçalho do acordo. Total: as parcelas válidas. Recebido: TODO pagamento
 * do acordo, inclusive o de parcela que foi cancelada depois (o dinheiro
 * entrou). Saldo: o que falta nas parcelas válidas — pagamento a mais numa
 * parcela não abate o saldo de outra.
 */
export function resumoFinanceiroDoAcordo(parcelas: readonly ParcelaComPagamentos[] | null | undefined): {
  total: number
  recebido: number
  saldo: number
} {
  const lista = parcelas ?? []
  const recebido = lista.reduce((acc, p) => acc + (p.pagamentos ?? []).reduce((a, x) => a + emCentavos(x.valor), 0), 0)
  const saldo = lista.reduce((acc, p) => acc + emCentavos(linhaDaParcela(p, '0000-00-00').saldo), 0)
  return { total: valorTotalDoAcordo(lista), recebido: recebido / 100, saldo: saldo / 100 }
}

/** Mexer nas parcelas (adicionar, editar, cancelar) só com o acordo aberto e para admin e financeiro. */
export function motivoParaNaoMexerNoAcordo(perfil: string, statusAcordo: AcordoStatus): string | null {
  if (perfil !== 'admin' && perfil !== 'financeiro') return 'Só admin e financeiro mexem nas parcelas'
  if (statusAcordo !== 'aberto') return `Acordo ${minusculaInicial(STATUS_ACORDO_LABELS[statusAcordo])} não muda de parcela`
  return null
}

/**
 * Cancelar a parcela: só a que não recebeu pagamento. Com pagamento, a parcela
 * cancelada ficaria com dinheiro que não conta no saldo; estorne antes (10.3).
 */
export function motivoParaNaoCancelarParcela(p: { status: ParcelaStatus; qtdPagamentos: number }): string | null {
  if (p.status === 'cancelada') return 'A parcela já está cancelada'
  if (p.qtdPagamentos > 0) return 'A parcela tem pagamento: estorne antes de cancelar'
  return null
}

/** Editar o valor previsto: não pode ficar abaixo do que já foi pago (como a NF, 9.3). */
export function motivoParaNaoEditarParcela(p: { status: ParcelaStatus; pago: number }, novoValor: number): string | null {
  if (p.status === 'cancelada') return 'Parcela cancelada não é editável'
  if (emCentavos(novoValor) < emCentavos(p.pago)) return 'O valor não pode ficar abaixo do que já foi pago'
  return null
}

// ------------------------------------------------------------
// Conversão em nota fiscal (11.4, regra 7 do CONTEXT)
// ------------------------------------------------------------

/** O tipo da NF sugerido pelo motivo do acordo; a pessoa pode trocar. */
export function tipoNfDoMotivo(motivo: AcordoMotivo | null): NotaFiscalTipo {
  if (motivo === 'sinal') return 'sinal'
  if (motivo === 'adiantamento_material') return 'entrega_material'
  return 'outro'
}

/** Converter: admin e financeiro, só acordo aberto, e com saldo (a NF de saldo vale o que falta). */
export function motivoParaNaoConverter(perfil: string, status: AcordoStatus, saldo: number): string | null {
  if (perfil !== 'admin' && perfil !== 'financeiro') return 'Só admin e financeiro convertem acordo em nota fiscal'
  if (status !== 'aberto') return `Acordo ${minusculaInicial(STATUS_ACORDO_LABELS[status])} não é convertido`
  if (emCentavos(saldo) <= 0) return 'O acordo não tem saldo: não há o que faturar'
  return null
}

/** Reais no texto (aviso e observação), com espaço comum: sai igual no SSR, no cliente e no banco. */
const moeda = (v: number) => `R$ ${(emCentavos(v) / 100).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`

/**
 * O aviso explícito do diálogo de conversão: o que acontece com os
 * pagamentos já lançados (ficam arquivados, fora do recebido da obra) e por
 * que a NF vale o saldo, e não o total.
 */
export function avisoDaConversao(r: { recebido: number; qtdPagamentos: number; saldo: number }): string[] {
  const linhas = [
    'O acordo passa a "convertido em NF": não recebe mais baixa, e as parcelas não mudam mais.',
    `A nota fiscal entra no lugar das parcelas, no a receber da obra. Ela deve valer o saldo do acordo (${moeda(r.saldo)}), e não o total: assim o saldo da obra não muda.`,
  ]
  linhas.push(
    r.qtdPagamentos === 0
      ? 'Não há pagamento lançado no acordo: nada fica arquivado.'
      : r.qtdPagamentos === 1
        ? `O pagamento já lançado (${moeda(r.recebido)}) fica arquivado: continua no histórico, mas deixa de contar no recebido da obra.`
        : `Os ${r.qtdPagamentos} pagamentos já lançados (${moeda(r.recebido)}) ficam arquivados: continuam no histórico, mas deixam de contar no recebido da obra.`,
  )
  linhas.push('Não dá para desfazer.')
  return linhas
}

// ------------------------------------------------------------
// Encerramento à mão (11.5)
// ------------------------------------------------------------

/** O motivo do cancelamento vai para a observação do acordo (não há coluna própria). */
export const MOTIVO_CANCELAMENTO_ACORDO_MIN = 5

/**
 * "Encerrar como quitado": o cliente não vai pagar o que falta e o combinado
 * está encerrado. As parcelas pendentes (sem pagamento) são canceladas e o
 * trigger quita o acordo (todas as válidas pagas). Parcela paga parcialmente
 * impede: receba o resto ou ajuste o valor dela antes; e sem nenhuma parcela
 * paga não há o que quitar — é cancelamento.
 */
export function motivoParaNaoQuitar(
  perfil: string,
  status: AcordoStatus,
  parcelas: readonly { numero_parcela: number; status: ParcelaStatus }[],
): string | null {
  if (perfil !== 'admin' && perfil !== 'financeiro') return 'Só admin e financeiro encerram acordos'
  if (status !== 'aberto') return `Acordo ${minusculaInicial(STATUS_ACORDO_LABELS[status])} já está encerrado`
  const parcial = parcelas.find((p) => p.status === 'paga_parcialmente')
  if (parcial) return `A parcela ${parcial.numero_parcela} está paga parcialmente: receba o resto ou ajuste o valor dela antes`
  if (!parcelas.some((p) => p.status === 'paga')) return 'Nenhuma parcela foi paga: para encerrar sem pagamento, cancele o acordo'
  return null
}

/**
 * Cancelar o acordo: só o aberto. Com pagamento também (ver
 * planoDoCancelamento): o que entrou fica, e o acordo encerra pelo recebido.
 */
export function motivoParaNaoCancelarAcordo(perfil: string, status: AcordoStatus): string | null {
  if (perfil !== 'admin' && perfil !== 'financeiro') return 'Só admin e financeiro encerram acordos'
  if (status !== 'aberto') return `Acordo ${minusculaInicial(STATUS_ACORDO_LABELS[status])} já está encerrado`
  return null
}

export type PlanoDoCancelamento = {
  /** Soma do pago nas parcelas válidas: com ela acima de zero, o acordo encerra pelo recebido. */
  recebido: number
  /** Parcelas pagas em parte: o valor previsto desce ao pago, e o trigger as põe em paga. */
  ajustar: { id: string; numero: number; valor: number }[]
  /** Parcelas válidas sem pagamento: canceladas. */
  cancelar: string[]
  /** O que sai do a receber da obra: o previsto das canceladas mais a sobra das ajustadas. */
  semReceber: number
}

/**
 * O que "Cancelar acordo" faz com as parcelas. Sem pagamento, todas são
 * canceladas e o acordo fica cancelado. Com pagamento, o dinheiro que entrou
 * não pode sumir do recebido da obra, e as views (receitas_obra) só o contam
 * de forma consistente no acordo quitado: no cancelado, o pagamento entra no
 * total_recebido mas a parcela sai do total_a_receber, e o saldo da obra fica
 * errado. Por isso o acordo com pagamento encerra QUITADO pelo recebido: a
 * parcela paga em parte fica com o valor pago, as sem pagamento são
 * canceladas, e o trigger quita o acordo.
 */
export function planoDoCancelamento(parcelas: { id: string; numero_parcela: number; status: ParcelaStatus; valor_previsto: number | string; pago: number | string }[]): PlanoDoCancelamento {
  const validas = parcelas.filter((p) => p.status !== 'cancelada')
  const recebido = validas.reduce((acc, p) => acc + emCentavos(p.pago), 0)
  const ajustar = validas
    .filter((p) => emCentavos(p.pago) > 0 && emCentavos(p.pago) < emCentavos(p.valor_previsto))
    .map((p) => ({ id: p.id, numero: p.numero_parcela, valor: emCentavos(p.pago) / 100 }))
  const semPagamento = validas.filter((p) => emCentavos(p.pago) === 0)
  const semReceber = validas.reduce((acc, p) => acc + Math.max(0, emCentavos(p.valor_previsto) - emCentavos(p.pago)), 0)
  return { recebido: recebido / 100, ajustar, cancelar: semPagamento.map((p) => p.id), semReceber: semReceber / 100 }
}

/** O texto do diálogo de cancelamento, conforme o acordo tenha recebido ou não. */
export function avisoDoCancelamento(plano: PlanoDoCancelamento): string {
  if (emCentavos(plano.recebido) === 0) return 'O acordo e as parcelas ficam cancelados e saem do a receber da obra. Não dá para desfazer.'
  const ajustes = plano.ajustar.length === 0 ? ''
    : plano.ajustar.length === 1 ? ` A parcela ${plano.ajustar[0].numero}, paga em parte, fica com o valor pago.`
    : ` As parcelas ${plano.ajustar.map((a) => a.numero).join(', ')}, pagas em parte, ficam com o valor pago.`
  return `O acordo já recebeu ${moeda(plano.recebido)}, e esse valor continua no recebido da obra. O que faltava (${moeda(plano.semReceber)}) sai do a receber: as parcelas sem pagamento são canceladas.${ajustes} O acordo fica encerrado como quitado pelo valor recebido, com o motivo na observação. Não dá para desfazer.`
}

/** A observação depois do cancelamento: a anterior, mais a linha do cancelamento. */
export function observacaoComCancelamento(anterior: string | null, motivo: string, data: string, recebido = 0): string {
  const quando = data.split('-').reverse().join('/')
  const linha = emCentavos(recebido) > 0
    ? `Cancelado em ${quando}, encerrado pelo recebido (${moeda(recebido)}): ${motivo.trim()}`
    : `Cancelado em ${quando}: ${motivo.trim()}`
  return anterior?.trim() ? `${anterior.trim()}\n${linha}` : linha
}
