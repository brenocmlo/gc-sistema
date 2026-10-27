/**
 * Importação da planilha legada "Gestão Contratos.xlsx" (sprint 14, bloco 14.2).
 *
 *   node --env-file=.env.local scripts/importacao/importar-planilha.mjs <planilha.xlsx>            # simulação: só relata
 *   node --env-file=.env.local scripts/importacao/importar-planilha.mjs <planilha.xlsx> --gravar   # grava em gc-dev
 *   node --env-file=.env.local scripts/importacao/importar-planilha.mjs <planilha.xlsx> --desfazer # apaga o que esta planilha importou
 *
 * Opções: --mapa <json> (padrão: mapa-planilha.json ao lado), --ate AAAA-MM-DD
 * (data de corte; vence a do mapa), --autor <email> (padrão: VALIDACAO_EMAIL;
 * define a empresa e o created_by), --relatorio <json> (onde salvar o
 * relatório; padrão: importacao-<data>.json no diretório temporário).
 *
 * Sem --gravar, nada toca no banco além da leitura do autor. Só roda em gc-dev
 * (scripts/comum/gc-dev-guard.mjs): o go-live (14.4) vai pedir a liberação de
 * gc-prod antes de trocar essa trava.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createClient } from '@supabase/supabase-js'

import { exigirGcDev } from '../comum/gc-dev-guard.mjs'

import { desfazerRegistros, gravarRegistros } from './gravar.mjs'
import { lerPlanilha } from './ler-planilha.mjs'
import { montarRegistros, totaisDosRegistros } from './montar-registros.mjs'

const args = process.argv.slice(2)
const opcao = (nome) => { const i = args.indexOf(nome); return i >= 0 ? args[i + 1] : undefined }
const arquivo = args.find((a, i) => !a.startsWith('--') && !['--mapa', '--ate', '--autor', '--relatorio'].includes(args[i - 1]))
const GRAVAR = args.includes('--gravar')
const DESFAZER = args.includes('--desfazer')

if (!arquivo) {
  console.error('Uso: node --env-file=.env.local scripts/importacao/importar-planilha.mjs <planilha.xlsx> [--gravar | --desfazer] [--ate AAAA-MM-DD] [--mapa arquivo.json] [--autor email]')
  process.exit(2)
}
if (GRAVAR && DESFAZER) {
  console.error('FALHA: --gravar e --desfazer juntos não fazem sentido.')
  process.exit(2)
}

const URL_SUPABASE = process.env.NEXT_PUBLIC_SUPABASE_URL
exigirGcDev(URL_SUPABASE, 'a importação da planilha')
const svc = createClient(URL_SUPABASE, process.env.SUPABASE_SERVICE_ROLE_KEY ?? '', { auth: { persistSession: false } })

const mapa = JSON.parse(readFileSync(opcao('--mapa') ?? new URL('./mapa-planilha.json', import.meta.url), 'utf8'))
const dataCorte = opcao('--ate') ?? mapa.data_corte ?? null
if (dataCorte && !/^\d{4}-\d{2}-\d{2}$/.test(dataCorte)) {
  console.error(`FALHA: data de corte "${dataCorte}" não está como AAAA-MM-DD.`)
  process.exit(2)
}

const emailAutor = opcao('--autor') ?? process.env.VALIDACAO_EMAIL
const { data: autor } = await svc.from('profiles').select('id, empresa_id, nome, perfil').eq('email', emailAutor).maybeSingle()
if (!autor) {
  console.error(`FALHA: autor ${emailAutor} não tem perfil em gc-dev.`)
  process.exit(1)
}

const { resultado: lido, abasDaPlanilha } = await lerPlanilha(arquivo, mapa)
const registros = montarRegistros(Object.fromEntries(Object.entries(lido).map(([k, v]) => [k, { linhas: v.linhas }])), mapa, { dataCorte })
const totais = totaisDosRegistros(registros)

const modo = GRAVAR ? 'GRAVAR' : DESFAZER ? 'DESFAZER' : 'SIMULAÇÃO (nada é gravado)'
console.log(`\n  Importação de ${arquivo}\n  modo: ${modo} · autor: ${autor.nome} (${autor.perfil}) · data de corte: ${dataCorte ?? 'nenhuma'}`)
console.log(`  abas da planilha: ${abasDaPlanilha.join(', ')}\n`)
for (const [entidade, l] of Object.entries(lido)) {
  console.log(`  ${entidade.padEnd(14)} ${l.problema ? `PROBLEMA: ${l.problema}` : `aba "${l.aba}", cabeçalho na linha ${l.cabecalho}, ${l.linhas.length} linha(s)`}`)
}
const contagem = {
  clientes: registros.clientes.length, obras: registros.obras.length, propostas: registros.propostas.length,
  itens: registros.itens.length, contratos: registros.contratos.length, itens_contrato: registros.itensContrato.length,
  aditivos: registros.contratos.reduce((a, c) => a + c.aditivos.length, 0), execucoes: registros.execucoes.length, notas: registros.notas.length,
  pagamentos: registros.pagamentos.length, fds: registros.fds.length,
}
console.log(`\n  prontos para gravar: ${Object.entries(contagem).map(([k, v]) => `${v} ${k}`).join(' · ')}`)
console.log(`  totais: NF emitida R$ ${totais.nf_emitida.toFixed(2)} · recebido R$ ${totais.recebido.toFixed(2)} · FD a descontar R$ ${totais.fd_a_descontar.toFixed(2)}`)
console.log(`  ${registros.ignoradas.length} linha(s) ignorada(s) · ${registros.avisos.length} aviso(s)`)
for (const x of registros.ignoradas.slice(0, 40)) console.log(`    IGNORADA ${x.ref}: ${x.motivo}`)
if (registros.ignoradas.length > 40) console.log(`    … e mais ${registros.ignoradas.length - 40} no relatório`)

let gravacao = null
const abasComProblema = Object.values(lido).filter((l) => l.problema)
if (GRAVAR) {
  if (abasComProblema.length > 0) {
    console.error('\n  FALHA: há aba com problema de leitura; ajuste o mapa antes de gravar (nada foi gravado).')
    process.exit(1)
  }
  gravacao = await gravarRegistros(svc, registros, { empresaId: autor.empresa_id, autorId: autor.id, dataCorte })
  console.log('\n  gravado:')
  for (const [k, v] of Object.entries(gravacao)) console.log(`    ${k.padEnd(13)} ${v.criados} criado(s), ${v.existentes} já existia(m)`)
  for (const x of gravacao.contratos?.pulados ?? []) console.log(`    AVISO ${x}`)
}
if (DESFAZER) {
  gravacao = await desfazerRegistros(svc, registros, { empresaId: autor.empresa_id })
  console.log(`\n  desfeito: ${Object.entries(gravacao).map(([k, v]) => `${v} ${k}`).join(' · ') || 'nada a apagar'}`)
}

const caminho = opcao('--relatorio') ?? join(tmpdir(), `importacao-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
writeFileSync(caminho, JSON.stringify({
  arquivo, modo, dataCorte, autor: emailAutor, abas: Object.fromEntries(Object.entries(lido).map(([k, v]) => [k, { aba: v.aba, problema: v.problema, linhas: v.linhas.length, colunas: v.colunas }])),
  contagem, totais, ignoradas: registros.ignoradas, avisos: registros.avisos, gravacao,
}, null, 2))
console.log(`\n  relatório completo: ${caminho}`)
process.exit(abasComProblema.length > 0 && !DESFAZER ? 1 : 0)
