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
  // Importação da planilha (14.1/14.2): itens de proposta e de contrato da
  // planilha falsa levam a marca na descrição; a execução sai junto.
  { tabela: 'itens', coluna: 'descricao', padroes: ['VALIDA-IMP%'] },
  { tabela: 'contratos', coluna: 'numero' },
  // Contrato da importação (decisão 2 do 14.1): CT-<nº da proposta>.
  { tabela: 'contratos', coluna: 'numero', padroes: ['CT-VALIDA-IMP%'] },
  { tabela: 'propostas', coluna: 'numero' },
  { tabela: 'orcamentos', coluna: 'numero' },
  // Acordo: a marca vai na descrição; as parcelas saem em cascata.
  { tabela: 'acordos_pagamento', coluna: 'descricao' },
  // FD da planilha falsa da importação (14.2): a marca vai na observação.
  { tabela: 'fd', coluna: 'observacao' },
  { tabela: 'obras', coluna: 'codigo_obra' },
  // Importação da planilha (14.2): obra sem código entra como LEGADO-<nome>, e
  // o nome da planilha falsa é que leva a marca; o cliente dela também.
  { tabela: 'obras', coluna: 'nome', padroes: ['VALIDA-IMP%'] },
  { tabela: 'clientes', coluna: 'nome', padroes: ['VALIDA-IMP%'] },
  // Usuários de teste da gestão de usuários (13.1): apagados pelo Auth (o perfil sai em cascata).
  { tabela: 'profiles', coluna: 'email', padroes: ['valida-%@teste.com', 'run-%@teste.com'] },
]

async function sobrasDe({ tabela, coluna, padroes = PADROES }) {
  const filtro = padroes.map((p) => `${coluna}.like.${p}`).join(',')
  const { data, error } = await svc.from(tabela).select(`id, ${coluna}, created_at`).or(filtro)
  if (error) throw new Error(`${tabela}: ${error.message}`)
  return data.map((r) => ({ id: r.id, nome: r[coluna], criado: r.created_at }))
}

async function apagar(tabela, linha) {
  if (tabela === 'profiles') {
    // Usuário de teste que editou algo é autor de auditoria; a auditoria_imutavel
    // recusa o "on delete set null" do autor_id, então os eventos dele saem antes.
    await svc.from('auditoria_eventos').delete().eq('autor_id', linha.id)
    const { error } = await svc.auth.admin.deleteUser(linha.id)
    return error?.message ?? null
  }
  if (tabela === 'itens') {
    await svc.from('execucao').delete().eq('item_id', linha.id)
  }
  if (tabela === 'contratos') {
    await svc.from('documentos_processamento').update({ contrato_criado_id: null }).eq('contrato_criado_id', linha.id)
    const { data: itensDoContrato } = await svc.from('itens').select('id').eq('contrato_id', linha.id)
    const idsItens = (itensDoContrato ?? []).map((i) => i.id)
    if (idsItens.length > 0) await svc.from('execucao').delete().in('item_id', idsItens)
    await svc.from('itens').delete().eq('contrato_id', linha.id)
    // Aditivo ligado a ele: a FK solta sozinha (on delete set null), mas fica explícito.
    await svc.from('propostas').update({ contrato_aditivo_id: null }).eq('contrato_aditivo_id', linha.id)
  }
  if (tabela === 'propostas') {
    await svc.from('documentos_processamento').update({ proposta_criada_id: null }).eq('proposta_criada_id', linha.id)
    const { data: itensDaProposta } = await svc.from('itens').select('id').eq('proposta_id', linha.id)
    const idsItens = (itensDaProposta ?? []).map((i) => i.id)
    if (idsItens.length > 0) await svc.from('execucao').delete().in('item_id', idsItens)
    const { data: comFoto } = await svc.from('itens').select('foto_url').eq('proposta_id', linha.id).not('foto_url', 'is', null)
    await svc.from('itens').delete().eq('proposta_id', linha.id)
    const fotos = (comFoto ?? []).map((i) => i.foto_url).filter(Boolean)
    if (fotos.length > 0) await svc.storage.from('anexos').remove(fotos)
  }
  // Rodada interrompida no 7.2 deixa item de execução preso só à obra (sem contrato).
  if (tabela === 'obras') {
    const { data: itensDaObra } = await svc.from('itens').select('id').eq('obra_id', linha.id)
    const idsItens = (itensDaObra ?? []).map((i) => i.id)
    if (idsItens.length > 0) await svc.from('execucao').delete().in('item_id', idsItens)
    await svc.from('itens').delete().eq('obra_id', linha.id)
    // Rodada interrompida na ingestão deixa documento de teste preso à obra de teste.
    await svc.from('documentos_processamento').delete().eq('obra_id', linha.id)
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
