/**
 * Camada 6 (escrita): exercita as Server Actions de Propostas de ponta a ponta,
 * contra gc-dev, autenticado como usuário real.
 *
 *   BASE_URL=http://127.0.0.1:3111 node --env-file=.env.local scripts/validar-escrita.mjs
 *
 * Por que existe: até 2026-09-05 nenhuma escrita tinha rodado. As camadas
 * runtime e dados provam leitura — a tela abre, a query volta —, e todo o
 * caminho de gravação (guard de perfil, zod, CHECK do banco, Storage, histórico)
 * era código nunca executado. Era a maior lacuna do projeto.
 *
 * Como chama a action sem navegador: Server Action é um POST com o header
 * `Next-Action: <id>` e o corpo no formato do React Flight. Os ids saem do
 * próprio build (`.next/server/app/**\/page.js`), onde cada um aparece ao lado
 * do nome da função exportada — então o mapa se refaz sozinho a cada build, sem
 * hash chumbado aqui.
 *
 * Duas sutilezas que custaram tentativa até acertar:
 *   1. Argumento simples vai como `JSON.stringify([...args])` em text/plain.
 *   2. Com FormData, o corpo é multipart e a **parte do arquivo precisa vir
 *      antes** do campo `0` — o decodificador lê o `0` e procura partes já
 *      vistas. Na ordem inversa, a action recebe um FormData vazio e responde
 *      "Arquivo ausente no upload".
 *
 * Limpa o que cria: a proposta de teste é apagada no fim, inclusive quando algum
 * passo falha.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { createClient } from '@supabase/supabase-js'

import { exigirGcDev } from './gc-dev-guard.mjs'
import { sessaoDePerfil } from './sessao-dev.mjs'

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:3111'
const URL_SUPABASE = process.env.NEXT_PUBLIC_SUPABASE_URL
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const EMAIL = process.env.VALIDACAO_EMAIL
const SENHA = process.env.VALIDACAO_SENHA

if (!URL_SUPABASE || !ANON || !EMAIL || !SENHA) {
  console.error('FALHA: camada escrita precisa das variáveis de validação em .env.local.')
  process.exit(1)
}

exigirGcDev(URL_SUPABASE, 'a camada de escrita')

// ============================================================
// Mapa id → nome da action, lido do build
// ============================================================

function arquivosDoBuild(dir, saida = []) {
  for (const nome of readdirSync(dir)) {
    const caminho = join(dir, nome)
    if (statSync(caminho).isDirectory()) arquivosDoBuild(caminho, saida)
    else if (nome.endsWith('.js')) saida.push(caminho)
  }
  return saida
}

function mapaDeActions() {
  const mapa = {}
  // O build emite, minificado:
  //   "<id>":()=>Promise.resolve().then(r.bind(r,N)).then(e=>e.nomeDaFuncao)
  // A chave perde as aspas quando o hash começa por letra, daí o ["']? — e o
  // corpo é lido sem cruzar aspas, pra não vazar pro próximo par.
  const padrao = /["']?([0-9a-f]{40})["']?:\(\)=>[^"']{0,200}?\.then\(\w+=>\w+\.(\w+)\)/g
  for (const arquivo of arquivosDoBuild('.next/server/app')) {
    const conteudo = readFileSync(arquivo, 'utf8')
    for (const m of conteudo.matchAll(padrao)) mapa[m[2]] = m[1]
  }
  return mapa
}

const ACTIONS = mapaDeActions()

const NECESSARIAS = [
  'createProposta',
  'updateProposta',
  'changePropostaStatus',
  'deleteProposta',
  'uploadAnexo',
  'getAnexoUrl',
  'deleteAnexo',
  // Orçamentos: só o que o histórico uniformizado (migration 013) exige.
  'createOrcamento',
  'changeOrcamentoStatus',
  'deleteOrcamento',
]

const faltando = NECESSARIAS.filter((n) => !ACTIONS[n])
if (faltando.length > 0) {
  console.error(
    `FALHA: não achei no build as actions: ${faltando.join(', ')}.\n` +
      '  Rode a camada build antes (o mapa vem de .next/server/app).',
  )
  process.exit(1)
}

// ============================================================
// Sessões
// ============================================================

const ref = new URL(URL_SUPABASE).hostname.split('.')[0]

/** O mesmo cookie, a partir de uma sessão já pronta (sem senha). */
function cookieDeSessao(session) {
  const valor = `base64-${Buffer.from(JSON.stringify(session)).toString('base64url')}`
  return `sb-${ref}-auth-token=${valor}`
}

