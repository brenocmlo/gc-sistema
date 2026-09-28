// Regras puras das evidências de execução (bloco 8.1): arquivo no bucket
// `evidencias`, metadado no jsonb `execucao.evidencias`. Sem React: serve
// Server Action, Client Component e `node --test`.

import { isEtapa, type Etapa } from './execucao.ts'
import { fileExtension, sanitizeFilename } from './files.ts'
import type { Anexo } from './types'

export const BUCKET_EVIDENCIAS = 'evidencias'

/** O `file_size_limit` do bucket (20260424121552_storage_buckets.sql). */
export const EVIDENCIA_MAX_BYTES = 20 * 1024 * 1024

/**
 * Extensão → MIME. TEM de bater com o `allowed_mime_types` do bucket
 * `evidencias` (`evidencias.test.ts` compara). O MIME sai da extensão, e não
 * do `file.type`, porque o navegador costuma mandar HEIC com tipo vazio, e o
 * bucket recusa upload sem o content-type da lista.
 */
export const EVIDENCIA_TIPOS: Readonly<Record<string, string>> = {
  '.pdf': 'application/pdf',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.heic': 'image/heic',
}

export const EVIDENCIA_ACCEPT = Object.keys(EVIDENCIA_TIPOS).join(',')

export const EVIDENCIA_DICA = 'PDF, JPG, PNG, WebP ou HEIC · até 20 MB por arquivo'

/** O metadado de cada arquivo: o de anexo, mais a etapa a que ele pertence. */
export type Evidencia = Anexo & { etapa: Etapa }

type ArquivoLike = { name: string; size: number; type?: string }

/** Content-type que vai no upload, ou null se o tipo não é aceito. */
export function tipoDaEvidencia(arquivo: ArquivoLike): string | null {
  return EVIDENCIA_TIPOS[fileExtension(arquivo.name)] ?? null
}

export function validarEvidencia(arquivo: ArquivoLike): string | null {
  if (!tipoDaEvidencia(arquivo)) return 'Envie PDF ou imagem (JPG, PNG, WebP ou HEIC)'
  if (arquivo.size <= 0) return 'O arquivo está vazio'
  if (arquivo.size > EVIDENCIA_MAX_BYTES) return 'O arquivo passa de 20 MB'
  return null
}

type Destino = { empresaId: string; obraId: string; execucaoId: string; etapa: Etapa }

/** `{empresa}/{obra}/execucao/{execucao}/{etapa}/`. A empresa vem primeiro: é o que a policy confere. */
export function pastaDaEvidencia(d: Destino): string {
  return `${d.empresaId}/${d.obraId}/execucao/${d.execucaoId}/${d.etapa}/`
}

export function caminhoDaEvidencia(d: Destino, nomeArquivo: string, agora: number = Date.now()): string {
  return `${pastaDaEvidencia(d)}${agora}_${sanitizeFilename(nomeArquivo)}`
}

/**
 * A action só registra arquivo que está na pasta daquela execução e daquela
 * etapa. O path vem do navegador: sem isto, daria para "registrar" a foto de
 * outra obra da mesma empresa, que a policy do bucket deixa ler.
 */
export function caminhoEhDaEvidencia(caminho: string, d: Destino): boolean {
  const pasta = pastaDaEvidencia(d)
  const resto = caminho.slice(pasta.length)
  return caminho.startsWith(pasta) && resto.length > 0 && !resto.includes('/') && !caminho.includes('..')
}

/** O jsonb como veio do banco, sem o que não tem forma de evidência. */
export function lerEvidencias(valor: unknown): Evidencia[] {
  if (!Array.isArray(valor)) return []
  return valor.filter(
    (e): e is Evidencia =>
      Boolean(e) && typeof e === 'object' && typeof e.path === 'string' && typeof e.etapa === 'string' && isEtapa(e.etapa),
  )
}

/** As evidências de uma etapa, da mais nova para a mais antiga. */
export function evidenciasDaEtapa(lista: readonly Evidencia[], etapa: Etapa): Evidencia[] {
  return lista
    .filter((e) => e.etapa === etapa)
    .sort((a, b) => (a.uploaded_at < b.uploaded_at ? 1 : a.uploaded_at > b.uploaded_at ? -1 : 0))
}

/** Miniatura só para o que o navegador desenha; HEIC fora do Safari não desenha. */
export function temMiniatura(e: Pick<Evidencia, 'tipo'>): boolean {
  return e.tipo === 'image/jpeg' || e.tipo === 'image/png' || e.tipo === 'image/webp'
}
