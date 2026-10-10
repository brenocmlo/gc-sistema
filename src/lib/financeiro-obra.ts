// Aba Financeiro da obra (12.1). Os totais vêm das views do banco
// (receitas_obra e obras_financeiro); aqui só o que elas não têm: o atrasado,
// que depende do "hoje", as linhas das listas e a linha do tempo.

import { computeStatusParcela, linhaDaParcela, type SituacaoParcela } from './acordos.ts'
import { situacaoDaNf, type SituacaoNf } from './notas-fiscais.ts'
import { documentoDoPagamento } from './pagamentos.ts'
import type { AcordoStatus, NotaFiscalStatus, PagamentoListItem, ParcelaStatus } from './types'

const emCentavos = (v: number | string | null | undefined) => Math.round(Number(v ?? 0) * 100)

/** As colunas das views que a aba usa (numeric chega como number ou string). */
export type ReceitasDaObra = {
  total_recebido: number | string | null
  saldo_pendente: number | string | null
  total_acordos_convertidos_arquivado: number | string | null
}
export type FinanceiroDaObra = {
  total_faturado: number | string | null
  total_fd_aceito: number | string | null
}

export type BlocosFinanceiros = {
  contratado: number
  faturado: number
  recebido: number
  aReceber: number
  atrasado: number
  fdDescontado: number
}

/**
 * Os seis blocos. Contratado é o valor final da obra (obras_com_valores,
 * o mesmo da aba Detalhes); faturado e FD são de obras_financeiro; recebido e
 * a receber (o saldo pendente: NFs e parcelas válidas menos o que entrou) são
 * de receitas_obra. Só o atrasado é calculado aqui (atrasadoDaObra).
 */
export function blocosFinanceiros(
  contratado: number | string | null,
  receitas: ReceitasDaObra | null,
  financeiro: FinanceiroDaObra | null,
  atrasado: number,
): BlocosFinanceiros {
  const reais = (v: number | string | null | undefined) => emCentavos(v) / 100
  return {
    contratado: reais(contratado),
    faturado: reais(financeiro?.total_faturado),
    recebido: reais(receitas?.total_recebido),
    aReceber: reais(receitas?.saldo_pendente),
    atrasado,
    fdDescontado: reais(financeiro?.total_fd_aceito),
  }
}

export type NfDaObra = {
  id: string
  numero: string
  serie: string | null
  tipo: string
  status: NotaFiscalStatus
  data_emissao: string
  data_vencimento: string | null
  valor_total: number | string
  pagamentos: { valor: number | string }[] | null
}

export type LinhaNf = { id: string; numero: string; serie: string | null; tipo: string; emissao: string; vencimento: string | null; valor: number; recebido: number; saldo: number; situacao: SituacaoNf }

/** A NF com o recebido e o saldo. Paga e cancelada não têm saldo: a paga quitou, a cancelada saiu. */
export function linhaDaNf(nf: NfDaObra, hoje: string): LinhaNf {
  const recebido = (nf.pagamentos ?? []).reduce((acc, p) => acc + emCentavos(p.valor), 0)
  const semSaldo = nf.status === 'paga' || nf.status === 'cancelada'
  const saldo = semSaldo ? 0 : Math.max(0, emCentavos(nf.valor_total) - recebido)
  return {
    id: nf.id, numero: nf.numero, serie: nf.serie, tipo: nf.tipo,
    emissao: nf.data_emissao, vencimento: nf.data_vencimento,
    valor: emCentavos(nf.valor_total) / 100, recebido: recebido / 100, saldo: saldo / 100,
    situacao: situacaoDaNf(nf, hoje),
  }
}

export type AcordoDaObra = {
  id: string
  descricao: string
  status: AcordoStatus
  parcelas: { id: string; numero_parcela: number; data_vencimento: string; valor_previsto: number | string; status: ParcelaStatus; pagamentos: { valor: number | string }[] | null }[] | null
}

export type ParcelaEmAberto = { id: string; acordoId: string; acordo: string; numero: number; vencimento: string; previsto: number; pago: number; saldo: number; situacao: SituacaoParcela }

/**
 * As parcelas que ainda esperam pagamento: do acordo aberto, não pagas nem
 * canceladas, por vencimento. Acordo quitado, cancelado ou convertido não tem
 * parcela em aberto (o convertido virou NF, que aparece na lista de NFs).
 */
