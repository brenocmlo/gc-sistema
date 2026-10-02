import test from 'node:test'
import assert from 'node:assert/strict'

import { juntarAnexo, nomeOriginalDoArquivo } from './anexo-do-documento.ts'

test('nomeOriginalDoArquivo tira a pasta e o carimbo de tempo', () => {
  assert.equal(nomeOriginalDoArquivo('emp/telegram/1727712345678_proposta_eb-25.pdf'), 'proposta_eb-25.pdf')
  assert.equal(nomeOriginalDoArquivo('emp/sistema/1727712345678_contrato.pdf'), 'contrato.pdf')
  // Número curto no começo é parte do nome, não carimbo.
  assert.equal(nomeOriginalDoArquivo('emp/sistema/2025_tabela.pdf'), '2025_tabela.pdf')
  assert.equal(nomeOriginalDoArquivo(''), 'documento.pdf')
})

const anexo = (nome: string, tamanho = 10) => ({
  nome, path: `p/${nome}`, tipo: 'application/pdf', tamanho, uploaded_at: '2026-10-01T00:00:00Z', uploaded_by: 'u',
})

test('juntarAnexo acrescenta sem perder os que já existem', () => {
  assert.deepEqual(juntarAnexo([anexo('a.pdf')], anexo('b.pdf')).map((a) => a.nome), ['a.pdf', 'b.pdf'])
  assert.deepEqual(juntarAnexo(null, anexo('b.pdf')).map((a) => a.nome), ['b.pdf'])
  assert.deepEqual(juntarAnexo('lixo', anexo('b.pdf')).map((a) => a.nome), ['b.pdf'])
})

test('juntarAnexo não duplica o mesmo PDF numa reexecução', () => {
  const lista = [anexo('b.pdf', 99)]
  assert.equal(juntarAnexo(lista, anexo('b.pdf', 99)).length, 1)
  // Mesmo nome, outro arquivo: entra.
  assert.equal(juntarAnexo(lista, anexo('b.pdf', 100)).length, 2)
})
