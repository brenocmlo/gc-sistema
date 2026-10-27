/**
 * Conciliação da importação da planilha legada (sprint 14, bloco 14.3).
 *
 *   node --env-file=.env.local scripts/importacao/conciliar.mjs <planilha.xlsx>
 *
 * Lê a planilha como a importação lê (lerPlanilha + montarRegistros), consulta
 * gc-dev pela chave de serviço e compara três fontes por métrica, no total e
 * por obra: a planilha, o banco e a referência (os números que a equipe deu).
 * SÓ LÊ o banco: não grava nada. Código de saída 1 se alguma coisa não bater.
 *
 * O que confere:
 *   - contagens: obras, propostas, itens, NFs, FDs (com referência), execuções,
 *     pagamentos, contratos e itens de contrato (sem referência; os contratos
 *     são os da decisão 2 do 14.1, um por obra com proposta aprovada);
 *   - valores: NF emitida, recebido e FD a descontar, no total e por obra;
 *   - status de cada NF: o calculado pelo trigger dos pagamentos × o texto da
 *     planilha;
 *   - valor de cada proposta × soma dos itens (o trigger do 5.6 faz o banco
 *     valer a soma; a diferença para a planilha é informativa);
 *   - a view receitas_obra (e obras_financeiro, para o FD) × a aba Resumo da
 *     planilha, por obra. Sem aba Resumo legível, a view é comparada com os
 *     registros montados, e a saída avisa.
 *
 * Opções: --mapa <json> (padrão: mapa-planilha.json ao lado), --ate AAAA-MM-DD,
 * --autor <email> (padrão: VALIDACAO_EMAIL; define a empresa),
 * --referencia <json> (vence a do mapa e a do card), --sem-referencia,
 * --relatorio <json> (padrão: conciliacao-<data>.json no diretório temporário).
 *
 * Formato do --referencia (ou da chave "referencia" do mapa):
 *   { "contagens": { "obras": 8, "propostas": 24, "itens": 120, "notas": 9, "fds": 248 },
 *     "valores": { "nf_emitida": 627959.83, "recebido": 489498.13, "fd_a_descontar": 2060290.51 },
 *     "por_obra": { "<código>": { "nf_emitida": 0, "recebido": 0, "fd_a_descontar": 0 } } }
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createClient } from '@supabase/supabase-js'

import {
  conciliar,
  conferirStatusNf,
  entradasPorObra,
  formatarValor,
  resumoDaConciliacao,
} from '../../src/lib/conciliacao.ts'
import { chaveDeComparacao, numeroDaPlanilha } from '../../src/lib/importacao.ts'
import { exigirGcDev } from '../comum/gc-dev-guard.mjs'

import { lerPlanilha } from './ler-planilha.mjs'
import { montarRegistros, totaisDosRegistros } from './montar-registros.mjs'

/**
 * Os números do card 14.3 (ClickUp 86e31aq3x). São a referência padrão, mas a
 * equipe ainda precisa confirmar de onde saíram (data de corte, se a NF
 * emitida inclui cancelada, se o FD é o valor a descontar ou o bruto).
 */
const REFERENCIA_DO_CARD = {
  fonte: 'card 14.3 (a confirmar com a equipe)',
  contagens: { obras: 8, propostas: 24, itens: 120, notas: 9, fds: 248 },
  valores: { nf_emitida: 627959.83, recebido: 489498.13, fd_a_descontar: 2060290.51 },
  por_obra: {},
}

/** Aba Resumo: PROVISÓRIO como o resto do mapa; "resumo" no mapa vence este. */
const RESUMO_PADRAO = {
  nomes: ['Resumo', 'Resumo Geral', 'Resumo por Obra'],
  campos: {
    obra: { colunas: ['Obra', 'Código', 'Cód. Obra', 'Código da Obra'], obrigatorio: true },
    nf_emitida: ['NF Emitida', 'NFs Emitidas', 'Total NF', 'Faturado', 'Total Faturado'],
    recebido: ['Recebido', 'Total Recebido', 'Valor Recebido'],
    fd_a_descontar: ['FD a Descontar', 'A Descontar', 'Total FD', 'FD'],
    saldo: ['Saldo', 'Saldo Pendente', 'A Receber'],
  },
}

