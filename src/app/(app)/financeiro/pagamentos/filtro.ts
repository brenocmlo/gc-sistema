// Os filtros da listagem de pagamentos (10.1), para a página, o totalizador e
// o export (10.6) aplicarem as MESMAS condições: se divergirem, o total do topo
// não é o da lista, e o XLSX não bate com a tela de onde a pessoa exportou.
// Fora de um arquivo 'use server' de propósito (todo export dele vira Server
// Action).

import { computePeriodoCutoff, sanitizeBusca } from '@/lib/listagem'
import { isPagamentoForma, isPagamentoOrigem } from '@/lib/pagamentos'
import type { createClient } from '@/lib/supabase/server'

export type ParametrosPagamentos = {
  busca?: string | null
  obra?: string | null
  origem?: string | null
  forma?: string | null
  periodo?: string | null
}

type Filtravel<Q> = {
  or(filtros: string): Q
  eq(coluna: string, valor: string): Q
  gte(coluna: string, valor: string): Q
}

export async function filtroDePagamentos(
  supabase: ReturnType<typeof createClient>,
  params: ParametrosPagamentos,
  obras: readonly { id: string; codigo_obra: string; nome: string }[],
) {
  const busca = sanitizeBusca(params.busca ?? '')
  const obra = params.obra ?? ''
  const origem = params.origem ?? ''
  const forma = params.forma ?? ''
  const periodo = params.periodo ?? ''

  // A busca cobre obra, número da NF e observação. Obra e NF são resolvidas
  // em ids antes (a obra na lista já carregada, a NF numa consulta própria):
  // o `.or` do PostgREST não mistura coluna da tabela com coluna do JOIN.
  let filtroBusca: string | null = null
  if (busca) {
    const termo = busca.toLowerCase()
    const obraIds = obras
      .filter((o) => o.codigo_obra.toLowerCase().includes(termo) || o.nome.toLowerCase().includes(termo))
      .map((o) => o.id)
    const { data: nfs } = await supabase.from('notas_fiscais').select('id').ilike('numero', `%${busca}%`)
    const nfIds = (nfs ?? []).map((n) => n.id)
    filtroBusca = [
      `observacao.ilike.%${busca}%`,
      obraIds.length > 0 ? `obra_id.in.(${obraIds.join(',')})` : null,
      nfIds.length > 0 ? `nota_id.in.(${nfIds.join(',')})` : null,
    ]
      .filter(Boolean)
      .join(',')
  }

  // Período sobre a data do pagamento.
  const cutoff = computePeriodoCutoff(periodo)

  function filtrar<Q extends Filtravel<Q>>(q: Q): Q {
    let r = q
    if (filtroBusca) r = r.or(filtroBusca)
    if (obra) r = r.eq('obra_id', obra)
    if (origem && isPagamentoOrigem(origem)) r = r.eq('origem', origem)
    if (forma && isPagamentoForma(forma)) r = r.eq('forma', forma)
    if (cutoff) r = r.gte('data_pagamento', cutoff)
    return r
  }

  return { filtrar, valores: { busca, obra, origem, forma, periodo } }
}
