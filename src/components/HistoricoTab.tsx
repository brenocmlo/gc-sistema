import StatusBadge from '@/components/StatusBadge'
import type { EntradaHistorico } from '@/lib/historico'
import { MOTIVO_REJEICAO_LABELS } from '@/lib/types'

type HistoricoTabProps = {
  entradas: EntradaHistorico[]
  /** uuid do profile → nome, resolvido pela page numa consulta só. */
  autores: Map<string, string>
  /** Ex: "orçamento". Entra na mensagem de lista vazia. */
  entidade: string
}

/**
 * Aba Histórico das telas de detalhe, compartilhada por propostas e orçamentos
 * — as duas gravam o mesmo formato (ver `src/lib/historico.ts`), então a
 * leitura também é a mesma.
 *
 * Mais recente primeiro: quem ordena é `historicoOrdenado`, na page.
 */
export default function HistoricoTab({
  entradas,
  autores,
  entidade,
}: HistoricoTabProps) {
  if (entradas.length === 0) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-sm text-gray-500">
        Nenhuma mudança de status registrada ainda. O histórico deste {entidade}{' '}
        começa na primeira transição.
      </div>
    )
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200 divide-y divide-gray-100">
      {entradas.map((e, i) => (
        <div
          key={`${e.em}-${i}`}
          className="flex items-start gap-3 p-4 flex-wrap"
        >
          <div className="flex items-center gap-2 shrink-0">
            <StatusBadge status={e.de} />
            <span className="text-gray-400">→</span>
            <StatusBadge status={e.para} />
          </div>
          <div className="flex-1 min-w-[200px] text-sm text-gray-600">
            <p>
              {formatDateTime(e.em)}
              {e.por ? ` · ${autores.get(e.por) ?? 'usuário removido'}` : ''}
            </p>
            {e.motivo_rejeicao && (
              <p className="text-gray-500 mt-1">
                Motivo: {motivoRejeicaoLabel(e.motivo_rejeicao)}
                {e.detalhe_rejeicao ? ` — ${e.detalhe_rejeicao}` : ''}
              </p>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

/** Data e hora do carimbo ISO do histórico, em pt-BR. */
function formatDateTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
}

/** Slug do motivo → label amigável, com fallback pro slug cru. */
function motivoRejeicaoLabel(raw: string | null): string | null {
  if (!raw) return null
  return (MOTIVO_REJEICAO_LABELS as Record<string, string>)[raw] ?? raw
}