async function cookieDe(email, senha) {
  const sb = createClient(URL_SUPABASE, ANON)
  const { data, error } = await sb.auth.signInWithPassword({ email, password: senha })
  if (error) {
    console.error(`FALHA no login de ${email}: ${error.message}`)
    process.exit(1)
  }
  const valor = `base64-${Buffer.from(JSON.stringify(data.session)).toString('base64url')}`
  return { cookie: `sb-${ref}-auth-token=${valor}`, client: sb, userId: data.user.id }
}

const admin = await cookieDe(EMAIL, SENHA)
const supabase = admin.client

// ============================================================
// Chamada de Server Action
// ============================================================

function resultadoDoFlight(texto) {
  // A resposta é RSC: uma linha "1:{...}" carrega o retorno da action.
  for (const linha of texto.split('\n')) {
    const i = linha.indexOf(':')
    if (i < 0) continue
    const corpo = linha.slice(i + 1)
    if (!corpo.startsWith('{')) continue
    try {
      const json = JSON.parse(corpo)
      if ('ok' in json || 'error' in json) return json
    } catch {
      /* linha de metadados do flight, ignora */
    }
  }
  return { ok: false, error: `resposta não reconhecida: ${texto.slice(0, 200)}` }
}

async function chamar(nomeAction, args, { cookie = admin.cookie, rota = '/propostas' } = {}) {
  const res = await fetch(BASE + rota, {
    method: 'POST',
    headers: {
      cookie,
      'Next-Action': ACTIONS[nomeAction],
      'Content-Type': 'text/plain;charset=UTF-8',
    },
    body: JSON.stringify(args),
  })
  if (res.status !== 200) return { ok: false, error: `HTTP ${res.status}` }
  return resultadoDoFlight(await res.text())
}

async function chamarComArquivo(nomeAction, id, arquivo, { cookie = admin.cookie } = {}) {
  const form = new FormData()
  // A parte do arquivo PRECISA vir antes do campo 0 — ver cabeçalho.
  form.append('1_file', arquivo)
  form.append('0', JSON.stringify([id, '$K1']))

  const res = await fetch(BASE + '/propostas', {
    method: 'POST',
    headers: { cookie, 'Next-Action': ACTIONS[nomeAction] },
    body: form,
  })
  if (res.status !== 200) return { ok: false, error: `HTTP ${res.status}` }
  return resultadoDoFlight(await res.text())
}

// ============================================================
// Asserções
// ============================================================

let falhas = 0
let passos = 0

function checar(descricao, condicao, detalhe = '') {
  passos += 1
  if (condicao) {
    console.log(`  ok    ${descricao}`)
  } else {
    falhas += 1
    console.log(`  FALHA ${descricao}`)
    if (detalhe) console.log(`         ${detalhe}`)
  }
}

// ============================================================
// Roteiro
// ============================================================

const NUMERO = `VALIDA-ESCRITA-${Date.now()}`
let propostaId = null
let orcamentoId = null

