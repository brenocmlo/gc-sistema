// Regras puras dos anexos (jsonb `anexos` + bucket `anexos`), compartilhadas
// por proposta, orçamento e contrato. Sem React: serve Server Action e Client.

import type { Anexo } from './types'

/**
 * Quem pode excluir um anexo. Espelha a policy "Anexos: admin/dono exclui" do
 * Storage (20260424121552): admin, ou quem subiu o arquivo (`owner` no
 * Storage, `uploaded_by` no jsonb). Sem esta regra na aplicação, o comercial
 * que tentava apagar o anexo de outra pessoa tinha o `remove` recusado em
 * silêncio pelo Storage — sem erro, zero objetos removidos —, e a action tirava
 * o anexo do jsonb com o arquivo ainda no bucket.
 */
export function podeExcluirAnexo(
  anexo: Pick<Anexo, 'uploaded_by'>,
  quem: { perfil: string; userId: string },
): boolean {
  if (quem.perfil === 'admin') return true
  return Boolean(anexo.uploaded_by) && anexo.uploaded_by === quem.userId
}

/**
 * Confere, antes de tocar no Storage, se `path` é anexo daquele registro e se
 * quem pede pode apagá-lo. O path vem do corpo da requisição: sem conferir
 * que ele está no jsonb, a action apagaria qualquer arquivo da empresa que a
 * policy do Storage deixasse.
 */
export function autorizarExclusaoDeAnexo(
  anexos: unknown,
  path: string,
  quem: { perfil: string; userId: string },
): { ok: true; restantes: Anexo[] } | { ok: false; error: string } {
  const lista = Array.isArray(anexos) ? (anexos as Anexo[]) : []
  const anexo = lista.find((a) => a.path === path)
  if (!anexo) return { ok: false, error: 'Anexo não encontrado neste registro' }
  if (!podeExcluirAnexo(anexo, quem)) {
    return { ok: false, error: 'Só o admin ou quem enviou o arquivo pode excluí-lo' }
  }
  return { ok: true, restantes: lista.filter((a) => a.path !== path) }
}

/**
 * O `remove` do Storage não devolve erro quando a policy recusa: devolve a
 * lista de objetos removidos vazia. Esta é a checagem que faltava.
 */
export function removeuDoStorage(removidos: readonly unknown[] | null | undefined): boolean {
  return Array.isArray(removidos) && removidos.length > 0
}

/** Mensagem da mudança de status que perdeu a corrida (ver as actions de status). */
export const STATUS_MUDOU_NO_MEIO =
  'O status mudou enquanto você decidia. Recarregue a página e tente de novo.'
