// Regras puras dos arquivos da NF (bloco 9.5): XML e PDF no bucket
// `notas-fiscais`, o caminho gravado em `notas_fiscais.xml_url` / `pdf_url`.
// Sem React: serve Server Action, Client Component e `node --test`.

import { fileExtension } from './files.ts'

export const BUCKET_NF = 'notas-fiscais'

/** O `file_size_limit` do bucket (20260424121552_storage_buckets.sql). */
export const ARQUIVO_NF_MAX_BYTES = 10 * 1024 * 1024

export const TIPOS_ARQUIVO_NF = ['xml', 'pdf'] as const
export type TipoArquivoNf = (typeof TIPOS_ARQUIVO_NF)[number]

export const ARQUIVO_NF_LABELS: Record<TipoArquivoNf, string> = { xml: 'XML da NF', pdf: 'PDF da NF' }

/** A coluna de cada tipo. Guarda o caminho no bucket, não uma URL (que expira). */
export const COLUNA_ARQUIVO_NF: Record<TipoArquivoNf, 'xml_url' | 'pdf_url'> = { xml: 'xml_url', pdf: 'pdf_url' }

/** Content-type do upload: tem de estar no `allowed_mime_types` do bucket. */
export const MIME_ARQUIVO_NF: Record<TipoArquivoNf, string> = { xml: 'application/xml', pdf: 'application/pdf' }

export const ACCEPT_ARQUIVO_NF: Record<TipoArquivoNf, string> = {
  xml: '.xml,application/xml,text/xml',
  pdf: '.pdf,application/pdf',
}

export function isTipoArquivoNf(v: unknown): v is TipoArquivoNf {
  return typeof v === 'string' && (TIPOS_ARQUIVO_NF as readonly string[]).includes(v)
}

/**
 * `{empresa}/{obra}/nf/{nf}/nota.xml` e `.../nota.pdf`. Nome FIXO por tipo:
 * substituir é sobrescrever (upsert, pela policy de update, que o financeiro
 * tem), sem apagar o antigo — a policy de delete do bucket é só do admin, e
 * apagar deixaria o financeiro sem conseguir trocar o arquivo.
 */
export function caminhoArquivoNf(d: { empresaId: string; obraId: string; nfId: string }, tipo: TipoArquivoNf): string {
  return `${d.empresaId}/${d.obraId}/nf/${d.nfId}/nota.${tipo}`
}

/** Extensão e tamanho, antes de subir. O MIME do navegador não é confiável (XML chega como text/xml ou vazio). */
export function validarArquivoNf(tipo: TipoArquivoNf, arquivo: { name: string; size: number }): string | null {
  if (fileExtension(arquivo.name) !== `.${tipo}`) return `Envie um arquivo .${tipo}`
  if (arquivo.size <= 0) return 'O arquivo está vazio'
  if (arquivo.size > ARQUIVO_NF_MAX_BYTES) return 'O arquivo passa de 10 MB'
  return null
}

/**
 * O começo do arquivo tem de ser do tipo certo: PDF começa com `%PDF`; XML,
 * depois de BOM e espaços, com `<`. Pega o .pdf renomeado para .xml (e vice-versa).
 */
export function conteudoPareceDoTipo(tipo: TipoArquivoNf, inicio: string): boolean {
  if (tipo === 'pdf') return inicio.startsWith('%PDF')
  return inicio.replace(/^﻿/, '').trimStart().startsWith('<')
}
