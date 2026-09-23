/**
 * Camada 4 (runtime): abre as rotas num servidor de verdade, autenticado, e
 * confere que a página renderizou o que devia.
 *
 * Rodar via `bash scripts/validar.sh runtime` — ele faz o build, sobe o
 * `next start` e passa BASE_URL. Sozinho:
 *   BASE_URL=http://127.0.0.1:3111 node --env-file=.env.local scripts/validar-runtime.mjs
 *
 * Por que forjar o cookie em vez de usar navegador: toda rota de /(app) passa
 * pelo middleware, que redireciona quem não tem sessão pro /login. Sem sessão,
 * um curl só prova que o redirect funciona — não que a página renderiza. O
 * cookie é montado no mesmo formato que o @supabase/ssr lê
 * (`sb-<ref>-auth-token` = "base64-" + base64url do objeto session), então o
 * servidor trata a requisição como usuário logado de verdade, com RLS.
 *
 * As rotas conferidas ficam em scripts/validacao-rotas.json — cada bloco novo
 * acrescenta as suas lá, não aqui. Os placeholders {propostaSeed} e
 * {propostaItens} no path são
 * trocado pelo id da proposta de scripts/seed-propostas-dev.mjs, que é como as
 * rotas dinâmicas entram sem uuid chumbado no arquivo.
 */
import { readFileSync } from 'node:fs'

import { createClient } from '@supabase/supabase-js'

import { exigirGcDev } from './gc-dev-guard.mjs'
import { PERFIS_DE_TESTE, sessaoDePerfil } from './sessao-dev.mjs'

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:3111'
const URL_SUPABASE = process.env.NEXT_PUBLIC_SUPABASE_URL
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const EMAIL = process.env.VALIDACAO_EMAIL
const SENHA = process.env.VALIDACAO_SENHA

// Perfis de teste: a rota com `"perfil": "<nome>"` entra por sessão gerada
// sem senha (ver scripts/sessao-dev.mjs). Perfil novo é só uma linha lá.

// Limite do @supabase/ssr: acima disso o cookie é partido em .0, .1, ...
const MAX_CHUNK = 3180

function faltando(nome) {
  console.error(
    `FALHA: ${nome} não está definida. Camada runtime precisa de\n` +
      `  NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,\n` +
      `  VALIDACAO_EMAIL e VALIDACAO_SENHA (usuário de gc-dev) em .env.local.`,
  )
  process.exit(1)
}

if (!URL_SUPABASE) faltando('NEXT_PUBLIC_SUPABASE_URL')
if (!ANON) faltando('NEXT_PUBLIC_SUPABASE_ANON_KEY')
if (!EMAIL) faltando('VALIDACAO_EMAIL')
if (!SENHA) faltando('VALIDACAO_SENHA')

exigirGcDev(URL_SUPABASE, 'a camada de runtime')

const rotas = JSON.parse(
  readFileSync(new URL('./validacao-rotas.json', import.meta.url), 'utf8'),
)

/**
 * Trechos que NUNCA podem aparecer em rota nenhuma. A caixa de erro das
 * listagens renderiza dentro de um HTTP 200, então status sozinho não prova
 * nada — sem esta checagem, uma tela quebrada passa como "ok".
 */
const PROIBIDO_EM_TODA_ROTA = ['Erro ao carregar', 'Application error']

/**
 * Abre o XLSX e confere as células. Sem isso, a asserção de `content-type`
 * prova que a rota devolve uma planilha, não que a planilha está certa — e uma
 * coluna trocada passaria batido.
 *
 * `espera` aceita: `colunas` (cabeçalhos, na ordem), `minLinhas` e `contem`
 * (textos que precisam aparecer em alguma célula).
 */
/**
 * O template REAL da rota passado pelo parser REAL da importação (bloco 5.4).
 * O teste unitário reproduz o layout; este prova que a rota entrega esse
 * layout. Os dois juntos fecham o caminho baixar → preencher → subir.
 * O Node 24 importa .ts direto (type stripping).
 */