const args = process.argv.slice(2)
const COM_VALOR = ['--mapa', '--ate', '--autor', '--referencia', '--relatorio']
const opcao = (nome) => { const i = args.indexOf(nome); return i >= 0 ? args[i + 1] : undefined }
const arquivo = args.find((a, i) => !a.startsWith('--') && !COM_VALOR.includes(args[i - 1]))
if (!arquivo) {
  console.error('Uso: node --env-file=.env.local scripts/importacao/conciliar.mjs <planilha.xlsx> [--referencia ref.json | --sem-referencia] [--ate AAAA-MM-DD] [--mapa arquivo.json] [--autor email] [--relatorio saida.json]')
  process.exit(2)
}

const URL_SUPABASE = process.env.NEXT_PUBLIC_SUPABASE_URL
exigirGcDev(URL_SUPABASE, 'a conciliação da importação')
const svc = createClient(URL_SUPABASE, process.env.SUPABASE_SERVICE_ROLE_KEY ?? '', { auth: { persistSession: false } })

const mapa = JSON.parse(readFileSync(opcao('--mapa') ?? new URL('./mapa-planilha.json', import.meta.url), 'utf8'))
const dataCorte = opcao('--ate') ?? mapa.data_corte ?? null
const referencia = args.includes('--sem-referencia')
  ? null
  : opcao('--referencia')
    ? { fonte: opcao('--referencia'), ...JSON.parse(readFileSync(opcao('--referencia'), 'utf8')) }
    : mapa.referencia
      ? { fonte: 'mapa-planilha.json', ...mapa.referencia }
      : REFERENCIA_DO_CARD

const emailAutor = opcao('--autor') ?? process.env.VALIDACAO_EMAIL
const { data: autor, error: eAutor } = await svc.from('profiles').select('id, empresa_id, nome').eq('email', emailAutor).maybeSingle()
if (!autor) {
  console.error(`FALHA: autor ${emailAutor} não tem perfil em gc-dev${eAutor ? ` (${eAutor.message})` : ''}.`)
  process.exit(1)
}
const empresaId = autor.empresa_id

// ---- planilha ------------------------------------------------------------
const { resultado: lido, abasDaPlanilha } = await lerPlanilha(arquivo, mapa)
const r = montarRegistros(Object.fromEntries(Object.entries(lido).map(([k, v]) => [k, { linhas: v.linhas }])), mapa, { dataCorte })
const totaisPlanilha = totaisDosRegistros(r)
const abasComProblema = Object.entries(lido).filter(([, l]) => l.problema).map(([k, l]) => `${k}: ${l.problema}`)

const soma = (xs, f) => Math.round(xs.reduce((a, x) => a + (Number(f(x)) || 0), 0) * 100) / 100
const agrupar = (xs, chave, valor) => {
  const m = {}
  for (const x of xs) { const k = chave(x); if (k != null) m[k] = Math.round(((m[k] ?? 0) + (Number(valor(x)) || 0)) * 100) / 100 }
  return m
}
const chaveNf = (numero, serie) => `${numero}|${serie ?? ''}`
const notaPorChave = new Map(r.notas.map((n) => [chaveNf(n.numero, n.serie), n]))
const planilhaPorObra = {
  nf_emitida: agrupar(r.notas.filter((n) => !n.cancelada), (n) => n.obra, (n) => n.valor_total),
  recebido: agrupar(r.pagamentos, (p) => notaPorChave.get(p.nota)?.obra, (p) => p.valor),
  fd_a_descontar: agrupar(r.fds, (f) => f.obra, (f) => f.valor_descontar),
}
// Obra sem NF/pagamento/FD na planilha vale 0 (não "faltando").
for (const o of r.obras) for (const m of Object.values(planilhaPorObra)) m[o.codigo_obra] ??= 0

