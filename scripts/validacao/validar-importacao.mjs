/**
 * Ensaio do importador da planilha legada (sprint 14, bloco 14.2), chamado
 * pela camada escrita. Gera a planilha falsa (scripts/importacao/planilha-falsa.mjs),
 * lê, monta, grava em gc-dev, grava de novo (não pode duplicar), confere o que
 * os triggers fizeram, roda a conciliação (14.3) sobre o que gravou e desfaz.
 * Não substitui a conciliação com a planilha real: prova o mecanismo, não o mapa.
 *
 * Decisões do 14.1 exercitadas: um contrato por obra com proposta aprovada
 * (CT-VALIDA-IMP-P1, com a P4 de aditivo; CT-VALIDA-IMP-P2 concluido, da obra
 * concluída), a execução nos itens do contrato, o status da obra e o aviso de
 * NF de medição sem medição.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createClient } from '@supabase/supabase-js'

import { limparAuditoriaDoRoteiro } from '../comum/auditoria-limpeza.mjs'
import { exigirGcDev } from '../comum/gc-dev-guard.mjs'
import { desfazerRegistros, gravarRegistros } from '../importacao/gravar.mjs'
import { lerPlanilha } from '../importacao/ler-planilha.mjs'
import { montarRegistros, totaisDosRegistros } from '../importacao/montar-registros.mjs'

const URL_SUPABASE = process.env.NEXT_PUBLIC_SUPABASE_URL
exigirGcDev(URL_SUPABASE, 'o ensaio da importação')
const svc = createClient(URL_SUPABASE, process.env.SUPABASE_SERVICE_ROLE_KEY ?? '', { auth: { persistSession: false } })
const INICIO = new Date(Date.now() - 60_000).toISOString()

let passos = 0
let falhas = 0
function checar(descricao, condicao, detalhe = '') {
  passos += 1
  if (condicao) console.log(`  ok    ${descricao}`)
  else {
    falhas += 1
    console.log(`  FALHA ${descricao}`)
    if (detalhe) console.log(`         ${String(detalhe).slice(0, 400)}`)
  }
}

const arquivo = join(tmpdir(), `planilha-falsa-${Date.now()}.xlsx`)
execFileSync(process.execPath, [new URL('../importacao/planilha-falsa.mjs', import.meta.url).pathname, arquivo], { stdio: 'ignore' })
const mapa = JSON.parse(readFileSync(new URL('../importacao/mapa-planilha.json', import.meta.url), 'utf8'))
mapa.clientes.equivalencias = { 'VALIDA-IMP Estação Fashion': ['VALIDA-IMP EF Empreendimentos Imobiliarios'] }

const { data: autor } = await svc.from('profiles').select('id, empresa_id').eq('email', process.env.VALIDACAO_EMAIL).single()
const { resultado } = await lerPlanilha(arquivo, mapa)
const r = montarRegistros(Object.fromEntries(Object.entries(resultado).map(([k, v]) => [k, { linhas: v.linhas }])), mapa)

checar('lê as 7 abas, com o cabeçalho abaixo do título', Object.values(resultado).every((a) => !a.problema && a.cabecalho === 3),
  JSON.stringify(Object.fromEntries(Object.entries(resultado).map(([k, v]) => [k, v.problema ?? v.cabecalho]))))
checar('decisão 1: as três grafias do cliente viram um cliente pela tabela de equivalências', r.clientes.length === 1, JSON.stringify(r.clientes))
checar('ignora exatamente as 4 linhas plantadas, cada uma com o motivo',
  r.ignoradas.length === 4 && ['unidade "litro"', 'instalada (9) maior', 'NF "VALIDA-IMP-NF9"', 'a descontar (500) maior'].every((m) => r.ignoradas.some((x) => x.motivo.includes(m))),
  JSON.stringify(r.ignoradas))
const t = totaisDosRegistros(r)
checar('totais da simulação: NF R$ 6.250, recebido R$ 4.000, FD a descontar R$ 4.500',
  t.nf_emitida === 6250 && t.recebido === 4000 && t.fd_a_descontar === 4500, JSON.stringify(t))
const resumoCt = r.contratos.map((c) => `${c.numero}:${c.obra}:${c.status}:${c.aditivos.join('+')}`).sort()
checar('decisão 2 na montagem: um contrato por obra com aprovada (P1 com aditivo P4; P2 concluido); Galpão sem contrato',
  JSON.stringify(resumoCt) === JSON.stringify(['CT-VALIDA-IMP-P1:VALIDA-IMP-01:ativo:VALIDA-IMP-P4', 'CT-VALIDA-IMP-P2:VALIDA-IMP-02:concluido:']) &&
    r.itensContrato.length === 3,
  JSON.stringify({ resumoCt, itensContrato: r.itensContrato.length }))
checar('decisão 3: avisa a obra com NF de medição e nada medido',
  r.avisos.some((a) => a.aviso.includes('obra VALIDA-IMP-02: NF de medição') && a.aviso.includes('nada medido')), JSON.stringify(r.avisos.filter((a) => a.aviso.includes('medição'))))

try {
  const g1 = await gravarRegistros(svc, r, { empresaId: autor.empresa_id, autorId: autor.id })
  const criados = Object.values(g1).reduce((a, x) => a + x.criados, 0)
  checar('a gravação cria os 28 registros (1 cliente, 3 obras, 4 propostas, 4 itens, 2 contratos, 3 itens de contrato, 1 aditivo, 4 execuções, 2 NFs, 2 pagamentos, 2 FDs)',
    criados === 28, JSON.stringify(g1))
  const g2 = await gravarRegistros(svc, r, { empresaId: autor.empresa_id, autorId: autor.id })
  checar('rodar de novo não duplica (0 criados, 28 já existiam)',
    Object.values(g2).every((x) => x.criados === 0) && Object.values(g2).reduce((a, x) => a + x.existentes, 0) === 28, JSON.stringify(g2))

  const { data: obrasB } = await svc.from('obras').select('id, codigo_obra, status').like('nome', 'VALIDA-IMP%')
  const stObra = Object.fromEntries((obrasB ?? []).map((o) => [o.codigo_obra, o.status]))
  checar('status da obra pela planilha: 01 ativa, 02 concluida, Galpão (vazio) ativa',
    stObra['VALIDA-IMP-01'] === 'ativa' && stObra['VALIDA-IMP-02'] === 'concluida' && stObra['LEGADO-VALIDAIMP-GALPAO'] === 'ativa', JSON.stringify(stObra))

  const { data: cts } = await svc.from('contratos')
    .select('id, numero, status, valor_total, desconto, data_assinatura, created_by, observacao, obra:obras!contratos_obra_fk(codigo_obra), origem:propostas!contratos_proposta_fk(numero), itens:itens!itens_contrato_fk(numero, proposta_id)')
    .in('obra_id', (obrasB ?? []).map((o) => o.id))
  const ct = Object.fromEntries((cts ?? []).map((c) => [c.obra?.codigo_obra, c]))
  const c1 = ct['VALIDA-IMP-01']
  const c2 = ct['VALIDA-IMP-02']
  checar('decisão 2 no banco: um contrato por obra com aprovada, da principal, sem assinatura, autor e marca; Galpão sem contrato',
    (cts ?? []).length === 2 && !ct['LEGADO-VALIDAIMP-GALPAO'] &&
      c1?.numero === 'CT-VALIDA-IMP-P1' && c1.origem?.numero === 'VALIDA-IMP-P1' && c1.status === 'ativo' &&
      c2?.numero === 'CT-VALIDA-IMP-P2' && c2.origem?.numero === 'VALIDA-IMP-P2' && c2.status === 'concluido' && Number(c2.desconto) === 500 &&
      cts.every((c) => c.data_assinatura === null && c.created_by === autor.id && c.observacao.includes('[importacao:contrato-') && c.observacao.includes('sem contrato assinado')),
    JSON.stringify(cts))
  checar('decisão 2: itens copiados para o contrato (2 e 1, sem proposta), valor do contrato = soma dos itens (R$ 10.000 e R$ 5.000)',
    c1?.itens.length === 2 && c2?.itens.length === 1 && [...c1.itens, ...c2.itens].every((i) => i.proposta_id === null) &&
      Number(c1.valor_total) === 10000 && Number(c2.valor_total) === 5000,
    JSON.stringify({ c1: c1 && { v: c1.valor_total, itens: c1.itens }, c2: c2 && { v: c2.valor_total, itens: c2.itens } }))

  const { data: props } = await svc.from('propostas').select('numero, contrato_aditivo_id').like('numero', 'VALIDA-IMP-P%')
  const adit = Object.fromEntries((props ?? []).map((x) => [x.numero, x.contrato_aditivo_id]))
  checar('decisão 2: a P4 (segunda aprovada da obra 01) é aditivo do CT-VALIDA-IMP-P1; as outras não são aditivo',
    c1 && adit['VALIDA-IMP-P4'] === c1.id && ['VALIDA-IMP-P1', 'VALIDA-IMP-P2', 'VALIDA-IMP-P3'].every((n) => adit[n] === null), JSON.stringify(adit))

  const { data: exCt } = await svc.from('execucao').select('id, item:itens!inner(numero, contrato_id, proposta_id)').in('item.contrato_id', (cts ?? []).map((c) => c.id))
  const { data: exProp } = await svc.from('execucao').select('id, item:itens!inner(numero, proposta:propostas!itens_proposta_fk!inner(numero))').like('item.proposta.numero', 'VALIDA-IMP-P%')
  checar('decisão 2: a execução da principal mora no item do contrato (3); no item de proposta só a do aditivo P4 (1)',
    (exCt ?? []).length === 3 && (exProp ?? []).length === 1 && exProp[0].item.proposta.numero === 'VALIDA-IMP-P4',
    JSON.stringify({ contrato: exCt?.length, proposta: exProp }))

  const { data: nfs } = await svc.from('notas_fiscais').select('numero, status').like('numero', 'VALIDA-IMP-%')
  const st = Object.fromEntries((nfs ?? []).map((n) => [n.numero, n.status]))
  checar('status de NF pelo trigger dos pagamentos: a "Paga" fica paga, a "Atrasada" fica emitida',
    st['VALIDA-IMP-NF1'] === 'paga' && st['VALIDA-IMP-NF2'] === 'emitida', JSON.stringify(st))
  const { data: ex } = await svc.from('execucao').select('sequencial, quantidade_total, fab_qtd, ent_qtd, inst_qtd, med_qtd, item:itens!inner(numero, contrato:contratos!itens_contrato_fk!inner(numero))').eq('item.contrato.numero', 'CT-VALIDA-IMP-P1').eq('item.numero', 1).order('sequencial')
  checar('decisão 3 no banco: o item do contrato com duas linhas tem as execuções 1 e 2, com fab = ent = inst e med = 0',
    (ex ?? []).length === 2 && ex[0].sequencial === 1 && ex[1].sequencial === 2 &&
      ex.every((e) => Number(e.fab_qtd) === Number(e.inst_qtd) && Number(e.ent_qtd) === Number(e.inst_qtd) && Number(e.med_qtd) === 0) &&
      Number(ex[0].inst_qtd) === 6 && Number(ex[1].inst_qtd) === 1,
    JSON.stringify(ex))

  // 14.3: a conciliação bate com o que acabou de ser gravado, contra a
  // referência da própria planilha falsa.
  const refFalsa = join(tmpdir(), `referencia-falsa-${Date.now()}.json`)
  writeFileSync(refFalsa, JSON.stringify({
    contagens: { obras: 3, propostas: 4, itens: 4, notas: 2, fds: 2 },
    valores: { nf_emitida: 6250, recebido: 4000, fd_a_descontar: 4500 },
  }))
  const mapaComEq = join(tmpdir(), `mapa-ensaio-${Date.now()}.json`)
  writeFileSync(mapaComEq, JSON.stringify(mapa))
  const conc = { status: 0, stdout: '' }
  try {
    conc.stdout = execFileSync(process.execPath,
      ['--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', new URL('../importacao/conciliar.mjs', import.meta.url).pathname, arquivo,
        '--mapa', mapaComEq, '--referencia', refFalsa, '--relatorio', join(tmpdir(), `conciliacao-ensaio-${Date.now()}.json`)],
      { env: process.env, encoding: 'utf8' })
  } catch (e) { conc.status = e.status; conc.stdout = String(e.stdout) }
  const linhaFinal = conc.stdout.split('\n').find((l) => /BATEU/.test(l)) ?? ''
  checar('14.3: a conciliação bate (saída 0, BATEU), com contratos e execução no item do contrato',
    conc.status === 0 && /^\s*BATEU/.test(linhaFinal) && /ok\s+contratos: planilha 2 · banco 2/.test(conc.stdout) && /ok\s+execuções: planilha 4 · banco 4/.test(conc.stdout),
    `${linhaFinal.trim()} | ${conc.stdout.split('\n').filter((l) => l.includes('DIVERGE') || l.includes('PROBLEMA')).join(' | ')}`)
} catch (e) {
  checar('gravação', false, e.message)
} finally {
  const d = await desfazerRegistros(svc, r, { empresaId: autor.empresa_id }).catch((e) => ({ erro: e.message }))
  const conta = async (tabela, coluna) => (await svc.from(tabela).select('id', { count: 'exact', head: true }).like(coluna, 'VALIDA-IMP%')).count
  const contaCt = (await svc.from('contratos').select('id', { count: 'exact', head: true }).like('numero', 'CT-VALIDA-IMP%')).count
  const sobra = (await conta('obras', 'nome')) + (await conta('propostas', 'numero')) + (await conta('notas_fiscais', 'numero')) + (await conta('clientes', 'nome')) + (await conta('fd', 'observacao')) + (await conta('pagamentos', 'observacao')) + (await conta('itens', 'descricao')) + contaCt
  checar('desfazer apaga tudo o que a planilha importou, contratos e itens de contrato inclusive', !d.erro && sobra === 0 && contaCt === 0, d.erro ?? `sobraram ${sobra} (contratos: ${contaCt}) · ${JSON.stringify(d)}`)
  await limparAuditoriaDoRoteiro(svc, INICIO)
}

console.log(`\n${passos - falhas}/${passos} passos ok (ensaio da importação)`)
process.exit(falhas === 0 ? 0 : 1)
