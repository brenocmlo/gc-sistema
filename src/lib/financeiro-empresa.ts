// Visão consolidada do financeiro da empresa (12.2, /financeiro/visao-geral).
// O saldo de cada obra vem de receitas_obra; os fluxos do período (faturado e
// recebido) são somados aqui das NFs e dos pagamentos, com as mesmas regras da
// view: sem filtro de período, a soma é a da view (o plano confere).

import { linhaDaParcela } from './acordos.ts'
import { numeroComSerie } from './notas-fiscais.ts'
import type { AcordoStatus, NotaFiscalStatus, ParcelaStatus } from './types'

const emCentavos = (v: number | string | null | undefined) => Math.round(Number(v ?? 0) * 100)

export type PeriodoFinanceiro = 'mes' | '30d' | '90d' | 'ano' | 'tudo'

/** O período dos fluxos. Começa no mês corrente: é o "recebido no mês" da planilha antiga. */
export const PERIODO_FINANCEIRO_OPTIONS: readonly { value: PeriodoFinanceiro; label: string }[] = [
  { value: 'mes', label: 'Este mês' },
  { value: '30d', label: 'Últimos 30 dias' },
  { value: '90d', label: 'Últimos 90 dias' },
  { value: 'ano', label: 'Este ano' },
  { value: 'tudo', label: 'Todo o período' },
]

/** Querystring é input externo: o que não for período conhecido vira o mês corrente. */
export function normalizarPeriodo(v: string | null | undefined): PeriodoFinanceiro {
  return PERIODO_FINANCEIRO_OPTIONS.some((o) => o.value === v) ? (v as PeriodoFinanceiro) : 'mes'
}