// Aba Resumo, com o mesmo leitor.
const configResumo = mapa.resumo ?? RESUMO_PADRAO
const { resultado: lidoResumo } = await lerPlanilha(arquivo, { abas: { resumo: configResumo } })
const resumoLido = lidoResumo.resumo
const codigoDaObra = (v) => {
  const k = chaveDeComparacao(v)
  return r.obras.find((o) => chaveDeComparacao(o.codigo_obra) === k || chaveDeComparacao(o.nome) === k)?.codigo_obra ?? null
}
const resumoPorObra = { nf_emitida: {}, recebido: {}, fd_a_descontar: {}, saldo: {} }
const resumoSemObra = []
if (!resumoLido.problema) {
  for (const l of resumoLido.linhas) {
    if (/^total/.test(chaveDeComparacao(l.obra))) continue
    const codigo = codigoDaObra(l.obra)
    if (!codigo) { resumoSemObra.push(`${l.__ref}: obra "${l.obra}" não está na aba de obras`); continue }
    for (const m of Object.keys(resumoPorObra)) if (l[m] != null) resumoPorObra[m][codigo] = numeroDaPlanilha(l[m])
  }
}

// ---- banco (só leitura) ---------------------------------------------------
const LOTE = 200
async function emLotes(lista, fn) {
  const saida = []
  for (let i = 0; i < lista.length; i += LOTE) saida.push(...(await fn(lista.slice(i, i + LOTE))))
  return saida
}
async function consultar(rotulo, ids, montar) {
  if (ids.length === 0) return []
  return emLotes(ids, async (lote) => {
    const { data, error } = await montar(lote)
    if (error) throw new Error(`${rotulo}: ${error.message}`)
    return data
  })
}

const obrasBanco = await consultar('obras', r.obras.map((o) => o.codigo_obra), (l) => svc.from('obras').select('id, codigo_obra, nome').eq('empresa_id', empresaId).in('codigo_obra', l))
const idsObra = obrasBanco.map((o) => o.id)
const codigoPorId = new Map(obrasBanco.map((o) => [o.id, o.codigo_obra]))
const propostasBanco = await consultar('propostas', r.propostas.map((p) => p.numero), (l) => svc.from('propostas').select('id, numero, obra_id, valor_total, status').eq('empresa_id', empresaId).in('numero', l))
const itensBanco = await consultar('itens', propostasBanco.map((p) => p.id), (l) => svc.from('itens').select('id, proposta_id, numero, valor_total').in('proposta_id', l))
// Decisão 2 do 14.1: contratos gerados das aprovadas, e a execução nos itens deles.
const contratosR = r.contratos ?? []
const contratosBanco = await consultar('contratos', contratosR.map((c) => c.numero), (l) => svc.from('contratos').select('id, numero, obra_id').eq('empresa_id', empresaId).in('numero', l))
const itensContratoBanco = await consultar('itens do contrato', contratosBanco.map((c) => c.id), (l) => svc.from('itens').select('id, contrato_id, numero').in('contrato_id', l))
const execBanco = await consultar('execução', [...itensBanco, ...itensContratoBanco].map((i) => i.id), (l) => svc.from('execucao').select('id').in('item_id', l))
const notasBanco = (await consultar('notas fiscais', [...new Set(r.notas.map((n) => n.numero))], (l) => svc.from('notas_fiscais').select('id, numero, serie, obra_id, valor_total, status').eq('empresa_id', empresaId).in('numero', l)))
  .filter((n) => notaPorChave.has(chaveNf(n.numero, n.serie)))
