// Helpers PUROS sobre arquivos — sem imports de React ou lucide.
// Pode ser importado livremente de Server Actions, Server Components e Client.
// Ícones por tipo de arquivo ficam em './file-icons' (lucide, só client/JSX).

export const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10 MB

// MIME types aceitos. Frontend também valida extensão como fallback.
//
// TEM de ser igual ao `allowed_mime_types` do bucket `anexos`
// (20260424121552_storage_buckets.sql). Até o fim da sprint 5 esta lista
// aceitava GIF, que o bucket recusa — o anexo passava na tela e falhava no
// upload com erro cru do Storage — e não aceitava WebP, que o bucket aceita.
// `files.test.ts` compara as duas listas.
export const ALLOWED_MIME_TYPES: readonly string[] = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
  'application/msword', // .doc (legado)
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
  'application/vnd.ms-excel', // .xls (legado)
  'image/jpeg',
  'image/png',
  'image/webp',
]

export const ALLOWED_EXTENSIONS: readonly string[] = [
  '.pdf',
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
]

/** Atributo `accept` de input[type=file]. */
export const FILE_ACCEPT_ATTR = ALLOWED_EXTENSIONS.join(',')

export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** Extrai extensão (com ponto) em lowercase. '' se não tiver. */
export function fileExtension(filename: string): string {
  const dot = filename.lastIndexOf('.')
  if (dot === -1 || dot === filename.length - 1) return ''
  return filename.slice(dot).toLowerCase()
}

/**
 * Remove acentos, espaços e caracteres inválidos do nome do arquivo.
 * Mantém extensão intacta. Usa escapes Unicode explícitos pra range de marcas
 * diacríticas combinantes (U+0300..U+036F) e evitar problemas de codificação.
 */
export function sanitizeFilename(name: string): string {
  const normalized = name.normalize('NFD').replace(/[̀-ͯ]/g, '')
  return normalized
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_{2,}/g, '_')
    .toLowerCase()
}

/** Path de Storage: `{empresa}/{entidade}/{id}/{ts}_{filename}`. */
export function buildStoragePath(
  empresaId: string,
  entidade: string,
  entidadeId: string,
  filename: string,
): string {
  const ts = Date.now()
  const clean = sanitizeFilename(filename)
  return `${empresaId}/${entidade}/${entidadeId}/${ts}_${clean}`
}

export type FileValidationError =
  | { kind: 'too_large'; maxBytes: number }
  | { kind: 'invalid_type'; allowed: readonly string[] }

export function validateFile(file: File): FileValidationError | null {
  if (file.size > MAX_FILE_SIZE) {
    return { kind: 'too_large', maxBytes: MAX_FILE_SIZE }
  }
  const ext = fileExtension(file.name)
  const mimeOk = ALLOWED_MIME_TYPES.includes(file.type)
  const extOk = ALLOWED_EXTENSIONS.includes(ext)
  if (!mimeOk && !extOk) {
    return { kind: 'invalid_type', allowed: ALLOWED_EXTENSIONS }
  }
  return null
}

export function fileErrorMessage(error: FileValidationError): string {
  if (error.kind === 'too_large') {
    return `Arquivo muito grande (máximo ${formatFileSize(error.maxBytes)})`
  }
  return `Tipo de arquivo não permitido. Aceitos: ${error.allowed.join(', ')}`
}
