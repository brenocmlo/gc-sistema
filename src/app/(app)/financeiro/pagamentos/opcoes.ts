// NFs, acordos e parcelas que podem receber pagamento, para os selects do
// formulário (10.2) e da baixa rápida (10.3), com o saldo em aberto de cada
// um. Fora de um actions.ts de propósito: todo export de um arquivo
// 'use server' vira Server Action chamável pelo navegador.

import { numeroComSerie, STATUS_NF_LABELS } from '@/lib/notas-fiscais'
import { saldoEmAberto } from '@/lib/pagamentos-form'
import type { createClient } from '@/lib/supabase/server'
import type { NotaFiscalStatus } from '@/lib/types'

export type NfOpcao = { id: string; obra_id: string; label: string; saldo: number }
export type AcordoOpcao = { id: string; obra_id: string; label: string }
export type ParcelaOpcao = { id: string; acordo_id: string; label: string; saldo: number }

export type OpcoesDePagamento = {
  notas: NfOpcao[]
  acordos: AcordoOpcao[]
  parcelas: ParcelaOpcao[]
}

const STATUS_PARCELA: Record<string, string> = {
  pendente: 'pendente',
  paga_parcialmente: 'paga parcialmente',
  paga: 'paga',
}

export async function opcoesDePagamento(supabase: ReturnType<typeof createClient>): Promise<OpcoesDePagamento> {
  const [{ data: notas }, { data: acordos }, { data: parcelas }] = await Promise.all([
    // Cancelada não recebe pagamento (trigger pagamento_nf_cancelada, 9.4).
    supabase
      .from('notas_fiscais')
      .select('id, numero, serie, obra_id, status, valor_total, pagamentos(valor)')
      .neq('status', 'cancelada')
      .order('data_emissao', { ascending: false }),
    // Só acordo aberto: quitado, cancelado ou convertido em NF não recebe mais.
    supabase.from('acordos_pagamento').select('id, descricao, obra_id').eq('status', 'aberto').order('data_abertura', { ascending: false }),
    supabase
      .from('acordo_parcelas')
      .select('id, acordo_id, numero_parcela, data_vencimento, valor_previsto, status, pagamentos(valor)')
      .neq('status', 'cancelada')
      .order('numero_parcela'),
  ])

  return {
    notas: (notas ?? []).map((n) => {
      const saldo = saldoEmAberto(n.valor_total, n.pagamentos)
      const status = STATUS_NF_LABELS[n.status as NotaFiscalStatus] ?? n.status
      return { id: n.id, obra_id: n.obra_id, saldo, label: `NF ${numeroComSerie(n.numero, n.serie)} (${status.toLowerCase()})` }
    }),
    acordos: (acordos ?? []).map((a) => ({ id: a.id, obra_id: a.obra_id, label: a.descricao })),
    parcelas: (parcelas ?? []).map((p) => ({
      id: p.id,
      acordo_id: p.acordo_id,
      saldo: saldoEmAberto(p.valor_previsto, p.pagamentos),
      label: `Parcela ${p.numero_parcela} · vence ${p.data_vencimento.split('-').reverse().join('/')} (${STATUS_PARCELA[p.status] ?? p.status})`,
    })),
  }
}
