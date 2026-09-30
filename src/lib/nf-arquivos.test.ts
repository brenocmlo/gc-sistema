import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  ARQUIVO_NF_MAX_BYTES,
  caminhoArquivoNf,
  COLUNA_ARQUIVO_NF,
  conteudoPareceDoTipo,
  isTipoArquivoNf,
  MIME_ARQUIVO_NF,
  validarArquivoNf,
} from './nf-arquivos.ts'

test('os MIME do upload estão no allowed_mime_types do bucket notas-fiscais, e o limite é o dele', () => {
  const sql = readFileSync(new URL('../../supabase/migrations/20260424121552_storage_buckets.sql', import.meta.url), 'utf8')
  const bloco = sql.slice(sql.indexOf("'notas-fiscais',"), sql.indexOf("'documentos',"))
  for (const mime of Object.values(MIME_ARQUIVO_NF)) assert.ok(bloco.includes(`'${mime}'`), mime)
  assert.match(bloco, /10485760/)
  assert.equal(ARQUIVO_NF_MAX_BYTES, 10485760)
})

test('caminho fixo por tipo, com a empresa primeiro (a policy confere o primeiro segmento)', () => {
  const d = { empresaId: 'E', obraId: 'O', nfId: 'N' }
  assert.equal(caminhoArquivoNf(d, 'xml'), 'E/O/nf/N/nota.xml')
  assert.equal(caminhoArquivoNf(d, 'pdf'), 'E/O/nf/N/nota.pdf')
  assert.deepEqual(COLUNA_ARQUIVO_NF, { xml: 'xml_url', pdf: 'pdf_url' })
})

test('validarArquivoNf: extensão certa para cada tipo, vazio e acima de 10 MB', () => {
  assert.equal(validarArquivoNf('xml', { name: 'NFe3526.XML', size: 10 }), null)
  assert.equal(validarArquivoNf('pdf', { name: 'danfe.pdf', size: 10 }), null)
  assert.match(validarArquivoNf('xml', { name: 'danfe.pdf', size: 10 }) ?? '', /\.xml/)
  assert.match(validarArquivoNf('pdf', { name: 'nota.xml', size: 10 }) ?? '', /\.pdf/)
  assert.match(validarArquivoNf('pdf', { name: 'x.pdf', size: 0 }) ?? '', /vazio/)
  assert.match(validarArquivoNf('pdf', { name: 'x.pdf', size: ARQUIVO_NF_MAX_BYTES + 1 }) ?? '', /10 MB/)
})

test('conteudoPareceDoTipo pega PDF renomeado para .xml e o contrário', () => {
  assert.equal(conteudoPareceDoTipo('pdf', '%PDF-1.7'), true)
  assert.equal(conteudoPareceDoTipo('pdf', '<?xml'), false)
  assert.equal(conteudoPareceDoTipo('xml', '﻿  <?xml version="1.0"?>'), true)
  assert.equal(conteudoPareceDoTipo('xml', '%PDF-1.4'), false)
  assert.equal(isTipoArquivoNf('xml'), true)
  assert.equal(isTipoArquivoNf('docx'), false)
})
