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
import { limparAuditoriaDoRoteiro } from './auditoria-limpeza.mjs'

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
  // `.next/server` inteiro, e não só `app/`: action usada por mais de uma rota
  // (as de item, desde o 6.4, servem proposta e contrato) vai para um chunk
  // compartilhado em `.next/server/chunks/`.
  for (const arquivo of arquivosDoBuild('.next/server')) {
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
  // Itens (bloco 5.2)
  'createItem',
  'updateItem',
  'deleteItem',
  // Importação em massa (bloco 5.4)
  'importarItens',
  // Sincronização de valor (5.6)
  'sincronizarValorComItens',
  // Duplicar, reordenar e lote (5.7)
  'duplicarItem',
  'moverItem',
  'excluirItensEmLote',
  'ajustarValorEmLote',
  // Gerar contrato de proposta aprovada (6.2)
  'gerarContratoDeProposta',
  // Contrato avulso (6.3)
  'createContrato',
  // Detalhe e edição do contrato (6.4)
  'updateContrato',
  'uploadAnexoContrato',
  'deleteAnexoContrato',
  // Mudança de status e rescisão (6.5)
  'changeContratoStatus',
  // Orçamentos: só o que o histórico uniformizado (migration 013) exige.
  'createOrcamento',
  'changeOrcamentoStatus',
  'deleteOrcamento',
  // Anexos do orçamento, renomeados para não colidirem com os da proposta
  'uploadAnexoOrcamento',
  'deleteAnexoOrcamento',
  // Execução: ação em lote da listagem (7.2) e apontamento (7.3)
  'criarExecucoesFaltantes',
  'apontarExecucao',
  'lerExecucao',
  // Várias execuções por item (7.4)
  'criarNovaExecucao',
  // Automação, Fase 7: contatos do bot em /configuracoes/contatos
  'createContato',
  'updateContato',
  'deleteContato',
  // Automação, Fase 7: envio de documento pela tela (/documentos)
  'registrarEnvioDocumento',
]

