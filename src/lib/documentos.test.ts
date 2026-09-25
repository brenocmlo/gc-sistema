import test from 'node:test'
import assert from 'node:assert/strict'

import {
  caminhoDoArquivo,
  destinoDoDocumento,
  isDocumentoStatus,
  itensLidos,
  resumoDoDocumento,
  rotuloOrigem,
  rotuloTipo,
  STATUS_DOCUMENTO_OPTIONS,
} from './documentos.ts'

test('status: os quatro do CHECK, com rótulo', () => {
  assert.deepEqual(STATUS_DOCUMENTO_OPTIONS.map((o) => o.value), ['PENDENTE', 'ERRO_VALIDACAO', 'REVISAO_HUMANA', 'APROVADO'])
  assert.equal(isDocumentoStatus('APROVADO'), true)
  assert.equal(isDocumentoStatus('PROPOSTA_REGISTRADA'), false)
})

test('rótulos de tipo e origem', () => {
  assert.equal(rotuloTipo('PROPOSTA'), 'Proposta')
  assert.equal(rotuloTipo('CONTRATO'), 'Contrato')
  assert.equal(rotuloTipo(null), '—')
  assert.equal(rotuloOrigem('TELEGRAM'), 'Telegram')
  assert.equal(rotuloOrigem('WHATSAPP'), 'WhatsApp')
  assert.equal(rotuloOrigem(null), 'Pela tela')
})

test('resumo lê o formato do fluxo novo', () => {
  const r = resumoDoDocumento({ numero: 'PROP-2026-0117', valorProposta: 248500, cliente_nome: 'Vista Verde', itens: [{}, {}, {}, {}], extrator: 'groq', itensConfiaveis: true })
  assert.deepEqual(r, { numero: 'PROP-2026-0117', valor: 248500, cliente: 'Vista Verde', itens: 4, extrator: 'groq', itensConfiaveis: true })
})

test('resumo lê o formato antigo (agosto) e o cru do Gemini', () => {
  assert.equal(resumoDoDocumento({ numeroContrato: 'TESTE-FASE2-001', valorContrato: '121656.19' }).valor, 121656.19)
  assert.equal(resumoDoDocumento({ numero_contrato: 'X', valor_total: 10 }).numero, 'X')
})

test('resumo tolera dado vazio ou estranho', () => {
  for (const v of [null, undefined, 'texto', [1, 2], {}]) {
    const r = resumoDoDocumento(v)
    assert.equal(r.numero, null)
    assert.equal(r.itens, 0)
    assert.equal(r.itensConfiaveis, null)
  }
})

test('itensLidos normaliza cada item e ignora o que não for lista', () => {
  const itens = itensLidos({ itens: [{ numero: '12', descricao: 'Porta', quantidade: 2, valor_unitario: 1986.08, valor_total: 3972.16, unidade: null }, 'lixo'] })
  assert.equal(itens.length, 2)
  assert.deepEqual(itens[0], { numero: '12', descricao: 'Porta', quantidade: 2, unidade: null, valor_unitario: 1986.08, valor_total: 3972.16, tipo: null, localizacao: null })
  assert.equal(itens[1].descricao, null)
  assert.deepEqual(itensLidos({ itens: 'nada' }), [])
})

test('destino: proposta, contrato ou nenhum', () => {
  assert.deepEqual(destinoDoDocumento({ proposta_criada_id: 'p1', contrato_criado_id: null }), { href: '/propostas/p1', rotulo: 'Ver proposta' })
  assert.deepEqual(destinoDoDocumento({ proposta_criada_id: null, contrato_criado_id: 'c1' }), { href: '/contratos/c1', rotulo: 'Ver contrato' })
  assert.equal(destinoDoDocumento({ proposta_criada_id: null, contrato_criado_id: null }), null)
})

test('caminhoDoArquivo tira o path da URL assinada', () => {
  const url = 'https://x.supabase.co/storage/v1/object/sign/documentos-processamento/emp/telegram/1-PROP.%20COM.pdf?token=abc'
  assert.equal(caminhoDoArquivo(url), 'emp/telegram/1-PROP. COM.pdf')
  assert.equal(caminhoDoArquivo('https://x/object/public/documentos-processamento/emp/a.pdf'), 'emp/a.pdf')
  assert.equal(caminhoDoArquivo('validacao://ingestao'), null)
  assert.equal(caminhoDoArquivo(null), null)
})

import { caminhoDeEnvio, caminhoEhDaEmpresa, MAX_ENVIO_BYTES, validarPdfParaEnvio } from './documentos.ts'

test('validarPdfParaEnvio: só PDF, não vazio, até 20 MB', () => {
  assert.equal(validarPdfParaEnvio({ name: 'a.pdf', type: 'application/pdf', size: 100 }), null)
  assert.equal(validarPdfParaEnvio({ name: 'A.PDF', type: '', size: 100 }), null)
  assert.equal(validarPdfParaEnvio({ name: 'a.jpg', type: 'image/jpeg', size: 100 }), 'Envie o documento em PDF')
  assert.equal(validarPdfParaEnvio({ name: 'a.pdf', type: 'application/pdf', size: 0 }), 'O arquivo está vazio')
  assert.equal(validarPdfParaEnvio({ name: 'a.pdf', type: 'application/pdf', size: MAX_ENVIO_BYTES + 1 }), 'O arquivo passa de 20 MB')
})

test('caminhoDeEnvio: empresa primeiro, pasta sistema, nome limpo', () => {
  assert.equal(caminhoDeEnvio('emp-1', 'PROP. COM. - EF (AL+VD).pdf', 123), 'emp-1/sistema/123_prop._com._-_ef_al_vd_.pdf')
})

test('caminhoEhDaEmpresa barra outra empresa, outra pasta e ..', () => {
  assert.equal(caminhoEhDaEmpresa('emp-1/sistema/1_a.pdf', 'emp-1'), true)
  assert.equal(caminhoEhDaEmpresa('emp-2/sistema/1_a.pdf', 'emp-1'), false)
  assert.equal(caminhoEhDaEmpresa('emp-1/telegram/1_a.pdf', 'emp-1'), false)
  assert.equal(caminhoEhDaEmpresa('emp-1/sistema/../emp-2/a.pdf', 'emp-1'), false)
})