const pagamentosBanco = await consultar('pagamentos', idsObra, (l) => svc.from('pagamentos').select('id, obra_id, valor').in('obra_id', l))
const fdsBanco = await consultar('fd', idsObra, (l) => svc.from('fd').select('id, obra_id, valor_descontar').in('obra_id', l))
const receitas = await consultar('receitas_obra', idsObra, (l) => svc.from('receitas_obra').select('obra_id, codigo_obra, total_nfs_emitidas, total_recebido, saldo_pendente').in('obra_id', l))
const financeiro = await consultar('obras_financeiro', idsObra, (l) => svc.from('obras_financeiro').select('obra_id, total_fd_aceito').in('obra_id', l))

const nadaNoBanco = (xs) => (xs.length === 0 ? null : xs.length)
const bancoPorObra = {
  nf_emitida: agrupar(notasBanco.filter((n) => n.status !== 'cancelada'), (n) => codigoPorId.get(n.obra_id), (n) => n.valor_total),
  recebido: agrupar(pagamentosBanco, (p) => codigoPorId.get(p.obra_id), (p) => p.valor),
  fd_a_descontar: agrupar(fdsBanco, (f) => codigoPorId.get(f.obra_id), (f) => f.valor_descontar),
}
for (const o of obrasBanco) for (const m of Object.values(bancoPorObra)) m[o.codigo_obra] ??= 0

// ---- comparação -------------------------------------------------------------
const ref = referencia ?? { contagens: {}, valores: {}, por_obra: {} }
const refPorObra = (m) => Object.fromEntries(Object.entries(ref.por_obra ?? {}).map(([obra, v]) => [obra, v?.[m]]))
const ROTULO = { nf_emitida: 'NF emitida', recebido: 'recebido', fd_a_descontar: 'FD a descontar' }

const entradas = [
  { metrica: 'obras', obra: null, tipo: 'contagem', planilha: r.obras.length, banco: nadaNoBanco(obrasBanco), esperado: ref.contagens?.obras },
  { metrica: 'propostas', obra: null, tipo: 'contagem', planilha: r.propostas.length, banco: nadaNoBanco(propostasBanco), esperado: ref.contagens?.propostas },
  { metrica: 'itens', obra: null, tipo: 'contagem', planilha: r.itens.length, banco: nadaNoBanco(itensBanco), esperado: ref.contagens?.itens },
  { metrica: 'contratos', obra: null, tipo: 'contagem', planilha: contratosR.length, banco: obrasBanco.length ? contratosBanco.length : null },
  { metrica: 'itens de contrato', obra: null, tipo: 'contagem', planilha: (r.itensContrato ?? []).length, banco: obrasBanco.length ? itensContratoBanco.length : null },
  { metrica: 'execuções', obra: null, tipo: 'contagem', planilha: r.execucoes.length, banco: nadaNoBanco(execBanco) },
  { metrica: 'NFs', obra: null, tipo: 'contagem', planilha: r.notas.length, banco: nadaNoBanco(notasBanco), esperado: ref.contagens?.notas },
  { metrica: 'pagamentos', obra: null, tipo: 'contagem', planilha: r.pagamentos.length, banco: nadaNoBanco(pagamentosBanco) },
  { metrica: 'FDs', obra: null, tipo: 'contagem', planilha: r.fds.length, banco: nadaNoBanco(fdsBanco), esperado: ref.contagens?.fds },
]
for (const m of Object.keys(ROTULO)) {
  entradas.push({ metrica: ROTULO[m], obra: null, tipo: 'moeda', planilha: totaisPlanilha[m], banco: obrasBanco.length ? soma(Object.values(bancoPorObra[m]), (x) => x) : null, esperado: ref.valores?.[m] })
}
for (const m of Object.keys(ROTULO)) {
  entradas.push(...entradasPorObra(ROTULO[m], 'moeda', { planilha: planilhaPorObra[m], banco: bancoPorObra[m], esperado: refPorObra(m) }))
}

