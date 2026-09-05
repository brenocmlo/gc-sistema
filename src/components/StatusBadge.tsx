import type {
  ObraStatus,
  OrcamentoStatus,
  PropostaStatus,
  StatusFdPagamento,
} from '@/lib/types'

type StatusKey =
  | ObraStatus
  | OrcamentoStatus
  | PropostaStatus
  | StatusFdPagamento

type StatusConfig = { label: string; className: string }

const CONFIG: Record<StatusKey, StatusConfig> = {
  // Obras
  ativa: {
    label: 'Ativa',
    className: 'bg-green-100 text-green-700 border-green-200',
  },
  concluida: {
    label: 'Concluída',
    className: 'bg-blue-100 text-blue-700 border-blue-200',
  },
  suspensa: {
    label: 'Suspensa',
    className: 'bg-yellow-100 text-yellow-700 border-yellow-200',
  },
  cancelada: {
    label: 'Cancelada',
    className: 'bg-gray-100 text-gray-600 border-gray-200',
  },

  // Orçamentos
  pendente: {
    label: 'Pendente',
    className: 'bg-gray-100 text-gray-600 border-gray-200',
  },
  analise: {
    label: 'Em análise',
    className: 'bg-yellow-100 text-yellow-700 border-yellow-200',
  },
  enviado: {
    label: 'Enviado',
    className: 'bg-blue-100 text-blue-700 border-blue-200',
  },
  aprovado: {
    label: 'Aprovado',
    className: 'bg-green-100 text-green-700 border-green-200',
  },
  rejeitado: {
    label: 'Rejeitado',
    className: 'bg-red-100 text-red-700 border-red-200',
  },
  expirado: {
    label: 'Expirado',
    className: 'bg-slate-200 text-slate-700 border-slate-300',
  },

  // Propostas (labels no feminino — chaves distintas das de orçamento)
  rascunho: {
    label: 'Rascunho',
    className: 'bg-gray-100 text-gray-600 border-gray-200',
  },
  enviada: {
    label: 'Enviada',
    className: 'bg-blue-100 text-blue-700 border-blue-200',
  },
  aprovada: {
    label: 'Aprovada',
    className: 'bg-green-100 text-green-700 border-green-200',
  },
  rejeitada: {
    label: 'Rejeitada',
    className: 'bg-red-100 text-red-700 border-red-200',
  },

  // FD pagamento (calculado em runtime — não é coluna do banco)
  pago: {
    label: 'Pago',
    className: 'bg-green-100 text-green-700 border-green-200',
  },
  vencido: {
    label: 'Vencido',
    className: 'bg-red-100 text-red-700 border-red-200',
  },
}

const FALLBACK: StatusConfig = {
  label: '',
  className: 'bg-gray-100 text-gray-600 border-gray-200',
}

export default function StatusBadge({ status }: { status: string }) {
  const config =
    (CONFIG as Record<string, StatusConfig>)[status] ??
    ({ ...FALLBACK, label: status } satisfies StatusConfig)

  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${config.className}`}
    >
      {config.label}
    </span>
  )
}
