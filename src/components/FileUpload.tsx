'use client'

import { CheckCircle2, Loader2, Upload, X, XCircle } from 'lucide-react'
import { useRef, useState, type ChangeEvent, type DragEvent } from 'react'

import {
  FILE_ACCEPT_ATTR,
  fileErrorMessage,
  formatFileSize,
  validateFile,
} from '@/lib/files'

export type UploadResult = { ok: true } | { ok: false; error: string }

type FileUploadProps = {
  /** Chamado para cada arquivo. Faz o upload de fato (server action etc). */
  uploadFn: (file: File) => Promise<UploadResult>
  /** Chamado após cada upload com sucesso — caller costuma usar pra router.refresh(). */
  onUploaded?: () => void
  disabled?: boolean
  /** Sobrescreve o atributo `accept`. Default: extensões permitidas em lib/files. */
  accept?: string
}

type QueueItem = {
  id: string
  file: File
  status: 'pending' | 'uploading' | 'done' | 'error'
  error?: string
}

function nextId() {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

/**
 * Upload de arquivos reutilizável: drag-and-drop + picker. Valida tamanho/tipo
 * no cliente antes de chamar uploadFn. Upload serial (um por vez) pra UX simples
 * e controle de ordem.
 */
export default function FileUpload({
  uploadFn,
  onUploaded,
  disabled = false,
  accept = FILE_ACCEPT_ATTR,
}: FileUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [queue, setQueue] = useState<QueueItem[]>([])
  const [isDragging, setIsDragging] = useState(false)

  function openPicker() {
    if (!disabled) inputRef.current?.click()
  }

  async function processFiles(files: File[]) {
    if (files.length === 0) return

    // Adiciona tudo à fila com status inicial
    const initial: QueueItem[] = files.map((file) => {
      const err = validateFile(file)
      return {
        id: nextId(),
        file,
        status: err ? 'error' : 'pending',
        error: err ? fileErrorMessage(err) : undefined,
      }
    })

    setQueue((prev) => [...prev, ...initial])

    // Upload serial dos válidos
    for (const item of initial) {
      if (item.status === 'error') continue

      setQueue((prev) =>
        prev.map((q) =>
          q.id === item.id ? { ...q, status: 'uploading' } : q,
        ),
      )

      const result = await uploadFn(item.file)

      if (result.ok) {
        setQueue((prev) =>
          prev.map((q) => (q.id === item.id ? { ...q, status: 'done' } : q)),
        )
        onUploaded?.()
      } else {
        setQueue((prev) =>
          prev.map((q) =>
            q.id === item.id
              ? { ...q, status: 'error', error: result.error }
              : q,
          ),
        )
      }
    }
  }

  function onInputChange(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    e.target.value = '' // permite selecionar o mesmo arquivo de novo depois
    processFiles(files)
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setIsDragging(false)
    if (disabled) return
    const files = Array.from(e.dataTransfer.files)
    processFiles(files)
  }

  function onDragOver(e: DragEvent<HTMLDivElement>) {
    e.preventDefault()
    if (!disabled) setIsDragging(true)
  }

  function onDragLeave() {
    setIsDragging(false)
  }

  function removeFromQueue(id: string) {
    setQueue((prev) => prev.filter((q) => q.id !== id))
  }

  function clearDone() {
    setQueue((prev) => prev.filter((q) => q.status !== 'done'))
  }

  const hasDone = queue.some((q) => q.status === 'done')
  const allDone =
    queue.length > 0 && queue.every((q) => q.status === 'done' || q.status === 'error')

  return (
    <div className="space-y-3">
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={accept}
        disabled={disabled}
        onChange={onInputChange}
        className="hidden"
      />

      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        onClick={openPicker}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            openPicker()
          }
        }}
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        aria-disabled={disabled}
        className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${
          disabled
            ? 'border-gray-200 bg-gray-50 cursor-not-allowed'
            : isDragging
              ? 'border-gray-900 bg-gray-50'
              : 'border-gray-300 hover:border-gray-400 hover:bg-gray-50'
        }`}
      >
        <Upload size={28} className="mx-auto text-gray-400 mb-2" />
        <p className="text-sm text-gray-700">
          <span className="font-medium">Clique pra escolher</span> ou arraste
          arquivos aqui
        </p>
        <p className="text-xs text-gray-500 mt-1">
          PDF, Word, Excel, JPG, PNG, WebP · até 10 MB por arquivo
        </p>
      </div>

      {queue.length > 0 && (
        <div className="space-y-1.5">
          {queue.map((item) => (
            <div
              key={item.id}
              className="flex items-center gap-3 bg-white border border-gray-200 rounded-md px-3 py-2 text-sm"
            >
              <StatusIcon status={item.status} />
              <div className="flex-1 min-w-0">
                <p className="text-gray-900 truncate">{item.file.name}</p>
                <p className="text-xs text-gray-500">
                  {formatFileSize(item.file.size)}
                  {item.error && (
                    <span className="text-red-600 ml-2">{item.error}</span>
                  )}
                </p>
              </div>
              {item.status !== 'uploading' && (
                <button
                  type="button"
                  onClick={() => removeFromQueue(item.id)}
                  aria-label="Remover da lista"
                  className="text-gray-400 hover:text-gray-600"
                >
                  <X size={16} />
                </button>
              )}
            </div>
          ))}

          {allDone && hasDone && (
            <button
              type="button"
              onClick={clearDone}
              className="text-xs text-gray-500 hover:text-gray-700"
            >
              Limpar lista
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function StatusIcon({ status }: { status: QueueItem['status'] }) {
  if (status === 'uploading') {
    return <Loader2 size={16} className="text-gray-500 animate-spin shrink-0" />
  }
  if (status === 'done') {
    return <CheckCircle2 size={16} className="text-green-600 shrink-0" />
  }
  if (status === 'error') {
    return <XCircle size={16} className="text-red-600 shrink-0" />
  }
  return <Loader2 size={16} className="text-gray-300 shrink-0" />
}
