import test from 'node:test'
import assert from 'node:assert/strict'

import { descreverErro, etapaEncerrada, rotuloEtapa, situacaoDaAutomacao, type EventoAutomacao } from './automacao.ts'

test('limite de execuções do n8n: frase clara e bloqueia tudo', () => {
  // mensagem real recebida no grupo em 23/09 (execução 4460)
  const e = descreverErro('<p style="font-style: normal">Execution limit reached. Consider <a href="...">upgrading your plan</a></p>')
  assert.equal(e.codigo, 'N8N_LIMITE_EXECUCOES')
  assert.equal(e.titulo, 'Limite de execuções do n8n atingido')
  assert.match(e.explicacao, /nenhum documento é lido/)
  assert.match(e.oQueFazer, /Settings → Usage/)
  assert.equal(e.bloqueiaAutomacao, true)
})

test('erros reais da IA viram títulos distintos', () => {
  assert.equal(descreverErro('The service is receiving too many requests from you — You exceeded your current quota, please check your plan').codigo, 'GEMINI_COTA')
  assert.equal(descreverErro('Service unavailable — This model is currently experiencing high demand').codigo, 'GEMINI_SOBRECARGA')
  assert.equal(descreverErro('Request too large for model `openai/gpt-oss-120b` on tokens per minute (TPM): Limit 8000').codigo, 'IA_LIMITE_POR_MINUTO')
  assert.equal(descreverErro('PDF sem texto legivel (provavelmente escaneado ou foto).').codigo, 'PDF_SEM_TEXTO')
})

test('erros das rotas do sistema', () => {
  const obra = descreverErro('Obra não identificada: não encontramos no sistema a obra do documento (XYZ-999)')
  assert.equal(obra.codigo, 'OBRA_NAO_IDENTIFICADA')
  assert.match(obra.explicacao, /XYZ-999/)
  assert.equal(descreverErro('A obra já tem um contrato vigente (SEED-CT-001)').codigo, 'OBRA_JA_TEM_CONTRATO')
  assert.equal(descreverErro('Já existe uma proposta com esse número').codigo, 'NUMERO_REPETIDO')
  assert.equal(descreverErro('Itens sem conserto: item 2: quantidade ausente ou zero').codigo, 'ITENS_ILEGIVEIS')
  assert.equal(descreverErro('400 - InvalidSignature').codigo, 'DOWNLOAD_PDF')
  assert.equal(descreverErro('Token de ingestão inválido').codigo, 'TOKEN_INVALIDO')
  assert.equal(descreverErro('a leitura automática não respondeu (The operation was aborted due to timeout)').codigo, 'SEM_RESPOSTA')
})

test('erro desconhecido: mantém o detalhe cru, truncado', () => {
  const e = descreverErro('x'.repeat(500))
  assert.equal(e.codigo, 'OUTRO')
  assert.ok(e.explicacao.length < 260 && e.explicacao.endsWith('…'))
  assert.match(descreverErro(null).explicacao, /sem mensagem/)
})

test('etapas: rótulo e encerramento', () => {
  assert.equal(rotuloEtapa('LEITURA_RESERVA'), 'Lendo o PDF pela reserva (Groq)')
  assert.equal(rotuloEtapa(null), 'Sem etapa registrada')
  assert.deepEqual(['NA_FILA', 'LEITURA', 'GRAVANDO', 'CONCLUIDO', 'REVISAO', 'ERRO'].map(etapaEncerrada), [false, false, false, true, true, true])
})

const ev = (horasAtras: number, etapa: string, nivel: string, mensagem = '', detalhe: string | null = null): EventoAutomacao => ({
  id: String(horasAtras), documento_id: null, etapa, nivel, mensagem, detalhe, origem: 'n8n',
  criado_em: new Date(Date.UTC(2026, 8, 28, 12) - horasAtras * 3600e3).toISOString(),
})
const AGORA = new Date(Date.UTC(2026, 8, 28, 12))

test('situação: limite do n8n recente e nada concluído depois → parada', () => {
  const s = situacaoDaAutomacao([ev(1, 'ERRO', 'erro', 'Falha no workflow', 'Execution limit reached'), ev(5, 'CONCLUIDO', 'info')], AGORA)
  assert.equal(s.parada, true)
  if (s.parada) assert.equal(s.erro.codigo, 'N8N_LIMITE_EXECUCOES')
})

test('situação: documento concluído depois do erro → voltou a andar', () => {
  assert.equal(situacaoDaAutomacao([ev(1, 'CONCLUIDO', 'info'), ev(3, 'ERRO', 'erro', '', 'Execution limit reached')], AGORA).parada, false)
})

test('situação: erro que não bloqueia (obra não identificada) não para a automação', () => {
  assert.equal(situacaoDaAutomacao([ev(1, 'ERRO', 'erro', '', 'Obra não identificada: x')], AGORA).parada, false)
})

test('situação: erro velho (fora da janela) não conta', () => {
  assert.equal(situacaoDaAutomacao([ev(72, 'ERRO', 'erro', '', 'Execution limit reached')], AGORA).parada, false)
})
