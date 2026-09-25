import { DOCUMENTO_STATUS_CLASSES, DOCUMENTO_STATUS_LABELS, isDocumentoStatus } from '@/lib/documentos'

export default function StatusDocumento({ status }: { status: string }) {
  const conhecido = isDocumentoStatus(status)
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${
        conhecido ? DOCUMENTO_STATUS_CLASSES[status] : 'bg-gray-100 text-gray-600 border-gray-200'
      }`}
    >
      {conhecido ? DOCUMENTO_STATUS_LABELS[status] : status}
    </span>
  )
}
