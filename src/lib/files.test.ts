import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { ALLOWED_EXTENSIONS, ALLOWED_MIME_TYPES, validateFile } from './files.ts'

/**
 * Lê o `allowed_mime_types` do bucket `anexos` direto da migration, em vez de
 * copiar a lista para cá: se alguém mudar o bucket e esquecer o cliente (ou o
 * contrário), este teste quebra.
 */
function mimesDoBucketAnexos(): string[] {
  const sql = readFileSync(
    new URL('../../supabase/migrations/20260424121552_storage_buckets.sql', import.meta.url),
    'utf8',
  )
  const bloco = sql.slice(sql.indexOf("'anexos',"), sql.indexOf("'evidencias',"))
  const lista = bloco.slice(bloco.indexOf('array['), bloco.indexOf(']', bloco.indexOf('array[')))
  return (lista.match(/'[^']+'/g) ?? []).map((m) => m.slice(1, -1))
}

test('os tipos aceitos no cliente são exatamente os do bucket anexos', () => {
  assert.deepEqual([...ALLOWED_MIME_TYPES].sort(), mimesDoBucketAnexos().sort())
})

test('GIF é recusado no cliente — o bucket não aceita', () => {
  const gif = { name: 'x.gif', type: 'image/gif', size: 100 } as File
  assert.equal(validateFile(gif)?.kind, 'invalid_type')
  assert.equal(ALLOWED_EXTENSIONS.includes('.gif'), false)
})

test('WebP é aceito no cliente — o bucket aceita', () => {
  const webp = { name: 'x.webp', type: 'image/webp', size: 100 } as File
  assert.equal(validateFile(webp), null)
})
