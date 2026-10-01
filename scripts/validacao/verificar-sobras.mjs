/**
 * Sobras de rodadas interrompidas do plano de validação, em gc-dev.
 *
 * Cada camada limpa o que cria no `finally`, mas uma rodada morta no meio
 * (Ctrl-C, máquina dormindo, `fetch failed`) não chega lá. A sobra não quebra
 * a camada que a deixou: quebra outra, depois, com mensagem enganosa — em
 * 2026-09-29 um contrato `VALIDA-ESCRITA-*` ocupou a única obra sem contrato e
 * o runtime falhou com "falta dado".
 *
 * Os roteiros nomeiam o que criam com `VALIDA-*` (escrita, runtime) e
 * `RUN-<hhmmss>` (navegador); seed usa `SEED-*` e dado real não usa nenhum dos
 * dois (em pagamentos, que não têm número, a marca vai na observação). O
 * validar.sh roda isto antes das camadas que usam o banco e para se
 * achar alguma coisa.
 *
 * Uso:
 *   node --env-file=.env.local scripts/validacao/verificar-sobras.mjs           # lista; sai 1 se houver
 *   node --env-file=.env.local scripts/validacao/verificar-sobras.mjs --apagar  # apaga e confere
 *
 * Precisa da chave de serviço: o que sobrou pode ser de qualquer perfil.
 */
import { createClient } from '@supabase/supabase-js'

import { exigirGcDev } from '../comum/gc-dev-guard.mjs'
import { limparAuditoriaDoRoteiro } from '../comum/auditoria-limpeza.mjs'

const URL_SUPABASE = process.env.NEXT_PUBLIC_SUPABASE_URL
exigirGcDev(URL_SUPABASE, 'a verificação de sobras')
const svc = createClient(URL_SUPABASE, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

const APAGAR = process.argv.includes('--apagar')
const PADROES = ['VALIDA-%', 'RUN-%']

// Ordem de exclusão: quem aponta vem antes de quem é apontado.
const TABELAS = [
  // Pagamento não tem número: o roteiro marca a observação (`${NUMERO}-PG`).
  { tabela: 'pagamentos', coluna: 'observacao' },
  { tabela: 'notas_fiscais', coluna: 'numero' },
  { tabela: 'contratos', coluna: 'numero' },
  { tabela: 'propostas', coluna: 'numero' },
  { tabela: 'orcamentos', coluna: 'numero' },
  { tabela: 'obras', coluna: 'codigo_obra' },
]

async function sobrasDe({ tabela, coluna }) {
  const filtro = PADROES.map((p) => `${coluna}.like.${p}`).join(',')
  const { data, error } = await svc.from(tabela).select(`id, ${coluna}, created_at`).or(filtro)
  if (error) throw new Error(`${tabela}: ${error.message}`)
  return data.map((r) => ({ id: r.id, nome: r[coluna], criado: r.created_at }))
}

async function apagar(tabela, linha) {
  if (tabela === 'contratos') {
    await svc.from('documentos_processamento').update({ contrato_criado_id: null }).eq('contrato_criado_id', linha.id)
    await svc.from('itens').delete().eq('contrato_id', linha.id)
  }
  if (tabela === 'propostas') {
    await svc.from('documentos_processamento').update({ proposta_criada_id: null }).eq('proposta_criada_id', linha.id)
    const { data: comFoto } = await svc.from('itens').select('foto_url').eq('proposta_id', linha.id).not('foto_url', 'is', null)
    await svc.from('itens').delete().eq('proposta_id', linha.id)
    const fotos = (comFoto ?? []).map((i) => i.foto_url).filter(Boolean)
    if (fotos.length > 0) await svc.storage.from('anexos').remove(fotos)
  }
  const { error } = await svc.from(tabela).delete().eq('id', linha.id)
  return error?.message ?? null
}

const achadas = []
for (const t of TABELAS) {
  for (const linha of await sobrasDe(t)) achadas.push({ tabela: t.tabela, ...linha })
}

if (achadas.length === 0) {
  console.log('  sem sobras de rodadas anteriores em gc-dev')
  process.exit(0)
}

console.log(`  ${achadas.length} sobra(s) de rodada interrompida em gc-dev:`)
for (const s of achadas) console.log(`    ${s.tabela.padEnd(14)} ${s.nome}  (${s.criado.slice(0, 16)})`)

if (!APAGAR) {
  console.log('  Elas escondem dado de que outras camadas dependem. Confira e apague com:')
  console.log('    node --env-file=.env.local scripts/validacao/verificar-sobras.mjs --apagar')
  process.exit(1)
}

let falhas = 0
for (const s of achadas) {
  const erro = await apagar(s.tabela, s)
  if (erro) {
    falhas += 1
    console.log(`    FALHA ao apagar ${s.tabela} ${s.nome}: ${erro}`)
  }
}
const desde = achadas.map((s) => s.criado).sort()[0]
const aud = await limparAuditoriaDoRoteiro(svc, new Date(new Date(desde).getTime() - 60_000).toISOString())
console.log(`  apagadas ${achadas.length - falhas}/${achadas.length}; ${aud.apagados} evento(s) de auditoria delas`)

let restam = 0
for (const t of TABELAS) restam += (await sobrasDe(t)).length
console.log(`  restam: ${restam}`)
process.exit(falhas === 0 && restam === 0 ? 0 : 1)