export function parcelasEmAberto(acordos: readonly AcordoDaObra[], hoje: string): ParcelaEmAberto[] {
  return acordos
    .filter((a) => a.status === 'aberto')
    .flatMap((a) => (a.parcelas ?? [])
      .filter((p) => p.status === 'pendente' || p.status === 'paga_parcialmente')
      .map((p) => {
        const l = linhaDaParcela(p, hoje)
        return { id: p.id, acordoId: a.id, acordo: a.descricao, numero: p.numero_parcela, vencimento: p.data_vencimento, previsto: emCentavos(p.valor_previsto) / 100, pago: l.pago, saldo: l.saldo, situacao: computeStatusParcela(p, hoje) }
      }))
    .sort((x, y) => x.vencimento.localeCompare(y.vencimento) || x.acordo.localeCompare(y.acordo) || x.numero - y.numero)
}

/**
 * O atrasado: o saldo das NFs vencidas mais o saldo das parcelas atrasadas.
 * Vencer hoje ainda não é atrasar (situacaoDaNf, computeStatusParcela).
 */
export function atrasadoDaObra(nfs: readonly LinhaNf[], parcelas: readonly ParcelaEmAberto[]): number {
  const centavos = nfs.filter((n) => n.situacao === 'vencida').reduce((acc, n) => acc + emCentavos(n.saldo), 0)
    + parcelas.filter((p) => p.situacao === 'atrasada').reduce((acc, p) => acc + emCentavos(p.saldo), 0)
  return centavos / 100
}

export type PagamentoDaObra = Pick<PagamentoListItem, 'id' | 'data_pagamento' | 'origem' | 'forma' | 'valor' | 'nota' | 'parcela'> & {
  /** O acordo do pagamento, para tirar da linha do tempo o que foi arquivado na conversão. */
  parcela: (NonNullable<PagamentoListItem['parcela']> & { acordo: { descricao: string; status?: AcordoStatus } | null }) | null
}

export type MesDaLinhaDoTempo = {
  mes: string
  total: number
  /** O recebido até o fim do mês, somando os meses anteriores. */
  acumulado: number
  pagamentos: { id: string; data: string; documento: string; origem: PagamentoListItem['origem']; forma: string | null; valor: number }[]
}

/**
 * Os recebimentos por mês, do mais recente para o mais antigo, com o total e o
 * acumulado. Segue o total_recebido de receitas_obra: o pagamento de acordo
 * convertido em NF fica de fora (arquivado), e o acumulado do mês mais recente
 * é o recebido da obra.
 */
export function linhaDoTempo(pagamentos: readonly PagamentoDaObra[]): MesDaLinhaDoTempo[] {
  const vigentes = pagamentos.filter((p) => !(p.origem === 'acordo' && p.parcela?.acordo?.status === 'convertido_nf'))
  const porMes = new Map<string, PagamentoDaObra[]>()
  for (const p of vigentes) {
    const mes = p.data_pagamento.slice(0, 7)
    porMes.set(mes, [...(porMes.get(mes) ?? []), p])
  }
  let acumulado = 0
  const meses = Array.from(porMes.keys()).sort().map((mes) => {
    const lista = porMes.get(mes) ?? []
    const total = lista.reduce((acc, p) => acc + emCentavos(p.valor), 0)
    acumulado += total
    return {
      mes,
      total: total / 100,
      acumulado: acumulado / 100,
      pagamentos: [...lista]
        .sort((a, b) => b.data_pagamento.localeCompare(a.data_pagamento))
        .map((p) => ({ id: p.id, data: p.data_pagamento, documento: documentoDoPagamento(p), origem: p.origem, forma: p.forma, valor: emCentavos(p.valor) / 100 })),
    }
  })
  return meses.reverse()
}

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']

/** "2026-09" → "Setembro de 2026" (só a inicial do mês em maiúscula). */
export function rotuloDoMes(mes: string): string {
  const [ano, m] = mes.split('-')
  const nome = MESES[Number(m) - 1] ?? m
  return `${nome.charAt(0).toUpperCase()}${nome.slice(1)} de ${ano}`
}
