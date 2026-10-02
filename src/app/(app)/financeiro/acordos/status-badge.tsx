import {
  SITUACAO_PARCELA_CLASSES,
  SITUACAO_PARCELA_LABELS,
  STATUS_ACORDO_CLASSES,
  STATUS_ACORDO_LABELS,
  type SituacaoParcela,
} from '@/lib/acordos'
import type { AcordoStatus } from '@/lib/types'

/** O selo do acordo: os 4 status do banco. */
export function StatusAcordoBadge({ status }: { status: AcordoStatus }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${STATUS_ACORDO_CLASSES[status]}`}>
      {STATUS_ACORDO_LABELS[status]}
    </span>
  )
}

/** O selo da parcela: os 4 status do banco e "atrasada", calculada em runtime (em vermelho). */
export function SituacaoParcelaBadge({ situacao }: { situacao: SituacaoParcela }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${SITUACAO_PARCELA_CLASSES[situacao]}`}>
      {SITUACAO_PARCELA_LABELS[situacao]}
    </span>
  )
}
