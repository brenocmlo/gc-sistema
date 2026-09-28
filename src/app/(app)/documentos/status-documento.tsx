import { DOCUMENTO_STATUS_CLASSES, aguardaConferencia, isDocumentoStatus, rotuloStatusDocumento } from '@/lib/documentos'

const CLASSE_A_CONFERIR = 'bg-blue-100 text-blue-700 border-blue-200'

export default function StatusDocumento({ status, conferencia }: { status: string; conferencia?: string | null }) {
  const doc = { status, conferencia }
  const classe = aguardaConferencia(doc)
    ? CLASSE_A_CONFERIR
    : isDocumentoStatus(status)
      ? DOCUMENTO_STATUS_CLASSES[status]
      : 'bg-gray-100 text-gray-600 border-gray-200'
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${classe}`}>
      {rotuloStatusDocumento(doc)}
    </span>
  )
}
