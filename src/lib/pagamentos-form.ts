// Schema e helpers puros do formulário de pagamento (bloco 10.2). Sem
// 'use client' e sem React, como notas-fiscais-form.ts: o zod espelha a
// constraint `pagamento_vinculo_consistente`, e a mesma regra roda de novo na
// Server Action, sobre o payload, porque o zod do form só roda no navegador.
//
// A constraint tem três combinações válidas, e o formulário não deixa montar
// outra:
//   nf      → nota_id preenchido, parcela_acordo_id nulo
//   acordo  → parcela_acordo_id preenchido, nota_id nulo
//   avulso  → nenhum dos dois (e, pela regra da tela, observação obrigatória)

import { z } from 'zod'

import { formatCurrency } from './format.ts'
import { FORMA_PAGAMENTO_LABELS, isPagamentoForma, isPagamentoOrigem, ORIGEM_PAGAMENTO_LABELS } from './pagamentos.ts'
import type { PagamentoForma, PagamentoOrigem } from './types'

const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/

const ORIGENS = Object.keys(ORIGEM_PAGAMENTO_LABELS) as [PagamentoOrigem, ...PagamentoOrigem[]]
const FORMAS = Object.keys(FORMA_PAGAMENTO_LABELS) as [PagamentoForma, ...PagamentoForma[]]

/** O avulso não tem documento: a observação é o que diz do que é o dinheiro. */
export const OBSERVACAO_AVULSO_MIN = 5

export const pagamentoSchema = z
  .object({
    obra_id: z.string().uuid('Selecione uma obra'),
    origem: z.enum(ORIGENS, { message: 'Escolha a origem' }),
    nota_id: z.string().optional().default(''),
    // Só do formulário: o select de acordo filtra as parcelas. O banco guarda a parcela.
    acordo_id: z.string().optional().default(''),
    parcela_acordo_id: z.string().optional().default(''),
    data_pagamento: z.string().regex(DATA_ISO, 'Data do pagamento obrigatória'),
    // CHECK valor > 0
    valor: z.coerce.number({ message: 'Informe o valor' }).positive('O valor tem de ser maior que zero'),
    forma: z.enum(FORMAS, { message: 'Selecione a forma' }),
    observacao: z.string().max(1000, 'Máximo 1000 caracteres').optional().default(''),
  })
  .superRefine((d, ctx) => {
    if (d.origem === 'nf' && !d.nota_id) {
      ctx.addIssue({ path: ['nota_id'], code: 'custom', message: 'Selecione a nota fiscal' })
    }
    if (d.origem === 'acordo') {
      if (!d.acordo_id) ctx.addIssue({ path: ['acordo_id'], code: 'custom', message: 'Selecione o acordo' })
      else if (!d.parcela_acordo_id) ctx.addIssue({ path: ['parcela_acordo_id'], code: 'custom', message: 'Selecione a parcela' })
    }
    if (d.origem === 'avulso' && (d.observacao ?? '').trim().length < OBSERVACAO_AVULSO_MIN) {
      ctx.addIssue({ path: ['observacao'], code: 'custom', message: 'No avulso, diga do que é o pagamento' })
    }
  })

export type PagamentoFormValues = z.input<typeof pagamentoSchema>

/** O que createPagamento recebe. */
export type PagamentoPayload = {
  obra_id: string
  origem: PagamentoOrigem
  nota_id: string | null
  parcela_acordo_id: string | null
  data_pagamento: string
  valor: number
  forma: PagamentoForma
  observacao: string | null
}

function vazioParaNulo(v: string | null | undefined): string | null {
  const t = (v ?? '').trim()
  return t === '' ? null : t
}