/** `hoje` mais `dias`, em YYYY-MM-DD, sem fuso (a data é civil). */
export function somarDias(hoje: string, dias: number): string {
  const d = new Date(`${hoje}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + dias)
  return d.toISOString().slice(0, 10)
}

/** A primeira data do período (inclusive), ou null para "todo o período". */
export function inicioDoPeriodo(periodo: PeriodoFinanceiro, hoje: string): string | null {
  if (periodo === 'mes') return `${hoje.slice(0, 7)}-01`
  if (periodo === '30d') return somarDias(hoje, -30)
  if (periodo === '90d') return somarDias(hoje, -90)
  if (periodo === 'ano') return `${hoje.slice(0, 4)}-01-01`
  return null
}

export type NfDaEmpresa = {
  id: string
  obra_id: string
  numero: string
  serie: string | null
  status: NotaFiscalStatus
  data_emissao: string
  data_vencimento: string | null
  valor_total: number | string
  pagamentos: { valor: number | string }[] | null
}

export type ParcelaDaEmpresa = {
  id: string
  numero_parcela: number
  data_vencimento: string
  valor_previsto: number | string
  status: ParcelaStatus
  pagamentos: { valor: number | string }[] | null
  acordo: { id: string; descricao: string; obra_id: string; status: AcordoStatus } | null
}

export type PagamentoDaEmpresa = {
  obra_id: string
  data_pagamento: string
  valor: number | string
  origem: string
  /** O status do acordo do pagamento: o de acordo convertido em NF fica arquivado, fora do recebido. */
  parcela: { acordo: { status: AcordoStatus } | null } | null
}

/** O pagamento conta no recebido? A regra de receitas_obra.total_recebido. */
export function contaNoRecebido(p: Pick<PagamentoDaEmpresa, 'origem' | 'parcela'>): boolean {
  return !(p.origem === 'acordo' && p.parcela?.acordo?.status === 'convertido_nf')
}

/** Faturado por obra: NFs não canceladas, emitidas a partir de `inicio` (null: todas). */
export function faturadoPorObra(nfs: readonly Pick<NfDaEmpresa, 'obra_id' | 'status' | 'data_emissao' | 'valor_total'>[], inicio: string | null): Map<string, number> {
  const m = new Map<string, number>()
  for (const n of nfs) {
    if (n.status === 'cancelada' || (inicio && n.data_emissao < inicio)) continue
    m.set(n.obra_id, (m.get(n.obra_id) ?? 0) + emCentavos(n.valor_total))
  }
  return new Map(Array.from(m, ([k, v]) => [k, v / 100]))
}

/** Recebido por obra: pagamentos a partir de `inicio`, sem o arquivado das conversões. */
export function recebidoPorObra(pagamentos: readonly PagamentoDaEmpresa[], inicio: string | null): Map<string, number> {
  const m = new Map<string, number>()
  for (const p of pagamentos) {
    if (!contaNoRecebido(p) || (inicio && p.data_pagamento < inicio)) continue
    m.set(p.obra_id, (m.get(p.obra_id) ?? 0) + emCentavos(p.valor))
  }
  return new Map(Array.from(m, ([k, v]) => [k, v / 100]))
}

export type ReceitasPorObra = {
  obra_id: string
  codigo_obra: string
  obra_nome: string
  total_recebido: number | string | null
  total_a_receber: number | string | null
  saldo_pendente: number | string | null
}

export type LinhaObra = {
  obraId: string
  codigo: string
  nome: string
  faturado: number
  recebido: number
  saldo: number
  /** Recebido total sobre o a receber bruto (NFs e parcelas válidas). Null sem nada a receber. */
  pctRecebido: number | null
}

/**
 * A tabela por obra. Faturado e recebido são do período; saldo e % recebido
 * são da obra inteira (receitas_obra), porque saldo não tem período: é o que
 * falta hoje. Obra sem nada (sem NF, parcela nem pagamento) fica de fora.
 */
export function linhasPorObra(receitas: readonly ReceitasPorObra[], faturado: Map<string, number>, recebido: Map<string, number>): LinhaObra[] {
  const temMovimento = (r: ReceitasPorObra) =>
    emCentavos(r.total_a_receber) !== 0 || emCentavos(r.total_recebido) !== 0 || faturado.has(r.obra_id) || recebido.has(r.obra_id)
  return receitas
    .filter(temMovimento)
    .map((r) => {
      const bruto = emCentavos(r.total_a_receber)
      return {
        obraId: r.obra_id,
        codigo: r.codigo_obra,
        nome: r.obra_nome,
        faturado: faturado.get(r.obra_id) ?? 0,
        recebido: recebido.get(r.obra_id) ?? 0,
        saldo: emCentavos(r.saldo_pendente) / 100,
        pctRecebido: bruto > 0 ? Math.round((emCentavos(r.total_recebido) / bruto) * 1000) / 10 : null,
      }
    })
    .sort((a, b) => b.saldo - a.saldo || a.codigo.localeCompare(b.codigo))
}

export type FaixaVencimento = 'vencidas' | 'hoje' | '7dias' | '30dias' | 'depois' | 'sem_vencimento'

export const FAIXA_VENCIMENTO_LABELS: Record<FaixaVencimento, string> = {
  vencidas: 'Vencidas',
  hoje: 'Vencem hoje',
  '7dias': 'Próximos 7 dias',
  '30dias': 'De 8 a 30 dias',
  depois: 'Depois de 30 dias',
  sem_vencimento: 'Sem vencimento',
}

/** Vencer hoje ainda não é vencida (situacaoDaNf, computeStatusParcela). */
export function faixaDoVencimento(vencimento: string | null, hoje: string): FaixaVencimento {
  if (!vencimento) return 'sem_vencimento'
  if (vencimento < hoje) return 'vencidas'
  if (vencimento === hoje) return 'hoje'
  if (vencimento <= somarDias(hoje, 7)) return '7dias'
  if (vencimento <= somarDias(hoje, 30)) return '30dias'
  return 'depois'
}

export type ContaAReceber = {
  tipo: 'nf' | 'parcela'
  id: string
  /** Para o link: a NF ou o acordo. */
  destinoId: string
  obraId: string
  documento: string
  vencimento: string | null
  saldo: number
  faixa: FaixaVencimento
}

/**
 * O que ainda tem saldo a receber: NF emitida ou paga em parte, e parcela
 * pendente ou paga em parte de acordo aberto. Por vencimento, a sem
 * vencimento por último.
 */
export function contasAReceber(nfs: readonly NfDaEmpresa[], parcelas: readonly ParcelaDaEmpresa[], hoje: string): ContaAReceber[] {
  const deNf = nfs
    .filter((n) => n.status === 'emitida' || n.status === 'paga_parcialmente')
    .map((n) => {
      const saldo = Math.max(0, emCentavos(n.valor_total) - (n.pagamentos ?? []).reduce((a, p) => a + emCentavos(p.valor), 0))
      const documento = `NF ${numeroComSerie(n.numero, n.serie)}`
      return { tipo: 'nf' as const, id: n.id, destinoId: n.id, obraId: n.obra_id, documento, vencimento: n.data_vencimento, saldo: saldo / 100, faixa: faixaDoVencimento(n.data_vencimento, hoje) }
    })
  const deParcela = parcelas
    .filter((p) => p.acordo?.status === 'aberto' && (p.status === 'pendente' || p.status === 'paga_parcialmente'))
    .map((p) => ({
      tipo: 'parcela' as const, id: p.id, destinoId: p.acordo!.id, obraId: p.acordo!.obra_id,
      documento: `${p.acordo!.descricao} · parcela ${p.numero_parcela}`,
      vencimento: p.data_vencimento, saldo: linhaDaParcela(p, hoje).saldo, faixa: faixaDoVencimento(p.data_vencimento, hoje),
    }))
  return [...deNf, ...deParcela]
    .filter((c) => emCentavos(c.saldo) > 0)
    .sort((a, b) => (a.vencimento ?? '9999-99-99').localeCompare(b.vencimento ?? '9999-99-99') || a.documento.localeCompare(b.documento))
}

export type ResumoDaFaixa = { faixa: FaixaVencimento; total: number; quantidade: number }

export function resumoPorFaixa(contas: readonly ContaAReceber[]): Record<FaixaVencimento, ResumoDaFaixa> {
  const faixas = Object.keys(FAIXA_VENCIMENTO_LABELS) as FaixaVencimento[]
  return Object.fromEntries(faixas.map((f) => {
    const daFaixa = contas.filter((c) => c.faixa === f)
    return [f, { faixa: f, total: daFaixa.reduce((a, c) => a + emCentavos(c.saldo), 0) / 100, quantidade: daFaixa.length }]
  })) as Record<FaixaVencimento, ResumoDaFaixa>
}

export type CardsDaEmpresa = { aReceber: number; recebidoNoPeriodo: number; atrasado: number; previsto30: number }

/**
 * Os cards do topo. A receber é a soma do saldo pendente das obras
 * (receitas_obra), que desconta também o avulso e o pagamento a mais; por
 * isso pode ser menor que a soma das faixas, que é só o saldo dos documentos.
 * Atrasado é o saldo vencido; previsto para 30 dias, o que vence de hoje até
 * daqui a 30 dias.
 */
export function cardsDaEmpresa(linhas: readonly ReceitasPorObra[], recebidoNoPeriodo: number, faixas: Record<FaixaVencimento, ResumoDaFaixa>): CardsDaEmpresa {
  return {
    aReceber: linhas.reduce((a, l) => a + emCentavos(l.saldo_pendente), 0) / 100,
    recebidoNoPeriodo,
    atrasado: faixas.vencidas.total,
    previsto30: (emCentavos(faixas.hoje.total) + emCentavos(faixas['7dias'].total) + emCentavos(faixas['30dias'].total)) / 100,
  }
}

/** Soma de um Map de valores em reais, em centavos exatos. */
export function somaDoMapa(m: Map<string, number>): number {
  return Array.from(m.values()).reduce((a, v) => a + emCentavos(v), 0) / 100
}
