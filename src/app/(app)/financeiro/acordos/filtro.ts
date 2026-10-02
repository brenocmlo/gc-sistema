// Os filtros da listagem de acordos (11.1), para a página e o export (11.5)
// aplicarem as MESMAS condições: o XLSX tem de bater com a tela de onde a
// pessoa exportou. Fora de um arquivo 'use server' de propósito.

import { isAcordoMotivo, isAcordoStatus } from '@/lib/acordos'
import { computePeriodoCutoff, sanitizeBusca } from '@/lib/listagem'

export type ParametrosAcordos = {
  busca?: string | null
  obra?: string | null
  status?: string | null
  motivo?: string | null
  periodo?: string | null
}

type Filtravel<Q> = {
  or(filtros: string): Q
  eq(coluna: string, valor: string): Q
  gte(coluna: string, valor: string): Q
}

export function filtroDeAcordos(params: ParametrosAcordos, obras: readonly { id: string; codigo_obra: string; nome: string }[]) {
  const busca = sanitizeBusca(params.busca ?? '')
  const obra = params.obra ?? ''
  const status = params.status ?? ''
  const motivo = params.motivo ?? ''
  const periodo = params.periodo ?? ''

  // Obra por código ou nome, resolvida na lista já carregada.
  let filtroBusca: string | null = null
  if (busca) {
    const termo = busca.toLowerCase()
    const obraIds = obras
      .filter((o) => o.codigo_obra.toLowerCase().includes(termo) || o.nome.toLowerCase().includes(termo))
      .map((o) => o.id)
    filtroBusca = [
      `descricao.ilike.%${busca}%`,
      `periodo_ref.ilike.%${busca}%`,
      obraIds.length > 0 ? `obra_id.in.(${obraIds.join(',')})` : null,
    ]
      .filter(Boolean)
      .join(',')
  }
  // Período sobre a data de abertura.
  const cutoff = computePeriodoCutoff(periodo)

  function filtrar<Q extends Filtravel<Q>>(q: Q): Q {
    let r = q
    if (filtroBusca) r = r.or(filtroBusca)
    if (obra) r = r.eq('obra_id', obra)
    if (status && isAcordoStatus(status)) r = r.eq('status', status)
    if (motivo && isAcordoMotivo(motivo)) r = r.eq('motivo', motivo)
    if (cutoff) r = r.gte('data_abertura', cutoff)
    return r
  }

  return { filtrar, valores: { busca, obra, status, motivo, periodo } }
}