async function conferirTemplateItens(buffer) {
  const { lerPlanilhaItens } = await import('../src/lib/itens-planilha.ts')
  const { validarPlanilha } = await import('../src/lib/itens-form.ts')
  const lido = await lerPlanilhaItens(buffer)
  if (!lido.ok) return [`o parser da importação não leu o template: ${lido.erro}`]
  if (lido.linhas.length !== 1) return [`template deveria ter 1 linha (o exemplo), tem ${lido.linhas.length}`]
  const [v] = validarPlanilha(lido.linhas, [])
  if (v.ok) return ['a linha de exemplo do template passou na validação — seria importada como item']
  return []
}

async function conferirXlsx(buffer, espera) {
  const problemas = []
  const { default: ExcelJS } = await import('exceljs')

  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buffer)
  const ws = wb.worksheets[0]

  if (!ws) return ['a planilha não tem nenhuma aba']

  // O cabeçalho não está na linha 1: os exports abrem com metaRows (título,
  // data de emissão, filtros, total). Acha a linha que casa com a 1ª coluna.
  let linhaCab = null
  const primeira = espera.colunas?.[0]
  if (primeira) {
    ws.eachRow((row, n) => {
      if (linhaCab) return
      if (row.values.some((v) => String(v ?? '').trim() === primeira)) linhaCab = n
    })
    if (!linhaCab) {
      return [`não achei a linha de cabeçalho (procurei "${primeira}")`]
    }

    const cabecalhos = (ws.getRow(linhaCab).values ?? [])
      .slice(1)
      .map((v) => String(v ?? '').trim())
      .filter(Boolean)

    for (const col of espera.colunas) {
      if (!cabecalhos.includes(col)) problemas.push(`planilha sem a coluna "${col}"`)
    }
  }

  if (espera.minLinhas != null) {
    // Linhas de dado = total menos metaRows menos o cabeçalho. Aproxima por
    // rowCount, que é o que basta pra pegar planilha vazia.
    const dados = ws.rowCount - (linhaCab ?? 0)
    if (dados < espera.minLinhas) {
      problemas.push(`planilha com ${dados} linha(s) de dado, esperado >= ${espera.minLinhas}`)
    }
  }

  if (espera.contem?.length) {
    const texto = []
    ws.eachRow((row) => {
      for (const v of row.values ?? []) {
        if (v != null) texto.push(String(typeof v === 'object' ? (v.text ?? v.result ?? '') : v))
      }
    })
    const tudo = texto.join(' | ')
    for (const t of espera.contem) {
      if (!tudo.includes(t)) problemas.push(`planilha sem "${t}" em nenhuma célula`)
    }
  }

  return problemas
}

const supabase = createClient(URL_SUPABASE, ANON)
const { data, error } = await supabase.auth.signInWithPassword({
  email: EMAIL,
  password: SENHA,
})

if (error) {
  console.error(`FALHA: login de ${EMAIL} em gc-dev: ${error.message}`)
  process.exit(1)
}

const ref = new global.URL(URL_SUPABASE).hostname.split('.')[0]

function cookieDaSessao(session) {
  const valor = `base64-${Buffer.from(JSON.stringify(session)).toString('base64url')}`
  if (encodeURIComponent(valor).length > MAX_CHUNK) return null
  return `sb-${ref}-auth-token=${valor}`
}

const valor = `base64-${Buffer.from(JSON.stringify(data.session)).toString('base64url')}`

if (encodeURIComponent(valor).length > MAX_CHUNK) {
  // Não implementado de propósito: hoje o cookie dá ~2,6 kB. Se um dia
  // estourar, o @supabase/ssr espera sb-<ref>-auth-token.0, .1, ...
  console.error(
    'FALHA: sessão maior que um cookie (chunking não implementado). Ver createChunks do @supabase/ssr.',
  )
  process.exit(1)
}

const cookie = `sb-${ref}-auth-token=${valor}`