/** Form → payload: só o vínculo da origem escolhida vai preenchido. */
export function formParaPayloadPagamento(v: PagamentoFormValues): PagamentoPayload {
  return {
    obra_id: v.obra_id,
    origem: v.origem as PagamentoOrigem,
    nota_id: v.origem === 'nf' ? vazioParaNulo(v.nota_id) : null,
    parcela_acordo_id: v.origem === 'acordo' ? vazioParaNulo(v.parcela_acordo_id) : null,
    data_pagamento: v.data_pagamento,
    valor: Number(v.valor),
    forma: v.forma as PagamentoForma,
    observacao: vazioParaNulo(v.observacao),
  }
}

/** Form vazio. `inicio` preenche origem e vínculo (a baixa rápida do 10.3). */
export function pagamentoVazioFormValues(
  hoje: string,
  inicio: Partial<Pick<PagamentoFormValues, 'obra_id' | 'origem' | 'nota_id' | 'acordo_id' | 'parcela_acordo_id' | 'valor'>> = {},
): PagamentoFormValues {
  return {
    obra_id: '',
    origem: 'nf',
    nota_id: '',
    acordo_id: '',
    parcela_acordo_id: '',
    data_pagamento: hoje,
    valor: '' as unknown as number,
    forma: '' as PagamentoForma,
    observacao: '',
    ...inicio,
  }
}

/**
 * A regra do schema sobre o PAYLOAD, para a Server Action repetir: o POST
 * pode vir de qualquer lugar, com a origem e os vínculos trocados.
 */
export function validarPayloadPagamento(
  p: Partial<PagamentoPayload> | null | undefined,
): { ok: true } | { ok: false; error: string } {
  if (!p || typeof p !== 'object') return { ok: false, error: 'Dados do pagamento ausentes' }
  if (!p.obra_id) return { ok: false, error: 'Selecione uma obra' }
  if (!p.origem || !isPagamentoOrigem(p.origem)) return { ok: false, error: 'Origem do pagamento inválida' }
  // pagamento_vinculo_consistente, as três combinações.
  if (p.origem === 'nf' && (!p.nota_id || p.parcela_acordo_id)) {
    return { ok: false, error: 'Pagamento de NF leva a nota fiscal, e só ela' }
  }
  if (p.origem === 'acordo' && (!p.parcela_acordo_id || p.nota_id)) {
    return { ok: false, error: 'Pagamento de acordo leva a parcela, e só ela' }
  }
  if (p.origem === 'avulso') {
    if (p.nota_id || p.parcela_acordo_id) return { ok: false, error: 'Pagamento avulso não tem nota fiscal nem parcela' }
    if ((p.observacao ?? '').trim().length < OBSERVACAO_AVULSO_MIN) return { ok: false, error: 'No avulso, diga do que é o pagamento' }
  }
  if (!p.data_pagamento || !DATA_ISO.test(p.data_pagamento)) return { ok: false, error: 'Data do pagamento obrigatória' }
  const valor = Number(p.valor)
  if (!Number.isFinite(valor) || valor <= 0) return { ok: false, error: 'O valor tem de ser maior que zero' }
  if (Math.abs(Math.round(valor * 100) - valor * 100) > 1e-6) return { ok: false, error: 'O valor tem no máximo 2 casas decimais' }
  if (!p.forma || !isPagamentoForma(p.forma)) return { ok: false, error: 'Forma de pagamento inválida' }
  if ((p.observacao ?? '').length > 1000) return { ok: false, error: 'Observação com mais de 1000 caracteres' }
  return { ok: true }
}