const faltando = NECESSARIAS.filter((n) => !ACTIONS[n])
if (faltando.length > 0) {
  console.error(
    `FALHA: não achei no build as actions: ${faltando.join(', ')}.\n` +
      '  Rode a camada build antes (o mapa vem de .next/server).',
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
/** Quantas mudanças de status venceram na corrida do orçamento — entram na conta da auditoria. */
let orcCorridaVenceram = 0
/** Ids dos itens criados no roteiro — limpos no finally. */
const itensCriados = []
/** Proposta isolada dos passos do 5.6 — apagada no finally. */
let proposta56Id = null
/** Contrato e proposta de carga do fechamento da sprint 5 — apagados no finally. */
let contratoTesteId = null
let propostaCargaId = null
/** Propostas do 5.7 e da matriz de perfis do 5.8 — apagadas no finally. */
let proposta57Id = null
let propostaPerfisId = null
/** Bloco 6.2: proposta aprovada de teste e os contratos gerados dela — apagados no finally. */
let proposta62Id = null
const contratos62 = []
/** Fase 7 da automação: PDF de teste no bucket e documento do envio pela tela — apagados no finally. */
let envioTesteCaminho = null
let envioTesteDocId = null
/** Fase 7 da automação: contato de teste criado em /configuracoes/contatos — apagado no finally. */
let contatoTesteId = null
/** Fase 6 da automação: proposta criada pela rota de ingestão e os documentos de teste — apagados no finally. */
let propostaIngestaoId = null
const documentosIngestao = []
/**
 * Início do roteiro, com folga de 1 min pro relógio do banco. A limpeza da
 * auditoria (13.2) só apaga eventos daqui pra frente cujo registro já não
 * existe — os que o próprio roteiro criou e apagou.
 */
const INICIO_AUDITORIA = new Date(Date.now() - 60_000).toISOString()
const svc = createClient(URL_SUPABASE, process.env.SUPABASE_SERVICE_ROLE_KEY ?? '', {
  auth: { persistSession: false },
})


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

    // 5b. Itens (bloco 5.2) — a proposta ainda é rascunho aqui, que é a
    // única janela em que o guard de item deixa escrever.
    const rotaItens = `/propostas/${propostaId}`

    const item1 = await chamar('createItem', [propostaId, {
      numero: 1, tipo: 'Janela', descricao: 'Janela de correr', linha: 'Suprema',
      acabamento: 'Branco', largura: 1.2, altura: 1.5, quantidade: 2,
      unidade: 'M2', valor_unit: 500,
    }], { rota: rotaItens })
    checar('createItem cria o item na proposta', item1.ok === true, item1.error)
    if (item1.ok) itensCriados.push(item1.item.id)

    // As duas colunas GENERATED: o banco calcula, ninguém envia.
    checar(
      'valor_total generated = valor_unit × quantidade (1000)',
      Number(item1.item?.valor_total) === 1000,
      `valor_total=${item1.item?.valor_total}`,
    )
    checar(
      'area_m2 generated = largura × altura × quantidade (3.6)',
      Math.abs(Number(item1.item?.area_m2) - 3.6) < 0.0001,
      `area_m2=${item1.item?.area_m2}`,
    )
    // O servidor resolve empresa_id/obra_id da proposta — não vêm do cliente.
    checar(
      'item herda obra_id e empresa_id da proposta',
      item1.item?.obra_id === obra.id && Boolean(item1.item?.empresa_id),
      `obra_id=${item1.item?.obra_id}`,
    )

    // Editar recalcula as geradas
    const item1Editado = await chamar('updateItem', [propostaId, item1.item?.id, {
      numero: 1, tipo: 'Janela', descricao: 'Janela de correr', linha: 'Suprema',
      acabamento: 'Branco', largura: 1.2, altura: 1.5, quantidade: 3,
      unidade: 'M2', valor_unit: 500,
    }], { rota: rotaItens })
    checar('updateItem edita a linha', item1Editado.ok === true, item1Editado.error)
    checar(
      'colunas generated recalculam na edição (1500)',
      Number(item1Editado.item?.valor_total) === 1500,
      `valor_total=${item1Editado.item?.valor_total}`,
    )

    // Unique parcial (proposta_id, numero) — o tsc não pega, o banco pega
    const numeroRepetido = await chamar('createItem', [propostaId, {
      numero: 1, tipo: null, descricao: 'Duplicata', linha: null, acabamento: null,
      largura: null, altura: null, quantidade: 1, unidade: 'QTD', valor_unit: 10,
    }], { rota: rotaItens })
    checar(
      'número repetido na mesma proposta é recusado',
      numeroRepetido.ok === false,
      numeroRepetido.error,
    )
    if (numeroRepetido.ok) itensCriados.push(numeroRepetido.item.id)

    // CHECK de unidade. Via HTTP dá pra mandar 'ML', que o ItemPayload
    // bloquearia no tsc — é exatamente o caminho que a automação vai usar.
    const unidadeInvalida = await chamar('createItem', [propostaId, {
      numero: 2, tipo: null, descricao: 'ML não existe mais', linha: null,
      acabamento: null, largura: null, altura: null, quantidade: 1,
      unidade: 'ML', valor_unit: 10,
    }], { rota: rotaItens })
    checar(
      "unidade 'ML' é recusada pelo CHECK",
      unidadeInvalida.ok === false,
      unidadeInvalida.error,
    )
    if (unidadeInvalida.ok) itensCriados.push(unidadeInvalida.item.id)

    // Colunas geradas enviadas pelo cliente: limparColunasGeradas as remove
    // antes do insert, então a action aceita e o banco calcula o certo.
    const comGeradas = await chamar('createItem', [propostaId, {
      numero: 3, tipo: null, descricao: 'Com colunas geradas no payload',
      linha: null, acabamento: null, largura: null, altura: null,
      quantidade: 2, unidade: 'QTD', valor_unit: 100,
      valor_total: 999999, area_m2: 999999,
    }], { rota: rotaItens })
    checar(
      'payload com valor_total/area_m2 não quebra o insert',
      comGeradas.ok === true,
      comGeradas.error,
    )
    if (comGeradas.ok) itensCriados.push(comGeradas.item.id)
    checar(
      'valor_total enviado pelo cliente é ignorado (200, não 999999)',
      Number(comGeradas.item?.valor_total) === 200,
      `valor_total=${comGeradas.item?.valor_total}`,
    )

    // Excluir
    if (comGeradas.ok) {
      const excluido = await chamar('deleteItem', [propostaId, comGeradas.item.id], {
        rota: rotaItens,
      })
      checar('deleteItem remove o item', excluido.ok === true, excluido.error)
      if (excluido.ok) {
        const i = itensCriados.indexOf(comGeradas.item.id)
        if (i >= 0) itensCriados.splice(i, 1)
      }
    }

    // 5e. Formulário completo (bloco 5.3): os três campos que a tabela não
    // tem. Prova que `localizacao`/`vidros`/`observacao` gravam, e — o que
    // importa mais — que editar pela TABELA depois não os apaga.
    const itemCompleto = await chamar('createItem', [propostaId, {
      numero: 30, tipo: 'Porta', descricao: 'Com todos os campos', linha: 'Gold',
      acabamento: 'Bronze', largura: 0.9, altura: 2.1, quantidade: 1,
      unidade: 'M2', valor_unit: 2000,
      localizacao: 'Entrada social', vidros: 'Temperado 8mm', observacao: 'Vem do formulário completo',
    }], { rota: `/propostas/${propostaId}` })
    checar('createItem grava localizacao, vidros e observacao', itemCompleto.ok === true, itemCompleto.error)
    if (itemCompleto.ok) {
      itensCriados.push(itemCompleto.item.id)
      checar(
        'os três campos do formulário completo voltaram do banco',
        itemCompleto.item.localizacao === 'Entrada social' &&
          itemCompleto.item.vidros === 'Temperado 8mm' &&
          itemCompleto.item.observacao === 'Vem do formulário completo',
        JSON.stringify({
          localizacao: itemCompleto.item.localizacao,
          vidros: itemCompleto.item.vidros,
          observacao: itemCompleto.item.observacao,
        }),
      )

      // A tabela do 5.2 NÃO manda esses três campos. O PostgREST só altera as
      // colunas presentes no update, então omitir tem de PRESERVAR.
      const edicaoPelaTabela = await chamar('updateItem', [propostaId, itemCompleto.item.id, {
        numero: 30, tipo: 'Porta', descricao: 'Editado pela tabela', linha: 'Gold',
        acabamento: 'Bronze', largura: 0.9, altura: 2.1, quantidade: 2,
        unidade: 'M2', valor_unit: 2000,
      }, itemCompleto.item.updated_at], { rota: `/propostas/${propostaId}` })
      checar('editar pela tabela funciona', edicaoPelaTabela.ok === true, edicaoPelaTabela.error)
      checar(
        'editar pela tabela NÃO apaga os campos do formulário completo',
        edicaoPelaTabela.ok &&
          edicaoPelaTabela.item.localizacao === 'Entrada social' &&
          edicaoPelaTabela.item.vidros === 'Temperado 8mm' &&
          edicaoPelaTabela.item.observacao === 'Vem do formulário completo',
        JSON.stringify({
          localizacao: edicaoPelaTabela.item?.localizacao,
          vidros: edicaoPelaTabela.item?.vidros,
          observacao: edicaoPelaTabela.item?.observacao,
        }),
      )
    }

    // 5f. Importação em massa (bloco 5.4)
    const lote = await chamar('importarItens', [propostaId, [
      { numero: 40, tipo: 'Lote', descricao: 'Linha 1 do lote', linha: null, acabamento: null,
        largura: 1, altura: 1, quantidade: 2, unidade: 'M2', valor_unit: 100,
        localizacao: null, vidros: null, observacao: null },
      { numero: null, tipo: 'Lote', descricao: 'Linha 2 do lote, sem numero', linha: null, acabamento: null,
        largura: null, altura: null, quantidade: 1, unidade: 'QTD', valor_unit: 50,
        localizacao: null, vidros: null, observacao: null },
    ], 3], { rota: `/propostas/${propostaId}` })
    checar('importarItens grava o lote', lote.ok === true, lote.error)
    checar('relatório traz importados e ignorados',
      lote.ok && lote.importados === 2 && lote.ignorados === 3,
      JSON.stringify({ importados: lote.importados, ignorados: lote.ignorados }))

    if (lote.ok) {
      const { data: doLote } = await supabase
        .from('itens')
        .select('id, numero, valor_total, area_m2, descricao')
        .eq('proposta_id', propostaId)
        .like('descricao', '%do lote%')
      for (const l of doLote ?? []) itensCriados.push(l.id)

      const semNumeroOriginal = (doLote ?? []).find((l) => l.descricao?.includes('sem numero'))
      checar(
        'linha sem numero recebeu numeração automática',
        semNumeroOriginal && Number(semNumeroOriginal.numero) > 0,
        `numero=${semNumeroOriginal?.numero}`,
      )

      const comDimensao = (doLote ?? []).find((l) => l.descricao?.includes('Linha 1'))
      checar(
        'colunas generated calculadas no lote (200 e 2)',
        comDimensao && Number(comDimensao.valor_total) === 200 && Math.abs(Number(comDimensao.area_m2) - 2) < 0.0001,
        JSON.stringify({ valor_total: comDimensao?.valor_total, area_m2: comDimensao?.area_m2 }),
      )
    }

    // Lote inteiro volta atrás se UMA linha viola o unique — importação
    // parcial é pior que recusada, porque ninguém sabe onde parou.
    const loteComColisao = await chamar('importarItens', [propostaId, [
      { numero: 50, tipo: 'Lote', descricao: 'Boa', linha: null, acabamento: null,
        largura: null, altura: null, quantidade: 1, unidade: 'QTD', valor_unit: 10,
        localizacao: null, vidros: null, observacao: null },
      { numero: 50, tipo: 'Lote', descricao: 'Numero repetido', linha: null, acabamento: null,
        largura: null, altura: null, quantidade: 1, unidade: 'QTD', valor_unit: 10,
        localizacao: null, vidros: null, observacao: null },
    ], 0], { rota: `/propostas/${propostaId}` })
    checar('lote com numero repetido é recusado inteiro', loteComColisao.ok === false, loteComColisao.error)

    const { count: sobrouDaColisao } = await supabase
      .from('itens')
      .select('id', { count: 'exact', head: true })
      .eq('proposta_id', propostaId)
      .eq('numero', 50)
    checar('nenhuma linha do lote recusado entrou (transação)', sobrouDaColisao === 0,
      `linhas com numero 50: ${sobrouDaColisao}`)

    // Entrada inválida no lote é recusada antes do banco
    const loteInvalido = await chamar('importarItens', [propostaId, [
      { numero: 60, tipo: null, descricao: 'Unidade inválida', linha: null, acabamento: null,
        largura: null, altura: null, quantidade: 1, unidade: 'ML', valor_unit: 10,
        localizacao: null, vidros: null, observacao: null },
    ], 0], { rota: `/propostas/${propostaId}` })
    checar('lote com unidade inválida é recusado pela action',
      loteInvalido.ok === false && /Unidade/i.test(loteInvalido.error ?? ''),
      loteInvalido.error)

    // ------------------------------------------------------------
    // 5g. Whitelist de escrita (furo encontrado no 5.5). Tipo não existe em
    // runtime: um POST pode mandar qualquer campo. Estes passos provam que os
    // resolvidos pelo servidor não são sobrescritos pelo corpo.
    // ------------------------------------------------------------
    const { data: perfilDoAdmin } = await supabase
      .from('profiles').select('empresa_id').eq('id', admin.userId).maybeSingle()
    const empresaId = perfilDoAdmin?.empresa_id
    const { data: outraProposta } = await supabase
      .from('propostas').select('id').eq('numero', 'SEED-ITENS-001').maybeSingle()

    const intruso = await chamar('createItem', [propostaId, {
      numero: 90, tipo: null, descricao: 'Tenta escolher a própria proposta', linha: null,
      acabamento: null, largura: null, altura: null, quantidade: 1, unidade: 'QTD', valor_unit: 10,
      proposta_id: outraProposta?.id, created_by: '00000000-0000-0000-0000-000000000000',
      foto_url: `${empresaId}/itens/qualquer/roubada.png`,
    }], { rota: `/propostas/${propostaId}` })
    if (intruso.ok) itensCriados.push(intruso.item.id)
    checar('createItem ignora proposta_id, created_by e foto_url do corpo',
      intruso.ok && intruso.item.proposta_id === propostaId &&
        intruso.item.created_by === admin.userId && intruso.item.foto_url === null,
      JSON.stringify({ proposta: intruso.item?.proposta_id, por: intruso.item?.created_by, foto: intruso.item?.foto_url }))

    if (intruso.ok) {
      const mover = await chamar('updateItem', [propostaId, intruso.item.id, {
        numero: 90, tipo: null, descricao: 'Tenta mudar de proposta', linha: null,
        acabamento: null, largura: null, altura: null, quantidade: 1, unidade: 'QTD', valor_unit: 10,
        proposta_id: outraProposta?.id, empresa_id: '00000000-0000-0000-0000-000000000000',
        foto_url: `${empresaId}/itens/qualquer/roubada.png`,
      }, intruso.item.updated_at], { rota: `/propostas/${propostaId}` })
      checar('updateItem não move o item de proposta nem aceita foto_url do corpo',
        mover.ok && mover.item.proposta_id === propostaId && mover.item.foto_url === null,
        JSON.stringify({ ok: mover.ok, proposta: mover.item?.proposta_id, foto: mover.item?.foto_url, erro: mover.error }))

      // Excluir é só admin: a policy "Itens: admin exclui". Até o 5.5 a action
      // aceitava comercial, o RLS negava em silêncio e a resposta era `ok`.
      const sessaoCom5 = await sessaoDePerfil('comercial')
      const exclCom = await chamar('deleteItem', [propostaId, intruso.item.id], {
        cookie: cookieDeSessao(sessaoCom5.session), rota: `/propostas/${propostaId}`,
      })
      const { count: aindaExiste } = await supabase
        .from('itens').select('id', { count: 'exact', head: true }).eq('id', intruso.item.id)
      checar('comercial não exclui item — e a resposta diz isso, não "ok"',
        exclCom.ok === false && /permissão/i.test(exclCom.error ?? '') && aindaExiste === 1,
        `${exclCom.error} · linhas=${aindaExiste}`)
    }

    // ------------------------------------------------------------
    // 5i. Recálculo do valor (bloco 5.6), numa proposta isolada: os passos
    // precisam de desconto e de aprovação, e a proposta principal do roteiro
    // é rejeitada mais adiante.
    // ------------------------------------------------------------
    const { data: somaPrincipal } = await supabase
      .from('itens').select('valor_total').eq('proposta_id', propostaId)
    const { data: valorPrincipal } = await supabase
      .from('propostas').select('valor_total').eq('id', propostaId).maybeSingle()
    const soma1 = (somaPrincipal ?? []).reduce((a, i) => a + Number(i.valor_total), 0)
    checar('proposta principal: valor_total acompanhou a soma dos itens (trigger)',
      Math.abs(Number(valorPrincipal?.valor_total) - soma1) < 0.005,
      `valor=${valorPrincipal?.valor_total} soma=${soma1}`)

    const p56 = await chamar('createProposta', [{
      ...base, numero: `${NUMERO}-56`, valor_total: 5000, desconto: 100,
      pct_sinal: null, pct_fd: null,
    }], { rota: '/propostas/nova' })
    proposta56Id = p56.id ?? null
    checar('proposta do 5.6 criada com valor digitado 5000', p56.ok === true, p56.error)

    if (proposta56Id) {
      const r56 = `/propostas/${proposta56Id}`
      const valor56 = async () => {
        const { data } = await supabase.from('propostas').select('valor_total').eq('id', proposta56Id).maybeSingle()
        return Number(data?.valor_total)
      }
      const item56 = (n, qtd, vu) => ({ numero: n, tipo: null, descricao: `5.6 item ${n}`, linha: null,
        acabamento: null, largura: null, altura: null, quantidade: qtd, unidade: 'QTD', valor_unit: vu })

      // Excluir o ÚLTIMO item não zera o valor (escolha 2 da migration)
      const z = await chamar('createItem', [proposta56Id, item56(1, 1, 700)], { rota: r56 })
      checar('com o primeiro item, o valor vira a soma (700)', z.ok && (await valor56()) === 700, await valor56())
      if (z.ok) await chamar('deleteItem', [proposta56Id, z.item.id], { rota: r56 })
      checar('excluir o último item mantém o último valor (700), não zera', (await valor56()) === 700, await valor56())

      const a = await chamar('createItem', [proposta56Id, item56(2, 2, 300)], { rota: r56 })
      const b = await chamar('createItem', [proposta56Id, item56(3, 1, 50)], { rota: r56 })
      if (a.ok) itensCriados.push(a.item.id)
      if (b.ok) itensCriados.push(b.item.id)
      checar('dois itens (2×300 + 1×50): valor = 650', (await valor56()) === 650, await valor56())

      // Soma abaixo do desconto: não bloqueia e não sincroniza (escolha 3). A
      // primeira versão bloqueava — e aí nenhuma proposta com desconto
      // conseguia receber o primeiro item. Quem pegou foi a camada navegador.
      if (a.ok) {
        const baratear = await chamar('updateItem', [proposta56Id, a.item.id, item56(2, 2, 1), a.item.updated_at], { rota: r56 })
        checar('baratear abaixo do desconto (100) é aceito — não trava o lançamento de itens',
          baratear.ok === true, baratear.error)
        checar('e o valor digitado segue valendo (650), porque a soma (52) não cabe no CHECK',
          (await valor56()) === 650, await valor56())
        const voltar = await chamar('updateItem', [proposta56Id, a.item.id, item56(2, 2, 300),
          baratear.ok ? baratear.item.updated_at : a.item.updated_at], { rota: r56 })
        checar('quando a soma volta a alcançar o desconto, o valor volta a acompanhá-la (650)',
          voltar.ok && (await valor56()) === 650, `${voltar.error ?? ''} · valor=${await valor56()}`)
      }

      // Formulário de edição com itens: obra travada, valor vem da soma
      const { data: outraObra } = await supabase
        .from('obras').select('id').neq('id', obra.id).limit(1).maybeSingle()
      if (outraObra) {
        const trocaObra = await chamar('updateProposta', [proposta56Id, {
          ...base, numero: `${NUMERO}-56`, obra_id: outraObra.id, valor_total: 650, desconto: 100,
          pct_sinal: null, pct_fd: null,
        }], { rota: `${r56}/editar` })
        checar('com itens, trocar a obra da proposta é recusado',
          trocaObra.ok === false && /tem itens/.test(trocaObra.error ?? ''), trocaObra.error)
      }
      const valorDoCorpo = await chamar('updateProposta', [proposta56Id, {
        ...base, numero: `${NUMERO}-56`, valor_total: 1, desconto: 100, pct_sinal: null, pct_fd: null,
      }], { rota: `${r56}/editar` })
      checar('com itens, o valor_total do corpo é ignorado: fica a soma (650)',
        valorDoCorpo.ok && (await valor56()) === 650, `${valorDoCorpo.error ?? ''} · valor=${await valor56()}`)

      // Divergência por escrita direta (o caminho do n8n) e o botão de resolver
      await supabase.from('propostas').update({ valor_total: 12345 }).eq('id', proposta56Id)
      checar('escrita direta no valor cria a divergência (o trigger não vigia propostas)',
        (await valor56()) === 12345, await valor56())
      const sinc = await chamar('sincronizarValorComItens', [proposta56Id], { rota: r56 })
      checar('sincronizarValorComItens devolve o valor à soma (650)',
        sinc.ok && (await valor56()) === 650, `${sinc.error ?? ''} · valor=${await valor56()}`)

      // obras_com_valores continua batendo: aprovar a proposta soma os 650
      // dela no valor da obra. Delta, e não valor absoluto, porque a obra já
      // tem outras propostas e contratos.
      const { data: antes } = await supabase
        .from('obras_com_valores').select('valor_total_calculado').eq('id', obra.id).maybeSingle()
      const hojeAprov = new Date().toISOString().slice(0, 10)
      await chamar('changePropostaStatus', [proposta56Id,
        { novo_status: 'enviada', data_envio: hojeAprov, data_decisao: null, motivo_rejeicao: null, detalhe_rejeicao: null },
      ], { rota: r56 })
      const aprov = await chamar('changePropostaStatus', [proposta56Id,
        { novo_status: 'aprovada', data_envio: hojeAprov, data_decisao: hojeAprov, motivo_rejeicao: null, detalhe_rejeicao: null },
      ], { rota: r56 })
      const { data: depois } = await supabase
        .from('obras_com_valores').select('valor_total_calculado').eq('id', obra.id).maybeSingle()
      // A coluna da view é `valor_total_calculado`, não `valor_total`.
      const delta = Math.round((Number(depois?.valor_total_calculado) - Number(antes?.valor_total_calculado)) * 100) / 100
      checar('obras_com_valores: aprovar a proposta soma exatamente os 650 dos itens na obra',
        aprov.ok && delta === 650, `${aprov.error ?? ''} · antes=${antes?.valor_total_calculado} depois=${depois?.valor_total_calculado} delta=${delta}`)
    }

    // ------------------------------------------------------------
    // 5j. Recálculo em CONTRATO (pendência do 5.6). O trigger cobre contratos,
    // mas nada tinha criado item de contrato: a tela é da sprint 6. Aqui é
    // direto no banco, como o workflow n8n de contrato faz.
    // ------------------------------------------------------------
    {
      const { data: c, error: ce } = await supabase.from('contratos').insert({
        empresa_id: empresaId, obra_id: obra.id, numero: `${NUMERO}-CONTRATO`, valor_total: 999,
      }).select('id').single()
      checar('contrato de teste criado com valor digitado 999', !ce, ce?.message)
      contratoTesteId = c?.id ?? null
      if (contratoTesteId) {
        const valorC = async () => Number((await supabase.from('contratos').select('valor_total').eq('id', contratoTesteId).single()).data?.valor_total)
        const { data: ic } = await supabase.from('itens').insert([
          { empresa_id: empresaId, obra_id: obra.id, contrato_id: contratoTesteId, quantidade: 2, unidade: 'QTD', valor_unit: 100 },
          { empresa_id: empresaId, obra_id: obra.id, contrato_id: contratoTesteId, quantidade: 1, unidade: 'QTD', valor_unit: 50 },
        ]).select('id')
        checar('itens de contrato: valor do contrato vira a soma (250)', (await valorC()) === 250, await valorC())
        await supabase.from('itens').update({ quantidade: 3 }).eq('id', ic?.[0]?.id)
        checar('editar item de contrato recalcula (350)', (await valorC()) === 350, await valorC())
        await supabase.from('itens').delete().in('id', (ic ?? []).map((i) => i.id))
        checar('apagar todos os itens do contrato mantém o último valor (350)', (await valorC()) === 350, await valorC())
      }
    }

    // ------------------------------------------------------------
    // 5k. Concorrência DE VERDADE (pendências do 5.2, 5.3 e 5.6): requisições
    // disparadas ao mesmo tempo, cada uma na sua transação.
    // ------------------------------------------------------------
    {
      const base5k = (n, vu = 10) => ({ numero: n, tipo: null, descricao: `concorrência ${n}`, linha: null,
        acabamento: null, largura: null, altura: null, quantidade: 1, unidade: 'QTD', valor_unit: vu })

      // Mesmo número em paralelo: o unique parcial garante um só.
      const mesmoNumero = await Promise.all([1, 2, 3].map(() =>
        chamar('createItem', [propostaId, base5k(80)], { rota: `/propostas/${propostaId}` })))
      for (const r of mesmoNumero) if (r.ok) itensCriados.push(r.item.id)
      checar('3 criações simultâneas com o mesmo número: exatamente 1 entra',
        mesmoNumero.filter((r) => r.ok).length === 1 &&
          mesmoNumero.filter((r) => !r.ok && /Já existe um item com esse número/.test(r.error ?? '')).length === 2,
        mesmoNumero.map((r) => r.ok ? 'ok' : r.error).join(' | '))

      // Mesma linha editada por duas pessoas ao mesmo tempo: o lock otimista
      // deixa passar uma.
      const alvo5k = mesmoNumero.find((r) => r.ok)
      if (alvo5k) {
        const duasEdicoes = await Promise.all([30, 40].map((vu) =>
          chamar('updateItem', [propostaId, alvo5k.item.id, base5k(80, vu), alvo5k.item.updated_at], { rota: `/propostas/${propostaId}` })))
        checar('2 edições simultâneas com o mesmo updated_at: exatamente 1 grava',
          duasEdicoes.filter((r) => r.ok).length === 1,
          duasEdicoes.map((r) => r.ok ? `ok(${r.item.valor_unit})` : r.error).join(' | '))
      }

      // Muitas criações em paralelo: o valor da proposta tem de bater com a
      // soma no fim. Antes da migration 20260922130000 isto falhava em 8 de
      // 20 rodadas.
      const muitas = await Promise.all([81, 82, 83, 84, 85, 86].map((n) =>
        chamar('createItem', [propostaId, base5k(n, n)], { rota: `/propostas/${propostaId}` })))
      for (const r of muitas) if (r.ok) itensCriados.push(r.item.id)
      const { data: somaPar } = await supabase.from('itens').select('valor_total').eq('proposta_id', propostaId)
      const { data: valorPar } = await supabase.from('propostas').select('valor_total, desconto').eq('id', propostaId).single()
      const soma5k = (somaPar ?? []).reduce((a, i) => a + Number(i.valor_total), 0)
      checar('6 criações simultâneas: valor da proposta == soma dos itens (trigger com trava)',
        muitas.every((r) => r.ok) && Math.abs(Number(valorPar?.valor_total) - soma5k) < 0.005,
        `valor=${valorPar?.valor_total} soma=${soma5k} · ${muitas.filter((r) => !r.ok).map((r) => r.error).join(' | ') || 'todas ok'}`)
    }

    // ------------------------------------------------------------
    // 5l. Carga (pendências do 5.2 e do 5.4): 500 itens, o limite da
    // importação, numa proposta própria; e 501, que tem de ser recusado.
    // ------------------------------------------------------------
    {
      const pc = await chamar('createProposta', [{
        ...base, numero: `${NUMERO}-CARGA`, valor_total: 0, desconto: 0, pct_sinal: null, pct_fd: null,
      }], { rota: '/propostas/nova' })
      propostaCargaId = pc.id ?? null
      if (propostaCargaId) {
        const linhaCarga = (n) => ({ numero: n, tipo: 'Carga', descricao: `item ${n}`, linha: null, acabamento: null,
          largura: null, altura: null, quantidade: 1, unidade: 'QTD', valor_unit: 10,
          localizacao: null, vidros: null, observacao: null })
        const demais = await chamar('importarItens', [propostaCargaId, Array.from({ length: 501 }, (_, i) => linhaCarga(i + 1)), 0],
          { rota: `/propostas/${propostaCargaId}` })
        checar('501 linhas são recusadas pelo limite', demais.ok === false && /até 500/.test(demais.error ?? ''), demais.error)

        const t0 = Date.now()
        const cheio = await chamar('importarItens', [propostaCargaId, Array.from({ length: 500 }, (_, i) => linhaCarga(i + 1)), 0],
          { rota: `/propostas/${propostaCargaId}` })
        const ms = Date.now() - t0
        const { data: vCarga } = await supabase.from('propostas').select('valor_total').eq('id', propostaCargaId).single()
        checar(`500 linhas entram numa importação só (${ms} ms), e o valor vira a soma (5000)`,
          cheio.ok && cheio.importados === 500 && Number(vCarga?.valor_total) === 5000,
          `${cheio.error ?? ''} · importados=${cheio.importados} valor=${vCarga?.valor_total}`)
        console.log(`  medida importação de 500 itens: ${ms} ms`)
      }
    }

    // ------------------------------------------------------------
    // 5m. Duplicar, reordenar e lote (bloco 5.7), numa proposta própria.
    // ------------------------------------------------------------
    {
      const p57 = await chamar('createProposta', [{
        ...base, numero: `${NUMERO}-57`, valor_total: 0, desconto: 0, pct_sinal: null, pct_fd: null,
      }], { rota: '/propostas/nova' })
      proposta57Id = p57.id ?? null
      if (proposta57Id) {
        const r57 = `/propostas/${proposta57Id}`
        const l57 = (n, vu, extra = {}) => ({ numero: n, tipo: `T${n ?? 'x'}`, descricao: `5.7 item ${n ?? 'sem número'}`,
          linha: null, acabamento: null, largura: 1, altura: 2, quantidade: 1, unidade: 'M2', valor_unit: vu,
          localizacao: `Loc ${n}`, vidros: null, observacao: `Obs ${n}`, ...extra })
        // A importação NUMERA sozinha quem vem sem número (regra do 5.4). O item
        // sem número de verdade tem de entrar pelo createItem.
        await chamar('importarItens', [proposta57Id, [l57(1, 100), l57(2, 33.33), l57(3, 10)], 0], { rota: r57 })
        await chamar('createItem', [proposta57Id, l57(null, null)], { rota: r57 })
        const ler57 = async () => (await supabase.from('itens')
          .select('id, numero, tipo, valor_unit, valor_total, observacao, localizacao, foto_url')
          .eq('proposta_id', proposta57Id).order('numero', { ascending: true, nullsFirst: false })).data ?? []
        const valor57 = async () => Number((await supabase.from('propostas').select('valor_total').eq('id', proposta57Id).single()).data?.valor_total)
        let itens57 = await ler57()
        const porTipo = (t) => itens57.find((i) => i.tipo === t)

        // Duplicar
        const dup = await chamar('duplicarItem', [proposta57Id, porTipo('T2').id], { rota: r57 })
        itens57 = await ler57()
        checar('duplicar copia os campos e dá o próximo número (4, depois do maior)',
          dup.ok && dup.item.numero === 4 && dup.item.tipo === 'T2' && dup.item.observacao === 'Obs 2' &&
            dup.item.localizacao === 'Loc 2' && Number(dup.item.valor_unit) === 33.33,
          JSON.stringify({ ok: dup.ok, n: dup.item?.numero, tipo: dup.item?.tipo, obs: dup.item?.observacao, erro: dup.error }))
        checar('duplicar não copia a foto (o arquivo é de um item só)', dup.ok && dup.item.foto_url === null)

        // Reordenar
        const sobe = await chamar('moverItem', [proposta57Id, porTipo('T3').id, 'subir'], { rota: r57 })
        itens57 = await ler57()
        checar('subir troca o número com o vizinho (T3 vira 2, T2 vira 3)',
          sobe.ok && porTipo('T3').numero === 2 && porTipo('T2').numero === 3,
          `${sobe.error ?? ''} · ${itens57.map((i) => `${i.tipo}=${i.numero}`).join(' ')}`)
        const topo = await chamar('moverItem', [proposta57Id, porTipo('T1').id, 'subir'], { rota: r57 })
        checar('o primeiro não sobe', topo.ok === false && /primeiro/.test(topo.error ?? ''), topo.error)
        const semNum = await chamar('moverItem', [proposta57Id, porTipo('Tx').id, 'descer'], { rota: r57 })
        checar('item sem número não se move, com mensagem própria', semNum.ok === false && /sem número/.test(semNum.error ?? ''), semNum.error)

        // Duas trocas simultâneas sobre o mesmo par: a trava da função
        // serializa, e nenhum item pode ficar sem número no meio do caminho.
        const [m1, m2] = await Promise.all([
          chamar('moverItem', [proposta57Id, porTipo('T3').id, 'descer'], { rota: r57 }),
          chamar('moverItem', [proposta57Id, porTipo('T2').id, 'subir'], { rota: r57 }),
        ])
        itens57 = await ler57()
        const numeros = itens57.filter((i) => i.tipo !== 'Tx').map((i) => i.numero).sort((a, b) => a - b)
        checar('2 reordenações simultâneas: nenhum número perdido nem repetido',
          JSON.stringify(numeros) === JSON.stringify([1, 2, 3, 4]),
          `${m1.error ?? 'ok'} | ${m2.error ?? 'ok'} · números=${numeros.join(',')}`)

        // Ajuste em lote
        const idsAjuste = [porTipo('T1').id, porTipo('T2').id, porTipo('Tx').id]
        const aj = await chamar('ajustarValorEmLote', [proposta57Id, idsAjuste, 5], { rota: r57 })
        itens57 = await ler57()
        checar('ajuste de +5% muda só os com valor (2 de 3), com centavos arredondados',
          aj.ok && aj.afetados === 2 && Number(porTipo('T1').valor_unit) === 105 && Number(porTipo('T2').valor_unit) === 35,
          `${aj.error ?? ''} · afetados=${aj.afetados} T1=${porTipo('T1').valor_unit} T2=${porTipo('T2').valor_unit}`)
        const somaAj = itens57.reduce((a, i) => a + Number(i.valor_total ?? 0), 0)
        checar('o valor da proposta acompanha o ajuste (trigger do 5.6)',
          Math.abs((await valor57()) - somaAj) < 0.005, `valor=${await valor57()} soma=${somaAj}`)
        const ajRuim = await chamar('ajustarValorEmLote', [proposta57Id, idsAjuste, -100], { rota: r57 })
        checar('ajuste de -100% é recusado', ajRuim.ok === false && /-100%/.test(ajRuim.error ?? ''), ajRuim.error)

        const { data: alheio } = await supabase.from('itens').select('id, valor_unit')
          .eq('proposta_id', outraProposta?.id).not('valor_unit', 'is', null).limit(1).single()
        const ajAlheio = await chamar('ajustarValorEmLote', [proposta57Id, [alheio?.id], 50], { rota: r57 })
        const { data: alheioDepois } = await supabase.from('itens').select('valor_unit').eq('id', alheio?.id).single()
        checar('ajuste com id de OUTRA proposta não toca o item alheio',
          ajAlheio.ok === false && Number(alheioDepois?.valor_unit) === Number(alheio?.valor_unit),
          `${ajAlheio.error} · antes=${alheio?.valor_unit} depois=${alheioDepois?.valor_unit}`)

        // A função é exposta pelo PostgREST: chamá-la direto, sem a action,
        // como visualizador, não pode mudar nada.
        const visSb = await (async () => {
          const { createClient } = await import('@supabase/supabase-js')
          const c = createClient(URL_SUPABASE, ANON)
          const s = await sessaoDePerfil('visualizador')
          await c.auth.setSession({ access_token: s.session.access_token, refresh_token: s.session.refresh_token })
          return c
        })()
        const direto = await visSb.rpc('ajustar_valor_itens', { p_proposta: proposta57Id, p_itens: idsAjuste, p_percentual: 50 })
        const { data: t1Depois } = await supabase.from('itens').select('valor_unit').eq('id', porTipo('T1').id).single()
        checar('visualizador chamando a função direto no banco não muda nenhum valor (RLS)',
          Number(t1Depois?.valor_unit) === 105, `rpc=${JSON.stringify(direto.data ?? direto.error?.message)} T1=${t1Depois?.valor_unit}`)

        // Exclusão em lote
        const sessaoCom57 = await sessaoDePerfil('comercial')
        const lotCom = await chamar('excluirItensEmLote', [proposta57Id, [porTipo('T1').id]], {
          cookie: cookieDeSessao(sessaoCom57.session), rota: r57 })
        checar('comercial não exclui em lote', lotCom.ok === false && /permissão/i.test(lotCom.error ?? ''), lotCom.error)
        const lot = await chamar('excluirItensEmLote', [proposta57Id, [porTipo('T1').id, dup.item?.id, alheio?.id]], { rota: r57 })
        itens57 = await ler57()
        const { count: alheioExiste } = await supabase.from('itens').select('id', { count: 'exact', head: true }).eq('id', alheio?.id)
        checar('exclusão em lote apaga só os desta proposta (2), e o alheio fica',
          lot.ok && lot.afetados === 2 && itens57.length === 3 && alheioExiste === 1,
          `${lot.error ?? ''} · afetados=${lot.afetados} restam=${itens57.length} alheio=${alheioExiste}`)
      }
    }

    // ------------------------------------------------------------
    // 5n. Matriz de perfis (bloco 5.8): cada ação de item, em cada perfil.
    // Regra esperada, a mesma do RLS de `itens`: admin tudo; comercial tudo
    // menos excluir; financeiro, medição, produção e visualizador, nada.
    // ------------------------------------------------------------
    {
      const pp = await chamar('createProposta', [{
        ...base, numero: `${NUMERO}-PERFIS`, valor_total: 0, desconto: 0, pct_sinal: null, pct_fd: null,
      }], { rota: '/propostas/nova' })
      propostaPerfisId = pp.id ?? null
      if (propostaPerfisId) {
        const rp = `/propostas/${propostaPerfisId}`
        const lp = (n) => ({ numero: n, tipo: 'Perfil', descricao: `perfis ${n}`, linha: null, acabamento: null,
          largura: null, altura: null, quantidade: 1, unidade: 'QTD', valor_unit: 10,
          localizacao: null, vidros: null, observacao: null })
        // Números espaçados de 10 em 10: o duplicar pega `maior + 1`, e com
        // números seguidos a cópia colidia com o item seguinte do teste.
        let seq = 1000
        const novoItem = async () => {
          seq += 10
          const r = await chamar('createItem', [propostaPerfisId, lp(seq)], { rota: rp })
          return r.item
        }
        const PERFIS = ['admin', 'comercial', 'financeiro', 'medicao', 'producao', 'visualizador']
        const PODE = {
          createItem: ['admin', 'comercial'], updateItem: ['admin', 'comercial'],
          duplicarItem: ['admin', 'comercial'], moverItem: ['admin', 'comercial'],
          ajustarValorEmLote: ['admin', 'comercial'], importarItens: ['admin', 'comercial'],
          deleteItem: ['admin'], excluirItensEmLote: ['admin'],
        }
        for (const perfil of PERFIS) {
          const cookie = perfil === 'admin' ? admin.cookie : cookieDeSessao((await sessaoDePerfil(perfil)).session)
          const a = await novoItem()
          const b = await novoItem()
          const alvos = {
            createItem: [propostaPerfisId, lp(null)],
            updateItem: [propostaPerfisId, a.id, { ...lp(a.numero), descricao: `editado por ${perfil}` }],
            duplicarItem: [propostaPerfisId, a.id],
            moverItem: [propostaPerfisId, b.id, 'subir'],
            ajustarValorEmLote: [propostaPerfisId, [a.id], 1],
            importarItens: [propostaPerfisId, [lp(null)], 0],
            deleteItem: [propostaPerfisId, a.id],
            excluirItensEmLote: [propostaPerfisId, [b.id]],
          }
          const erradas = []
          for (const [acao, args] of Object.entries(alvos)) {
            const r = await chamar(acao, args, { cookie, rota: rp })
            const deveriaPoder = PODE[acao].includes(perfil)
            if (deveriaPoder && !r.ok) erradas.push(`${acao} recusou: ${r.error}`)
            if (!deveriaPoder && r.ok) erradas.push(`${acao} PASSOU sem permissão`)
            if (!deveriaPoder && !r.ok && !/permissão/i.test(r.error ?? '')) erradas.push(`${acao} recusou pelo motivo errado: ${r.error}`)
          }
          checar(`perfil ${perfil}: as 8 ações de item obedecem à regra`, erradas.length === 0, erradas.join(' | '))
        }
      }
    }

    // 5c. Perfis nas actions de ITEM. As três checagens de perfil que já
    // existiam são das actions de proposta — as de item nunca tinham sido
    // exercitadas com outra sessão. A proposta ainda é rascunho aqui.
    {
      const sessaoCom = await sessaoDePerfil('comercial')
      const com = { cookie: cookieDeSessao(sessaoCom.session) }

      const criarComoCom = await chamar('createItem', [propostaId, {
        numero: 20, tipo: 'Teste comercial', descricao: 'Comercial pode criar item',
        linha: null, acabamento: null, largura: null, altura: null,
        quantidade: 1, unidade: 'QTD', valor_unit: 15,
      }], { cookie: com.cookie, rota: `/propostas/${propostaId}` })
      checar('comercial CRIA item', criarComoCom.ok === true, criarComoCom.error)
      if (criarComoCom.ok) itensCriados.push(criarComoCom.item.id)

      if (criarComoCom.ok) {
        const editarComoCom = await chamar('updateItem', [propostaId, criarComoCom.item.id, {
          numero: 20, tipo: 'Teste comercial', descricao: 'Editado por comercial',
          linha: null, acabamento: null, largura: null, altura: null,
          quantidade: 2, unidade: 'QTD', valor_unit: 15,
        }, criarComoCom.item.updated_at], { cookie: com.cookie, rota: `/propostas/${propostaId}` })
        checar('comercial EDITA item', editarComoCom.ok === true, editarComoCom.error)

        // Lock otimista: repetir com o updated_at JÁ CONSUMIDO tem de ser
        // recusado, não sobrescrever em silêncio.
        const conflito = await chamar('updateItem', [propostaId, criarComoCom.item.id, {
          numero: 20, tipo: 'Teste comercial', descricao: 'Gravação concorrente',
          linha: null, acabamento: null, largura: null, altura: null,
          quantidade: 99, unidade: 'QTD', valor_unit: 15,
        }, criarComoCom.item.updated_at], { rota: `/propostas/${propostaId}` })
        checar(
          'updated_at velho é recusado (lock otimista)',
          conflito.ok === false && /outra pessoa/i.test(conflito.error ?? ''),
          conflito.error,
        )

        // E o valor da gravação recusada NÃO entrou no banco.
        const { data: naoMudou } = await supabase
          .from('itens')
          .select('quantidade')
          .eq('id', criarComoCom.item.id)
          .maybeSingle()
        checar(
          'a gravação recusada não alterou a linha',
          Number(naoMudou?.quantidade) === 2,
          `quantidade=${naoMudou?.quantidade}`,
        )
      }

      const sessaoVisItem = await sessaoDePerfil('visualizador')
      const visItem = { cookie: cookieDeSessao(sessaoVisItem.session) }

      const criarComoVisItem = await chamar('createItem', [propostaId, {
        numero: 21, tipo: null, descricao: 'Visualizador não deve criar',
        linha: null, acabamento: null, largura: null, altura: null,
        quantidade: 1, unidade: 'QTD', valor_unit: 10,
      }], { cookie: visItem.cookie, rota: `/propostas/${propostaId}` })
      checar(
        'visualizador não cria item',
        criarComoVisItem.ok === false && /permissão/i.test(criarComoVisItem.error ?? ''),
        criarComoVisItem.error,
      )
      if (criarComoVisItem.ok) itensCriados.push(criarComoVisItem.item.id)

      if (criarComoCom.ok) {
        const editarComoVis = await chamar('updateItem', [propostaId, criarComoCom.item.id, {
          numero: 20, tipo: null, descricao: 'Visualizador não deve editar',
          linha: null, acabamento: null, largura: null, altura: null,
          quantidade: 1, unidade: 'QTD', valor_unit: 10,
        }], { cookie: visItem.cookie, rota: `/propostas/${propostaId}` })
        checar(
          'visualizador não edita item',
          editarComoVis.ok === false && /permissão/i.test(editarComoVis.error ?? ''),
          editarComoVis.error,
        )

        const excluirComoVis = await chamar('deleteItem', [propostaId, criarComoCom.item.id], {
          cookie: visItem.cookie, rota: `/propostas/${propostaId}`,
        })
        checar(
          'visualizador não exclui item',
          excluirComoVis.ok === false && /permissão/i.test(excluirComoVis.error ?? ''),
          excluirComoVis.error,
        )

        const importarComoVis = await chamar('importarItens', [propostaId, [
          { numero: 70, tipo: null, descricao: 'Visualizador não importa', linha: null,
            acabamento: null, largura: null, altura: null, quantidade: 1,
            unidade: 'QTD', valor_unit: 10, localizacao: null, vidros: null, observacao: null },
        ], 0], { cookie: visItem.cookie, rota: `/propostas/${propostaId}` })
        checar(
          'visualizador não importa planilha',
          importarComoVis.ok === false && /permissão/i.test(importarComoVis.error ?? ''),
          importarComoVis.error,
        )
      }
    }

    // 5d. Entrada inválida recusada ANTES do banco (validarEntradaItem)
    const numeroQuebrado = await chamar('createItem', [propostaId, {
      numero: 1.5, tipo: null, descricao: 'Número não inteiro', linha: null,
      acabamento: null, largura: null, altura: null, quantidade: 1,
      unidade: 'QTD', valor_unit: 10,
    }], { rota: `/propostas/${propostaId}` })
    checar(
      'número não inteiro é recusado pela action',
      numeroQuebrado.ok === false && /inteiro/i.test(numeroQuebrado.error ?? ''),
      numeroQuebrado.error,
    )
    if (numeroQuebrado.ok) itensCriados.push(numeroQuebrado.item.id)

    const negativo = await chamar('createItem', [propostaId, {
      numero: 22, tipo: null, descricao: 'Quantidade negativa', linha: null,
      acabamento: null, largura: null, altura: null, quantidade: -5,
      unidade: 'QTD', valor_unit: 10,
    }], { rota: `/propostas/${propostaId}` })
    checar(
      'quantidade negativa é recusada pela action',
      negativo.ok === false && /negativa/i.test(negativo.error ?? ''),
      negativo.error,
    )
    if (negativo.ok) itensCriados.push(negativo.item.id)

    // 6. rascunho → enviada
    const hoje = new Date().toISOString().slice(0, 10)
    const enviada = await chamar('changePropostaStatus', [
      propostaId,
      { novo_status: 'enviada', data_envio: hoje, data_decisao: null, motivo_rejeicao: null, detalhe_rejeicao: null },
    ], { rota: `/propostas/${propostaId}` })
    checar('changePropostaStatus leva rascunho → enviada', enviada.ok === true, enviada.error)

    // 6b. Item fora de rascunho: mesma regra do botão Editar
    const itemForaDeRascunho = await chamar('createItem', [propostaId, {
      numero: 9, tipo: null, descricao: 'Não deve entrar', linha: null,
      acabamento: null, largura: null, altura: null, quantidade: 1,
      unidade: 'QTD', valor_unit: 10,
    }], { rota: `/propostas/${propostaId}` })
    checar(
      'criar item em proposta enviada é recusado',
      itemForaDeRascunho.ok === false,
      itemForaDeRascunho.error,
    )
    if (itemForaDeRascunho.ok) itensCriados.push(itemForaDeRascunho.item.id)

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

    // 12c. Pendências da sprint 6: o path vem do corpo, e o Storage só deixa
    // o admin ou quem subiu apagar. Nos dois casos o anexo tem de ficar.
    const alheio = await chamar('deleteAnexo', [propostaId, `${perfilAdmin?.empresa_id}/contratos/x/1_outro.pdf`], {
      rota: `/propostas/${propostaId}`,
    })
    checar('deleteAnexo recusa path que não é anexo da proposta',
      alheio.ok === false && /não encontrado/.test(alheio.error ?? ''), alheio.error)
    const cookieCom12 = cookieDeSessao((await sessaoDePerfil('comercial')).session)
    const doAdmin = await chamar('deleteAnexo', [propostaId, path], { rota: `/propostas/${propostaId}`, cookie: cookieCom12 })
    const { data: aindaNaProposta } = await supabase.from('propostas').select('anexos').eq('id', propostaId).maybeSingle()
    const { data: aindaNoBucket } = await supabase.storage.from('anexos').list(`${perfilAdmin?.empresa_id}/propostas/${propostaId}`)
    checar('comercial não apaga o anexo que o admin subiu: fica no jsonb e no bucket',
      doAdmin.ok === false && /admin ou quem enviou/.test(doAdmin.error ?? '') &&
        (aindaNaProposta?.anexos ?? []).length === 1 && (aindaNoBucket ?? []).length === 1,
      `${doAdmin.error ?? 'passou'} · jsonb=${(aindaNaProposta?.anexos ?? []).length} bucket=${(aindaNoBucket ?? []).length}`)

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

      // Pendências da sprint 6 no orçamento: anexo e corrida de status.
      const ro = `/orcamentos/${orcamentoId}`
      const { data: perfilOrc } = await supabase.from('profiles').select('empresa_id').eq('id', admin.userId).maybeSingle()
      const pdfOrc = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34])], 'orcamento.pdf', { type: 'application/pdf' })
      const upOrc = await chamarComArquivo('uploadAnexoOrcamento', orcamentoId, pdfOrc)
      const anexosOrc = (await supabase.from('orcamentos').select('anexos').eq('id', orcamentoId).maybeSingle()).data?.anexos ?? []
      const pathOrc = anexosOrc[0]?.path ?? ''
      checar('uploadAnexoOrcamento sobe o arquivo em {empresa}/orcamentos/{id}/',
        upOrc.ok === true && anexosOrc.length === 1 && pathOrc.startsWith(`${perfilOrc?.empresa_id}/orcamentos/${orcamentoId}/`),
        `${upOrc.error ?? ''} · ${pathOrc}`)
      const alheioOrc = await chamar('deleteAnexoOrcamento', [orcamentoId, `${perfilOrc?.empresa_id}/propostas/x/1_outro.pdf`], { rota: ro })
      checar('deleteAnexoOrcamento recusa path que não é anexo do orçamento',
        alheioOrc.ok === false && /não encontrado/.test(alheioOrc.error ?? ''), alheioOrc.error)
      const cookieComOrc = cookieDeSessao((await sessaoDePerfil('comercial')).session)
      const doAdminOrc = await chamar('deleteAnexoOrcamento', [orcamentoId, pathOrc], { rota: ro, cookie: cookieComOrc })
      const { data: noBucketOrc } = await supabase.storage.from('anexos').list(`${perfilOrc?.empresa_id}/orcamentos/${orcamentoId}`)
      checar('comercial não apaga o anexo do orçamento que o admin subiu: fica no jsonb e no bucket',
        doAdminOrc.ok === false && /admin ou quem enviou/.test(doAdminOrc.error ?? '') &&
          ((await supabase.from('orcamentos').select('anexos').eq('id', orcamentoId).maybeSingle()).data?.anexos ?? []).length === 1 &&
          (noBucketOrc ?? []).length === 1,
        doAdminOrc.error ?? 'passou')
      const rmOrc = await chamar('deleteAnexoOrcamento', [orcamentoId, pathOrc], { rota: ro })
      const { data: noBucketOrc2 } = await supabase.storage.from('anexos').list(`${perfilOrc?.empresa_id}/orcamentos/${orcamentoId}`)
      checar('deleteAnexoOrcamento remove do bucket e do jsonb', rmOrc.ok === true && (noBucketOrc2 ?? []).length === 0, rmOrc.error)

      // Corrida: o orçamento não tem regra de transição, então, serializadas,
      // as duas passam. O invariante é o mesmo das outras entidades: uma
      // entrada por mudança que venceu, e a última batendo com o status.
      const orcPara = (novo_status) => chamar('changeOrcamentoStatus', [orcamentoId, {
        novo_status, data_envio: hoje, data_decisao: null, motivo_rejeicao: null, detalhe_rejeicao: null,
        obra_id_vinculada: null, vincular_obra: false,
      }], { rota: ro })
      const [o1, o2] = await Promise.all([orcPara('pendente'), orcPara('enviado')])
      const { data: orcDepois } = await supabase.from('orcamentos').select('status, historico').eq('id', orcamentoId).maybeSingle()
      const venceramOrc = [o1, o2].filter((r) => r.ok).length
      orcCorridaVenceram = venceramOrc
      const perdedoraOrc = [o1, o2].find((r) => !r.ok)
      checar('orçamento: mudanças simultâneas não perdem entrada do histórico',
        venceramOrc >= 1 && orcDepois?.historico?.length === 2 + venceramOrc &&
          orcDepois.historico.at(-1)?.para === orcDepois.status &&
          (!perdedoraOrc || /mudou enquanto/.test(perdedoraOrc.error ?? '')),
        `ok=${venceramOrc} · ${perdedoraOrc?.error ?? ''} · ${JSON.stringify(orcDepois?.historico?.map((h) => h.para) ?? null)}`)
    }
  }
  // ============================================================
  // Bloco 6.2 — gerar contrato a partir de proposta aprovada
  // ============================================================
  // A action chama a função gerar_contrato_de_proposta (20260923162000), que
  // insere o contrato e copia os itens numa transação. Os passos provam as
  // regras da função (aprovada, duplicado sem confirmação, rescindido não
  // conta) e as da action (perfil), e que falha não deixa nada pela metade.
  {
    const p62 = await chamar('createProposta', [{
      ...base, numero: `${NUMERO}-62`, valor_total: 100, desconto: 100, pct_sinal: 0.3, pct_fd: 0.7,
    }], { rota: '/propostas/nova' })
    proposta62Id = p62.id ?? null
    checar('6.2: proposta de teste criada', p62.ok === true, p62.error)

    if (proposta62Id) {
      const r62 = `/propostas/${proposta62Id}`
      const rg = `${r62}/gerar-contrato`
      const it62 = (n, qtd, vu) => ({ numero: n, tipo: 'Janela', descricao: `6.2 item ${n}`, linha: 'L', acabamento: 'A',
        largura: 1.2, altura: 1, quantidade: qtd, unidade: 'M2', valor_unit: vu, localizacao: 'Térreo', vidros: '6mm', observacao: 'obs' })
      await chamar('createItem', [proposta62Id, it62(1, 2, 300)], { rota: r62 })
      await chamar('createItem', [proposta62Id, it62(2, 1, 50)], { rota: r62 })

      const ct = (numero, extra = {}) => ({
        numero, obra_id: obra.id, data_assinatura: new Date().toISOString().slice(0, 10),
        prazo_execucao: '45 dias', descricao: 'Contrato gerado pela camada de escrita', valor_total: 650,
        desconto: 100, pct_sinal: 0.3, pct_fd: 0.7, pct_entrega_material: null, pct_medicao_instalacao: null,
        condicoes_pagamento: 'condições da proposta', observacao: null, ...extra,
      })
      const gerar = (numero, opcoes, extra, cookie) =>
        chamar('gerarContratoDeProposta', [proposta62Id, ct(numero, extra), opcoes], { rota: rg, ...(cookie ? { cookie } : {}) })
      const contratosDaProposta = async () =>
        (await supabase.from('contratos').select('id, numero, status, valor_total, desconto, valor_final, obra_id, proposta_origem_id, pct_sinal, pct_fd, prazo_execucao')
          .eq('proposta_origem_id', proposta62Id).order('numero')).data ?? []
      const lembrar = async () => {
        for (const c of await contratosDaProposta()) if (!contratos62.includes(c.id)) contratos62.push(c.id)
      }

      const emRascunho = await gerar(`${NUMERO}-CT0`, { copiarItens: true, confirmarDuplicado: false })
      checar('6.2: proposta em rascunho não gera contrato', emRascunho.ok === false && /aprovada/.test(emRascunho.error ?? ''), emRascunho.error)

      const hoje62 = new Date().toISOString().slice(0, 10)
      await chamar('changePropostaStatus', [proposta62Id,
        { novo_status: 'enviada', data_envio: hoje62, data_decisao: null, motivo_rejeicao: null, detalhe_rejeicao: null }], { rota: r62 })
      const ap = await chamar('changePropostaStatus', [proposta62Id,
        { novo_status: 'aprovada', data_envio: hoje62, data_decisao: hoje62, motivo_rejeicao: null, detalhe_rejeicao: null }], { rota: r62 })
      checar('6.2: proposta aprovada', ap.ok === true, ap.error)

      const cookieVis = cookieDeSessao((await sessaoDePerfil('visualizador')).session)
      const comoVis = await gerar(`${NUMERO}-CTV`, { copiarItens: true, confirmarDuplicado: false }, {}, cookieVis)
      checar('6.2: visualizador não gera contrato (guard da action)', comoVis.ok === false && /permissão/.test(comoVis.error ?? ''), comoVis.error)

      // A função é exposta pelo PostgREST: direto, sem a action, o RLS barra.
      const visSb = createClient(URL_SUPABASE, ANON)
      const sv = await sessaoDePerfil('visualizador')
      await visSb.auth.setSession({ access_token: sv.session.access_token, refresh_token: sv.session.refresh_token })
      const direto = await visSb.rpc('gerar_contrato_de_proposta', {
        p_proposta: proposta62Id, p_contrato: { numero: `${NUMERO}-CTVD` }, p_copiar_itens: true, p_confirmar_duplicado: true,
      })
      checar('6.2: visualizador chamando a função direto no banco não cria contrato (RLS)',
        Boolean(direto.error) && (await contratosDaProposta()).length === 0, direto.error?.message ?? `criou ${direto.data}`)

      const g1 = await gerar(`${NUMERO}-CT1`, { copiarItens: true, confirmarDuplicado: false })
      await lembrar()
      checar('6.2: admin gera o contrato com cópia dos itens', g1.ok === true, g1.error)
      const [c1] = await contratosDaProposta()
      checar('6.2: contrato ativo, da obra da proposta, com proposta_origem_id',
        c1?.status === 'ativo' && c1?.obra_id === obra.id && c1?.proposta_origem_id === proposta62Id, JSON.stringify(c1 ?? null))
      checar('6.2: valor = soma dos itens (650), desconto 100, final 550, pct e prazo do form',
        Number(c1?.valor_total) === 650 && Number(c1?.desconto) === 100 && Number(c1?.valor_final) === 550 &&
          Number(c1?.pct_sinal) === 0.3 && Number(c1?.pct_fd) === 0.7 && c1?.prazo_execucao === '45 dias',
        JSON.stringify(c1 ?? null))

      const campos = 'numero, tipo, descricao, linha, acabamento, largura, altura, quantidade, unidade, valor_unit, localizacao, vidros, observacao, proposta_id, contrato_id, foto_url'
      const { data: itensC1 } = await supabase.from('itens').select(campos).eq('contrato_id', c1?.id ?? '').order('numero')
      const { data: itensP } = await supabase.from('itens').select(campos).eq('proposta_id', proposta62Id).order('numero')
      const semVinculo = (l) => (l ?? []).map(({ proposta_id, contrato_id, foto_url, ...resto }) => resto)
      checar('6.2: os 2 itens foram copiados com todos os campos',
        (itensC1 ?? []).length === 2 && JSON.stringify(semVinculo(itensC1)) === JSON.stringify(semVinculo(itensP)),
        JSON.stringify(semVinculo(itensC1)).slice(0, 200))
      checar('6.2: XOR — a cópia só tem contrato_id, e a proposta continua com os itens dela',
        (itensC1 ?? []).every((i) => i.proposta_id === null && i.contrato_id === c1?.id) && (itensP ?? []).length === 2,
        `proposta tem ${(itensP ?? []).length}`)

      const dup = await gerar(`${NUMERO}-CT2`, { copiarItens: true, confirmarDuplicado: false })
      checar('6.2: segundo contrato sem confirmação é recusado e devolve o número do existente',
        dup.ok === false && (dup.contratosExistentes ?? []).includes(`${NUMERO}-CT1`) && (await contratosDaProposta()).length === 1,
        JSON.stringify(dup))

      const semDesconto = await gerar(`${NUMERO}-CT2`, { copiarItens: true, confirmarDuplicado: true }, { desconto: 5000 })
      await lembrar()
      const { count: itensTotais } = await supabase.from('itens').select('id', { count: 'exact', head: true }).in('contrato_id', contratos62)
      checar('6.2: desconto acima da soma dos itens é recusado, sem contrato nem item pela metade',
        semDesconto.ok === false && /desconto/i.test(semDesconto.error ?? '') && (await contratosDaProposta()).length === 1 && itensTotais === 2,
        `${semDesconto.error} · contratos=${(await contratosDaProposta()).length} itens=${itensTotais}`)

      const numRepetido = await gerar(`${NUMERO}-CT1`, { copiarItens: false, confirmarDuplicado: true })
      checar('6.2: número de contrato repetido é recusado com mensagem legível',
        numRepetido.ok === false && /Já existe um contrato com esse número/.test(numRepetido.error ?? ''), numRepetido.error)

      const g2 = await gerar(`${NUMERO}-CT2`, { copiarItens: false, confirmarDuplicado: true }, { valor_total: 700, desconto: 0 })
      await lembrar()
      const c2 = (await contratosDaProposta()).find((c) => c.numero === `${NUMERO}-CT2`)
      const { count: itensC2 } = await supabase.from('itens').select('id', { count: 'exact', head: true }).eq('contrato_id', c2?.id ?? '')
      checar('6.2: com confirmação, gera o segundo — sem cópia, valor digitado (700) e nenhum item',
        g2.ok === true && Number(c2?.valor_total) === 700 && itensC2 === 0, `${g2.error ?? ''} · ${JSON.stringify(c2 ?? null)} itens=${itensC2}`)

      // Rescindido não conta como vigente: depois de rescindir os dois,
      // gerar de novo não pede confirmação. Rescisão direto no banco — a tela
      // de status é do 6.5.
      await supabase.from('contratos').update({ status: 'rescindido', motivo_rescisao: 'acordo_partes' }).in('id', contratos62)
      const cookieCom = cookieDeSessao((await sessaoDePerfil('comercial')).session)
      const g3 = await gerar(`${NUMERO}-CT3`, { copiarItens: true, confirmarDuplicado: false }, {}, cookieCom)
      await lembrar()
      checar('6.2: com os anteriores rescindidos, comercial gera sem confirmação',
        g3.ok === true && (await contratosDaProposta()).length === 3, g3.error)
    }
  }

  // ============================================================
  // Bloco 6.3 — contrato avulso (createContrato)
  // ============================================================
  // A action repete a regra do zod do form (validarPayloadContrato), porque
  // o zod só roda no navegador. Todos os contratos levam `${NUMERO}-AV` no
  // número e saem no finally.
  {
    const rn = '/contratos/novo'
    const av = (sufixo, extra = {}) => ({
      numero: `${NUMERO}-AV${sufixo}`, obra_id: obra.id, descricao: 'Contrato avulso da camada de escrita',
      data_assinatura: new Date().toISOString().slice(0, 10), prazo_execucao: '30 dias',
      valor_total: 2000, desconto: 200, pct_sinal: 0.4, pct_fd: 0.6, pct_entrega_material: null,
      pct_medicao_instalacao: null, condicoes_pagamento: 'boleto', observacao: 'obs avulso', ...extra,
    })
    const doBanco = async (numero) =>
      (await supabase.from('contratos').select('id, numero, status, proposta_origem_id, obra_id, valor_total, desconto, valor_final, pct_sinal, pct_fd, prazo_execucao, condicoes_pagamento, historico, created_by')
        .eq('numero', numero).maybeSingle()).data
    const existe = async (numero) =>
      (await supabase.from('contratos').select('id', { count: 'exact', head: true }).eq('numero', numero)).count

    const c1 = await chamar('createContrato', [av('1')], { rota: rn })
    const b1 = await doBanco(`${NUMERO}-AV1`)
    checar('6.3: admin cria contrato avulso', c1.ok === true && Boolean(b1), c1.error)
    checar('6.3: nasce ativo, sem proposta de origem, histórico vazio e com o autor',
      b1?.status === 'ativo' && b1?.proposta_origem_id === null && Array.isArray(b1?.historico) && b1.historico.length === 0 &&
        b1?.created_by === admin.userId, JSON.stringify(b1 ?? null))
    checar('6.3: valores, desconto, final (1800), % e textos gravados como enviados',
      Number(b1?.valor_total) === 2000 && Number(b1?.desconto) === 200 && Number(b1?.valor_final) === 1800 &&
        Number(b1?.pct_sinal) === 0.4 && Number(b1?.pct_fd) === 0.6 && b1?.prazo_execucao === '30 dias' &&
        b1?.condicoes_pagamento === 'boleto' && b1?.obra_id === obra.id, JSON.stringify(b1 ?? null))

    // Campos que não são do form, mandados no corpo: a action não os repassa.
    const { data: umaProposta } = await supabase.from('propostas').select('id').eq('obra_id', obra.id).limit(1).maybeSingle()
    const c2 = await chamar('createContrato', [av('2', {
      status: 'concluido', proposta_origem_id: umaProposta?.id ?? null, historico: [{ de: 'x' }], empresa_id: '00000000-0000-0000-0000-000000000000',
    })], { rota: rn })
    const b2 = await doBanco(`${NUMERO}-AV2`)
    checar('6.3: status, proposta de origem, histórico e empresa vindos do corpo são ignorados',
      c2.ok === true && b2?.status === 'ativo' && b2?.proposta_origem_id === null && (b2?.historico ?? []).length === 0,
      `${c2.error ?? ''} · ${JSON.stringify(b2 ?? null)}`)

    const recusas = [
      ['desconto maior que o valor', av('X1', { desconto: 2001 }), /Desconto não pode ser maior/],
      ['soma dos percentuais acima de 100%', av('X2', { pct_sinal: 0.5, pct_fd: 0.6 }), /100%/],
      ['percentual isolado acima de 100%', av('X3', { pct_sinal: 1.5, pct_fd: 0 }), /entre 0% e 100%/],
      ['valor negativo', av('X4', { valor_total: -1, desconto: 0 }), /negativo/],
      ['número em branco', av('X5', { numero: '   ' }), /Número obrigatório/],
      ['sem obra', av('X6', { obra_id: '' }), /obra/],
    ]
    for (const [rotulo, payload, esperado] of recusas) {
      const r = await chamar('createContrato', [payload], { rota: rn })
      checar(`6.3: ${rotulo} é recusado pela action, sem gravar`,
        r.ok === false && esperado.test(r.error ?? '') && (await existe(payload.numero)) === 0, r.error)
    }

    const rep1 = await chamar('createContrato', [av('1', { valor_total: 10, desconto: 0 })], { rota: rn })
    checar('6.3: número repetido na empresa é recusado com mensagem legível',
      rep1.ok === false && /Já existe um contrato com esse número/.test(rep1.error ?? ''), rep1.error)

    const cookieVis63 = cookieDeSessao((await sessaoDePerfil('visualizador')).session)
    const vis = await chamar('createContrato', [av('V')], { rota: rn, cookie: cookieVis63 })
    checar('6.3: visualizador não cria contrato',
      vis.ok === false && /permissão/.test(vis.error ?? '') && (await existe(`${NUMERO}-AVV`)) === 0, vis.error)

    const cookieCom63 = cookieDeSessao((await sessaoDePerfil('comercial')).session)
    const com = await chamar('createContrato', [av('C')], { rota: rn, cookie: cookieCom63 })
    checar('6.3: comercial cria contrato avulso', com.ok === true && (await existe(`${NUMERO}-AVC`)) === 1, com.error)
  }

  // ============================================================
  // Bloco 6.4 — edição e anexos do contrato
  // ============================================================
  // O contrato leva `${NUMERO}-AV64` no número, então sai no finally junto dos
  // avulsos do 6.3; o item dele entra em itensCriados, que é apagado antes.
  {
    const cid = await chamar('createContrato', [{
      numero: `${NUMERO}-AV64`, obra_id: obra.id, descricao: 'Contrato do 6.4',
      data_assinatura: null, prazo_execucao: null, valor_total: 5000, desconto: 0,
      pct_sinal: 0.5, pct_fd: null, pct_entrega_material: null, pct_medicao_instalacao: null,
      condicoes_pagamento: null, observacao: null,
    }], { rota: '/contratos/novo' })
    checar('6.4: contrato de teste criado', cid.ok === true, cid.error)
    const id64 = cid.ok ? cid.id : null
    const rc = `/contratos/${id64}`
    const ed = (extra = {}) => ({
      numero: `${NUMERO}-AV64`, obra_id: obra.id, descricao: 'Contrato do 6.4 editado',
      data_assinatura: new Date().toISOString().slice(0, 10), prazo_execucao: '45 dias',
      valor_total: 6000, desconto: 600, pct_sinal: 0.3, pct_fd: 0.7, pct_entrega_material: null,
      pct_medicao_instalacao: null, condicoes_pagamento: 'pix', observacao: 'obs 6.4', ...extra,
    })
    const lido = async () =>
      (await supabase.from('contratos').select('numero, status, proposta_origem_id, obra_id, descricao, prazo_execucao, valor_total, desconto, valor_final, pct_sinal, pct_fd, condicoes_pagamento, historico, anexos')
        .eq('id', id64).maybeSingle()).data

    if (id64) {
      // Edição: os campos do form gravam; status, origem e histórico do corpo não.
      const u1 = await chamar('updateContrato', [id64, ed({ status: 'concluido', proposta_origem_id: proposta62Id, historico: [{ de: 'x' }] })], { rota: `${rc}/editar` })
      const b1 = await lido()
      checar('6.4: admin edita o contrato e os campos do form gravam',
        u1.ok === true && b1?.descricao === 'Contrato do 6.4 editado' && b1?.prazo_execucao === '45 dias' &&
          Number(b1?.valor_total) === 6000 && Number(b1?.desconto) === 600 && Number(b1?.valor_final) === 5400 &&
          Number(b1?.pct_sinal) === 0.3 && Number(b1?.pct_fd) === 0.7 && b1?.condicoes_pagamento === 'pix',
        `${u1.error ?? ''} · ${JSON.stringify(b1 ?? null)}`)
      checar('6.4: status, proposta de origem e histórico vindos do corpo são ignorados',
        b1?.status === 'ativo' && b1?.proposta_origem_id === null && (b1?.historico ?? []).length === 0,
        JSON.stringify(b1 ?? null))

      const recusas = [
        ['desconto maior que o valor', ed({ desconto: 6001 }), /Desconto não pode ser maior/],
        ['soma dos percentuais acima de 100%', ed({ pct_sinal: 0.5, pct_fd: 0.6 }), /100%/],
        ['número em branco', ed({ numero: '  ' }), /Número obrigatório/],
        ['número de outro contrato da empresa', ed({ numero: `${NUMERO}-AV1` }), /Já existe um contrato com esse número/],
      ]
      for (const [rotulo, payload, esperado] of recusas) {
        const r = await chamar('updateContrato', [id64, payload], { rota: `${rc}/editar` })
        const b = await lido()
        checar(`6.4: edição com ${rotulo} é recusada, sem gravar`,
          r.ok === false && esperado.test(r.error ?? '') && b?.numero === `${NUMERO}-AV64` && Number(b?.desconto) === 600,
          r.error)
      }

      const cookieVis64 = cookieDeSessao((await sessaoDePerfil('visualizador')).session)
      const vis = await chamar('updateContrato', [id64, ed({ descricao: 'visualizador' })], { rota: `${rc}/editar`, cookie: cookieVis64 })
      checar('6.4: visualizador não edita contrato',
        vis.ok === false && /permissão/.test(vis.error ?? '') && (await lido())?.descricao === 'Contrato do 6.4 editado', vis.error)

      const cookieCom64 = cookieDeSessao((await sessaoDePerfil('comercial')).session)
      const com = await chamar('updateContrato', [id64, ed({ descricao: 'editado pelo comercial' })], { rota: `${rc}/editar`, cookie: cookieCom64 })
      checar('6.4: comercial edita contrato', com.ok === true && (await lido())?.descricao === 'editado pelo comercial', com.error)

      // Com item: valor total vem da soma dos itens e a obra fica travada.
      const it = await chamar('createItem', [{ tipo: 'contrato', id: id64 }, {
        numero: 1, tipo: 'Janela', descricao: 'Janela do contrato 6.4', linha: 'Suprema',
        acabamento: 'Branco', largura: 1, altura: 1, quantidade: 2, unidade: 'QTD', valor_unit: 1500,
      }], { rota: rc })
      if (it.ok) itensCriados.push(it.item.id)
      checar('6.4: item criado no contrato pela aba Itens', it.ok === true, it.error)
      const vi = await chamar('updateContrato', [id64, ed({ valor_total: 999999, desconto: 0 })], { rota: `${rc}/editar` })
      checar('6.4: com itens, o valor total mandado no corpo dá lugar à soma dos itens (3000)',
        vi.ok === true && Number((await lido())?.valor_total) === 3000, `${vi.error ?? ''} · ${(await lido())?.valor_total}`)
      const { data: outraObra } = await supabase.from('obras').select('id').neq('id', obra.id).limit(1).maybeSingle()
      checar('6.4: gc-dev tem uma segunda obra para o passo da trava', Boolean(outraObra))
      if (outraObra) {
        const tr = await chamar('updateContrato', [id64, ed({ obra_id: outraObra.id, desconto: 0 })], { rota: `${rc}/editar` })
        checar('6.4: com itens, trocar a obra é recusado com mensagem legível',
          tr.ok === false && /tem itens/.test(tr.error ?? '') && (await lido())?.obra_id === obra.id, tr.error)
      }

      // Anexos: sobe, abre pela URL assinada e remove.
      const arquivo = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34])], 'validacao-contrato.pdf', { type: 'application/pdf' })
      const up = await chamarComArquivo('uploadAnexoContrato', id64, arquivo)
      const anexos = (await lido())?.anexos ?? []
      const pathAnexo = anexos[0]?.path ?? ''
      checar('6.4: uploadAnexoContrato sobe o arquivo e grava no jsonb do contrato',
        up.ok === true && anexos.length === 1, `${up.error ?? ''} · anexos=${anexos.length}`)
      const { data: perfil64 } = await supabase.from('profiles').select('empresa_id').eq('id', admin.userId).maybeSingle()
      checar('6.4: path do anexo segue {empresa}/contratos/{id}/...',
        pathAnexo.startsWith(`${perfil64?.empresa_id}/contratos/${id64}/`), pathAnexo)
      const url = await chamar('getAnexoUrl', [pathAnexo], { rota: rc })
      const baixado = url.ok ? await fetch(url.url) : null
      const bytes = baixado ? new Uint8Array(await baixado.arrayBuffer()) : new Uint8Array()
      checar('6.4: a URL assinada baixa o anexo do contrato (%PDF)',
        baixado?.status === 200 && bytes[0] === 0x25 && bytes[1] === 0x50, url.error ?? `HTTP ${baixado?.status}`)

      const upVis = await chamarComArquivo('uploadAnexoContrato', id64, arquivo, { cookie: cookieVis64 })
      checar('6.4: visualizador não anexa arquivo ao contrato',
        upVis.ok === false && /permissão/.test(upVis.error ?? '') && ((await lido())?.anexos ?? []).length === 1, upVis.error)
      const alheio = await chamar('deleteAnexoContrato', [id64, `${perfil64?.empresa_id}/propostas/x/1_outro.pdf`], { rota: rc })
      checar('6.4: deleteAnexoContrato recusa path que não é anexo do contrato',
        alheio.ok === false && /não encontrado/.test(alheio.error ?? ''), alheio.error)
      const cookieCom64b = cookieDeSessao((await sessaoDePerfil('comercial')).session)
      const doAdmin64 = await chamar('deleteAnexoContrato', [id64, pathAnexo], { rota: rc, cookie: cookieCom64b })
      const { data: noBucket64 } = await supabase.storage.from('anexos').list(`${perfil64?.empresa_id}/contratos/${id64}`)
      checar('comercial não apaga o anexo do contrato que o admin subiu: fica no jsonb e no bucket',
        doAdmin64.ok === false && /admin ou quem enviou/.test(doAdmin64.error ?? '') &&
          ((await lido())?.anexos ?? []).length === 1 && (noBucket64 ?? []).length === 1,
        doAdmin64.error ?? 'passou')

      const rm = await chamar('deleteAnexoContrato', [id64, pathAnexo], { rota: rc })
      const { data: noBucket } = await supabase.storage.from('anexos').list(`${perfil64?.empresa_id}/contratos/${id64}`)
      checar('6.4: deleteAnexoContrato remove do bucket e do jsonb',
        rm.ok === true && ((await lido())?.anexos ?? []).length === 0 && (noBucket ?? []).length === 0,
        `${rm.error ?? ''} · bucket=${(noBucket ?? []).length}`)

      // Fora de ativo, a edição é recusada.
      await chamar('changeContratoStatus', [id64, { novo_status: 'suspenso', motivo_rescisao: null, detalhe_rescisao: null }], { rota: rc })
      const sus = await chamar('updateContrato', [id64, ed({ descricao: 'suspenso', desconto: 0 })], { rota: `${rc}/editar` })
      checar('6.4: contrato suspenso não é editável',
        sus.ok === false && /Só contrato ativo/.test(sus.error ?? '') && (await lido())?.descricao !== 'suspenso', sus.error)
    }

    // Contrato gerado de proposta fica na obra dela (FK contratos_proposta_fk).
    const gerado = contratos62.length > 0
      ? (await supabase.from('contratos').select('id, numero, obra_id, status').in('id', contratos62).eq('status', 'ativo').limit(1).maybeSingle()).data
      : null
    checar('6.4: há contrato ativo gerado de proposta (do 6.2) para o passo da obra travada', Boolean(gerado))
    const { data: obraDiferente } = await supabase.from('obras').select('id').neq('id', gerado?.obra_id ?? obra.id).limit(1).maybeSingle()
    if (gerado && obraDiferente) {
      const r = await chamar('updateContrato', [gerado.id, ed({ numero: gerado.numero, obra_id: obraDiferente.id, desconto: 0 })], { rota: `/contratos/${gerado.id}/editar` })
      const depois = (await supabase.from('contratos').select('obra_id').eq('id', gerado.id).maybeSingle()).data
      checar('6.4: contrato gerado de proposta não troca de obra',
        r.ok === false && /obra da proposta de origem/.test(r.error ?? '') && depois?.obra_id === gerado.obra_id, r.error)
    }
  }

  // ============================================================
  // Bloco 6.5 — mudança de status e rescisão (changeContratoStatus)
  // ============================================================
  // Dois contratos `${NUMERO}-AV65A` e `-AV65B`, apagados no finally com os
  // avulsos. A: ativo → suspenso → ativo → rescindido. B: ativo → concluído.
  {
    const novo65 = async (sufixo) => chamar('createContrato', [{
      numero: `${NUMERO}-AV65${sufixo}`, obra_id: obra.id, descricao: 'Contrato do 6.5',
      data_assinatura: null, prazo_execucao: null, valor_total: 1000, desconto: 0,
      pct_sinal: null, pct_fd: null, pct_entrega_material: null, pct_medicao_instalacao: null,
      condicoes_pagamento: null, observacao: null,
    }], { rota: '/contratos/novo' })
    const a = await novo65('A')
    const b65 = await novo65('B')
    checar('6.5: contratos de teste criados', a.ok === true && b65.ok === true, a.error ?? b65.error)
    const idA = a.ok ? a.id : null
    const idB = b65.ok ? b65.id : null
    const st = (id, novo_status, motivo_rescisao = null, detalhe_rescisao = null, cookie = admin.cookie) =>
      chamar('changeContratoStatus', [id, { novo_status, motivo_rescisao, detalhe_rescisao }], { rota: `/contratos/${id}`, cookie })
    const ler = async (id) =>
      (await supabase.from('contratos').select('status, motivo_rescisao, detalhe_rescisao, historico').eq('id', id).maybeSingle()).data

    if (idA && idB) {
      const s1 = await st(idA, 'suspenso')
      const r1 = await ler(idA)
      checar('6.5: ativo → suspenso grava o status e uma entrada no histórico, com autor e sem motivo',
        s1.ok === true && r1?.status === 'suspenso' && r1?.historico?.length === 1 &&
          r1.historico[0].de === 'ativo' && r1.historico[0].para === 'suspenso' && r1.historico[0].por === admin.userId &&
          r1.historico[0].motivo_rescisao === null && Boolean(r1.historico[0].em),
        `${s1.error ?? ''} · ${JSON.stringify(r1 ?? null)}`)

      const sDireto = await st(idA, 'concluido')
      checar('6.5: suspenso → concluído não é permitido (precisa retomar antes)',
        sDireto.ok === false && /não é permitida/.test(sDireto.error ?? '') && (await ler(idA))?.status === 'suspenso', sDireto.error)

      const motivoFora = await st(idA, 'ativo', 'inadimplencia')
      checar('6.5: motivo de rescisão em transição que não é rescisão é recusado, sem gravar',
        motivoFora.ok === false && /só se aplica/.test(motivoFora.error ?? '') && (await ler(idA))?.status === 'suspenso', motivoFora.error)

      const s2 = await st(idA, 'ativo')
      checar('6.5: suspenso → ativo (retomada) grava a segunda entrada',
        s2.ok === true && (await ler(idA))?.status === 'ativo' && (await ler(idA))?.historico?.length === 2, s2.error)

      const recusas = [
        ['rescisão sem motivo', [idA, 'rescindido', null, null], /Informe o motivo/],
        ['rescisão com motivo inválido', [idA, 'rescindido', 'calote', null], /inválido/],
        ['rescisão por "outro" sem detalhamento', [idA, 'rescindido', 'outro', '   '], /Descreva o motivo/],
        ['status inexistente', [idA, 'cancelado', null, null], /não é permitida/],
      ]
      for (const [rotulo, args, esperado] of recusas) {
        const r = await st(...args)
        const depois = await ler(idA)
        checar(`6.5: ${rotulo} é recusada, sem gravar`,
          r.ok === false && esperado.test(r.error ?? '') && depois?.status === 'ativo' && depois?.historico?.length === 2, r.error)
      }

      const cookieVis65 = cookieDeSessao((await sessaoDePerfil('visualizador')).session)
      const vis = await st(idA, 'suspenso', null, null, cookieVis65)
      checar('6.5: visualizador não muda status',
        vis.ok === false && /permissão/.test(vis.error ?? '') && (await ler(idA))?.status === 'ativo', vis.error)

      const s3 = await st(idA, 'rescindido', 'outro', '  Obra embargada  ')
      const r3 = await ler(idA)
      const ultima = r3?.historico?.at(-1)
      checar('6.5: rescisão grava status, motivo e detalhamento (aparado) na linha',
        s3.ok === true && r3?.status === 'rescindido' && r3?.motivo_rescisao === 'outro' && r3?.detalhe_rescisao === 'Obra embargada',
        `${s3.error ?? ''} · ${JSON.stringify(r3 ?? null)}`)
      checar('6.5: a entrada da rescisão no histórico leva o motivo e o detalhamento',
        r3?.historico?.length === 3 && ultima?.para === 'rescindido' && ultima?.motivo_rescisao === 'outro' &&
          ultima?.detalhe_rescisao === 'Obra embargada', JSON.stringify(ultima ?? null))

      const volta = await st(idA, 'ativo')
      checar('6.5: rescindido é terminal (não volta a ativo)',
        volta.ok === false && /não é permitida/.test(volta.error ?? '') && (await ler(idA))?.status === 'rescindido', volta.error)

      const edRescindido = await chamar('updateContrato', [idA, {
        numero: `${NUMERO}-AV65A`, obra_id: obra.id, descricao: 'depois da rescisão', data_assinatura: null, prazo_execucao: null,
        valor_total: 1000, desconto: 0, pct_sinal: null, pct_fd: null, pct_entrega_material: null, pct_medicao_instalacao: null,
        condicoes_pagamento: null, observacao: null,
      }], { rota: `/contratos/${idA}/editar` })
      checar('6.5: contrato rescindido não é editável', edRescindido.ok === false && /Só contrato ativo/.test(edRescindido.error ?? ''), edRescindido.error)

      // Constraint estrita no banco, sem passar pela action: motivo fora de rescindido.
      const { error: ck } = await supabase.from('contratos').update({ motivo_rescisao: 'inadimplencia' }).eq('id', idB)
      checar('6.5: o CHECK contratos_rescindido_motivo recusa motivo em contrato ativo, direto no banco',
        Boolean(ck) && /contratos_rescindido_motivo/.test(ck?.message ?? ''), ck?.message ?? 'o update passou')

      const cookieCom65 = cookieDeSessao((await sessaoDePerfil('comercial')).session)
      const c1 = await st(idB, 'concluido', null, null, cookieCom65)
      const rb = await ler(idB)
      checar('6.5: comercial conclui contrato ativo; concluído não tem motivo',
        c1.ok === true && rb?.status === 'concluido' && rb?.motivo_rescisao === null && rb?.historico?.length === 1, c1.error)
      const c2 = await st(idB, 'rescindido', 'inadimplencia')
      checar('6.5: concluído é terminal (não vira rescindido)', c2.ok === false && (await ler(idB))?.status === 'concluido', c2.error)
    }
  }

  // ============================================================
  // Bloco 6.6 — matriz de perfis das ações de contrato
  // ============================================================
  // O "roteiro nos 4 perfis" do fechamento, feito sobre os seis (como o 5.8):
  // cada ação de contrato, inclusive gerar a partir de proposta, em cada
  // perfil. Regra esperada: admin e comercial tudo; financeiro, medição,
  // produção e visualizador nada, e recusados pela checagem de perfil (não por
  // erro de outra coisa). Os contratos levam `-AVM`, e os gerados entram em
  // contratos62; todos saem no finally.
  {
    const PERFIS = ['admin', 'comercial', 'financeiro', 'medicao', 'producao', 'visualizador']
    const PODEM = ['admin', 'comercial']
    const pdf = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34])], 'matriz.pdf', { type: 'application/pdf' })
    const cm = (numero) => ({
      numero, obra_id: obra.id, descricao: 'matriz de perfis', data_assinatura: null, prazo_execucao: null,
      valor_total: 100, desconto: 0, pct_sinal: null, pct_fd: null, pct_entrega_material: null,
      pct_medicao_instalacao: null, condicoes_pagamento: null, observacao: null,
    })
    for (const perfil of PERFIS) {
      const cookie = perfil === 'admin' ? admin.cookie : cookieDeSessao((await sessaoDePerfil(perfil)).session)
      // Alvo criado pelo admin, com um anexo também do admin.
      const alvo = await chamar('createContrato', [cm(`${NUMERO}-AVM-${perfil}`)], { rota: '/contratos/novo' })
      if (!alvo.ok) {
        checar(`6.6: perfil ${perfil}: contrato-alvo da matriz criado`, false, alvo.error)
        continue
      }
      const rc = `/contratos/${alvo.id}`
      await chamarComArquivo('uploadAnexoContrato', alvo.id, pdf)
      const anexoAdmin = (await supabase.from('contratos').select('anexos').eq('id', alvo.id).maybeSingle()).data?.anexos?.[0]?.path

      const deveriaPoder = PODEM.includes(perfil)
      const erradas = []
      const conferir = (acao, r) => {
        if (deveriaPoder && !r.ok) erradas.push(`${acao} recusou: ${r.error}`)
        if (!deveriaPoder && r.ok) erradas.push(`${acao} PASSOU sem permissão`)
        if (!deveriaPoder && !r.ok && !/permissão/i.test(r.error ?? '')) erradas.push(`${acao} recusou pelo motivo errado: ${r.error}`)
      }

      conferir('createContrato', await chamar('createContrato', [cm(`${NUMERO}-AVMC-${perfil}`)], { rota: '/contratos/novo', cookie }))
      conferir('updateContrato', await chamar('updateContrato', [alvo.id, { ...cm(`${NUMERO}-AVM-${perfil}`), descricao: `editado por ${perfil}` }], { rota: `${rc}/editar`, cookie }))
      // Anexo: quem pode sobe o próprio e o remove (o Storage só deixa o dono
      // ou o admin apagar); quem não pode tenta remover o do admin.
      const up = await chamarComArquivo('uploadAnexoContrato', alvo.id, pdf, { cookie })
      conferir('uploadAnexoContrato', up)
      const anexos = (await supabase.from('contratos').select('anexos').eq('id', alvo.id).maybeSingle()).data?.anexos ?? []
      const proprio = anexos.find((x) => x.path !== anexoAdmin)?.path
      conferir('deleteAnexoContrato', await chamar('deleteAnexoContrato', [alvo.id, up.ok && proprio ? proprio : anexoAdmin], { rota: rc, cookie }))
      conferir('changeContratoStatus', await chamar('changeContratoStatus', [alvo.id, { novo_status: 'suspenso', motivo_rescisao: null, detalhe_rescisao: null }], { rota: rc, cookie }))
      if (proposta62Id) {
        conferir('gerarContratoDeProposta', await chamar('gerarContratoDeProposta', [proposta62Id, { ...cm(`${NUMERO}-CTM-${perfil}`), valor_total: 650, desconto: 100 }, { copiarItens: false, confirmarDuplicado: true }], { rota: `/propostas/${proposta62Id}/gerar-contrato`, cookie }))
      } else {
        erradas.push('sem a proposta aprovada do 6.2 para gerar contrato')
      }
      checar(`6.6: perfil ${perfil}: as 6 ações de contrato obedecem à regra`, erradas.length === 0, erradas.join(' | '))

      // O anexo do admin sai do bucket aqui: a limpeza do finally apaga só as linhas.
      if (anexoAdmin) await supabase.storage.from('anexos').remove([anexoAdmin])
    }
    if (proposta62Id) {
      const { data: gerados } = await supabase.from('contratos').select('id').eq('proposta_origem_id', proposta62Id)
      for (const c of gerados ?? []) if (!contratos62.includes(c.id)) contratos62.push(c.id)
    }
  }

  // ============================================================
  // Pendências da sprint 6 — duas mudanças de status ao mesmo tempo
  // ============================================================
  // O histórico era lido e gravado em dois passos: duas mudanças simultâneas
  // liam a mesma lista e a segunda apagava a entrada da primeira. As actions
  // passaram a gravar só se o status ainda é o lido. O invariante conferido:
  // exatamente uma das duas vence, e o histórico tem uma entrada por
  // transição que venceu, com a última batendo com o status. As duas saem em
  // paralelo, mas o servidor pode serializá-las; aí a perdedora cai na regra
  // de transição em vez do lock. O invariante vale nos dois casos.
  {
    const cor = await chamar('createContrato', [{
      numero: `${NUMERO}-AVCOR`, obra_id: obra.id, descricao: 'corrida de status', data_assinatura: null,
      prazo_execucao: null, valor_total: 100, desconto: 0, pct_sinal: null, pct_fd: null,
      pct_entrega_material: null, pct_medicao_instalacao: null, condicoes_pagamento: null, observacao: null,
    }], { rota: '/contratos/novo' })
    if (cor.ok) {
      const st = (novo_status) => chamar('changeContratoStatus', [cor.id, { novo_status, motivo_rescisao: null, detalhe_rescisao: null }], { rota: `/contratos/${cor.id}` })
      const [r1, r2] = await Promise.all([st('suspenso'), st('concluido')])
      const { data: c } = await supabase.from('contratos').select('status, historico').eq('id', cor.id).maybeSingle()
      const venceu = [r1, r2].filter((r) => r.ok).length
      const perdedora = [r1, r2].find((r) => !r.ok)
      checar('contrato: de duas mudanças simultâneas, uma vence e o histórico tem exatamente a entrada dela',
        venceu === 1 && c?.historico?.length === 1 && c.historico[0].para === c.status &&
          /mudou enquanto|não é permitida/.test(perdedora?.error ?? ''),
        `ok=${venceu} · ${perdedora?.error ?? ''} · ${JSON.stringify(c ?? null)}`)
    } else {
      checar('contrato da corrida de status criado', false, cor.error)
    }

    const pc = await chamar('createProposta', [{ ...base, numero: `${NUMERO}-CORRIDA`, pct_sinal: null, pct_fd: null }], { rota: '/propostas/nova' })
    if (pc.ok) {
      const hoje = new Date().toISOString().slice(0, 10)
      const para = (novo_status) => chamar('changePropostaStatus', [pc.id,
        { novo_status, data_envio: hoje, data_decisao: hoje, motivo_rejeicao: null, detalhe_rejeicao: null }], { rota: `/propostas/${pc.id}` })
      // Enviada primeiro, sozinha; depois dois destinos diferentes ao mesmo
      // tempo. Transição para o mesmo status é aceita na proposta, então dois
      // envios iguais não distinguiriam o código antigo do novo.
      await para('enviada')
      const [e1, e2] = await Promise.all([para('aprovada'), para('rascunho')])
      const { data: pr } = await supabase.from('propostas').select('status, historico').eq('id', pc.id).maybeSingle()
      const venceu = [e1, e2].filter((r) => r.ok).length
      checar('proposta: de duas mudanças simultâneas, uma vence e o histórico tem exatamente a entrada dela',
        venceu === 1 && pr?.historico?.length === 2 && pr.historico[1].para === pr.status,
        `ok=${venceu} · ${[e1, e2].find((r) => !r.ok)?.error ?? ''} · ${JSON.stringify(pr ?? null)}`)
      const apagada = await chamar('deleteProposta', [pc.id], { rota: `/propostas/${pc.id}` })
      checar('limpeza da proposta da corrida de status', apagada.ok === true, apagada.error)
    } else {
      checar('proposta da corrida de status criada', false, pc.error)
    }
  }

  // Pendência do 6.2 — dois cliques simultâneos em "Gerar contrato", sem a
  // confirmação de duplicado. A função trava a proposta (`for update`) antes
  // de conferir se já existe contrato vigente: tem de sair um contrato só, e
  // a outra chamada volta com o aviso de contrato existente.
  {
    const hoje = new Date().toISOString().slice(0, 10)
    const pg = await chamar('createProposta', [{ ...base, numero: `${NUMERO}-GCOR`, pct_sinal: null, pct_fd: null }], { rota: '/propostas/nova' })
    if (pg.ok) {
      const rpg = `/propostas/${pg.id}`
      for (const novo_status of ['enviada', 'aprovada']) {
        await chamar('changePropostaStatus', [pg.id, { novo_status, data_envio: hoje, data_decisao: hoje, motivo_rejeicao: null, detalhe_rejeicao: null }], { rota: rpg })
      }
      const ger = (sufixo) => chamar('gerarContratoDeProposta', [pg.id, {
        numero: `${NUMERO}-CTCOR${sufixo}`, obra_id: obra.id, data_assinatura: hoje, prazo_execucao: null, descricao: null,
        valor_total: Number(base.valor_total ?? 0), desconto: 0, pct_sinal: null, pct_fd: null, pct_entrega_material: null,
        pct_medicao_instalacao: null, condicoes_pagamento: null, observacao: null,
      }, { copiarItens: false, confirmarDuplicado: false }], { rota: `${rpg}/gerar-contrato` })
      const [g1, g2] = await Promise.all([ger('1'), ger('2')])
      const { data: gerados } = await supabase.from('contratos').select('id, numero').eq('proposta_origem_id', pg.id)
      const perdedora = [g1, g2].find((r) => !r.ok)
      checar('6.2: dois "Gerar contrato" simultâneos sem confirmação geram um contrato só; o outro recebe o aviso',
        [g1, g2].filter((r) => r.ok).length === 1 && (gerados ?? []).length === 1 &&
          ((perdedora?.contratosExistentes ?? []).length === 1 || /vigente/.test(perdedora?.error ?? '')),
        `${perdedora?.error ?? ''} · gerados=${JSON.stringify(gerados ?? null)}`)
      // Contrato antes da proposta (FK contratos_proposta_fk).
      if ((gerados ?? []).length > 0) await supabase.from('contratos').delete().in('id', gerados.map((c) => c.id))
      const apg = await chamar('deleteProposta', [pg.id], { rota: rpg })
      checar('limpeza da proposta e do contrato da corrida do "Gerar"', apg.ok === true, apg.error)
    } else {
      checar('proposta da corrida do "Gerar" criada', false, pg.error)
    }
  }

  // ============================================================
  // Bloco 7.2 — criar execução para os itens que ainda não têm
  // ============================================================
  // A ação é por obra, e cria para TODO item de contrato sem execução daquela
  // obra. Por isso o passo usa uma obra sem contrato nenhum: só os itens
  // criados aqui entram. Os contratos levam `-AVEXE` (saem com os avulsos) e
  // os itens entram em itensCriados; a execução sai junto com o item (FK
  // execucao_item_fk é on delete cascade).
  {
    const { data: comContrato } = await supabase.from('contratos').select('obra_id')
    const { data: obrasTodas } = await supabase.from('obras').select('id')
    const obraLivre = (obrasTodas ?? []).find((o) => !(comContrato ?? []).some((c) => c.obra_id === o.id))
    checar('7.2: gc-dev tem uma obra sem contrato para a ação em lote', Boolean(obraLivre))
    if (obraLivre) {
      const ctExe = async (sufixo) => chamar('createContrato', [{
        numero: `${NUMERO}-AVEXE${sufixo}`, obra_id: obraLivre.id, descricao: 'execução 7.2', data_assinatura: null,
        prazo_execucao: null, valor_total: 0, desconto: 0, pct_sinal: null, pct_fd: null, pct_entrega_material: null,
        pct_medicao_instalacao: null, condicoes_pagamento: null, observacao: null,
      }], { rota: '/contratos/novo' })
      const itemExe = async (contratoId, numero, quantidade) => {
        const r = await chamar('createItem', [{ tipo: 'contrato', id: contratoId }, {
          numero, tipo: 'Janela', descricao: `execução 7.2 item ${numero}`, linha: null, acabamento: null,
          largura: null, altura: null, quantidade, unidade: 'QTD', valor_unit: 100,
        }], { rota: `/contratos/${contratoId}` })
        if (r.ok) itensCriados.push(r.item.id)
        return r
      }
      const c1 = await ctExe('1')
      const c2 = await ctExe('2')
      const i1 = c1.ok ? await itemExe(c1.id, 1, 5) : { ok: false }
      const i2 = c1.ok ? await itemExe(c1.id, 2, 3) : { ok: false }
      const i3 = c2.ok ? await itemExe(c2.id, 1, 7) : { ok: false }
      checar('7.2: dois contratos e três itens de teste na obra livre', c1.ok && c2.ok && i1.ok && i2.ok && i3.ok, c1.error ?? c2.error)
      // O segundo contrato é rescindido: o item dele não recebe execução.
      if (c2.ok) {
        await chamar('changeContratoStatus', [c2.id, { novo_status: 'rescindido', motivo_rescisao: 'acordo_partes', detalhe_rescisao: null }], { rota: `/contratos/${c2.id}` })
      }
      const execDe = async () =>
        (await supabase.from('execucao').select('id, updated_at, item_id, sequencial, quantidade_total, valor_unit, fab_qtd, fab_status')
          .in('item_id', [i1.item?.id, i2.item?.id, i3.item?.id].filter(Boolean))).data ?? []

      for (const perfil of ['comercial', 'visualizador', 'financeiro']) {
        const cookie = cookieDeSessao((await sessaoDePerfil(perfil)).session)
        const r = await chamar('criarExecucoesFaltantes', [obraLivre.id], { rota: '/execucao', cookie })
        checar(`7.2: ${perfil} não cria execução`, r.ok === false && /permissão/.test(r.error ?? '') && (await execDe()).length === 0, r.error)
      }

      const cookieProd = cookieDeSessao((await sessaoDePerfil('producao')).session)
      const criou = await chamar('criarExecucoesFaltantes', [obraLivre.id], { rota: '/execucao', cookie: cookieProd })
      const execs = await execDe()
      checar('7.2: produção cria a execução dos 2 itens do contrato ativo, e não a do rescindido',
        criou.ok === true && criou.criadas === 2 && execs.length === 2 && !execs.some((e) => e.item_id === i3.item?.id),
        `${criou.error ?? ''} · criadas=${criou.criadas} · ${JSON.stringify(execs)}`)
      const e1 = execs.find((e) => e.item_id === i1.item?.id)
      checar('7.2: a execução nasce zerada, sequencial 1, com a quantidade e o valor do item (triggers de INSERT)',
        e1?.sequencial === 1 && Number(e1?.quantidade_total) === 5 && Number(e1?.valor_unit) === 100 &&
          Number(e1?.fab_qtd) === 0 && e1?.fab_status === 'pendente', JSON.stringify(e1 ?? null))
      const denovo = await chamar('criarExecucoesFaltantes', [obraLivre.id], { rota: '/execucao', cookie: cookieProd })
      checar('7.2: rodar de novo não duplica (0 criadas)', denovo.ok === true && denovo.criadas === 0 && (await execDe()).length === 2, denovo.error)
      const semObra = await chamar('criarExecucoesFaltantes', [''], { rota: '/execucao', cookie: cookieProd })
      checar('7.2: sem obra é recusado', semObra.ok === false && /obra/.test(semObra.error ?? ''), semObra.error)

      // ----------------------------------------------------------
      // Bloco 7.3 — apontamento, sobre a execução do item 1 (5 unidades)
      // ----------------------------------------------------------
      if (e1) {
        const ap = (q, extra = {}) => ({
          fab_qtd: q[0], ent_qtd: q[1], inst_qtd: q[2], med_qtd: q[3],
          fab_responsavel: null, ent_responsavel: null, inst_responsavel: null, med_responsavel: null,
          fab_observacao: null, ent_observacao: null, inst_observacao: null, med_observacao: null, ...extra,
        })
        const ler = async () => (await supabase.from('execucao').select('*').eq('id', e1.id).maybeSingle()).data
        const apontar = (payload, visto, cookie = cookieProd) =>
          chamar('apontarExecucao', [e1.id, payload, visto], { rota: '/execucao', cookie })
        const hoje = new Date().toISOString().slice(0, 10)

        let linha = await ler()
        const a1 = await apontar(ap([3, 0, 0, 0], { fab_responsavel: '  Serralheria  ', fab_observacao: 'primeiro lote' }), linha.updated_at)
        linha = await ler()
        checar('7.3: produção aponta 3 de 5 na fabricação; o trigger preenche início e atualização, sem fim',
          a1.ok === true && Number(linha.fab_qtd) === 3 && linha.fab_status === 'andamento' &&
            linha.fab_data_inicio === hoje && linha.fab_data_atualizacao === hoje && linha.fab_data_fim === null,
          `${a1.error ?? ''} · ${JSON.stringify({ q: linha?.fab_qtd, s: linha?.fab_status, i: linha?.fab_data_inicio, f: linha?.fab_data_fim })}`)
        checar('7.3: responsável aparado e observação gravados; a linha volta pronta com o item',
          linha.fab_responsavel === 'Serralheria' && linha.fab_observacao === 'primeiro lote' &&
            a1.execucao?.id === e1.id && a1.execucao?.item?.id === i1.item?.id, JSON.stringify(a1.execucao?.item ?? null))

        const bloqueios = [
          ['entregar mais do que foi fabricado', [3, 4, 0, 0], /Só é possível entregar 3 porque só 3 foram fabricados/],
          ['fabricar mais do que o total do item', [6, 0, 0, 0], /quantidade total do item/],
          ['instalar sem entregar', [3, 0, 1, 0], /nenhuma unidade foi entregue/],
          ['quantidade negativa', [-1, 0, 0, 0], /negativa/],
          ['mais de 3 casas decimais', [1.2345, 0, 0, 0], /3 casas/],
        ]
        for (const [rotulo, q, esperado] of bloqueios) {
          const r = await apontar(ap(q), linha.updated_at)
          const depois = await ler()
          checar(`7.3: ${rotulo} é recusado com a mensagem da cascata, sem gravar`,
            r.ok === false && esperado.test(r.error ?? '') && Number(depois.fab_qtd) === 3, r.error)
        }

        for (const perfil of ['comercial', 'visualizador', 'financeiro']) {
          const cookie = cookieDeSessao((await sessaoDePerfil(perfil)).session)
          const r = await apontar(ap([5, 0, 0, 0]), linha.updated_at, cookie)
          checar(`7.3: ${perfil} não aponta`, r.ok === false && /permissão/.test(r.error ?? '') && Number((await ler()).fab_qtd) === 3, r.error)
        }

        const velho = linha.updated_at
        const a2 = await apontar(ap([5, 2, 0, 0], { fab_responsavel: 'Serralheria' }), velho)
        linha = await ler()
        checar('7.3: concluir a fabricação (5 de 5) preenche o fim; a entrega começa',
          a2.ok === true && linha.fab_status === 'concluido' && linha.fab_data_fim === hoje &&
            linha.ent_status === 'andamento' && linha.ent_data_inicio === hoje, a2.error)
        const conflito = await apontar(ap([5, 5, 0, 0]), velho)
        checar('7.3: updated_at velho é recusado como conflito, sem sobrescrever',
          conflito.ok === false && conflito.conflito === true && Number((await ler()).ent_qtd) === 2, conflito.error)
        const releitura = await chamar('lerExecucao', [e1.id], { rota: '/execucao', cookie: cookieProd })
        checar('7.3: lerExecucao devolve a linha atual depois do conflito',
          releitura.ok === true && releitura.execucao?.id === e1.id && Number(releitura.execucao?.ent_qtd) === 2,
          releitura.error ?? JSON.stringify(releitura.execucao ?? null).slice(0, 120))

        const cookieMed = cookieDeSessao((await sessaoDePerfil('medicao')).session)
        const a3 = await apontar(ap([5, 5, 5, 5], { med_responsavel: 'Cliente' }), linha.updated_at, cookieMed)
        linha = await ler()
        checar('7.3: medição conclui as 4 etapas; os 4 status GENERATED ficam concluídos, com as 4 datas de fim',
          a3.ok === true && ['fab', 'ent', 'inst', 'med'].every((e) => linha[`${e}_status`] === 'concluido' && linha[`${e}_data_fim`] !== null),
          a3.error)
        const a4 = await apontar(ap([5, 5, 5, 4]), linha.updated_at)
        linha = await ler()
        checar('7.3: voltar a medição para 4 reabre a etapa (andamento) e limpa o fim só dela',
          a4.ok === true && linha.med_status === 'andamento' && linha.med_data_fim === null && linha.inst_data_fim !== null,
          a4.error)
        const baixar = await apontar(ap([3, 5, 5, 4]), linha.updated_at)
        checar('7.3: baixar a fabricação abaixo do que já foi entregue é recusado',
          baixar.ok === false && /Só é possível entregar 3/.test(baixar.error ?? ''), baixar.error)
      }

      // ----------------------------------------------------------
      // Bloco 7.4 — várias execuções por item, sobre o item 2 (3 unidades)
      // ----------------------------------------------------------
      const e2 = execs.find((e) => e.item_id === i2.item?.id)
      if (e2) {
        const ap4 = (extra) => ({
          fab_qtd: 0, ent_qtd: 0, inst_qtd: 0, med_qtd: 0,
          fab_responsavel: null, ent_responsavel: null, inst_responsavel: null, med_responsavel: null,
          fab_observacao: null, ent_observacao: null, inst_observacao: null, med_observacao: null, ...extra,
        })
        const execsDoItem2 = async () =>
          (await supabase.from('execucao').select('id, sequencial, quantidade_total, localizacao, valor_unit, updated_at, fab_qtd')
            .eq('item_id', i2.item.id).order('sequencial')).data ?? []
        const nova = (quantidade, localizacao, cookie = cookieProd) =>
          chamar('criarNovaExecucao', [i2.item.id, { quantidade, localizacao }], { rota: '/execucao', cookie })

        const cheio = await nova(1, 'Torre B')
        checar('7.4: com a execução única ocupando o item todo, a nova é recusada',
          cheio.ok === false && /todo distribuído/.test(cheio.error ?? '') && (await execsDoItem2()).length === 1, cheio.error)

        let [p1] = await execsDoItem2()
        const reduz = await chamar('apontarExecucao', [e2.id, ap4({ quantidade_total: 2, localizacao: ' Torre A ' }), p1.updated_at], { rota: '/execucao', cookie: cookieProd })
        ;[p1] = await execsDoItem2()
        checar('7.4: a primeira execução é reduzida para 2 e ganha a localização "Torre A"',
          reduz.ok === true && Number(p1.quantidade_total) === 2 && p1.localizacao === 'Torre A', reduz.error)

        const demais = await nova(2, 'Torre B')
        checar('7.4: a nova não pode passar do que sobra (1)',
          demais.ok === false && /Só cabem 1 nesta execução/.test(demais.error ?? ''), demais.error)
        const criada = await nova(1, 'Torre B')
        const doItem = await execsDoItem2()
        const p2 = doItem.find((e) => e.sequencial === 2)
        checar('7.4: a nova nasce com sequencial 2, a quantidade enviada (a migration 20260924110000) e o valor do item',
          criada.ok === true && criada.sequencial === 2 && Number(p2?.quantidade_total) === 1 &&
            p2?.localizacao === 'Torre B' && Number(p2?.valor_unit) === 100, `${criada.error ?? ''} · ${JSON.stringify(doItem)}`)

        ;[p1] = await execsDoItem2()
        const aumenta = await chamar('apontarExecucao', [e2.id, ap4({ quantidade_total: 3 }), p1.updated_at], { rota: '/execucao', cookie: cookieProd })
        checar('7.4: aumentar a primeira de volta para 3 é recusado (a outra já tem 1)',
          aumenta.ok === false && /Só cabem 2/.test(aumenta.error ?? ''), aumenta.error)

        const fab2 = await chamar('apontarExecucao', [e2.id, ap4({ fab_qtd: 2 }), p1.updated_at], { rota: '/execucao', cookie: cookieProd })
        ;[p1] = await execsDoItem2()
        const abaixo = await chamar('apontarExecucao', [e2.id, ap4({ quantidade_total: 1, fab_qtd: 2 }), p1.updated_at], { rota: '/execucao', cookie: cookieProd })
        checar('7.4: reduzir a execução abaixo do que já foi fabricado é recusado',
          fab2.ok === true && abaixo.ok === false && /Já foram fabricados 2/.test(abaixo.error ?? ''), abaixo.error ?? fab2.error)

        const semLoc = await chamar('apontarExecucao', [e2.id, { ...ap4({ fab_qtd: 2 }), localizacao: undefined }], { rota: '/execucao', cookie: cookieProd })
        ;[p1] = await execsDoItem2()
        checar('7.4: apontar sem mandar a localização não apaga a que existe',
          p1.localizacao === 'Torre A', `${semLoc.error ?? ''} · ${p1.localizacao}`)

        const cookieCom74 = cookieDeSessao((await sessaoDePerfil('comercial')).session)
        const com = await nova(0.5, 'x', cookieCom74)
        checar('7.4: comercial não cria execução', com.ok === false && /permissão/.test(com.error ?? ''), com.error)
        const rescindido = await chamar('criarNovaExecucao', [i3.item.id, { quantidade: 1, localizacao: null }], { rota: '/execucao', cookie: cookieProd })
        checar('7.4: item de contrato rescindido não recebe execução',
          rescindido.ok === false && /contrato vigente/.test(rescindido.error ?? ''), rescindido.error)

        // Sincronização da quantidade (20260924110000): com várias execuções,
        // mudar o item não reparte; com uma só, ela acompanha o item.
        await supabase.from('itens').update({ quantidade: 4 }).eq('id', i2.item.id)
        const aposItem2 = await execsDoItem2()
        checar('7.4: com 2 execuções, mudar a quantidade do item não mexe nelas',
          aposItem2.map((e) => Number(e.quantidade_total)).join(',') === '2,1', JSON.stringify(aposItem2))
        await supabase.from('itens').update({ quantidade: 6 }).eq('id', i1.item.id)
        const unica = (await supabase.from('execucao').select('quantidade_total').eq('item_id', i1.item.id)).data ?? []
        checar('7.4: com execução única, ela acompanha a quantidade do item (5 → 6)',
          unica.length === 1 && Number(unica[0].quantidade_total) === 6, JSON.stringify(unica))
      }

      // ----------------------------------------------------------
      // Bloco 7.5 — previsões de fim, sobre a Torre A do item 2
      // ----------------------------------------------------------
      if (e2) {
        const prev = async () =>
          (await supabase.from('execucao').select('fab_previsao_fim, ent_previsao_fim, inst_previsao_fim, med_previsao_fim, localizacao')
            .eq('id', e2.id).maybeSingle()).data
        const base5 = {
          fab_qtd: 2, ent_qtd: 0, inst_qtd: 0, med_qtd: 0,
          fab_responsavel: null, ent_responsavel: null, inst_responsavel: null, med_responsavel: null,
          fab_observacao: null, ent_observacao: null, inst_observacao: null, med_observacao: null,
        }
        const ap5 = (extra) => chamar('apontarExecucao', [e2.id, { ...base5, ...extra }], { rota: '/execucao', cookie: cookieProd })

        const ok5 = await ap5({ fab_previsao_fim: '2026-10-01', ent_previsao_fim: '2026-10-05', med_previsao_fim: '2026-10-20' })
        let pv = await prev()
        checar('7.5: as previsões gravam em ordem, e a vazia (instalação) fica nula',
          ok5.ok === true && pv.fab_previsao_fim === '2026-10-01' && pv.ent_previsao_fim === '2026-10-05' &&
            pv.inst_previsao_fim === null && pv.med_previsao_fim === '2026-10-20', `${ok5.error ?? ''} · ${JSON.stringify(pv)}`)
        const fora = await ap5({ inst_previsao_fim: '2026-09-30' })
        checar('7.5: previsão da instalação antes da entrega é recusada, sem gravar',
          fora.ok === false && /não pode ser antes da de entrega/.test(fora.error ?? '') && (await prev()).inst_previsao_fim === null, fora.error)
        const invalida = await ap5({ fab_previsao_fim: '01/10/2026' })
        checar('7.5: data fora do formato é recusada', invalida.ok === false && /inválida/.test(invalida.error ?? ''), invalida.error)
        const semPrev = await ap5({})
        pv = await prev()
        checar('7.5: apontar sem mandar as previsões não apaga as que existem',
          semPrev.ok === true && pv.fab_previsao_fim === '2026-10-01' && pv.med_previsao_fim === '2026-10-20' && pv.localizacao === 'Torre A',
          `${semPrev.error ?? ''} · ${JSON.stringify(pv)}`)
        const limpa = await ap5({ med_previsao_fim: '' })
        checar('7.5: previsão enviada vazia é limpa', limpa.ok === true && (await prev()).med_previsao_fim === null, limpa.error)
      }

      // ----------------------------------------------------------
      // Bloco 7.6 — testes de cascata (fechamento da sprint 7)
      // ----------------------------------------------------------
      // Um item novo (10 un) no contrato ativo da obra isolada, com a execução
      // criada pela ação em lote. As regras do helper (statusDaEtapa e a
      // tradução dos CHECKs) vêm do próprio src/lib, e não de cópia aqui.
      const { statusDaEtapa, mensagemDeErroExecucao } = await import('../src/lib/execucao.ts')
      const i6 = c1.ok ? await itemExe(c1.id, 6, 10) : { ok: false }
      const i7 = c1.ok ? await itemExe(c1.id, 7, 100) : { ok: false }
      await chamar('criarExecucoesFaltantes', [obraLivre.id], { rota: '/execucao', cookie: cookieProd })
      const execDoItem = async (itemId) =>
        (await supabase.from('execucao').select('*').eq('item_id', itemId).order('sequencial')).data ?? []
      const [e6] = i6.ok ? await execDoItem(i6.item.id) : []
      const [e7] = i7.ok ? await execDoItem(i7.item.id) : []
      checar('7.6: itens e execuções de teste da cascata criados', Boolean(e6 && e7), `${i6.error ?? ''} ${i7.error ?? ''}`)

      if (e6 && e7) {
        const base6 = {
          fab_responsavel: null, ent_responsavel: null, inst_responsavel: null, med_responsavel: null,
          fab_observacao: null, ent_observacao: null, inst_observacao: null, med_observacao: null,
        }
        const ap6 = (id, q, cookie = cookieProd) => chamar('apontarExecucao', [id, {
          ...base6, fab_qtd: q[0], ent_qtd: q[1], inst_qtd: q[2], med_qtd: q[3],
        }], { rota: '/execucao', cookie })
        const statusBatem = (linha) => ['fab', 'ent', 'inst', 'med'].every(
          (et) => linha[`${et}_status`] === statusDaEtapa(Number(linha[`${et}_qtd`]), Number(linha.quantidade_total)),
        )
        const ler6 = async () => (await supabase.from('execucao').select('*').eq('id', e6.id).maybeSingle()).data

        // 1. Conclusão completa, etapa por etapa, com os GENERATED batendo em cada passo.
        const passos = [
          ['fabricação', [10, 0, 0, 0], ['concluido', 'pendente', 'pendente', 'pendente']],
          ['entrega', [10, 10, 0, 0], ['concluido', 'concluido', 'pendente', 'pendente']],
          ['instalação', [10, 10, 10, 0], ['concluido', 'concluido', 'concluido', 'pendente']],
          ['medição', [10, 10, 10, 10], ['concluido', 'concluido', 'concluido', 'concluido']],
        ]
        for (const [etapa, q, esperado] of passos) {
          const r = await ap6(e6.id, q)
          const l = await ler6()
          const status = ['fab', 'ent', 'inst', 'med'].map((et) => l[`${et}_status`])
          checar(`7.6: concluir a ${etapa} — status GENERATED ${esperado.join('/')} e iguais aos do helper`,
            r.ok === true && JSON.stringify(status) === JSON.stringify(esperado) && statusBatem(l),
            `${r.error ?? ''} · ${status.join('/')}`)
        }
        const final6 = await ler6()
        checar('7.6: concluída nas 4 etapas, com as 4 datas de início e de fim preenchidas pelo trigger',
          ['fab', 'ent', 'inst', 'med'].every((et) => final6[`${et}_data_inicio`] && final6[`${et}_data_fim`]),
          JSON.stringify(['fab', 'ent', 'inst', 'med'].map((et) => [final6[`${et}_data_inicio`], final6[`${et}_data_fim`]])))

        // Migration 20260924130000: o total que sobe reabre as etapas, e o fim
        // tem de sumir junto com o "concluido". Direto no banco, sem a action.
        await supabase.from('execucao').update({ quantidade_total: 12 }).eq('id', e6.id)
        const reaberta = await ler6()
        checar('7.6: total sobe de 10 para 12 numa concluída, as 4 etapas voltam a andamento e os 4 data_fim são limpos (início fica)',
          ['fab', 'ent', 'inst', 'med'].every((et) => reaberta[`${et}_status`] === 'andamento' &&
            reaberta[`${et}_data_fim`] === null && reaberta[`${et}_data_inicio`] === final6[`${et}_data_inicio`]),
          JSON.stringify(['fab', 'ent', 'inst', 'med'].map((et) => [reaberta[`${et}_status`], reaberta[`${et}_data_inicio`], reaberta[`${et}_data_fim`]])))
        await supabase.from('execucao').update({ quantidade_total: 10 }).eq('id', e6.id)
        const refechada = await ler6()
        checar('7.6: total volta para 10, as 4 etapas voltam a concluido com data_fim de novo',
          ['fab', 'ent', 'inst', 'med'].every((et) => refechada[`${et}_status`] === 'concluido' && refechada[`${et}_data_fim`] !== null),
          JSON.stringify(['fab', 'ent', 'inst', 'med'].map((et) => [refechada[`${et}_status`], refechada[`${et}_data_fim`]])))

        // 2. Decimais e parciais: os GENERATED batem com a regra do helper.
        const dec = await ap6(e6.id, [2.5, 1.25, 0.001, 0])
        const lDec = await ler6()
        checar('7.6: com decimais (2,5 / 1,25 / 0,001 / 0), os 4 status GENERATED batem com o helper',
          dec.ok === true && statusBatem(lDec) && lDec.fab_status === 'andamento' && lDec.med_status === 'pendente', dec.error)

        // 3. Cada bloqueio da cascata pela action, com a mensagem.
        const bloqueios = [
          ['fabricação acima do total', [11, 0, 0, 0], 'Só é possível fabricar 10: é a quantidade total do item'],
          ['entrega acima da fabricação', [4, 5, 0, 0], 'Só é possível entregar 4 porque só 4 foram fabricados'],
          ['instalação acima da entrega', [4, 1, 2, 0], 'Só é possível instalar 1 porque só 1 foi entregue'],
          ['medição acima da instalação', [4, 3, 2, 3], 'Só é possível medir 2 porque só 2 foram instalados'],
        ]
        const antes = await ler6()
        for (const [rotulo, q, mensagem] of bloqueios) {
          const r = await ap6(e6.id, q)
          const depois = await ler6()
          checar(`7.6: ${rotulo} — recusada pela action com "${mensagem}", sem gravar`,
            r.ok === false && r.error === mensagem && depois.updated_at === antes.updated_at, r.error)
        }

        // 4. Os 4 CHECKs no banco, sem passar pela action, e a tradução de cada erro.
        const checks = [
          ['execucao_fab_qtd_check', { fab_qtd: 11 }, /quantidade total/],
          ['execucao_ent_qtd_check', { fab_qtd: 4, ent_qtd: 5 }, /fabricado/],
          ['execucao_inst_qtd_check', { fab_qtd: 4, ent_qtd: 1, inst_qtd: 2 }, /entregue/],
          ['execucao_med_qtd_check', { fab_qtd: 4, ent_qtd: 3, inst_qtd: 2, med_qtd: 3 }, /instalado/],
        ]
        for (const [constraint, campos, traducao] of checks) {
          const { error } = await supabase.from('execucao').update({ fab_qtd: 0, ent_qtd: 0, inst_qtd: 0, med_qtd: 0, ...campos }).eq('id', e6.id)
          checar(`7.6: o banco recusa direto pelo ${constraint}, e mensagemDeErroExecucao traduz`,
            Boolean(error) && error.message.includes(constraint) && traducao.test(mensagemDeErroExecucao(error.message)),
            error?.message ?? 'o update passou')
        }

        // 5. RLS: comercial não atualiza execução nem direto no banco.
        const sessCom = await sessaoDePerfil('comercial')
        const sbCom = createClient(URL_SUPABASE, ANON, { auth: { persistSession: false } })
        await sbCom.auth.setSession(sessCom.session)
        const { data: rlsCom } = await sbCom.from('execucao').update({ fab_qtd: 1 }).eq('id', e6.id).select('id')
        checar('7.6: a policy de update recusa o comercial direto no banco (0 linhas, nada muda)',
          (rlsCom ?? []).length === 0 && Number((await ler6()).fab_qtd) === Number(lDec.fab_qtd), JSON.stringify(rlsCom))
        const sessProd = await sessaoDePerfil('producao')
        const sbProd = createClient(URL_SUPABASE, ANON, { auth: { persistSession: false } })
        await sbProd.auth.setSession(sessProd.session)
        const { data: rlsProd } = await sbProd.from('execucao').update({ fab_qtd: 3 }).eq('id', e6.id).select('id')
        checar('7.6: a mesma policy deixa a produção atualizar', (rlsProd ?? []).length === 1 && Number((await ler6()).fab_qtd) === 3, JSON.stringify(rlsProd))

        // 6. Matriz de perfis das actions de execução, sobre o item 7 (100 un):
        //    a execução dele é reduzida para 10, e cada perfil que pode cria uma
        //    nova de 1. admin, produção e medição fazem tudo; visualizador só lê;
        //    comercial e financeiro, nada — e recusados pela checagem de perfil.
        await ap6(e7.id, [0, 0, 0, 0])
        await chamar('apontarExecucao', [e7.id, { ...base6, quantidade_total: 10, fab_qtd: 0, ent_qtd: 0, inst_qtd: 0, med_qtd: 0 }], { rota: '/execucao', cookie: cookieProd })
        const PODEM_APONTAR = ['admin', 'producao', 'medicao']
        const PODEM_LER = ['admin', 'producao', 'medicao', 'visualizador']
        for (const perfil of ['admin', 'comercial', 'financeiro', 'medicao', 'producao', 'visualizador']) {
          const cookie = perfil === 'admin' ? admin.cookie : cookieDeSessao((await sessaoDePerfil(perfil)).session)
          const erradas = []
          const conferir = (acao, r, pode) => {
            if (pode && !r.ok) erradas.push(`${acao} recusou: ${r.error}`)
            if (!pode && r.ok) erradas.push(`${acao} PASSOU sem permissão`)
            if (!pode && !r.ok && !/permissão/i.test(r.error ?? '')) erradas.push(`${acao} recusou pelo motivo errado: ${r.error}`)
          }
          const aponta = PODEM_APONTAR.includes(perfil)
          conferir('apontarExecucao', await ap6(e7.id, [1, 0, 0, 0], cookie), aponta)
          conferir('criarNovaExecucao', await chamar('criarNovaExecucao', [i7.item.id, { quantidade: 1, localizacao: `matriz ${perfil}` }], { rota: '/execucao', cookie }), aponta)
          conferir('criarExecucoesFaltantes', await chamar('criarExecucoesFaltantes', [obraLivre.id], { rota: '/execucao', cookie }), aponta)
          conferir('lerExecucao', await chamar('lerExecucao', [e7.id], { rota: '/execucao', cookie }), PODEM_LER.includes(perfil))
          checar(`7.6: perfil ${perfil}: as 4 actions de execução obedecem à regra`, erradas.length === 0, erradas.join(' | '))
        }
        const doItem7 = await execDoItem(i7.item.id)
        checar('7.6: as 3 execuções da matriz (admin, produção, medição) nasceram com sequencial 2, 3 e 4',
          doItem7.map((e) => e.sequencial).join(',') === '1,2,3,4', JSON.stringify(doItem7.map((e) => [e.sequencial, e.localizacao])))
      }
    }
  }

  // ============================================================
  // Fase 7 da automação — envio de documento pela tela (/documentos)
  // ============================================================
  // O navegador sobe o PDF direto para o Storage e a action só registra e
  // aciona o n8n. Aqui o upload é feito com o cliente da sessão do admin (a
  // mesma policy do navegador). O caminho feliz chama o webhook do n8n de
  // verdade — gasta execução e roda o Gemini —, então só roda com
  // VALIDACAO_ENVIO_REAL=1; as recusas rodam sempre e param antes do webhook.
  {
    const ROTA_DOC = '/documentos'
    const { data: perfilAdm } = await supabase.from('profiles').select('empresa_id').eq('id', admin.userId ?? (await supabase.auth.getUser()).data.user.id).single()
    const EMP = perfilAdm.empresa_id
    const { data: obraDoc } = await supabase.from('obras').select('id').eq('empresa_id', EMP).order('codigo_obra').limit(1).single()
    envioTesteCaminho = `${EMP}/sistema/${Date.now()}_validacao-escrita.pdf`
    const pdf = new Blob(['%PDF-1.4\n% validacao da escrita\n%%EOF\n'], { type: 'application/pdf' })
    const { error: erroUp } = await supabase.storage.from('documentos-processamento').upload(envioTesteCaminho, pdf, { contentType: 'application/pdf' })
    checar('admin sobe o PDF direto no bucket, na pasta sistema/ da empresa', !erroUp, erroUp?.message)

    const base = { caminho: envioTesteCaminho, obraId: obraDoc.id, nomeArquivo: 'validacao-escrita.pdf' }
    const sessaoVisDoc = await sessaoDePerfil('visualizador')
    const visDoc = await chamar('registrarEnvioDocumento', [base], { rota: ROTA_DOC, cookie: cookieDeSessao(sessaoVisDoc.session) })
    checar('visualizador não envia documento (a action repete a regra)', visDoc.ok === false && /permissão/i.test(visDoc.error ?? ''), JSON.stringify(visDoc))
    const outraEmp = await chamar('registrarEnvioDocumento', [{ ...base, caminho: `00000000-0000-4000-8000-000000000000/sistema/1_x.pdf` }], { rota: ROTA_DOC })
    checar('arquivo fora da pasta da empresa é recusado', outraEmp.ok === false && /fora da pasta/.test(outraEmp.error ?? ''), JSON.stringify(outraEmp))
    const traversal = await chamar('registrarEnvioDocumento', [{ ...base, caminho: `${EMP}/sistema/../telegram/x.pdf` }], { rota: ROTA_DOC })
    checar('caminho com .. é recusado', traversal.ok === false, JSON.stringify(traversal))
    const semObra = await chamar('registrarEnvioDocumento', [{ ...base, obraId: '' }], { rota: ROTA_DOC })
    checar('envio sem obra é recusado', semObra.ok === false && /obra/i.test(semObra.error ?? ''), JSON.stringify(semObra))
    const obraAlheia = await chamar('registrarEnvioDocumento', [{ ...base, obraId: '00000000-0000-4000-8000-000000000000' }], { rota: ROTA_DOC })
    checar('obra de outra empresa é recusada', obraAlheia.ok === false && /Obra inválida/.test(obraAlheia.error ?? ''), JSON.stringify(obraAlheia))
    const inexistente = await chamar('registrarEnvioDocumento', [{ ...base, caminho: `${EMP}/sistema/1_nao-existe.pdf` }], { rota: ROTA_DOC })
    checar('arquivo que não está no bucket é recusado', inexistente.ok === false && /não encontrado/.test(inexistente.error ?? ''), JSON.stringify(inexistente))
    const { count: docsRecusa } = await supabase.from('documentos_processamento').select('id', { count: 'exact', head: true }).like('arquivo_url', `%${envioTesteCaminho.split('/').pop()}%`)
    checar('nenhuma recusa deixou documento gravado', docsRecusa === 0, `linhas: ${docsRecusa}`)

    if (process.env.VALIDACAO_ENVIO_REAL === '1') {
      const envio = await chamar('registrarEnvioDocumento', [base], { rota: ROTA_DOC })
      envioTesteDocId = envio.id ?? null
      checar('envio válido grava o documento como PENDENTE e aciona o n8n', envio.ok === true && envio.automacao === 'acionada', JSON.stringify(envio))
      if (envioTesteDocId) {
        const { data: d } = await supabase.from('documentos_processamento').select('status, canal, obra_id, created_by').eq('id', envioTesteDocId).single()
        checar('documento pela tela: canal nulo, obra e autor preenchidos', d?.canal === null && d?.obra_id === obraDoc.id && Boolean(d?.created_by), JSON.stringify(d))
      }
    } else {
      console.log('  nota  envio válido pulado: chama o n8n de verdade (rode com VALIDACAO_ENVIO_REAL=1)')
    }
  }

  // ============================================================
  // Fase 7 da automação — contatos do bot (/configuracoes/contatos)
  // ============================================================
  {
    const ROTA_CT = '/configuracoes/contatos'
    // Código fictício e único por rodada: o índice de chat_id é global.
    const CODIGO = String(9_000_000_000 + (Date.now() % 1_000_000_000))
    const { data: obraCt } = await supabase.from('obras').select('id').order('codigo_obra').limit(1).single()

    const semObra = await chamar('createContato', [{ nome: 'Validação', telegram_chat_id: CODIGO, obra_id: '' }], { rota: ROTA_CT })
    checar('createContato sem obra é recusado pelo schema', semObra.ok === false && /obra/i.test(semObra.error ?? ''), JSON.stringify(semObra))
    const letra = await chamar('createContato', [{ telegram_chat_id: '12ab5678', obra_id: obraCt.id }], { rota: ROTA_CT })
    checar('createContato com código não numérico é recusado', letra.ok === false, JSON.stringify(letra))

    const criado = await chamar('createContato', [{ nome: 'Validação da escrita', telegram_chat_id: ` ${CODIGO.slice(0, 3)} ${CODIGO.slice(3)} `, obra_id: obraCt.id }], { rota: ROTA_CT })
    checar('createContato cria o contato Telegram (código colado com espaço)', criado.ok === true, criado.error)
    contatoTesteId = criado.id ?? null

    if (contatoTesteId) {
      const { data: ct } = await supabase.from('contatos_whatsapp').select('canal, telegram_chat_id, telefone, obra_id, nome, created_by').eq('id', contatoTesteId).single()
      checar('contato gravado: canal TELEGRAM, código sem espaço, telefone nulo, obra e nome', ct?.canal === 'TELEGRAM' && ct?.telegram_chat_id === CODIGO && ct?.telefone === null && ct?.obra_id === obraCt.id && ct?.nome === 'Validação da escrita', JSON.stringify(ct))

      const dup = await chamar('createContato', [{ telegram_chat_id: CODIGO, obra_id: obraCt.id }], { rota: ROTA_CT })
      checar('código repetido é recusado com mensagem legível', dup.ok === false && dup.error === 'Esse código já está cadastrado', JSON.stringify(dup))

      const editado = await chamar('updateContato', [contatoTesteId, { nome: '', telegram_chat_id: CODIGO, obra_id: obraCt.id }], { rota: ROTA_CT })
      const { data: ct2 } = await supabase.from('contatos_whatsapp').select('nome').eq('id', contatoTesteId).single()
      checar('updateContato edita; nome vazio vira nulo', editado.ok === true && ct2?.nome === null, JSON.stringify({ editado, nome: ct2?.nome }))

      const { data: whats } = await supabase.from('contatos_whatsapp').select('id').eq('canal', 'WHATSAPP').limit(1).maybeSingle()
      if (whats) {
        const naoEdita = await chamar('updateContato', [whats.id, { telegram_chat_id: CODIGO + '9', obra_id: obraCt.id }], { rota: ROTA_CT })
        checar('contato antigo de WhatsApp não é convertido pela edição', naoEdita.ok === false, JSON.stringify(naoEdita))
      }

      const sessaoComCt = await sessaoDePerfil('comercial')
      const semPermissao = await chamar('deleteContato', [contatoTesteId], { rota: ROTA_CT, cookie: cookieDeSessao(sessaoComCt.session) })
      const { count: aindaCt } = await supabase.from('contatos_whatsapp').select('id', { count: 'exact', head: true }).eq('id', contatoTesteId)
      checar('comercial não exclui contato (a action repete a regra do layout)', semPermissao.ok === false && aindaCt === 1, JSON.stringify(semPermissao))

      const excluido = await chamar('deleteContato', [contatoTesteId], { rota: ROTA_CT })
      checar('deleteContato exclui o contato', excluido.ok === true, excluido.error)
      if (excluido.ok) contatoTesteId = null
    }
  }

  // ============================================================
  // Fase 6 da automação — POST /api/ingestao/proposta
  // ============================================================
  // Rota de máquina: autentica por x-ingestao-token, sem sessão. Os passos
  // montam documentos_processamento de teste como o n8n montaria.
  {
    const TOKEN = process.env.INGESTAO_TOKEN
    const AUTOR = process.env.INGESTAO_PROFILE_ID
    const { data: obraIng } = await supabase.from('obras').select('id, empresa_id').eq('id', obra.id).single()
    const novoDocumento = async () => {
      const { data, error } = await supabase
        .from('documentos_processamento')
        .insert({ empresa_id: obraIng.empresa_id, tipo_documento: 'PROPOSTA', arquivo_url: 'validacao://ingestao', status: 'PENDENTE', canal: 'TELEGRAM', canal_chat_id: 'validacao' })
        .select('id')
        .single()
      if (error) throw new Error(`documento de teste: ${error.message}`)
      documentosIngestao.push(data.id)
      return data.id
    }
    const ingerir = async (corpo, token = TOKEN) => {
      const res = await fetch(BASE + '/api/ingestao/proposta', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { 'x-ingestao-token': token } : {}) },
        body: JSON.stringify(corpo),
        redirect: 'manual',
      })
      let json = null
      try { json = await res.json() } catch { json = null }
      return { status: res.status, json }
    }
    checar('INGESTAO_TOKEN e INGESTAO_PROFILE_ID estão no .env.local', Boolean(TOKEN && AUTOR))

    const NUMERO_ING = `VALIDA-INGESTAO-${Date.now()}`
    const docId = await novoDocumento()
    const corpo = {
      documentoId: docId,
      empresaId: obraIng.empresa_id,
      obraId: obraIng.id,
      numero: NUMERO_ING,
      valorTotal: 'R$ 1.410,00',
      pct: { sinal: 30, fd: 70 },
      origem: { canal: 'TELEGRAM', chatId: 'validacao' },
      itens: [
        { numero: '1', descricao: 'só com valor total', quantidade: '02', valor_unitario: null, valor_total: 'R$ 1.000,00' },
        { numero: '2', descricao: 'unidade UN', quantidade: 1, unidade: 'UN', valor_unitario: 200, valor_total: 200 },
        { numero: '3', descricao: 'porta em mm', quantidade: 1, unidade: 'm²', valor_unitario: 210, valor_total: 210, largura: 950, altura: 2100 },
      ],
    }

    const semToken = await ingerir(corpo, null)
    checar('ingestão sem token é recusada com 401 (e não redireciona pro /login)', semToken.status === 401, `status ${semToken.status}`)
    const tokenErrado = await ingerir(corpo, 'x'.repeat(64))
    checar('ingestão com token errado é recusada com 401', tokenErrado.status === 401, `status ${tokenErrado.status}`)

    const pctRuim = await ingerir({ ...corpo, pct: { sinal: 60, fd: 50 } })
    checar('soma de percentuais acima de 100% é recusada com 422', pctRuim.status === 422 && /100%/.test(pctRuim.json?.error ?? ''), JSON.stringify(pctRuim))
    const obraAlheia = await ingerir({ ...corpo, obraId: '00000000-0000-4000-8000-000000000000' })
    checar('obra que não é da empresa é recusada com 422', obraAlheia.status === 422 && /Obra não pertence/.test(obraAlheia.json?.error ?? ''), JSON.stringify(obraAlheia))
    const semConserto = await ingerir({ ...corpo, itens: [...corpo.itens, { numero: '4', quantidade: 0, valor_total: null }] })
    checar('item com quantidade zero e sem valor recusa a ingestão inteira (422)', semConserto.status === 422 && /item 4/.test(semConserto.json?.error ?? ''), JSON.stringify(semConserto))
    const { count: antes } = await supabase.from('propostas').select('id', { count: 'exact', head: true }).eq('numero', NUMERO_ING)
    checar('nenhuma recusa deixou proposta gravada', antes === 0, `linhas: ${antes}`)

    const feliz = await ingerir(corpo)
    checar('ingestão válida cria a proposta (201) com 3 itens', feliz.status === 201 && feliz.json?.ok === true && feliz.json?.itens === 3, JSON.stringify(feliz))
    propostaIngestaoId = feliz.json?.propostaId ?? null

    if (propostaIngestaoId) {
      const { data: pIng } = await supabase
        .from('propostas')
        .select('status, created_by, historico, valor_total, pct_sinal, pct_fd, observacao, obra_id')
        .eq('id', propostaIngestaoId)
        .single()
      checar('proposta da ingestão nasce rascunho, com o profile de serviço como autor', pIng?.status === 'rascunho' && pIng?.created_by === AUTOR, JSON.stringify({ status: pIng?.status, created_by: pIng?.created_by }))
      const h0 = Array.isArray(pIng?.historico) ? pIng.historico[0] : null
      checar('histórico desde o nascimento: rascunho → rascunho, por = uuid do profile', h0?.de === 'rascunho' && h0?.para === 'rascunho' && h0?.por === AUTOR, JSON.stringify(h0))
      checar('percentuais gravados como fração (30% / 70%)', pIng?.pct_sinal === 0.3 && pIng?.pct_fd === 0.7, JSON.stringify({ s: pIng?.pct_sinal, f: pIng?.pct_fd }))
      checar('observacao leva o rastro do documento', (pIng?.observacao ?? '').includes(`documento ${docId}`), pIng?.observacao)

      const { data: itIng } = await supabase
        .from('itens')
        .select('numero, quantidade, unidade, valor_unit, valor_total, largura, altura, area_m2, observacao')
        .eq('proposta_id', propostaIngestaoId)
        .order('numero')
      const [i1, i2, i3] = itIng ?? []
      checar('item só com total grava valor_unit inferido (1.000 / 2 = 500) e marca observacao', Number(i1?.valor_unit) === 500 && Number(i1?.valor_total) === 1000 && /inferido/.test(i1?.observacao ?? ''), JSON.stringify(i1))
      checar("item com unidade 'UN' grava 'QTD'", i2?.unidade === 'QTD', JSON.stringify(i2))
      checar("item em m² grava 'M2', medidas em mm convertidas para metro", i3?.unidade === 'M2' && Number(i3?.largura) === 0.95 && Number(i3?.altura) === 2.1 && /lidas como mm/.test(i3?.observacao ?? ''), JSON.stringify(i3))
      checar('area_m2 e valor_total dos itens vêm calculados pelo banco', Number(i3?.area_m2) === 1.995 && Number(i3?.valor_total) === 210, JSON.stringify({ area: i3?.area_m2, total: i3?.valor_total }))
      checar('valor da proposta = soma dos itens (trigger da 5.6)', Number(pIng?.valor_total) === 1410, `valor_total ${pIng?.valor_total}`)

      const { data: dIng } = await supabase.from('documentos_processamento').select('status, proposta_criada_id, obra_id').eq('id', docId).single()
      checar('documento vinculado: APROVADO, proposta_criada_id e obra preenchidos', dIng?.status === 'APROVADO' && dIng?.proposta_criada_id === propostaIngestaoId && dIng?.obra_id === obraIng.id, JSON.stringify(dIng))

      const repetida = await ingerir(corpo)
      checar('segunda chamada com o mesmo documentoId devolve 200 e o mesmo id', repetida.status === 200 && repetida.json?.jaExistia === true && repetida.json?.propostaId === propostaIngestaoId, JSON.stringify(repetida))
      const { count: depois } = await supabase.from('propostas').select('id', { count: 'exact', head: true }).eq('numero', NUMERO_ING)
      checar('a repetição não criou segunda proposta', depois === 1, `linhas: ${depois}`)

      const doc2 = await novoDocumento()
      const duplicada = await ingerir({ ...corpo, documentoId: doc2 })
      checar('número de proposta repetido responde 409 com mensagem legível (decisão 9)', duplicada.status === 409 && /Já existe uma proposta com esse número/.test(duplicada.json?.error ?? ''), JSON.stringify(duplicada))
    }
  }
  // Auditoria (13.2): o trigger viu o roteiro acima, e a RPC grava erro
  // ============================================================

  /** Eventos de um registro, do mais antigo pro mais novo, lidos como admin. */
  async function eventosDe(entidade, registroId) {
    const { data, error } = await supabase
      .from('auditoria_eventos')
      .select('id, origem, entidade, registro_id, referencia, acao, resultado, mensagem, autor_id, autor_descricao, detalhe, empresa_id')
      .eq('entidade', entidade)
      .eq('registro_id', registroId)
      .order('id')
    if (error) console.log(`         select de auditoria: ${error.message}`)
    return data ?? []
  }

  if (propostaId) {
    const evs = await eventosDe('propostas', propostaId)
    const criar = evs.find((e) => e.acao === 'criar')
    checar(
      'auditoria: createProposta gerou evento "criar" com autor, origem sistema, referência e a linha',
      criar?.origem === 'sistema' && criar?.autor_id === admin.userId &&
        criar?.referencia === NUMERO && criar?.detalhe?.linha?.numero === NUMERO,
      JSON.stringify(criar ?? null).slice(0, 200),
    )
    const envio = evs.find(
      (e) => e.acao === 'status' && e.detalhe?.campos?.status?.de === 'rascunho' && e.detalhe?.campos?.status?.para === 'enviada',
    )
    checar('auditoria: rascunho → enviada virou evento "status" com o diff', Boolean(envio), `${evs.length} evento(s)`)
    const ruido = evs.filter((e) => {
      const campos = Object.keys(e.detalhe?.campos ?? {})
      return (e.acao === 'editar' || e.acao === 'status') &&
        (campos.length === 0 || campos.includes('updated_at') || campos.includes('historico'))
    })
    checar('auditoria: nenhum evento de update traz só updated_at/historico', ruido.length === 0, `${ruido.length} com ruído`)

    // A busca da tela (filtroBuscaAuditoria) acha a proposta pelo número.
    const { count: pelaBusca } = await supabase
      .from('auditoria_eventos')
      .select('id', { count: 'exact', head: true })
      .or(`referencia.ilike.%${NUMERO}%,mensagem.ilike.%${NUMERO}%,autor_descricao.ilike.%${NUMERO}%`)
    checar('auditoria: busca pelo número da proposta acha os eventos dela', (pelaBusca ?? 0) >= 2, `achou ${pelaBusca}`)
  }

  // A ingestão (Fase 6) grava com a chave de serviço: é o caso real do filtro
  // "Automação" da tela, com o profile de serviço como autor (created_by).
  if (propostaIngestaoId) {
    const evs = await eventosDe('propostas', propostaIngestaoId)
    const criar = evs.find((e) => e.acao === 'criar')
    checar(
      'auditoria: proposta da rota de ingestão entra como origem automacao, autor = profile de serviço',
      criar?.origem === 'automacao' && criar?.autor_id === process.env.INGESTAO_PROFILE_ID &&
        criar?.autor_descricao === 'service_role',
      JSON.stringify(criar ?? null).slice(0, 200),
    )
  }

  if (orcamentoId) {
    const evs = await eventosDe('orcamentos', orcamentoId)
    const status = evs.filter((e) => e.acao === 'status')
    // 2 transições do roteiro, mais as que venceram na corrida da sprint 6.
    const esperado = 2 + orcCorridaVenceram
    checar(`auditoria: as ${esperado} transições do orçamento viraram ${esperado} eventos "status"`, status.length === esperado, `status=${status.length}`)
  }

  if (itensCriados.length > 0) {
    const evs = await eventosDe('itens', itensCriados[0])
    checar('auditoria: createItem gerou evento "criar" em itens', evs.some((e) => e.acao === 'criar'), `${evs.length} evento(s)`)
  }

  // RPC registrar_evento, como uma Server Action faria ao falhar (etapa B).
  const comercial = await sessaoDePerfil('comercial')
  const sbComercial = createClient(URL_SUPABASE, ANON, { auth: { persistSession: false } })
  await sbComercial.auth.setSession(comercial.session)
  const { data: perfilAdmin } = await supabase.from('profiles').select('empresa_id').eq('id', admin.userId).maybeSingle()

  const rpc = await sbComercial.rpc('registrar_evento', {
    p_entidade: 'validacao',
    p_acao: 'teste_erro',
    p_resultado: 'erro',
    p_mensagem: `${NUMERO}: erro de teste da camada de escrita`,
    // Com sessão, a empresa vem da sessão: este uuid tem de ser ignorado.
    p_empresa_id: '00000000-0000-0000-0000-000000000000',
  })
  checar('auditoria: comercial registra erro pela RPC', !rpc.error && typeof rpc.data === 'number', rpc.error?.message)

  if (!rpc.error) {
    const { data: ev } = await supabase.from('auditoria_eventos').select('*').eq('id', rpc.data).maybeSingle()
    checar(
      'auditoria: evento da RPC tem origem sistema, autor = comercial e resultado erro',
      ev?.origem === 'sistema' && ev?.autor_id === comercial.user.id && ev?.resultado === 'erro',
      JSON.stringify(ev ?? null).slice(0, 200),
    )
    checar(
      'auditoria: RPC com sessão ignora p_empresa_id e grava na empresa da sessão',
      ev?.empresa_id === perfilAdmin?.empresa_id,
      `empresa=${ev?.empresa_id}`,
    )
    const { count: vistoPeloComercial } = await sbComercial
      .from('auditoria_eventos')
      .select('id', { count: 'exact', head: true })
      .eq('id', rpc.data)
    checar('auditoria: comercial grava mas não lê o próprio evento', vistoPeloComercial === 0, `viu ${vistoPeloComercial}`)

    const alterar = await svc.from('auditoria_eventos').update({ mensagem: 'adulterado' }).eq('id', rpc.data)
    checar(
      'auditoria: nem a chave de serviço altera evento (auditoria_imutavel)',
      /auditoria_imutavel/.test(alterar.error?.message ?? ''),
      alterar.error?.message ?? 'update passou',
    )
  }

  const anon = await createClient(URL_SUPABASE, ANON).rpc('registrar_evento', {
    p_entidade: 'validacao', p_acao: 'teste_anon', p_resultado: 'erro',
    p_empresa_id: perfilAdmin?.empresa_id,
  })
  checar('auditoria: anon não chama registrar_evento', Boolean(anon.error), 'anon conseguiu registrar')
} finally {
  if (envioTesteDocId) {
    const { error: ed } = await supabase.from('documentos_processamento').delete().eq('id', envioTesteDocId)
    checar('documento do envio pela tela apagado na limpeza', !ed, ed?.message)
  }
  if (envioTesteCaminho) {
    const { error: es } = await supabase.storage.from('documentos-processamento').remove([envioTesteCaminho])
    checar('PDF de teste do envio pela tela removido do bucket', !es, es?.message)
  }
  if (contatoTesteId) {
    const { error: ec } = await supabase.from('contatos_whatsapp').delete().eq('id', contatoTesteId)
    checar('contato de teste da Fase 7 apagado na limpeza', !ec, ec?.message)
  }
  // Fase 6: a proposta da ingestão sai com os itens pelo mesmo caminho da tela;
  // os documentos de teste saem depois (a FK de proposta_criada_id é set null).
  if (propostaIngestaoId) {
    const r = await chamar('deleteProposta', [propostaIngestaoId], { rota: `/propostas/${propostaIngestaoId}` })
    checar('proposta da ingestão apagada com os itens', r.ok === true, r.error)
  }
  if (documentosIngestao.length > 0) {
    const { error: ed } = await supabase.from('documentos_processamento').delete().in('id', documentosIngestao)
    checar(`limpeza dos ${documentosIngestao.length} documentos de teste da ingestão`, !ed, ed?.message)
  }
  // Limpeza: nem a proposta nem o orçamento de teste ficam em gc-dev, mesmo se
  // algo falhou no meio.
  if (orcamentoId) {
    const excluido = await chamar('deleteOrcamento', [orcamentoId], {
      rota: `/orcamentos/${orcamentoId}`,
    })
    checar('deleteOrcamento apaga o orçamento de teste', excluido.ok === true, excluido.error)
  }
  // Itens primeiro: a FK itens_proposta_fk é `on delete set null
  // (proposta_id)`, então apagar a proposta NÃO apaga os itens — deixa órfãos
  // em gc-dev. Tem de ser explícito.
  if (itensCriados.length > 0) {
    const { error: errItens } = await supabase
      .from('itens')
      .delete()
      .in('id', itensCriados)
    checar(
      `limpeza dos ${itensCriados.length} itens de teste`,
      !errItens,
      errItens?.message,
    )
  }
  // 6.3: contratos avulsos (sem itens).
  {
    const { data: avulsos } = await supabase.from('contratos').select('id').like('numero', `${NUMERO}-AV%`)
    if ((avulsos ?? []).length > 0) {
      const { error: eav } = await supabase.from('contratos').delete().in('id', avulsos.map((c) => c.id))
      checar(`6.3: os ${avulsos.length} contratos avulsos apagados`, !eav, eav?.message)
    }
  }
  // 6.2: itens dos contratos primeiro (FK set null deixaria órfãos), depois os
  // contratos, depois a proposta com os itens dela.
  if (contratos62.length > 0) {
    await supabase.from('itens').delete().in('contrato_id', contratos62)
    const { error: e62 } = await supabase.from('contratos').delete().in('id', contratos62)
    checar(`6.2: os ${contratos62.length} contratos gerados apagados com os itens`, !e62, e62?.message)
  }
  if (proposta62Id) {
    const r = await chamar('deleteProposta', [proposta62Id], { rota: `/propostas/${proposta62Id}` })
    checar('6.2: proposta de teste apagada com os itens', r.ok === true, r.error)
  }
  if (contratoTesteId) {
    await supabase.from('itens').delete().eq('contrato_id', contratoTesteId)
    const { error: ec } = await supabase.from('contratos').delete().eq('id', contratoTesteId)
    checar('contrato de teste apagado', !ec, ec?.message)
  }
  if (propostaCargaId) {
    const excCarga = await chamar('deleteProposta', [propostaCargaId], { rota: `/propostas/${propostaCargaId}` })
    checar('proposta de carga apagada com os 500 itens', excCarga.ok === true, excCarga.error)
  }
  for (const [id, rotulo] of [[proposta57Id, 'do 5.7'], [propostaPerfisId, 'da matriz de perfis']]) {
    if (!id) continue
    const r = await chamar('deleteProposta', [id], { rota: `/propostas/${id}` })
    checar(`proposta ${rotulo} apagada com os itens`, r.ok === true, r.error)
  }
  if (proposta56Id) {
    const exc56 = await chamar('deleteProposta', [proposta56Id], { rota: `/propostas/${proposta56Id}` })
    checar('deleteProposta apaga a proposta do 5.6 (e os itens dela)', exc56.ok === true, exc56.error)
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

    const { count: itensOrfaos } = await supabase
      .from('itens')
      .select('id', { count: 'exact', head: true })
      .in('id', itensCriados.length > 0 ? itensCriados : ['00000000-0000-0000-0000-000000000000'])
    checar(
      'nenhum item de teste ficou órfão',
      itensOrfaos === 0,
      `itens restantes: ${itensOrfaos}`,
    )

    const { data: exclusao } = await supabase
      .from('auditoria_eventos')
      .select('detalhe')
      .eq('entidade', 'propostas')
      .eq('registro_id', propostaId)
      .eq('acao', 'excluir')
      .maybeSingle()
    checar(
      'auditoria: deleteProposta deixou evento "excluir" com a linha apagada',
      exclusao?.detalhe?.linha?.numero === NUMERO,
      JSON.stringify(exclusao ?? null).slice(0, 200),
    )
  }

  // Limpeza da auditoria: os eventos que o roteiro gerou (ver o módulo).
  const limpezaAud = await limparAuditoriaDoRoteiro(svc, INICIO_AUDITORIA)
  checar(
    `limpeza dos ${limpezaAud.apagados} eventos de auditoria do roteiro`,
    !limpezaAud.error,
    limpezaAud.error?.message,
  )
}

console.log(`\n${passos - falhas}/${passos} passos ok (como ${EMAIL})`)
process.exit(falhas === 0 ? 0 : 1)