try {
  const { data: obra } = await supabase
    .from('obras')
    .select('id, codigo_obra')
    .order('codigo_obra', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!obra) {
    console.error('FALHA: gc-dev não tem obra — a proposta precisa de uma.')
    process.exit(1)
  }

  const base = {
    numero: NUMERO,
    obra_id: obra.id,
    data_emissao: new Date().toISOString().slice(0, 10),
    data_validade: null,
    descricao: 'Proposta criada pela camada de escrita da validação.',
    valor_total: 1000,
    desconto: 100,
    condicoes_pagamento: null,
    observacao: null,
    pct_sinal: 0.5,
    pct_fd: 0.5,
    pct_entrega_material: null,
    pct_medicao_instalacao: null,
  }

  // 1. Criar
  const criada = await chamar('createProposta', [base], { rota: '/propostas/nova' })
  checar('createProposta cria a proposta', criada.ok === true, criada.error)
  propostaId = criada.id ?? null

  if (!propostaId) {
    console.error('  Sem id, o resto do roteiro não roda.')
  } else {
    // 2. O banco calculou valor_final (coluna generated)
    const { data: nova } = await supabase
      .from('propostas')
      .select('status, valor_final, historico, pct_sinal')
      .eq('id', propostaId)
      .maybeSingle()
    checar('nasce rascunho', nova?.status === 'rascunho', `status=${nova?.status}`)
    checar(
      'valor_final generated = 900',
      Number(nova?.valor_final) === 900,
      `valor_final=${nova?.valor_final}`,
    )
    checar(
      'pct_* gravado como fração',
      Number(nova?.pct_sinal) === 0.5,
      `pct_sinal=${nova?.pct_sinal}`,
    )

    // 3. Número repetido é recusado com mensagem traduzida
    const duplicada = await chamar('createProposta', [base], { rota: '/propostas/nova' })
    checar(
      'número repetido é recusado com mensagem legível',
      duplicada.ok === false && /já existe uma proposta com esse número/i.test(duplicada.error ?? ''),
      duplicada.error,
    )

    // 4. Editar em rascunho
    const editada = await chamar('updateProposta', [
      propostaId,
      { ...base, descricao: 'Editada pela camada de escrita.', valor_total: 2000 },
    ], { rota: `/propostas/${propostaId}/editar` })
    checar('updateProposta edita em rascunho', editada.ok === true, editada.error)

    // 5. Desconto maior que o total: o CHECK do banco, via mensagem traduzida
    const descontoInvalido = await chamar('updateProposta', [
      propostaId,
      { ...base, valor_total: 100, desconto: 500 },
    ], { rota: `/propostas/${propostaId}/editar` })
    checar(
      'desconto > valor_total é recusado',
      descontoInvalido.ok === false,
      descontoInvalido.error,
    )

    // 6. rascunho → enviada
    const hoje = new Date().toISOString().slice(0, 10)
    const enviada = await chamar('changePropostaStatus', [
      propostaId,
      { novo_status: 'enviada', data_envio: hoje, data_decisao: null, motivo_rejeicao: null, detalhe_rejeicao: null },
    ], { rota: `/propostas/${propostaId}` })
    checar('changePropostaStatus leva rascunho → enviada', enviada.ok === true, enviada.error)

    // 7. Enviada não é editável — o guard lê o status do banco
    const editarEnviada = await chamar('updateProposta', [propostaId, base], {
      rota: `/propostas/${propostaId}/editar`,
    })
    checar(
      'proposta enviada recusa edição',
      editarEnviada.ok === false && /rascunho/i.test(editarEnviada.error ?? ''),
      editarEnviada.error,
    )

    // 8. Transição inválida: enviada → enviada não muda nada; o proibido é pular
    const pulo = await chamar('changePropostaStatus', [
      propostaId,
      { novo_status: 'aprovada', data_envio: null, data_decisao: null, motivo_rejeicao: null, detalhe_rejeicao: null },
    ], { rota: `/propostas/${propostaId}` })
    checar(
      'aprovada sem data_decisao é recusada',
      pulo.ok === false && /decisão/i.test(pulo.error ?? ''),
      pulo.error,
    )

    // 9. Rejeitar com motivo — exercita o CHECK propostas_rejeitada_motivo
    const rejeitada = await chamar('changePropostaStatus', [
      propostaId,
      {
        novo_status: 'rejeitada',
        data_envio: null,
        data_decisao: hoje,
        motivo_rejeicao: 'outro',
        detalhe_rejeicao: 'Rejeitada pela camada de escrita da validação.',
      },
    ], { rota: `/propostas/${propostaId}` })
    checar('changePropostaStatus rejeita com motivo', rejeitada.ok === true, rejeitada.error)

    // 10. Histórico append-only, com as duas transições
    const { data: comHistorico } = await supabase
      .from('propostas')
      .select('status, motivo_rejeicao, detalhe_rejeicao, historico')
      .eq('id', propostaId)
      .maybeSingle()

    const hist = Array.isArray(comHistorico?.historico) ? comHistorico.historico : []
    checar('status final é rejeitada', comHistorico?.status === 'rejeitada', comHistorico?.status)
    checar('motivo gravado', comHistorico?.motivo_rejeicao === 'outro', comHistorico?.motivo_rejeicao)
    checar('histórico tem as 2 transições', hist.length === 2, `entradas=${hist.length}`)
    checar(
      'primeira entrada é rascunho → enviada',
      hist[0]?.de === 'rascunho' && hist[0]?.para === 'enviada',
      JSON.stringify(hist[0] ?? null),
    )
    checar(
      'segunda entrada carrega o motivo e o autor',
      hist[1]?.para === 'rejeitada' &&
        hist[1]?.motivo_rejeicao === 'outro' &&
        hist[1]?.por === admin.userId,
      JSON.stringify(hist[1] ?? null),
    )

    // 11. Terminal não volta pro funil
    const reabrir = await chamar('changePropostaStatus', [
      propostaId,
      { novo_status: 'rascunho', data_envio: null, data_decisao: null, motivo_rejeicao: null, detalhe_rejeicao: null },
    ], { rota: `/propostas/${propostaId}` })
    checar(
      'rejeitada é terminal',
      reabrir.ok === false && /não é permitida/i.test(reabrir.error ?? ''),
      reabrir.error,
    )

    // 12. Anexo: sobe pro Storage e entra no jsonb
    const arquivo = new File(
      [new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34])],
      'validacao-escrita.pdf',
      { type: 'application/pdf' },
    )
    const upload = await chamarComArquivo('uploadAnexo', propostaId, arquivo)
    checar('uploadAnexo sobe o arquivo (Storage + RLS)', upload.ok === true, upload.error)

    const { data: comAnexo } = await supabase
      .from('propostas')
      .select('anexos')
      .eq('id', propostaId)
      .maybeSingle()
    const anexos = Array.isArray(comAnexo?.anexos) ? comAnexo.anexos : []
    checar('anexo entrou no jsonb', anexos.length === 1, `anexos=${anexos.length}`)

    const path = anexos[0]?.path ?? ''
    const { data: perfilAdmin } = await supabase
      .from('profiles')
      .select('empresa_id')
      .eq('id', admin.userId)
      .maybeSingle()
    checar(
      'path segue {empresa}/propostas/{id}/...',
      path.startsWith(`${perfilAdmin?.empresa_id}/propostas/${propostaId}/`),
      path,
    )

    const { data: naStorage } = await supabase.storage
      .from('anexos')
      .list(`${perfilAdmin?.empresa_id}/propostas/${propostaId}`)
    checar(
      'arquivo existe no bucket',
      (naStorage ?? []).length === 1,
      `objetos=${(naStorage ?? []).length}`,
    )

    // 12b. URL assinada: o bucket é privado, então visualizar depende dela
    const assinada = await chamar('getAnexoUrl', [path], {
      rota: `/propostas/${propostaId}`,
    })
    checar('getAnexoUrl devolve URL assinada', assinada.ok === true, assinada.error)

    if (assinada.ok) {
      checar(
        'a URL traz token de assinatura',
        /[?&]token=/.test(assinada.url),
        assinada.url.slice(0, 100),
      )
      // A string sozinha não prova nada: assinatura errada ou path errado
      // devolvem 400 do Storage. Baixar é o que prova que o link abre.
      const baixado = await fetch(assinada.url)
      const bytes = new Uint8Array(await baixado.arrayBuffer())
      checar(
        'a URL assinada baixa o PDF (200 e começa com %PDF)',
        baixado.status === 200 && bytes[0] === 0x25 && bytes[1] === 0x50,
        `HTTP ${baixado.status}, ${bytes.length} bytes`,
      )
    }

    // 13. Remover o anexo
    const removido = await chamar('deleteAnexo', [propostaId, path], {
      rota: `/propostas/${propostaId}`,
    })
    checar('deleteAnexo remove do bucket e do jsonb', removido.ok === true, removido.error)

    const { data: semAnexo } = await supabase
      .from('propostas')
      .select('anexos')
      .eq('id', propostaId)
      .maybeSingle()
    checar(
      'jsonb ficou vazio',
      (Array.isArray(semAnexo?.anexos) ? semAnexo.anexos : []).length === 0,
      JSON.stringify(semAnexo?.anexos),
    )

    // 14. Permissão: visualizador não escreve
    // Sem gate de env: até 2026-09-10 este bloco dependia de
    // VALIDACAO_*_VISUALIZADOR, que saiu do .env.local quando o 4.8 eliminou as
    // senhas de perfil — as três checagens passaram a ser puladas em silêncio,
    // com um "PULOU" no output e exit 0. Sessão sem senha, como o resto do
    // plano: se falhar, estoura, e é o que se quer.
    {
      const sessaoVis = await sessaoDePerfil('visualizador')
      const vis = { cookie: cookieDeSessao(sessaoVis.session) }

      const criarComoVis = await chamar('createProposta', [
        { ...base, numero: `${NUMERO}-VIS` },
      ], { cookie: vis.cookie, rota: '/propostas/nova' })
      checar(
        'visualizador não cria proposta',
        criarComoVis.ok === false && /permissão/i.test(criarComoVis.error ?? ''),
        criarComoVis.error,
      )

      const statusComoVis = await chamar('changePropostaStatus', [
        propostaId,
        { novo_status: 'rascunho', data_envio: null, data_decisao: null, motivo_rejeicao: null, detalhe_rejeicao: null },
      ], { cookie: vis.cookie, rota: `/propostas/${propostaId}` })
      checar(
        'visualizador não muda status',
        statusComoVis.ok === false && /permissão/i.test(statusComoVis.error ?? ''),
        statusComoVis.error,
      )

      const excluirComoVis = await chamar('deleteProposta', [propostaId], {
        cookie: vis.cookie,
        rota: `/propostas/${propostaId}`,
      })
      checar(
        'visualizador não exclui',
        excluirComoVis.ok === false && /permissão/i.test(excluirComoVis.error ?? ''),
        excluirComoVis.error,
      )
    }
  }
  // ============================================================
  // Orçamentos: o histórico uniformizado (migration 013)
  // ============================================================

  const { data: cliente } = await supabase
    .from('clientes')
    .select('id')
    .order('nome')
    .limit(1)
    .maybeSingle()

  if (!cliente) {
    console.log('  PULOU histórico de orçamento — gc-dev não tem cliente')
  } else {
    const hoje = new Date().toISOString().slice(0, 10)

    const criadoOrc = await chamar('createOrcamento', [
      {
        numero: `${NUMERO}-ORC`,
        data_solicitacao: hoje,
        cliente_id: cliente.id,
        descricao: 'Orçamento criado pela camada de escrita.',
        escopo_resumo: null,
        valor_estimado: 500,
        prazo_estimado: null,
        responsavel: null,
        obra_id: null,
        observacao: null,
      },
    ], { rota: '/orcamentos/novo' })
    checar('createOrcamento cria o orçamento', criadoOrc.ok === true, criadoOrc.error)
    orcamentoId = criadoOrc.id ?? null

    if (orcamentoId) {
      const enviadoOrc = await chamar('changeOrcamentoStatus', [
        orcamentoId,
        {
          novo_status: 'enviado',
          data_envio: hoje,
          data_decisao: null,
          motivo_rejeicao: null,
          detalhe_rejeicao: null,
          obra_id_vinculada: null,
          vincular_obra: false,
        },
      ], { rota: `/orcamentos/${orcamentoId}` })
      checar('changeOrcamentoStatus muda pra enviado', enviadoOrc.ok === true, enviadoOrc.error)

      const rejeitadoOrc = await chamar('changeOrcamentoStatus', [
        orcamentoId,
        {
          novo_status: 'rejeitado',
          data_envio: null,
          data_decisao: hoje,
          motivo_rejeicao: 'preco_alto',
          detalhe_rejeicao: null,
          obra_id_vinculada: null,
          vincular_obra: false,
        },
      ], { rota: `/orcamentos/${orcamentoId}` })
      checar('changeOrcamentoStatus rejeita com motivo', rejeitadoOrc.ok === true, rejeitadoOrc.error)

      const { data: orcComHist } = await supabase
        .from('orcamentos')
        .select('status, historico')
        .eq('id', orcamentoId)
        .maybeSingle()

      const histOrc = Array.isArray(orcComHist?.historico) ? orcComHist.historico : []
      checar('histórico de orçamento tem as 2 transições', histOrc.length === 2, `entradas=${histOrc.length}`)
      checar(
        'primeira entrada é pendente → enviado',
        histOrc[0]?.de === 'pendente' && histOrc[0]?.para === 'enviado',
        JSON.stringify(histOrc[0] ?? null),
      )
      // O status de rejeição de orçamento é masculino: se o atalho errado for
      // usado, o motivo vem null e este passo pega.
      checar(
        'segunda entrada guarda o motivo (statusDeRejeicao masculino)',
        histOrc[1]?.para === 'rejeitado' && histOrc[1]?.motivo_rejeicao === 'preco_alto',
        JSON.stringify(histOrc[1] ?? null),
      )
    }
  }
} finally {
  // Limpeza: nem a proposta nem o orçamento de teste ficam em gc-dev, mesmo se
  // algo falhou no meio.
  if (orcamentoId) {
    const excluido = await chamar('deleteOrcamento', [orcamentoId], {
      rota: `/orcamentos/${orcamentoId}`,
    })
    checar('deleteOrcamento apaga o orçamento de teste', excluido.ok === true, excluido.error)
  }
  if (propostaId) {
    const excluida = await chamar('deleteProposta', [propostaId], {
      rota: `/propostas/${propostaId}`,
    })
    checar('deleteProposta apaga a proposta de teste', excluida.ok === true, excluida.error)

    const { count } = await supabase
      .from('propostas')
      .select('id', { count: 'exact', head: true })
      .eq('numero', NUMERO)
    checar('nada sobrou em gc-dev', count === 0, `linhas com ${NUMERO}: ${count}`)
  }
}

console.log(`\n${passos - falhas}/${passos} passos ok (como ${EMAIL})`)
process.exit(falhas === 0 ? 0 : 1)