// Sessões extras, sob demanda: só entra o perfil que alguma rota pedir.
const cookiesPorPerfil = { admin: cookie }

for (const nome of Object.keys(PERFIS_DE_TESTE)) {
  if (!rotas.some((r) => r.perfil === nome)) continue

  let sessao
  try {
    sessao = await sessaoDePerfil(nome)
  } catch (e) {
    console.error(`FALHA ao abrir sessão de ${nome}: ${e.message}`)
    process.exit(1)
  }

  const c = cookieDaSessao(sessao.session)
  if (!c) {
    console.error(`FALHA: sessão de ${nome} maior que um cookie.`)
    process.exit(1)
  }
  cookiesPorPerfil[nome] = c
}

// Resolve {propostaSeed} → id da proposta semeada. Sem ela, as rotas dinâmicas
// são puladas com aviso, em vez de falharem por uuid inexistente.
const { data: seed } = await supabase
  .from('propostas')
  .select('id')
  .eq('numero', 'SEED-VENCIDA-001')
  .maybeSingle()

// {propostaItens} → a proposta rascunho com 12 itens (supabase/seed_itens.sql).
// Separada da de cima de propósito: SEED-VENCIDA-001 é `enviada` com ZERO
// itens, então só exercita a aba no estado somente-leitura vazio. Esta é
// rascunho e cheia, e é a única que faz a tabela editável renderizar.
const { data: seedItens } = await supabase
  .from('propostas')
  .select('id')
  .eq('numero', 'SEED-ITENS-001')
  .maybeSingle()

// {propostaDivergente} → SEED-DIVERGENTE-001 (supabase/seed_itens.sql): itens
// somando 5.000,00 com valor digitado em 9.999,00. Prova o aviso do bloco 5.6.
const { data: seedDivergente } = await supabase
  .from('propostas')
  .select('id')
  .eq('numero', 'SEED-DIVERGENTE-001')
  .maybeSingle()

// {obraPrimeira}: qualquer obra serve — o que a rota prova é que o detalhe
// monta, e ele passa pela mesma view que já derrubou a listagem uma vez.
const { data: obraPrimeira } = await supabase
  .from('obras')
  .select('id')
  .order('codigo_obra', { ascending: false })
  .limit(1)
  .maybeSingle()

const { data: orcamentoPrimeiro } = await supabase
  .from('orcamentos')
  .select('id')
  .order('data_solicitacao', { ascending: false })
  .limit(1)
  .maybeSingle()

let falhas = 0