// Propostas: valor × soma dos itens.
const itensPorProposta = agrupar(itensBanco, (i) => i.proposta_id, (i) => i.valor_total)
const propostaBanco = new Map(propostasBanco.map((p) => [p.numero, p]))
for (const p of r.propostas) {
  const b = propostaBanco.get(p.numero)
  const somaItensPlanilha = soma(r.itens.filter((i) => i.proposta === p.numero), (i) => i.quantidade * i.valor_unit)
  // Informativa: o trigger do 5.6 faz o banco valer a soma dos itens (14.2, seção 6).
  entradas.push({ metrica: `proposta ${p.numero}: valor`, obra: p.obra, tipo: 'moeda', planilha: p.valor_total, banco: b?.valor_total, informativa: true })
  // Informativa: a planilha soma quantidade × valor unitário; o banco, o valor_total de cada item.
  entradas.push({ metrica: `proposta ${p.numero}: soma dos itens`, obra: p.obra, tipo: 'moeda', planilha: somaItensPlanilha, banco: b ? (itensPorProposta[b.id] ?? 0) : null, informativa: true })
  // Bloqueante: no banco, o valor da proposta tem de ser a soma dos itens.
  if (b && itensPorProposta[b.id] != null) entradas.push({ metrica: `proposta ${p.numero}: valor no banco = soma dos itens no banco`, obra: p.obra, tipo: 'moeda', planilha: b.valor_total, banco: itensPorProposta[b.id] ?? 0 })
}

// View receitas_obra (e obras_financeiro para o FD) × aba Resumo.
const temResumo = !resumoLido.problema && resumoLido.linhas.length > 0
const fonteResumo = temResumo ? resumoPorObra : planilhaPorObra
const viewPorObra = {
  nf_emitida: Object.fromEntries(receitas.map((v) => [v.codigo_obra, v.total_nfs_emitidas])),
  recebido: Object.fromEntries(receitas.map((v) => [v.codigo_obra, v.total_recebido])),
  saldo: Object.fromEntries(receitas.map((v) => [v.codigo_obra, v.saldo_pendente])),
  fd_a_descontar: Object.fromEntries(financeiro.map((v) => [codigoPorId.get(v.obra_id), v.total_fd_aceito])),
}
const VIEW = { nf_emitida: 'receitas_obra.total_nfs_emitidas', recebido: 'receitas_obra.total_recebido', fd_a_descontar: 'obras_financeiro.total_fd_aceito', saldo: 'receitas_obra.saldo_pendente' }
for (const m of Object.keys(VIEW)) {
  if (m === 'saldo' && !(temResumo && Object.keys(resumoPorObra.saldo).length)) continue
  const planilha = { ...fonteResumo[m] }
  for (const o of r.obras) planilha[o.codigo_obra] ??= temResumo ? undefined : 0
  entradas.push(...entradasPorObra(`${VIEW[m]} × ${temResumo ? 'Resumo' : 'registros'}`, 'moeda', { planilha, banco: viewPorObra[m] }))
}

const linhas = conciliar(entradas)
const resumo = resumoDaConciliacao(linhas)

// Status das NFs.
const notaBanco = new Map(notasBanco.map((n) => [chaveNf(n.numero, n.serie), n]))
const statusNf = r.notas.map((n) => {
  const b = notaBanco.get(chaveNf(n.numero, n.serie))
  return { nf: n.numero, serie: n.serie, obra: n.obra, planilha: n.status_planilha, banco: b?.status ?? null, ...conferirStatusNf(n.status_planilha, b?.status) }
})
const statusDivergentes = statusNf.filter((s) => !s.ok)

// ---- saída -------------------------------------------------------------------
const f = (v, tipo) => formatarValor(v, tipo)
const linhaTexto = (l) => {
  const marca = l.ok ? 'ok      ' : l.informativa ? 'aviso   ' : 'DIVERGE '
  const ref = l.referencia != null ? ` · ref ${f(l.referencia, l.tipo)}` : ''
  return `  ${marca}${(l.obra ? `[${l.obra}] ` : '') + l.metrica}: planilha ${f(l.planilha, l.tipo)} · banco ${f(l.banco, l.tipo)}${ref}${l.ok ? '' : `\n            ${l.motivo}`}`
}