/** Constraint do Postgres → mensagem da tela. */
export function mensagemDeErroPagamento(raw: string): string {
  if (raw.includes('pagamento_vinculo_consistente')) return 'A origem e o vínculo não combinam: NF leva a nota, acordo leva a parcela, avulso não leva nenhum'
  if (raw.includes('pagamento_nf_cancelada')) return 'Nota fiscal cancelada não recebe pagamento'
  if (raw.includes('pagamento_parcela_cancelada')) return 'Parcela cancelada não recebe pagamento'
  if (raw.includes('pagamento_acordo_fechado')) return 'Acordo convertido em nota fiscal ou cancelado não recebe baixa'
  if (raw.includes('pagamentos_nota_fk')) return 'A nota fiscal tem de ser da mesma obra do pagamento'
  if (raw.includes('pagamentos_parcela_fk')) return 'A parcela tem de ser da mesma obra do pagamento'
  if (raw.includes('pagamentos_obra_fk')) return 'Obra inválida para esta empresa'
  if (raw.includes('pagamentos_valor_check')) return 'O valor tem de ser maior que zero'
  if (raw.includes('pagamentos_forma_check')) return 'Forma de pagamento inválida'
  if (raw.includes('pagamentos_origem_check')) return 'Origem do pagamento inválida'
  return raw
}

/** O que falta receber, em centavos exatos: o total menos o que já entrou. Nunca negativo. */
export function saldoEmAberto(total: number | string, pagamentos: readonly { valor: number | string }[] | null | undefined): number {
  const pago = (pagamentos ?? []).reduce((acc, p) => acc + Math.round(Number(p.valor) * 100), 0)
  return Math.max(0, Math.round(Number(total) * 100) - pago) / 100
}

/**
 * Aviso (não bloqueia) quando o valor lançado passa do saldo da NF ou da
 * parcela: pode ser juro, arredondamento ou erro de digitação. O banco aceita,
 * e o trigger marca a NF ou a parcela como paga.
 */
export function avisoDeExcesso(valor: number, saldo: number | null | undefined, doQue: 'nota fiscal' | 'parcela'): string | null {
  if (saldo == null || !Number.isFinite(valor) || valor <= 0) return null
  const excesso = Math.round(valor * 100) - Math.round(saldo * 100)
  if (excesso <= 0) return null
  return saldo === 0
    ? `A ${doQue} já está quitada: o valor inteiro passa do que falta receber.`
    : `O valor passa em ${formatCurrency(excesso / 100)} o saldo da ${doQue} (${formatCurrency(saldo)}).`
}

/**
 * Baixa rápida (10.3): `?nota=<id>` ou `?parcela=<id>` no /novo vira o form
 * já com a origem, o vínculo, a obra e o saldo como valor sugerido, e o
 * "voltar" aponta para de onde veio. Id que não está entre as opções (NF
 * cancelada, parcela de acordo fechado, de outra empresa) é ignorado: o form
 * abre vazio, sem sugerir nada.
 */
export function inicioDaBaixa(
  params: { nota?: string; parcela?: string },
  opcoes: {
    notas: readonly { id: string; obra_id: string; saldo: number }[]
    parcelas: readonly { id: string; acordo_id: string; saldo: number }[]
    acordos: readonly { id: string; obra_id: string }[]
  },
): { inicio: Parameters<typeof pagamentoVazioFormValues>[1]; voltarPara: string } {
  const nota = params.nota ? opcoes.notas.find((n) => n.id === params.nota) : undefined
  if (nota) {
    return {
      inicio: { obra_id: nota.obra_id, origem: 'nf', nota_id: nota.id, ...(nota.saldo > 0 ? { valor: nota.saldo } : {}) },
      voltarPara: `/financeiro/notas-fiscais/${nota.id}`,
    }
  }
  const parcela = params.parcela ? opcoes.parcelas.find((p) => p.id === params.parcela) : undefined
  const acordo = parcela ? opcoes.acordos.find((a) => a.id === parcela.acordo_id) : undefined
  if (parcela && acordo) {
    return {
      inicio: {
        obra_id: acordo.obra_id,
        origem: 'acordo',
        acordo_id: acordo.id,
        parcela_acordo_id: parcela.id,
        ...(parcela.saldo > 0 ? { valor: parcela.saldo } : {}),
      },
      // A parcela mora no detalhe do acordo (11.3): a baixa volta para ele.
      voltarPara: `/financeiro/acordos/${acordo.id}`,
    }
  }
  return { inicio: {}, voltarPara: '/financeiro/pagamentos' }
}
