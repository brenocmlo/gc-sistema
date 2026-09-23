/**
 * Foto do item (bloco 5.5) — regras puras, sem React, testáveis por
 * `node --test`.
 *
 * DECISÃO DE ARMAZENAMENTO: `itens.foto_url` guarda o **path** no bucket, não
 * uma URL. O nome da coluna sugere URL, mas o bucket `anexos` é privado
 * (`public = false`, `20260424121552_storage_buckets.sql`): uma URL assinada
 * expira em uma hora e gravá-la no banco deixaria todas as fotos quebradas no
 * dia seguinte. A URL é gerada na hora de mostrar, em lote, pelo servidor —
 * o mesmo desenho que os anexos de proposta já usam (`Anexo.path`).
 */

export const BUCKET_FOTOS = 'anexos'

/**
 * Tipos aceitos: a INTERSEÇÃO entre o que o bucket `anexos` aceita e o que é
 * foto.
 *
 * O bucket aceita `image/jpeg`, `image/png` e `image/webp`. Fica de fora:
 *   - `image/gif` — `src/lib/files.ts` o aceita para anexos, mas o bucket NÃO
 *     (o upload de gif como anexo de proposta falharia no Storage hoje);
 *   - `image/heic` — formato nativo do iPhone, aceito só no bucket
 *     `evidencias`. O Safari converte para JPEG ao anexar por
 *     `input[type=file]` na configuração padrão, mas não é garantido — ver a
 *     pendência nominal no documento do bloco.
 */
export const FOTO_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const

export const FOTO_ACCEPT = '.jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp'

/** 10 MB — o mesmo teto dos anexos. O bucket aceitaria 20. */
export const FOTO_MAX_BYTES = 10 * 1024 * 1024

export type ArquivoLike = { type: string; size: number; name?: string }

/** `null` se a foto é aceitável; senão, a mensagem para a pessoa. */
export function validarFoto(arquivo: ArquivoLike): string | null {
  if (!(FOTO_MIME_TYPES as readonly string[]).includes(arquivo.type)) {
    return 'A foto tem de ser JPG, PNG ou WebP'
  }
  if (arquivo.size <= 0) return 'O arquivo da foto está vazio'
  if (arquivo.size > FOTO_MAX_BYTES) {
    const mb = (arquivo.size / 1024 / 1024).toFixed(1).replace('.', ',')
    return `A foto tem ${mb} MB; o limite é 10 MB`
  }
  return null
}

/**
 * Prefixo onde as fotos de um item moram: `<empresa>/itens/<item>/`.
 *
 * O primeiro segmento TEM de ser o `empresa_id`: é o que a policy do bucket
 * confere (`storage_empresa_id_from_path(name) = current_empresa_id()`).
 */
export function prefixoFotoItem(empresaId: string, itemId: string): string {
  return `${empresaId}/itens/${itemId}/`
}

/**
 * Confere que um path pertence ao item. Usado antes de remover um arquivo: o
 * path vem do banco, mas `foto_url` já foi escrita sem whitelist uma vez (ver
 * `CAMPOS_EDITAVEIS_ITEM`), e remover do Storage um arquivo de outro item
 * seria destruir dado alheio.
 */
export function pathEhDoItem(
  path: string | null | undefined,
  empresaId: string,
  itemId: string,
): boolean {
  if (!path) return false
  if (path.includes('..')) return false
  const prefixo = prefixoFotoItem(empresaId, itemId)
  return path.startsWith(prefixo) && path.length > prefixo.length
}

/**
 * O `remove()` do Storage NÃO devolve erro quando o RLS nega a exclusão —
 * devolve sucesso com a lista vazia. Esta função transforma "pedi 1, removeu 0"
 * no que ele é: falha.
 *
 * Policy do bucket `anexos`: delete só para **admin ou dono do arquivo**
 * (`owner = auth.uid()`). Comercial B tentando remover a foto que comercial A
 * enviou é exatamente o caso que cai aqui.
 */
export function removeuTudo(
  pedidos: readonly string[],
  removidos: readonly { name?: string | null }[] | null | undefined,
): boolean {
  if (pedidos.length === 0) return true
  return (removidos?.length ?? 0) >= pedidos.length
}
