/**
 * Seed idempotente de propostas em gc-dev, para exercitar caminhos que o banco
 * de dev não cobre. Hoje: uma proposta ENVIADA e VENCIDA — sem ela o filtro
 * `?vencidas=1` roda mas volta zero linha, e a validação fica sem caminho
 * positivo (pendência 2 do bloco 4.3).
 *
 *   node --env-file=.env.local scripts/seed-propostas-dev.mjs
 *
 * Autentica como usuário real, então passa pela RLS igual à aplicação — o que
 * também exercita a policy "Propostas: comercial insere", que nenhuma outra
 * camada de validação toca (escrita é a parte manual do plano).
 *
 * Idempotente pelo `numero` (unique por empresa): rodar de novo atualiza a
 * mesma linha em vez de criar outra. `exigirGcDev` impede que rode em gc-prod.
 */
import { createClient } from '@supabase/supabase-js'

import { exigirGcDev } from './gc-dev-guard.mjs'

const URL_SUPABASE = process.env.NEXT_PUBLIC_SUPABASE_URL
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const EMAIL = process.env.VALIDACAO_EMAIL
const SENHA = process.env.VALIDACAO_SENHA

if (!URL_SUPABASE || !ANON || !EMAIL || !SENHA) {
  console.error(
    'FALHA: precisa de NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,\n' +
      '  VALIDACAO_EMAIL e VALIDACAO_SENHA em .env.local.',
  )
  process.exit(1)
}

exigirGcDev(URL_SUPABASE, 'semear dados')

const NUMERO_SEED = 'SEED-VENCIDA-001'

function diasAtras(n) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString().slice(0, 10)
}

const supabase = createClient(URL_SUPABASE, ANON)

const login = await supabase.auth.signInWithPassword({
  email: EMAIL,
  password: SENHA,
})
if (login.error) {
  console.error(`FALHA no login de ${EMAIL}: ${login.error.message}`)
  process.exit(1)
}

const { data: perfil } = await supabase
  .from('profiles')
  .select('empresa_id, perfil')
  .eq('id', login.data.user.id)
  .maybeSingle()

if (!perfil?.empresa_id) {
  console.error('FALHA: perfil sem empresa_id.')
  process.exit(1)
}

// Precisa de uma obra da mesma empresa: propostas_obra_fk é composta
// (obra_id, empresa_id).
const { data: obra } = await supabase
  .from('obras')
  .select('id, codigo_obra, nome')
  .eq('empresa_id', perfil.empresa_id)
  .order('codigo_obra', { ascending: false })
  .limit(1)
  .maybeSingle()

if (!obra) {
  console.error('FALHA: nenhuma obra em gc-dev — crie uma antes de semear.')
  process.exit(1)
}

const linha = {
  empresa_id: perfil.empresa_id,
  obra_id: obra.id,
  numero: NUMERO_SEED,
  descricao: 'Proposta de seed: enviada e com validade expirada.',
  data_emissao: diasAtras(60),
  data_validade: diasAtras(15),
  data_envio: diasAtras(59),
  status: 'enviada',
  valor_total: 50000,
  desconto: 5000,
  pct_sinal: 0.3,
  pct_fd: 0.2,
  pct_entrega_material: 0.25,
  pct_medicao_instalacao: 0.25,
  condicoes_pagamento: 'Gerada por scripts/seed-propostas-dev.mjs',
  created_by: login.data.user.id,
}

const { data: existente } = await supabase
  .from('propostas')
  .select('id')
  .eq('numero', NUMERO_SEED)
  .eq('empresa_id', perfil.empresa_id)
  .maybeSingle()

const resultado = existente
  ? await supabase
      .from('propostas')
      .update(linha)
      .eq('id', existente.id)
      .select('id, numero, status, data_validade')
      .single()
  : await supabase
      .from('propostas')
      .insert(linha)
      .select('id, numero, status, data_validade')
      .single()

if (resultado.error) {
  console.error(`FALHA ao gravar: ${resultado.error.message}`)
  process.exit(1)
}

console.log(
  `${existente ? 'Atualizada' : 'Criada'} ${resultado.data.numero} ` +
    `(${resultado.data.status}, validade ${resultado.data.data_validade}) ` +
    `na obra ${obra.codigo_obra} — ${obra.nome}`,
)
