import test from 'node:test'
import assert from 'node:assert/strict'

import {
  FOTO_MAX_BYTES,
  FOTO_MIME_TYPES,
  pathEhDoItem,
  prefixoFotoItem,
  removeuTudo,
  validarFoto,
} from './fotos.ts'

const E = '11111111-1111-1111-1111-111111111111'
const I = '22222222-2222-2222-2222-222222222222'

test('validarFoto aceita JPG, PNG e WebP', () => {
  for (const type of ['image/jpeg', 'image/png', 'image/webp']) {
    assert.equal(validarFoto({ type, size: 1000 }), null, type)
  }
})

test('validarFoto recusa GIF — o bucket anexos não aceita', () => {
  assert.match(validarFoto({ type: 'image/gif', size: 1000 }) ?? '', /JPG, PNG ou WebP/)
})

test('validarFoto recusa HEIC e PDF', () => {
  assert.ok(validarFoto({ type: 'image/heic', size: 1000 }))
  assert.ok(validarFoto({ type: 'application/pdf', size: 1000 }))
})

test('validarFoto recusa vazio e acima de 10 MB', () => {
  assert.match(validarFoto({ type: 'image/jpeg', size: 0 }) ?? '', /vazio/)
  assert.match(validarFoto({ type: 'image/jpeg', size: FOTO_MAX_BYTES + 1 }) ?? '', /limite é 10 MB/)
  assert.equal(validarFoto({ type: 'image/jpeg', size: FOTO_MAX_BYTES }), null)
})

test('FOTO_MIME_TYPES é subconjunto do que o bucket anexos aceita', () => {
  // Lista do bucket, copiada de 20260424121552_storage_buckets.sql
  const doBucket = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
  for (const t of FOTO_MIME_TYPES) assert.ok(doBucket.includes(t), t)
})

test('prefixoFotoItem começa pela empresa, como a policy exige', () => {
  assert.equal(prefixoFotoItem(E, I), `${E}/itens/${I}/`)
})

test('pathEhDoItem aceita só arquivo dentro da pasta do item', () => {
  assert.equal(pathEhDoItem(`${E}/itens/${I}/123_foto.jpg`, E, I), true)
  // outro item, outra empresa, a própria pasta sem arquivo, traversal
  assert.equal(pathEhDoItem(`${E}/itens/outro/123_foto.jpg`, E, I), false)
  assert.equal(pathEhDoItem(`outra/itens/${I}/123_foto.jpg`, E, I), false)
  assert.equal(pathEhDoItem(`${E}/itens/${I}/`, E, I), false)
  assert.equal(pathEhDoItem(`${E}/itens/${I}/../outro/foto.jpg`, E, I), false)
  assert.equal(pathEhDoItem(`${E}/propostas/${I}/foto.jpg`, E, I), false)
  assert.equal(pathEhDoItem(null, E, I), false)
})

test('removeuTudo trata lista vazia do Storage como falha', () => {
  // O remove() do Storage devolve sucesso com [] quando o RLS nega.
  assert.equal(removeuTudo(['a'], []), false)
  assert.equal(removeuTudo(['a'], null), false)
  assert.equal(removeuTudo(['a'], [{ name: 'a' }]), true)
  assert.equal(removeuTudo([], []), true)
})
