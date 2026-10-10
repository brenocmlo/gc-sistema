// Os dados da visão geral do financeiro (12.2), para a página e o export
// aplicarem as MESMAS condições: o XLSX tem de bater com a tela de onde a
// pessoa exportou. Fora de um arquivo 'use server' de propósito.

import {
  cardsDaEmpresa,
  contasAReceber,
  faturadoPorObra,
  inicioDoPeriodo,
  linhasPorObra,
  normalizarPeriodo,
  recebidoPorObra,
  resumoPorFaixa,
  somaDoMapa,
  type NfDaEmpresa,
  type PagamentoDaEmpresa,
  type ParcelaDaEmpresa,
  type ReceitasPorObra,
} from '@/lib/financeiro-empresa'
import type { createClient } from '@/lib/supabase/server'

type Supabase = ReturnType<typeof createClient>

export type ParametrosVisaoGeral = { obra?: string | null; periodo?: string | null }

/** Teto de linhas do PostgREST por requisição. */
const PAGINA = 1000

/**
 * Lê todas as linhas, de PAGINA em PAGINA: as somas não podem sair cortadas
 * pelo teto do PostgREST, como uma listagem pode.
 */
export async function todas<R>(pagina: (de: number, ate: number) => PromiseLike<{ data: R[] | null; error: { message: string } | null }>): Promise<R[]> {
  const linhas: R[] = []
  for (let de = 0; ; de += PAGINA) {
    const { data, error } = await pagina(de, de + PAGINA - 1)
    if (error) throw new Error(error.message)
    linhas.push(...(data ?? []))
    if ((data ?? []).length < PAGINA) return linhas
  }
}

export async function carregarVisaoGeral(supabase: Supabase, params: ParametrosVisaoGeral, hoje: string) {
  const obra = params.obra ?? ''
  const periodo = normalizarPeriodo(params.periodo)
  const inicio = inicioDoPeriodo(periodo, hoje)

  const [receitasLidas, nfsLidas, parcelasLidas, pagamentosLidos] = await Promise.all([
    todas((de, ate) => {
      let q = supabase.from('receitas_obra').select('obra_id, codigo_obra, obra_nome, total_recebido, total_a_receber, saldo_pendente').order('codigo_obra')
      if (obra) q = q.eq('obra_id', obra)
      return q.range(de, ate)
    }),
    todas((de, ate) => {
      let q = supabase.from('notas_fiscais').select('id, obra_id, numero, serie, status, data_emissao, data_vencimento, valor_total, pagamentos(valor)').order('id')
      if (obra) q = q.eq('obra_id', obra)
      return q.range(de, ate)
    }),
    todas((de, ate) => {
      let q = supabase
        .from('acordo_parcelas')
        .select('id, numero_parcela, data_vencimento, valor_previsto, status, pagamentos(valor), acordo:acordos_pagamento!inner(id, descricao, obra_id, status)')
        .eq('acordo.status', 'aberto')
        .order('id')
      if (obra) q = q.eq('acordo.obra_id', obra)
      return q.range(de, ate)
    }),
    todas((de, ate) => {
      let q = supabase.from('pagamentos').select('obra_id, data_pagamento, valor, origem, parcela:acordo_parcelas(acordo:acordos_pagamento(status))').order('id')
      if (obra) q = q.eq('obra_id', obra)
      return q.range(de, ate)
    }),
  ])
  const receitas = receitasLidas as ReceitasPorObra[]
  const nfs = nfsLidas as NfDaEmpresa[]
  const parcelas = parcelasLidas as ParcelaDaEmpresa[]
  const pagamentos = pagamentosLidos as PagamentoDaEmpresa[]

  const faturado = faturadoPorObra(nfs, inicio)
  const recebido = recebidoPorObra(pagamentos, inicio)
  const contas = contasAReceber(nfs, parcelas, hoje)
  const faixas = resumoPorFaixa(contas)
  return {
    periodo,
    inicio,
    cards: cardsDaEmpresa(receitas, somaDoMapa(recebido), faixas),
    obras: linhasPorObra(receitas, faturado, recebido),
    contas,
    faixas,
  }
}
