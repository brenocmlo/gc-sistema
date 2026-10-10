import test from 'node:test'
import assert from 'node:assert/strict'

import { descreverErro } from './automacao.ts'
import { alertaDeAutomacaoParada, avisoDeResolucao, chatIdValido, deveAlertar } from './telegram.ts'

test('chatIdValido aceita usuário e grupo, recusa o chat fictício dos testes', () => {
  assert.equal(chatIdValido('884349214'), true)
  assert.equal(chatIdValido('-5521155438'), true)
  assert.equal(chatIdValido('validacao'), false)
  assert.equal(chatIdValido(''), false)
  assert.equal(chatIdValido(null), false)
})

test('avisoDeResolucao fala de proposta e contrato no gênero certo', () => {
  assert.equal(avisoDeResolucao({ tipo: 'proposta', numero: 'PROP-1' }, { acao: 'aceito' }), 'Sua proposta PROP-1 foi conferida pela equipe e está confirmada no sistema.')
  assert.equal(avisoDeResolucao({ tipo: 'contrato', numero: 'CT-1' }, { acao: 'aceito' }), 'Seu contrato CT-1 foi conferido pela equipe e está confirmado no sistema.')
  assert.match(avisoDeResolucao({ tipo: 'proposta', numero: null }, { acao: 'recusado', motivo: 'itens trocados' }), /a proposta e o registro automático não foi aceito: itens trocados/)
  assert.equal(
    avisoDeResolucao({ tipo: 'contrato', numero: 'CT-9' }, { acao: 'vinculado', destino: 'contrato', numeroDestino: 'CT-2026-0042' }),
    'Seu documento CT-9 foi registrado pela equipe, ligado ao contrato CT-2026-0042.',
  )
  assert.match(avisoDeResolucao({ tipo: 'proposta', numero: 'X' }, { acao: 'descartado', motivo: 'PDF duplicado' }), /encerrado pela equipe sem registro no sistema: PDF duplicado\.$/)
})

test('alertaDeAutomacaoParada leva título, explicação e o que fazer', () => {
  const t = alertaDeAutomacaoParada(descreverErro('Execution limit reached'))
  assert.match(t, /^\[AUTOMAÇÃO PARADA\] Limite de execuções do n8n atingido/)
  assert.match(t, /O que fazer: /)
})

test('deveAlertar: um alerta por causa a cada 6 h', () => {
  const agora = new Date('2026-10-08T12:00:00Z')
  const ha2h = '2026-10-08T10:00:00Z'
  const ha7h = '2026-10-08T05:00:00Z'
  assert.equal(deveAlertar([], 'N8N_LIMITE_EXECUCOES', agora), true)
  assert.equal(deveAlertar([{ detalhe: 'N8N_LIMITE_EXECUCOES', criado_em: ha2h }], 'N8N_LIMITE_EXECUCOES', agora), false)
  assert.equal(deveAlertar([{ detalhe: 'N8N_LIMITE_EXECUCOES', criado_em: ha7h }], 'N8N_LIMITE_EXECUCOES', agora), true)
  // Outra causa avisa mesmo com alerta recente da primeira.
  assert.equal(deveAlertar([{ detalhe: 'N8N_LIMITE_EXECUCOES', criado_em: ha2h }], 'TOKEN_INVALIDO', agora), true)
})
