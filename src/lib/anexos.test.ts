import test from 'node:test'
import assert from 'node:assert/strict'

import { autorizarExclusaoDeAnexo, podeExcluirAnexo, removeuDoStorage } from './anexos.ts'

const ADMIN = { perfil: 'admin', userId: 'u-admin' }
const COMERCIAL = { perfil: 'comercial', userId: 'u-com' }

const anexo = (path: string, uploaded_by: string) => ({
  nome: path, path, tipo: 'application/pdf', tamanho: 1, uploaded_at: '2026-09-23T00:00:00Z', uploaded_by,
})

test('podeExcluirAnexo espelha a policy do Storage: admin ou dono', () => {
  assert.equal(podeExcluirAnexo(anexo('a', 'u-com'), ADMIN), true)
  assert.equal(podeExcluirAnexo(anexo('a', 'u-com'), COMERCIAL), true)
  assert.equal(podeExcluirAnexo(anexo('a', 'u-admin'), COMERCIAL), false)
  // Anexo antigo sem autor: só o admin.
  assert.equal(podeExcluirAnexo(anexo('a', ''), COMERCIAL), false)
  assert.equal(podeExcluirAnexo(anexo('a', ''), ADMIN), true)
})

test('autorizarExclusaoDeAnexo recusa path que não está no jsonb', () => {
  const r = autorizarExclusaoDeAnexo([anexo('emp/propostas/1/a.pdf', 'u-admin')], 'emp/contratos/9/b.pdf', ADMIN)
  assert.equal(r.ok, false)
  assert.equal(autorizarExclusaoDeAnexo(null, 'x', ADMIN).ok, false)
})

test('autorizarExclusaoDeAnexo recusa o comercial no anexo do admin, e devolve o restante a quem pode', () => {
  const lista = [anexo('p/1', 'u-admin'), anexo('p/2', 'u-com')]
  const negado = autorizarExclusaoDeAnexo(lista, 'p/1', COMERCIAL)
  assert.equal(negado.ok, false)
  assert.match(negado.ok ? '' : negado.error, /admin ou quem enviou/)
  const ok = autorizarExclusaoDeAnexo(lista, 'p/2', COMERCIAL)
  assert.deepEqual(ok.ok ? ok.restantes.map((a) => a.path) : null, ['p/1'])
})

test('removeuDoStorage: lista vazia é recusa silenciosa da policy', () => {
  assert.equal(removeuDoStorage([{ name: 'a' }]), true)
  assert.equal(removeuDoStorage([]), false)
  assert.equal(removeuDoStorage(null), false)
})
