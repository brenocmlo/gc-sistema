// Contratos e propostas que podem ser o vínculo de uma NF, para os selects do
// formulário (9.2 e 9.3). Fora do actions.ts de propósito: todo export de um
// arquivo 'use server' vira Server Action chamável pelo navegador.

import { STATUS_CONTRATO_LABELS } from '@/lib/contratos'
import type { createClient } from '@/lib/supabase/server'
import type { ContratoStatus } from '@/lib/types'

import type { VinculoOpcao } from './nota-fiscal-form'

const STATUS_PROPOSTA: Record<string, string> = {
  rascunho: 'rascunho',
  enviada: 'enviada',
  aprovada: 'aprovada',
  rejeitada: 'rejeitada',
}

export async function opcoesDeVinculo(
  supabase: ReturnType<typeof createClient>,
): Promise<{ contratos: VinculoOpcao[]; propostas: VinculoOpcao[] }> {
  const [{ data: contratos }, { data: propostas }] = await Promise.all([
    supabase.from('contratos').select('id, numero, obra_id, status').order('numero', { ascending: false }),
    supabase.from('propostas').select('id, numero, obra_id, status').order('numero', { ascending: false }),
  ])
  return {
    contratos: (contratos ?? []).map((c) => ({
      id: c.id,
      obra_id: c.obra_id,
      label: `${c.numero} (${STATUS_CONTRATO_LABELS[c.status as ContratoStatus] ?? c.status})`,
    })),
    propostas: (propostas ?? []).map((p) => ({
      id: p.id,
      obra_id: p.obra_id,
      label: `${p.numero} (${STATUS_PROPOSTA[p.status] ?? p.status})`,
    })),
  }
}
