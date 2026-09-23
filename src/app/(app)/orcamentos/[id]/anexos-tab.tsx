'use client'

import { ExternalLink, Trash2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { toast } from 'sonner'

import ConfirmDialog from '@/components/ConfirmDialog'
import FileUpload, { type UploadResult } from '@/components/FileUpload'
import { iconForFile } from '@/lib/file-icons'
import { formatDate } from '@/lib/format'
import { formatFileSize } from '@/lib/files'
import { podeExcluirAnexo } from '@/lib/anexos'
import type { Anexo, Perfil } from '@/lib/types'

import { deleteAnexoOrcamento, getAnexoUrl, uploadAnexoOrcamento } from './actions'

type AnexosTabProps = {
  orcamentoId: string
  anexos: Anexo[]
  perfil: Perfil
  /** Quem está vendo: excluir só aparece no anexo que a pessoa pode apagar. */
  userId: string
}

export default function AnexosTab({
  orcamentoId,
  anexos,
  perfil,
  userId,
}: AnexosTabProps) {
  const router = useRouter()
  const [deleting, setDeleting] = useState<Anexo | null>(null)
  const [opening, setOpening] = useState<string | null>(null)

  const canManage = perfil === 'admin' || perfil === 'comercial'

  async function handleUpload(file: File): Promise<UploadResult> {
    const formData = new FormData()
    formData.append('file', file)
    return uploadAnexoOrcamento(orcamentoId, formData)
  }

  async function handleOpen(anexo: Anexo) {
    setOpening(anexo.path)
    const result = await getAnexoUrl(anexo.path)
    setOpening(null)

    if (!result.ok) {
      toast.error(`Não foi possível abrir: ${result.error}`)
      return
    }
    window.open(result.url, '_blank', 'noopener,noreferrer')
  }

  async function handleDelete() {
    if (!deleting) return
    const result = await deleteAnexoOrcamento(orcamentoId, deleting.path)
    if (!result.ok) {
      toast.error(`Não foi possível excluir: ${result.error}`)
      return
    }
    toast.success('Anexo excluído')
    setDeleting(null)
    router.refresh()
  }

  return (
    <div className="space-y-6">
      {anexos.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-sm text-gray-500">
          Nenhum anexo ainda. Use o campo abaixo pra adicionar.
        </div>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 divide-y divide-gray-100">
          {anexos.map((anexo) => (
            <AnexoRow
              key={anexo.path}
              anexo={anexo}
              canDelete={canManage && podeExcluirAnexo(anexo, { perfil, userId })}
              opening={opening === anexo.path}
              onOpen={() => handleOpen(anexo)}
              onDelete={() => setDeleting(anexo)}
            />
          ))}
        </div>
      )}

      {canManage && (
        <div>
          <h3 className="text-sm font-semibold text-gray-900 mb-3">
            Adicionar anexos
          </h3>
          <FileUpload uploadFn={handleUpload} onUploaded={() => router.refresh()} />
        </div>
      )}

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Excluir anexo?"
        description={
          deleting
            ? `"${deleting.nome}" será removido permanentemente do orçamento.`
            : ''
        }
        variant="danger"
        confirmLabel="Excluir"
        onConfirm={handleDelete}
      />
    </div>
  )
}

function AnexoRow({
  anexo,
  canDelete,
  opening,
  onOpen,
  onDelete,
}: {
  anexo: Anexo
  canDelete: boolean
  opening: boolean
  onOpen: () => void
  onDelete: () => void
}) {
  const Icon = iconForFile(anexo.tipo, anexo.nome)

  return (
    <div className="flex items-center gap-3 p-3">
      <Icon size={20} className="text-gray-400 shrink-0" />

      <div className="flex-1 min-w-0">
        <p className="text-sm text-gray-900 truncate">{anexo.nome}</p>
        <p className="text-xs text-gray-500">
          {formatFileSize(anexo.tamanho)} · enviado em{' '}
          {formatDate(anexo.uploaded_at)}
        </p>
      </div>

      <div className="flex items-center gap-1 shrink-0">
        <button
          type="button"
          onClick={onOpen}
          disabled={opening}
          className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50"
        >
          <ExternalLink size={12} />
          {opening ? 'Abrindo...' : 'Visualizar'}
        </button>
        {canDelete && (
          <button
            type="button"
            onClick={onDelete}
            aria-label={`Excluir ${anexo.nome}`}
            className="p-1 rounded text-red-600 hover:bg-red-50"
          >
            <Trash2 size={14} />
          </button>
        )}
      </div>
    </div>
  )
}
