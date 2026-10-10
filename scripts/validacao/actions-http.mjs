/**
 * Server Action chamada por HTTP, sem navegador. Usado pelas camadas escrita e
 * fumaça. Extraído de validar-escrita.mjs no 13.5; o porquê de cada detalhe
 * (o id no header, o corpo React Flight, a ordem das partes do multipart) está
 * no cabeçalho de lá.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

function arquivosDoBuild(dir, saida = []) {
  for (const nome of readdirSync(dir)) {
    const caminho = join(dir, nome)
    if (statSync(caminho).isDirectory()) arquivosDoBuild(caminho, saida)
    else if (nome.endsWith('.js')) saida.push(caminho)
  }
  return saida
}

/** Nome da função exportada → id da action, lido do build (refaz-se a cada build). */
export function mapaDeActions() {
  const mapa = {}
  // O build emite, minificado:
  //   "<id>":()=>Promise.resolve().then(r.bind(r,N)).then(e=>e.nomeDaFuncao)
  // A chave perde as aspas quando o hash começa por letra, daí o ["']? — e o
  // corpo é lido sem cruzar aspas, pra não vazar pro próximo par.
  const padrao = /["']?([0-9a-f]{40})["']?:\(\)=>[^"']{0,200}?\.then\(\w+=>\w+\.(\w+)\)/g
  // `.next/server` inteiro, e não só `app/`: action usada por mais de uma rota
  // (as de item, desde o 6.4, servem proposta e contrato) vai para um chunk
  // compartilhado em `.next/server/chunks/`.
  for (const arquivo of arquivosDoBuild(`${process.env.NEXT_DIST_DIR || '.next'}/server`)) {
    const conteudo = readFileSync(arquivo, 'utf8')
    for (const m of conteudo.matchAll(padrao)) mapa[m[2]] = m[1]
  }
  return mapa
}

/** Aborta com a lista do que falta, para a camada não falhar no meio. */
export function exigirActions(actions, necessarias) {
  const faltando = necessarias.filter((n) => !actions[n])
  if (faltando.length > 0) {
    console.error(
      `FALHA: não achei no build as actions: ${faltando.join(', ')}.\n` +
        `  Rode a camada build antes (o mapa vem de ${process.env.NEXT_DIST_DIR || '.next'}/server).`,
    )
    process.exit(1)
  }
}

/** O cookie de sessão do @supabase/ssr, a partir de uma sessão pronta. */
export function cookieDeSessao(session, urlSupabase) {
  const ref = new URL(urlSupabase).hostname.split('.')[0]
  const valor = `base64-${Buffer.from(JSON.stringify(session)).toString('base64url')}`
  return `sb-${ref}-auth-token=${valor}`
}

export function resultadoDoFlight(texto) {
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

/** `chamar(nome, args, { cookie, rota })`, com o cookie padrão de quem roda. */
export function criarChamador({ base, actions, cookiePadrao }) {
  return async function chamar(nomeAction, args, { cookie = cookiePadrao(), rota = '/propostas' } = {}) {
    const res = await fetch(base + rota, {
      method: 'POST',
      headers: {
        cookie,
        'Next-Action': actions[nomeAction],
        'Content-Type': 'text/plain;charset=UTF-8',
      },
      body: JSON.stringify(args),
    })
    if (res.status !== 200) return { ok: false, error: `HTTP ${res.status}` }
    return resultadoDoFlight(await res.text())
  }
}