for (const rota of rotas) {
  const {
    esperaHtml = [],
    naoEsperaHtml = [],
    esperaStatus = 200,
    perfil,
  } = rota

  // Gate de dado ausente ESTOURA, não pula.
  //
  // Até 2026-09-21 estes três blocos faziam `pulados += 1` e o exit final só
  // olhava `falhas`, então gc-dev sem seed devolvia 0 com metade das rotas não
  // exercitada — o skip silencioso que `auditoria-cobertura-sprint-4.md`
  // documenta, dentro do próprio script de validação.
  if (rota.path.includes('{propostaSeed}') && !seed) {
    falhas += 1
    console.log(
      `  FALHA ${rota.path} — sem SEED-VENCIDA-001; rode scripts/seed-propostas-dev.mjs`,
    )
    continue
  }

  if (rota.path.includes('{propostaItens}') && !seedItens) {
    falhas += 1
    console.log(
      `  FALHA ${rota.path} — sem SEED-ITENS-001; rode` +
        ' bash scripts/aplicar-seed.sh supabase/seed_itens.sql',
    )
    continue
  }

  if (rota.path.includes('{propostaDivergente}') && !seedDivergente) {
    falhas += 1
    console.log(
      `  FALHA ${rota.path} — sem SEED-DIVERGENTE-001; rode` +
        ' bash scripts/aplicar-seed.sh supabase/seed_itens.sql',
    )
    continue
  }

  if (rota.path.includes('{obraPrimeira}') && !obraPrimeira) {
    falhas += 1
    console.log(`  FALHA ${rota.path} — gc-dev não tem nenhuma obra`)
    continue
  }

  if (rota.path.includes('{orcamentoPrimeiro}') && !orcamentoPrimeiro) {
    falhas += 1
    console.log(`  FALHA ${rota.path} — gc-dev não tem nenhum orçamento`)
    continue
  }

  const path = rota.path
    .replace('{propostaSeed}', seed?.id ?? '')
    .replace('{propostaItens}', seedItens?.id ?? '')
    .replace('{propostaDivergente}', seedDivergente?.id ?? '')
    .replace('{obraPrimeira}', obraPrimeira?.id ?? '')
    .replace('{orcamentoPrimeiro}', orcamentoPrimeiro?.id ?? '')
  const cookieDaRota = cookiesPorPerfil[perfil ?? 'admin']
  const problemas = []

  // 1. Sem sessão: tem que redirecionar pro login. É o guard de rota.
  const anon = await fetch(BASE + path, { redirect: 'manual' })
  if (anon.status !== 307 && anon.status !== 302) {
    problemas.push(`sem sessão devolveu ${anon.status}, esperado redirect`)
  } else if (!(anon.headers.get('location') ?? '').includes('/login')) {
    problemas.push(
      `sem sessão redirecionou pra ${anon.headers.get('location')}, esperado /login`,
    )
  }

  // 2. Com sessão: o status esperado (200, salvo rota que redireciona por
  // regra de negócio) e o conteúdo esperado no HTML.
  const res = await fetch(BASE + path, {
    redirect: 'manual',
    headers: { cookie: cookieDaRota },
  })
  if (res.status !== esperaStatus) {
    problemas.push(`autenticado devolveu ${res.status}, esperado ${esperaStatus}`)
  } else if (res.status === 200 && !path.startsWith('/api/')) {
    const html = await res.text()
    for (const trecho of esperaHtml) {
      if (!html.includes(trecho)) problemas.push(`HTML sem "${trecho}"`)
    }
    for (const trecho of naoEsperaHtml) {
      if (html.includes(trecho)) problemas.push(`HTML contém "${trecho}", não devia`)
    }
    for (const trecho of PROIBIDO_EM_TODA_ROTA) {
      if (html.includes(trecho)) {
        problemas.push(`HTML contém "${trecho}" — a tela renderizou um erro`)
      }
    }
    if (esperaHtml.length === 0) {
      problemas.push(
        'rota sem asserção positiva: acrescente esperaHtml em validacao-rotas.json',
      )
    }
  }

  // Rota de API não devolve HTML — a asserção positiva é o content-type e,
  // quando é planilha, o conteúdo das células.
  if (path.startsWith('/api/') && res.status === esperaStatus) {
    const tipo = res.headers.get('content-type') ?? ''
    if (rota.esperaContentType && !tipo.includes(rota.esperaContentType)) {
      problemas.push(`content-type "${tipo}", esperado ${rota.esperaContentType}`)
    }

    if (rota.esperaXlsx || rota.esperaTemplateItens) {
      const buffer = await res.arrayBuffer()
      if (rota.esperaXlsx) problemas.push(...(await conferirXlsx(buffer, rota.esperaXlsx)))
      if (rota.esperaTemplateItens) problemas.push(...(await conferirTemplateItens(buffer)))
    }
  }

  const rotulo = perfil ? `${path} (como ${perfil})` : path
  if (problemas.length === 0) {
    console.log(`  ok   ${rotulo}`)
  } else {
    falhas += 1
    console.log(`  FALHA ${rotulo}`)
    for (const p of problemas) console.log(`         ${p}`)
  }
}

console.log(
  `\n${rotas.length - falhas}/${rotas.length} rotas ok` +
    ` (autenticado como ${EMAIL})`,
)
process.exit(falhas === 0 ? 0 : 1)
