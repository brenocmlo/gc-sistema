// Regras puras do comprovante de pagamento (bloco 10.4). Sem React: serve
// Server Action, Client Component e `node --test`.
//
// O comprovante vai para o bucket `anexos`: é o que aceita PDF e imagem (o
// comprovante de Pix costuma ser print), deixa o financeiro subir e deixa toda
// a empresa ler (o visualizador vê). O caminho gravado em `pagamentos.anexo`
// é o do bucket, não uma URL (que expira).

import { fileExtension } from './files.ts'

export const BUCKET_COMPROVANTE = 'anexos'

/** O `file_size_limit` do bucket `anexos` (20260424121552_storage_buckets.sql). */
export const COMPROVANTE_MAX_BYTES = 20 * 1024 * 1024

/** Extensão → content-type do upload; todos estão no `allowed_mime_types` do bucket. */
export const MIME_COMPROVANTE: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
}

export const ACCEPT_COMPROVANTE = '.pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp'

/** A pasta do pagamento: `{empresa}/{obra}/pagamentos/{pagamento}/`. */
export function pastaDoComprovante(d: { empresaId: string; obraId: string; pagamentoId: string }): string {
  return `${d.empresaId}/${d.obraId}/pagamentos/${d.pagamentoId}/`
}

/**
 * Um caminho novo a cada envio, dentro da pasta do pagamento. No `anexos`, só
 * o dono do arquivo o sobrescreve (policy "atualizar próprios"): com nome
 * fixo, o financeiro não trocaria o comprovante que o admin subiu. Substituir
 * é subir outro e apontar a coluna para ele.
 */
export function caminhoDoComprovante(
  d: { empresaId: string; obraId: string; pagamentoId: string },
  nomeArquivo: string,
  agora: number,
): string | null {
  const ext = fileExtension(nomeArquivo)
  if (!(ext in MIME_COMPROVANTE)) return null
  return `${pastaDoComprovante(d)}${agora}_comprovante${ext === '.jpeg' ? '.jpg' : ext}`
}

/** O caminho que o navegador devolve tem de ser um comprovante DESTE pagamento. */
export function caminhoEhDoPagamento(caminho: string, d: { empresaId: string; obraId: string; pagamentoId: string }): boolean {
  const pasta = pastaDoComprovante(d)
  if (!caminho.startsWith(pasta)) return false
  const nome = caminho.slice(pasta.length)
  return /^\d+_comprovante\.(pdf|jpg|png|webp)$/.test(nome)
}

/** Extensão e tamanho, antes de subir. */
export function validarComprovante(arquivo: { name: string; size: number }): string | null {
  if (!(fileExtension(arquivo.name) in MIME_COMPROVANTE)) return 'Envie um PDF ou uma imagem (JPG, PNG ou WEBP)'
  if (arquivo.size <= 0) return 'O arquivo está vazio'
  if (arquivo.size > COMPROVANTE_MAX_BYTES) return 'O arquivo passa de 20 MB'
  return null
}

/**
 * Os primeiros bytes batem com a extensão? PDF começa com `%PDF`; JPEG com
 * FF D8 FF; PNG com 89 'PNG'; WEBP com 'RIFF' e 'WEBP' no byte 8. Pega o
 * arquivo renomeado.
 */
export function conteudoPareceComprovante(nomeArquivo: string, inicio: Uint8Array): boolean {
  const ext = fileExtension(nomeArquivo)
  const txt = (de: number, ate: number) => String.fromCharCode(...Array.from(inicio.slice(de, ate)))
  if (ext === '.pdf') return txt(0, 4) === '%PDF'
  if (ext === '.jpg' || ext === '.jpeg') return inicio[0] === 0xff && inicio[1] === 0xd8 && inicio[2] === 0xff
  if (ext === '.png') return inicio[0] === 0x89 && txt(1, 4) === 'PNG'
  if (ext === '.webp') return txt(0, 4) === 'RIFF' && txt(8, 12) === 'WEBP'
  return false
}