console.log(`\n  Conciliação de ${arquivo}\n  empresa do autor ${autor.nome} · data de corte: ${dataCorte ?? 'nenhuma'} · referência: ${referencia ? referencia.fonte : 'nenhuma (--sem-referencia)'}`)
console.log(`  abas da planilha: ${abasDaPlanilha.join(', ')}`)
for (const p of abasComProblema) console.log(`  PROBLEMA ${p}`)
console.log(`  ${r.ignoradas.length} linha(s) ignorada(s) pela montagem (não entram no banco; ver importar-planilha.mjs)`)
if (!temResumo) console.log(`  AVISO aba Resumo não lida (${resumoLido.problema ?? 'sem linhas'}): a view é comparada com os registros montados, não com o Resumo`)
for (const x of resumoSemObra) console.log(`  AVISO Resumo ${x}`)

const grupos = [
  ['Contagens', (l) => l.obra === null && l.tipo === 'contagem'],
  ['Totais', (l) => l.obra === null && l.tipo === 'moeda'],
  ['Por obra', (l) => l.obra !== null && Object.values(ROTULO).includes(l.metrica)],
  ['Propostas', (l) => l.metrica.startsWith('proposta ')],
  ['Views × Resumo', (l) => l.metrica.includes('×')],
]
for (const [titulo, filtro] of grupos) {
  const g = linhas.filter(filtro)
  if (g.length === 0) continue
  console.log(`\n  ${titulo} (${g.filter((l) => l.ok).length}/${g.length} ok)`)
  for (const l of g) console.log(linhaTexto(l))
}
console.log(`\n  Status das NFs (${statusNf.length - statusDivergentes.length}/${statusNf.length} ok)`)
for (const s of statusNf) console.log(`  ${s.ok ? 'ok      ' : 'DIVERGE '}NF ${s.nf}${s.serie ? `/${s.serie}` : ''}: planilha ${s.planilha ?? '—'} · banco ${s.banco ?? '—'}${s.ok ? '' : `\n            ${s.motivo}`}`)

// Sugestão para a conferência visual: as três obras de maior NF emitida no banco.
const paraConferir = obrasBanco
  .map((o) => ({ ...o, nf: bancoPorObra.nf_emitida[o.codigo_obra] ?? 0 }))
  .sort((a, b) => b.nf - a.nf)
  .slice(0, 3)
if (paraConferir.length) {
  console.log('\n  Conferência visual sugerida (maior NF emitida): abrir /obras/<id>, aba Financeiro')
  for (const o of paraConferir) console.log(`    ${o.codigo_obra} ${o.nome}: /obras/${o.id}`)
}

const bateu = resumo.bateu && statusDivergentes.length === 0 && abasComProblema.length === 0
console.log(`\n  ${bateu ? 'BATEU' : 'NÃO BATEU'}: ${resumo.ok}/${resumo.linhas} linhas ok · ${resumo.divergentes} divergente(s) · ${resumo.informativas_divergentes} aviso(s) · status de NF ${statusNf.length - statusDivergentes.length}/${statusNf.length}`)

const caminho = opcao('--relatorio') ?? join(tmpdir(), `conciliacao-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
writeFileSync(caminho, JSON.stringify({
  arquivo, dataCorte, autor: emailAutor, referencia, bateu, resumo, abasComProblema,
  resumoDaPlanilha: { lido: temResumo, problema: resumoLido.problema ?? null, semObra: resumoSemObra },
  ignoradas: r.ignoradas.length, linhas, statusNf,
  conferenciaVisual: paraConferir.map((o) => ({ codigo_obra: o.codigo_obra, nome: o.nome, rota: `/obras/${o.id}` })),
}, null, 2))
console.log(`  relatório completo: ${caminho}`)
process.exit(bateu ? 0 : 1)
