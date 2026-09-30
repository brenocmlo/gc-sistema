import { SITUACAO_NF_CLASSES, SITUACAO_NF_LABELS, type SituacaoNf } from '@/lib/notas-fiscais'

/** O selo da NF: os 4 status do banco e "vencida", calculada em runtime. */
export default function SituacaoBadge({ situacao }: { situacao: SituacaoNf }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${SITUACAO_NF_CLASSES[situacao]}`}>
      {SITUACAO_NF_LABELS[situacao]}
    </span>
  )
}
