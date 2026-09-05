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
 * acrescenta as suas lá, não aqui. O placeholder {propostaSeed} no path é
 * trocado pelo id da proposta de scripts/seed-propostas-dev.mjs, que é como as
 * rotas dinâmicas entram sem uuid chumbado no arquivo.
 */
import { readFileSync } from 'node:fs'

import { createClient } from '@supabase/supabase-js'

import { exigirGcDev } from './gc-dev-guard.mjs'

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:3111'
const URL_SUPABASE = process.env.NEXT_PUBLIC_SUPABASE_URL
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const EMAIL = process.env.VALIDACAO_EMAIL
const SENHA = process.env.VALIDACAO_SENHA

// Segundo usuário, perfil visualizador: prova as regras de permissão da UI.
// Rota com `"perfil": "visualizador"` entra por este login.
const PERFIS_EXTRA = {
  visualizador: {
    email: process.env.VALIDACAO_EMAIL_VISUALIZADOR,
    senha: process.env.VALIDACAO_SENHA_VISUALIZADOR,
  },
}

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

// Logins extras, sob demanda: só entra quem alguma rota pedir.
const cookiesPorPerfil = { admin: cookie }

for (const [nome, cred] of Object.entries(PERFIS_EXTRA)) {
  if (!rotas.some((r) => r.perfil === nome)) continue

  if (!cred.email || !cred.senha) {
    console.error(
      `FALHA: rota pede perfil "${nome}", mas VALIDACAO_EMAIL_${nome.toUpperCase()} / ` +
        `VALIDACAO_SENHA_${nome.toUpperCase()} não estão no .env.local.`,
    )
    process.exit(1)
  }

  const sessao = await createClient(URL_SUPABASE, ANON).auth.signInWithPassword({
    email: cred.email,
    password: cred.senha,
  })

  if (sessao.error) {
    console.error(`FALHA no login de ${cred.email} (${nome}): ${sessao.error.message}`)
    process.exit(1)
  }

  const c = cookieDaSessao(sessao.data.session)
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

// {obraPrimeira}: qualquer obra serve — o que a rota prova é que o detalhe
// monta, e ele passa pela mesma view que já derrubou a listagem uma vez.
const { data: obraPrimeira } = await supabase
  .from('obras')
  .select('id')
  .order('codigo_obra', { ascending: false })
  .limit(1)
  .maybeSingle()

let falhas = 0
let pulados = 0

for (const rota of rotas) {
  const {
    esperaHtml = [],
    naoEsperaHtml = [],
    esperaStatus = 200,
    perfil,
  } = rota

  if (rota.path.includes('{propostaSeed}') && !seed) {
    pulados += 1
    console.log(
      `  PULOU ${rota.path} — rode scripts/seed-propostas-dev.mjs primeiro`,
    )
    continue
  }

  if (rota.path.includes('{obraPrimeira}') && !obraPrimeira) {
    pulados += 1
    console.log(`  PULOU ${rota.path} — gc-dev não tem nenhuma obra`)
    continue
  }

  const path = rota.path
    .replace('{propostaSeed}', seed?.id ?? '')
    .replace('{obraPrimeira}', obraPrimeira?.id ?? '')
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

  // Rota de API não devolve HTML — a asserção positiva é o content-type.
  if (path.startsWith('/api/') && res.status === esperaStatus) {
    const tipo = res.headers.get('content-type') ?? ''
    if (rota.esperaContentType && !tipo.includes(rota.esperaContentType)) {
      problemas.push(`content-type "${tipo}", esperado ${rota.esperaContentType}`)
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
  `\n${rotas.length - falhas - pulados}/${rotas.length} rotas ok` +
    (pulados > 0 ? `, ${pulados} puladas` : '') +
    ` (autenticado como ${EMAIL})`,
)
process.exit(falhas === 0 ? 0 : 1)
