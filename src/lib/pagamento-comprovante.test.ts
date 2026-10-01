import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  caminhoDoComprovante,
  caminhoEhDoPagamento,
  COMPROVANTE_MAX_BYTES,
  conteudoPareceComprovante,
  MIME_COMPROVANTE,
  validarComprovante,
} from './pagamento-comprovante.ts'

const D = { empresaId: 'emp', obraId: 'obra', pagamentoId: 'pag' }

test('os tipos e o limite batem com o bucket anexos', () => {
  const sql = readFileSync(new URL('../../supabase/migrations/20260424121552_storage_buckets.sql', import.meta.url), 'utf8')
  const bloco = sql.match(/'anexos',\s*'anexos',\s*false,\s*(\d+),[^\n]*\n\s*array\[([\s\S]*?)\]/)
  assert.ok(bloco, 'bucket anexos não encontrado')
  assert.equal(Number(bloco[1]), COMPROVANTE_MAX_BYTES)
  const permitidos = bloco[2].match(/'([^']+)'/g)!.map((x) => x.slice(1, -1))
  for (const mime of Array.from(new Set(Object.values(MIME_COMPROVANTE)))) assert.ok(permitidos.includes(mime), `${mime} fora do bucket`)
})

test('caminho novo a cada envio, na pasta do pagamento, com a extensão normalizada', () => {
  assert.equal(caminhoDoComprovante(D, 'pix.JPEG', 1700000000000), 'emp/obra/pagamentos/pag/1700000000000_comprovante.jpg')
  assert.equal(caminhoDoComprovante(D, 'boleto.pdf', 1), 'emp/obra/pagamentos/pag/1_comprovante.pdf')
  assert.equal(caminhoDoComprovante(D, 'planilha.xlsx', 1), null)
})

test('caminhoEhDoPagamento recusa outra pasta, outro pagamento e nome forjado', () => {
  assert.equal(caminhoEhDoPagamento('emp/obra/pagamentos/pag/12_comprovante.png', D), true)
  assert.equal(caminhoEhDoPagamento('emp/obra/pagamentos/outro/12_comprovante.png', D), false)
  assert.equal(caminhoEhDoPagamento('emp/obra/pagamentos/pag/../outro/12_comprovante.png', D), false)
  assert.equal(caminhoEhDoPagamento('emp/obra/pagamentos/pag/12_comprovante.exe', D), false)
})

test('validarComprovante: extensão, vazio e tamanho', () => {
  assert.equal(validarComprovante({ name: 'a.pdf', size: 10 }), null)
  assert.match(validarComprovante({ name: 'a.docx', size: 10 }) ?? '', /PDF ou uma imagem/)
  assert.match(validarComprovante({ name: 'a.png', size: 0 }) ?? '', /vazio/)
  assert.match(validarComprovante({ name: 'a.png', size: COMPROVANTE_MAX_BYTES + 1 }) ?? '', /20 MB/)
})

test('conteudoPareceComprovante pelos primeiros bytes', () => {
  const b = (...xs: (number | string)[]) => new Uint8Array(xs.flatMap((x) => (typeof x === 'string' ? Array.from(x).map((c) => c.charCodeAt(0)) : [x])))
  assert.ok(conteudoPareceComprovante('a.pdf', b('%PDF-1.4')))
  assert.ok(conteudoPareceComprovante('a.jpg', b(0xff, 0xd8, 0xff, 0xe0)))
  assert.ok(conteudoPareceComprovante('a.png', b(0x89, 'PNG', 0x0d)))
  assert.ok(conteudoPareceComprovante('a.webp', b('RIFF', 0, 0, 0, 0, 'WEBP')))
  assert.equal(conteudoPareceComprovante('a.png', b('%PDF-1.4')), false, 'PDF renomeado para .png')
})
