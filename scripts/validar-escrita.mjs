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
        `valor=${valorPar?.valor_total} soma=${soma5k}`)
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
  }
}

console.log(`\n${passos - falhas}/${passos} passos ok (como ${EMAIL})`)
process.exit(falhas === 0 ? 0 : 1)
