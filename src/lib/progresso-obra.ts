/**
 * Progresso de itens da obra — o espelho em TypeScript da coluna
 * `progresso_itens_pct` da view `obras_com_valores`
 * (supabase/migrations/20261026100000_progresso_itens_so_contratado.sql).
 *
 * Progresso = quantidade medida / quantidade CONTRATADA × 100, com duas casas.
 *
 * "Contratado" é o mesmo conjunto que `calcular_valores_obra` usa para o valor
 * da obra:
 *   - os itens dos contratos não rescindidos da obra; e
 *   - os itens das propostas `aprovada` que ainda não viraram contrato não
 *     rescindido (`contratos.proposta_origem_id`).
 *
 * Fica de fora: item de proposta em rascunho, enviada ou rejeitada; item de
 * proposta que já gerou contrato (o contrato COPIA os itens, e contar os dois
 * dobrava o denominador — o defeito que travava a obra com contrato em 50%);
 * item de contrato rescindido.
 *
 * `null` quando o contratado soma zero (obra sem contrato nem proposta
 * aprovada, ou só com itens sem quantidade): a tela mostra "sem dados".
 *
 * Puro, sem React: roda no `node --test` e na camada dados da validação.
 */

export type ItemParaProgresso = {
  id: string
  quantidade: number | string | null
  proposta_id: string | null
  contrato_id: string | null
}

export type ContratoParaProgresso = {
  id: string
  status: string | null
  proposta_origem_id: string | null
}

export type PropostaParaProgresso = {
  id: string
  status: string | null
}

export type MedicaoParaProgresso = {
  item_id: string
  med_qtd: number | string | null
}

/** Ids dos itens que contam como contratados, pela regra do valor da obra. */
export function itensContratados(
  itens: readonly ItemParaProgresso[],
  contratos: readonly ContratoParaProgresso[],
  propostas: readonly PropostaParaProgresso[],
): Set<string> {
  const contratosVigentes = new Set(contratos.filter((c) => c.status !== 'rescindido').map((c) => c.id))
  const propostasComContrato = new Set(
    contratos
      .filter((c) => c.status !== 'rescindido' && c.proposta_origem_id)
      .map((c) => c.proposta_origem_id as string),
  )
  const propostasQueContam = new Set(
    propostas.filter((p) => p.status === 'aprovada' && !propostasComContrato.has(p.id)).map((p) => p.id),
  )
  const ids = new Set<string>()
  for (const i of itens) {
    if (i.contrato_id ? contratosVigentes.has(i.contrato_id) : i.proposta_id ? propostasQueContam.has(i.proposta_id) : false) {
      ids.add(i.id)
    }
  }
  return ids
}

/**
 * O `progresso_itens_pct` de UMA obra. Recebe os itens, contratos e propostas
 * dessa obra e as medições (linhas de `execucao`) de qualquer item — as de
 * item fora do contratado são ignoradas.
 */
export function progressoItensDaObra(
  itens: readonly ItemParaProgresso[],
  contratos: readonly ContratoParaProgresso[],
  propostas: readonly PropostaParaProgresso[],
  medicoes: readonly MedicaoParaProgresso[],
): number | null {
  const contam = itensContratados(itens, contratos, propostas)
  let contratado = 0
  for (const i of itens) if (contam.has(i.id)) contratado += Number(i.quantidade ?? 0)
  if (!(contratado > 0)) return null
  let medido = 0
  for (const m of medicoes) if (contam.has(m.item_id)) medido += Number(m.med_qtd ?? 0)
  return Math.round((medido / contratado) * 100 * 100) / 100
}
