// Consultas da tela de execução, compartilhadas pela page e pelas actions.
// Fora do actions.ts de propósito: todo export de um arquivo 'use server'
// vira Server Action chamável pelo navegador.

import type { createClient } from '@/lib/supabase/server'

/**
 * Itens de contrato da obra que ainda não têm execução — o que a ação em lote
 * do 7.2 cria. Só item de contrato (é o que vai para produção) e de contrato
 * que não foi rescindido.
 */
export async function itensSemExecucao(
  supabase: ReturnType<typeof createClient>,
  obraId: string,
): Promise<{ ids: string[]; error: string | null }> {
  const [{ data: itens, error: e1 }, { data: comExecucao, error: e2 }] = await Promise.all([
    supabase
      .from('itens')
      .select('id, contrato:contratos!inner(status)')
      .eq('obra_id', obraId)
      .not('contrato_id', 'is', null)
      .neq('contrato.status', 'rescindido'),
    supabase.from('execucao').select('item_id, item:itens!inner(obra_id)').eq('item.obra_id', obraId),
  ])
  const erro = e1 ?? e2
  if (erro) return { ids: [], error: erro.message }
  const jaTem = new Set((comExecucao ?? []).map((e) => e.item_id))
  return { ids: (itens ?? []).map((i) => i.id).filter((id) => !jaTem.has(id)), error: null }
}
