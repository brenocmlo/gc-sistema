/**
 * Fumaça (13.5): os quatro caminhos críticos, de ponta a ponta, em poucos
 * minutos. Não substitui o plano: é o que roda quando não dá tempo das sete
 * camadas, e o que o CI pode rodar mais vezes.
 *
 *   bash scripts/validacao/validar.sh fumaca      # build + next start + este roteiro
 *
 * 1. Login e redirecionamento por perfil: sem sessão vai ao login; senha
 *    errada é recusada; cada um dos seis perfis abre o que pode e é
 *    redirecionado do que não pode (o mapa é o de matriz-rls.json, do 13.3).
 * 2. Orçamento → proposta → contrato → item: o orçamento aprovado vincula a
 *    obra, a proposta com itens é aprovada e gera o contrato com os itens, e o
 *    item novo no contrato recalcula o valor.
 * 3. Execução respeitando a cascata: produção cria as execuções do contrato e
 *    aponta; entregar mais do que fabricou e instalar sem entregar são
 *    recusados sem gravar.
 * 4. NF → pagamento → status: a NF nasce emitida, o primeiro pagamento a deixa
 *    paga parcialmente e o segundo, paga.
 *
 * Tudo o que cria leva `VALIDA-FUMACA-<ts>` (o verificar-sobras acha se a
 * rodada morrer) e é apagado no fim, inclusive quando algum passo falha.
 */
import { readFileSync } from 'node:fs'

import { createClient } from '@supabase/supabase-js'

import { limparAuditoriaDoRoteiro } from '../comum/auditoria-limpeza.mjs'
import { exigirGcDev } from '../comum/gc-dev-guard.mjs'
import { comNovaTentativa } from '../comum/rede.mjs'
import { PERFIS_DE_TESTE, sessaoDePerfil } from '../comum/sessao-dev.mjs'

import { cookieDeSessao, criarChamador, exigirActions, mapaDeActions } from './actions-http.mjs'

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:3111'
const URL_SUPABASE = process.env.NEXT_PUBLIC_SUPABASE_URL
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const EMAIL = process.env.VALIDACAO_EMAIL
const SENHA = process.env.VALIDACAO_SENHA

if (!URL_SUPABASE || !ANON || !EMAIL || !SENHA || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error('FALHA: a fumaça precisa das variáveis de validação e da chave de serviço em .env.local.')
  process.exit(1)
}
exigirGcDev(URL_SUPABASE, 'a fumaça')

const ACTIONS = mapaDeActions()
exigirActions(ACTIONS, [
  'createOrcamento', 'changeOrcamentoStatus', 'createProposta', 'changePropostaStatus', 'createItem',
  'gerarContratoDeProposta', 'criarExecucoesFaltantes', 'apontarExecucao', 'createNotaFiscal', 'createPagamento',
])

