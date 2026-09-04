/**
 * Helpers puros compartilhados pelas listagens (/orcamentos, /fd, /propostas).
 *
 * Sem `use client` e sem import de React de propósito: roda em Server
 * Component, Server Action e Client Component, igual aos outros helpers de
 * `src/lib`.
 */

/** Opções do select de período, iguais nas três listagens. */
export const PERIODO_OPTIONS: readonly { value: string; label: string }[] = [
  { value: '', label: 'Todos os períodos' },
  { value: '30d', label: 'Últimos 30 dias' },
  { value: '90d', label: 'Últimos 90 dias' },
  { value: 'ano', label: 'Este ano' },
]

/**
 * Traduz o filtro de período num cutoff `YYYY-MM-DD` pra usar em
 * `.gte(<coluna de data>, cutoff)`. Devolve null quando o filtro é "todos"
 * ou um valor desconhecido (querystring é input externo).
 *
 * `hoje` é injetável só pra teste — a chamada normal passa um argumento só.
 */
export function computePeriodoCutoff(
  periodo: string,
  hoje: Date = new Date(),
): string | null {
  if (periodo === '30d') {
    const d = new Date(hoje)
    d.setDate(d.getDate() - 30)
    return d.toISOString().slice(0, 10)
  }
  if (periodo === '90d') {
    const d = new Date(hoje)
    d.setDate(d.getDate() - 90)
    return d.toISOString().slice(0, 10)
  }
  if (periodo === 'ano') {
    return `${hoje.getFullYear()}-01-01`
  }
  return null
}

/**
 * Deixa o termo de busca seguro pra entrar num `.or()` do PostgREST.
 *
 * O `.or()` recebe os filtros como uma string única separada por vírgula, com
 * os valores de `in.(...)` entre parênteses — então vírgula, parêntese e aspas
 * digitados pelo usuário quebram o parser e derrubam a query inteira. Como
 * nenhum dos três aparece em número de proposta, nome de obra ou de cliente,
 * o tratamento é remover.
 */
export function sanitizeBusca(v: string): string {
  return v.replace(/[,()"]/g, '').trim()
}