const svc = createClient(URL_SUPABASE, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const INICIO = new Date(Date.now() - 60_000).toISOString()
const NUMERO = `VALIDA-FUMACA-${Date.now()}`
const hoje = new Date().toISOString().slice(0, 10)

let passos = 0
let falhas = 0
function checar(descricao, condicao, detalhe = '') {
  passos += 1
  if (condicao) {
    console.log(`  ok    ${descricao}`)
  } else {
    falhas += 1
    console.log(`  FALHA ${descricao}`)
    if (detalhe) console.log(`         ${String(detalhe).slice(0, 400)}`)
  }
}

// Sessões: admin pela senha (o login de verdade), os outros perfis sem senha.
const sbAdmin = createClient(URL_SUPABASE, ANON, { auth: { persistSession: false } })
const login = await comNovaTentativa(`login de ${EMAIL}`, () => sbAdmin.auth.signInWithPassword({ email: EMAIL, password: SENHA }))
if (login.error) {
  console.error(`FALHA no login de ${EMAIL}: ${login.error.message}`)
  process.exit(1)
}
const cookies = { admin: cookieDeSessao(login.data.session, URL_SUPABASE) }
for (const perfil of Object.keys(PERFIS_DE_TESTE)) {
  cookies[perfil] = cookieDeSessao((await sessaoDePerfil(perfil)).session, URL_SUPABASE)
}
const chamar = criarChamador({ base: BASE, actions: ACTIONS, cookiePadrao: () => cookies.admin })
const { data: eu } = await svc.from('profiles').select('empresa_id').eq('id', login.data.user.id).single()

const criados = { obra: null, orcamento: null, proposta: null, contrato: null, nota: null }

try {
  // ------------------------------------------------------------------
  // 1. Login e redirecionamento por perfil
  // ------------------------------------------------------------------
  console.log('\n  1. login e redirecionamento por perfil')
  const semSessao = await fetch(`${BASE}/propostas`, { redirect: 'manual' })
  checar('sem sessão, /propostas manda ao login',
    [302, 307].includes(semSessao.status) && (semSessao.headers.get('location') ?? '').includes('/login'),
    `${semSessao.status} → ${semSessao.headers.get('location')}`)
  const errada = await createClient(URL_SUPABASE, ANON, { auth: { persistSession: false } })
    .auth.signInWithPassword({ email: EMAIL, password: `${SENHA}-errada` })
  checar('senha errada é recusada no login', Boolean(errada.error) && !errada.data.session, errada.error?.message ?? 'entrou')

  const mapa = JSON.parse(readFileSync(new URL('./matriz-rls.json', import.meta.url), 'utf8'))
  const ROTAS = ['/', '/propostas', '/contratos/novo', '/execucao', '/financeiro/notas-fiscais', '/fd/novo', '/logs', '/configuracoes/usuarios']
  for (const perfil of mapa.perfis) {
    const erros = []
    for (const rota of ROTAS) {
      const regra = mapa.rotas.acesso[rota]
      const pode = (regra === 'todos' ? mapa.perfis : regra).includes(perfil)
      const r = await fetch(BASE + rota, { redirect: 'manual', headers: { cookie: cookies[perfil] } })
      await r.arrayBuffer().catch(() => null)
      const ok = pode ? r.status === 200 : [302, 303, 307].includes(r.status)
      if (!ok) erros.push(`${rota}: ${r.status}, esperado ${pode ? 'abrir' : 'redirecionar'}`)
    }
    checar(`perfil ${perfil}: abre o que pode e é redirecionado do resto (${ROTAS.length} rotas)`, erros.length === 0, erros.join(' | '))
  }

  // ------------------------------------------------------------------
  // 2. Orçamento → proposta → contrato → item
  // ------------------------------------------------------------------
  console.log('\n  2. orçamento → proposta → contrato → item')
  const { data: cliente } = await svc.from('clientes').select('id').eq('empresa_id', eu.empresa_id).limit(1).single()
  const { data: obra, error: eObra } = await svc.from('obras')
    .insert({ empresa_id: eu.empresa_id, cliente_id: cliente.id, codigo_obra: `${NUMERO}-OB`, nome: `Obra da fumaça ${NUMERO}` })
    .select('id').single()
  criados.obra = obra?.id ?? null
  checar('obra de teste criada', Boolean(obra), eObra?.message)
  if (!obra) throw new Error('sem obra, o resto não roda')

  const orc = await chamar('createOrcamento', [{
    numero: `${NUMERO}-ORC`, data_solicitacao: hoje, cliente_id: cliente.id, descricao: 'Orçamento da fumaça',
    escopo_resumo: null, valor_estimado: 1000, prazo_estimado: null, responsavel: null, obra_id: null, observacao: null,
  }], { rota: '/orcamentos/novo' })
  criados.orcamento = orc.id ?? null
  const mudarOrc = (novo_status, extra = {}) => chamar('changeOrcamentoStatus', [orc.id, {
    novo_status, data_envio: hoje, data_decisao: novo_status === 'aprovado' ? hoje : null, motivo_rejeicao: null,
    detalhe_rejeicao: null, obra_id_vinculada: null, vincular_obra: false, ...extra,
  }], { rota: `/orcamentos/${orc.id}` })
  const env = orc.ok ? await mudarOrc('enviado') : { ok: false }
  const apr = env.ok ? await mudarOrc('aprovado', { obra_id_vinculada: obra.id, vincular_obra: true }) : { ok: false }
  const { data: orcLido } = await svc.from('orcamentos').select('status, obra_id').eq('id', orc.id ?? '').maybeSingle()
  checar('orçamento criado, enviado e aprovado, vinculando a obra',
    orc.ok && env.ok && apr.ok && orcLido?.status === 'aprovado' && orcLido?.obra_id === obra.id,
    orc.error ?? env.error ?? apr.error ?? JSON.stringify(orcLido))

  const prop = await chamar('createProposta', [{
    numero: NUMERO, obra_id: obra.id, data_emissao: hoje, data_validade: null, descricao: 'Proposta da fumaça',
    valor_total: 1000, desconto: 0, condicoes_pagamento: null, observacao: null,
    pct_sinal: 0.5, pct_fd: 0.5, pct_entrega_material: null, pct_medicao_instalacao: null,
  }], { rota: '/propostas/nova' })
  criados.proposta = prop.id ?? null
  const itemProp = prop.ok ? await chamar('createItem', [{ tipo: 'proposta', id: prop.id }, {
    numero: 1, tipo: 'Janela', descricao: 'Janela da fumaça', linha: null, acabamento: null,
    largura: null, altura: null, quantidade: 4, unidade: 'QTD', valor_unit: 250,
  }], { rota: `/propostas/${prop.id}` }) : { ok: false }
  const mudarProp = (novo_status) => chamar('changePropostaStatus', [prop.id, {
    novo_status, data_envio: hoje, data_decisao: novo_status === 'aprovada' ? hoje : null, motivo_rejeicao: null, detalhe_rejeicao: null,
  }], { rota: `/propostas/${prop.id}` })
  const envP = itemProp.ok ? await mudarProp('enviada') : { ok: false }
  const aprP = envP.ok ? await mudarProp('aprovada') : { ok: false }
  checar('proposta criada com item (4 × 250), enviada e aprovada',
    prop.ok && itemProp.ok && envP.ok && aprP.ok, prop.error ?? itemProp.error ?? envP.error ?? aprP.error)

  const gerou = aprP.ok ? await chamar('gerarContratoDeProposta', [prop.id, {
    numero: `${NUMERO}-CT`, obra_id: obra.id, data_assinatura: hoje, prazo_execucao: '30 dias', descricao: 'Contrato da fumaça',
    valor_total: 1000, desconto: 0, pct_sinal: 0.5, pct_fd: 0.5, pct_entrega_material: null, pct_medicao_instalacao: null,
    condicoes_pagamento: null, observacao: null,
  }, { copiarItens: true, confirmarDuplicado: false }], { rota: `/propostas/${prop.id}/gerar-contrato` }) : { ok: false }
  const { data: ct } = await svc.from('contratos').select('id, status, proposta_origem_id').eq('numero', `${NUMERO}-CT`).maybeSingle()
  criados.contrato = ct?.id ?? null
  const { data: itensCt } = ct ? await svc.from('itens').select('id, quantidade, valor_unit').eq('contrato_id', ct.id) : { data: [] }
  checar('a proposta aprovada gera o contrato ativo, com origem e o item copiado',
    gerou.ok && ct?.status === 'ativo' && ct?.proposta_origem_id === prop.id && (itensCt ?? []).length === 1,
    gerou.error ?? JSON.stringify({ ct, itens: itensCt?.length }))

  const itemCt = ct ? await chamar('createItem', [{ tipo: 'contrato', id: ct.id }, {
    numero: 2, tipo: 'Porta', descricao: 'Porta da fumaça', linha: null, acabamento: null,
    largura: null, altura: null, quantidade: 1, unidade: 'QTD', valor_unit: 200,
  }], { rota: `/contratos/${ct.id}` }) : { ok: false }
  const { data: ctValor } = ct ? await svc.from('contratos').select('valor_total').eq('id', ct.id).single() : { data: null }
  checar('item novo no contrato recalcula o valor (1.000 + 200 = 1.200)',
    itemCt.ok && Number(ctValor?.valor_total) === 1200, itemCt.error ?? `valor_total=${ctValor?.valor_total}`)

  // ------------------------------------------------------------------
  // 3. Execução respeitando a cascata
  // ------------------------------------------------------------------
  console.log('\n  3. execução e a cascata')
  if (ct) {
    const criou = await chamar('criarExecucoesFaltantes', [obra.id], { rota: '/execucao', cookie: cookies.producao })
    const { data: execs } = await svc.from('execucao').select('id, item_id, quantidade_total').in('item_id', (await svc.from('itens').select('id').eq('contrato_id', ct.id)).data.map((i) => i.id))
    checar('produção cria a execução dos 2 itens do contrato', criou.ok && criou.criadas === 2 && (execs ?? []).length === 2, criou.error ?? JSON.stringify(execs))
    const ex = (execs ?? []).find((e) => Number(e.quantidade_total) === 4)
    if (ex) {
      const ler = async () => (await svc.from('execucao').select('*').eq('id', ex.id).single()).data
      const ap = (q) => ({
        fab_qtd: q[0], ent_qtd: q[1], inst_qtd: q[2], med_qtd: q[3],
        fab_responsavel: null, ent_responsavel: null, inst_responsavel: null, med_responsavel: null,
        fab_observacao: null, ent_observacao: null, inst_observacao: null, med_observacao: null,
      })
      const apontar = async (q) => chamar('apontarExecucao', [ex.id, ap(q), (await ler()).updated_at], { rota: '/execucao', cookie: cookies.producao })

      const a1 = await apontar([2, 0, 0, 0])
      checar('produção aponta 2 de 4 na fabricação', a1.ok && Number((await ler()).fab_qtd) === 2, a1.error)
      const entregaDemais = await apontar([2, 3, 0, 0])
      checar('entregar 3 com só 2 fabricados é recusado, sem gravar',
        !entregaDemais.ok && /entregar 2/.test(entregaDemais.error ?? '') && Number((await ler()).ent_qtd) === 0, entregaDemais.error ?? 'passou')
      const semEntrega = await apontar([2, 0, 1, 0])
      checar('instalar sem entregar é recusado, sem gravar',
        !semEntrega.ok && /nenhuma unidade foi entregue/.test(semEntrega.error ?? '') && Number((await ler()).inst_qtd) === 0, semEntrega.error ?? 'passou')
      const a2 = await apontar([2, 2, 1, 0])
      const l2 = await ler()
      checar('dentro da cascata (2 fabricados, 2 entregues, 1 instalado) grava, com as etapas em andamento',
        a2.ok && Number(l2.ent_qtd) === 2 && Number(l2.inst_qtd) === 1 && l2.fab_status === 'andamento' && l2.inst_status === 'andamento',
        a2.error ?? JSON.stringify({ f: l2.fab_status, e: l2.ent_status, i: l2.inst_status }))
    } else {
      checar('execução do item de 4 unidades existe', false, JSON.stringify(execs))
    }
  }

  // ------------------------------------------------------------------
  // 4. NF → pagamento → status
  // ------------------------------------------------------------------
  console.log('\n  4. NF → pagamento → status')
  if (ct) {
    const nf = await chamar('createNotaFiscal', [{
      obra_id: obra.id, numero: `${NUMERO}-NF`, serie: '1', chave_nfe: null, contrato_id: ct.id, proposta_id: null,
      tipo: 'medicao', data_emissao: hoje, data_vencimento: null, valor_total: 1000, observacao: null,
    }], { rota: '/financeiro/notas-fiscais/novo' })
    criados.nota = nf.id ?? null
    const statusNf = async () => (await svc.from('notas_fiscais').select('status').eq('id', nf.id).single()).data?.status
    checar('a NF do contrato nasce emitida', nf.ok && (await statusNf()) === 'emitida', nf.error)
    if (nf.ok) {
      const pagar = (valor, sufixo) => chamar('createPagamento', [{
        obra_id: obra.id, origem: 'nf', nota_id: nf.id, parcela_acordo_id: null, data_pagamento: hoje,
        valor, forma: 'pix', observacao: `${NUMERO}-PG ${sufixo}`,
      }], { rota: '/financeiro/pagamentos/novo' })
      const p1 = await pagar(400, '1')
      checar('pagamento de 400 deixa a NF paga parcialmente', p1.ok && (await statusNf()) === 'paga_parcialmente', p1.error ?? await statusNf())
      const p2 = await pagar(600, '2')
      checar('pagamento dos 600 restantes deixa a NF paga', p2.ok && (await statusNf()) === 'paga', p2.error ?? await statusNf())
    }
  }
} catch (e) {
  checar('roteiro', false, e.message)
} finally {
  // Ordem: quem aponta antes de quem é apontado.
  const erros = []
  const apagar = async (rotulo, q) => { const { error } = await q; if (error) erros.push(`${rotulo}: ${error.message}`) }
  if (criados.nota) {
    await apagar('pagamentos', svc.from('pagamentos').delete().eq('nota_id', criados.nota))
    await apagar('nota fiscal', svc.from('notas_fiscais').delete().eq('id', criados.nota))
  }
  if (criados.obra) {
    const { data: itens } = await svc.from('itens').select('id').eq('obra_id', criados.obra)
    const ids = (itens ?? []).map((i) => i.id)
    if (ids.length > 0) await apagar('execuções', svc.from('execucao').delete().in('item_id', ids))
    await apagar('itens', svc.from('itens').delete().eq('obra_id', criados.obra))
  }
  if (criados.contrato) await apagar('contrato', svc.from('contratos').delete().eq('id', criados.contrato))
  if (criados.proposta) await apagar('proposta', svc.from('propostas').delete().eq('id', criados.proposta))
  if (criados.orcamento) await apagar('orçamento', svc.from('orcamentos').delete().eq('id', criados.orcamento))
  if (criados.obra) await apagar('obra', svc.from('obras').delete().eq('id', criados.obra))
  const aud = await limparAuditoriaDoRoteiro(svc, INICIO)
  checar(`limpeza: tudo o que a fumaça criou foi apagado (${aud.apagados} eventos de auditoria)`, erros.length === 0 && !aud.error, [...erros, aud.error?.message].filter(Boolean).join(' | '))
}

console.log(`\n${passos - falhas}/${passos} passos ok`)
process.exit(falhas === 0 ? 0 : 1)
