/**
 * Driver ad-hoc do gc-sistema: dirige a aplicação no Chrome headless a partir
 * de comandos lidos do stdin.
 *
 *   npx next dev -p 3111 &                      # deixe o servidor no ar
 *   node .claude/skills/run-gc-sistema/driver.mjs <<'CMD'
 *   ir /propostas
 *   shot listagem
 *   CMD
 *
 * O roteiro de regressão fixo é outra coisa: `bash scripts/validar.sh navegador`.
 * Este driver é pro caso "mudei X, quero ver X na tela".
 *
 * Sobe o Chrome sozinho se a porta CDP estiver livre; reusa se já estiver no ar.
 * Faz login com VALIDACAO_EMAIL/VALIDACAO_SENHA antes do primeiro comando, então
 * as rotas de /(app) já abrem autenticadas.
 *
 * Comandos (um por linha, `#` comenta):
 *   ir <rota>                  navega e espera o load
 *   shot <nome> [largura]      screenshot (default 1440; use 390 pra celular)
 *   clicar <seletor>           clique real de mouse
 *   texto <seletor> <texto>    clica no elemento cujo texto contém <texto>
 *   preencher <seletor> <val>  set nativo + eventos input/change
 *   esperar <expr JS>          espera a expressão virar verdadeira (15s)
 *   ver [regex]                imprime o texto da página (ou só o que casar)
 *   url                        imprime pathname + query
 *   medir <seletor>            largura/altura do elemento e se o doc rola
 *   js <expr>                  avalia e imprime o resultado
 *   erros                      imprime os erros de console acumulados
 */
import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { createInterface } from 'node:readline'

import { conectar } from '../../../scripts/navegador-cdp.mjs'

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:3111'
const PORTA_CDP = Number(process.env.VALIDACAO_PORTA_CDP ?? 9222)
const SHOTS = process.env.VALIDACAO_SHOTS ?? '/tmp/gc-validacao/shots'
const CHROME =
  process.env.CHROME_BIN ??
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

mkdirSync(SHOTS, { recursive: true })

async function cdpNoAr() {
  try {
    const r = await fetch(`http://127.0.0.1:${PORTA_CDP}/json/version`)
    return r.ok
  } catch {
    return false
  }
}

// Servidor é responsabilidade de quem chama: subir aqui deixaria um processo
// órfão a cada execução, e a primeira compilação do `next dev` leva ~12s.
try {
  const r = await fetch(`${BASE}/login`)
  if (!r.ok) throw new Error(String(r.status))
} catch (e) {
  console.error(
    `FALHA: ${BASE}/login não respondeu (${e.message}).\n` +
      '  Suba o servidor antes:  npx next dev -p 3111 &',
  )
  process.exit(1)
}

if (!(await cdpNoAr())) {
  const chrome = spawn(
    CHROME,
    [
      '--headless=new',
      `--remote-debugging-port=${PORTA_CDP}`,
      '--no-first-run',
      '--user-data-dir=/tmp/gc-validacao/chrome-profile',
      'about:blank',
    ],
    { detached: true, stdio: 'ignore' },
  )

  // Sem este handler, binário inexistente emite 'error' não tratado e o Node
  // morre com stack trace em vez de dizer o que fazer.
  chrome.on('error', (e) => {
    console.error(`FALHA ao abrir o Chrome em "${CHROME}": ${e.message}`)
    console.error('  Defina CHROME_BIN com o caminho do binário.')
    process.exit(1)
  })
  chrome.unref()

  for (let i = 0; i < 30 && !(await cdpNoAr()); i++) {
    await new Promise((r) => setTimeout(r, 500))
  }
  if (!(await cdpNoAr())) {
    console.error(`FALHA: Chrome não abriu a porta ${PORTA_CDP}. Confira CHROME_BIN.`)
    process.exit(1)
  }
}

const b = await conectar({ porta: PORTA_CDP })

// Perfil do Chrome guarda cookie entre execuções: começar limpo e logar sempre
// deixa cada execução independente da anterior.
await b.limparSessao()
await b.ir(`${BASE}/login`)
if (process.env.VALIDACAO_EMAIL && process.env.VALIDACAO_SENHA) {
  await b.preencher('#email', process.env.VALIDACAO_EMAIL)
  await b.preencher('#password', process.env.VALIDACAO_SENHA)
  await b.clicar('button[type="submit"]')
  await b.esperar('location.pathname !== "/login"', { rotulo: 'login', ms: 25000 })
  console.log(`# logado como ${process.env.VALIDACAO_EMAIL}`)
} else {
  console.log('# sem VALIDACAO_EMAIL/SENHA: seguindo deslogado')
}

let erro = false

for await (const bruta of createInterface({ input: process.stdin })) {
  const linha = bruta.trim()
  if (!linha || linha.startsWith('#')) continue

  const [cmd, ...resto] = linha.split(/\s+/)
  const arg = resto.join(' ')

  try {
    switch (cmd) {
      case 'ir':
        await b.ir(BASE + arg)
        console.log(`ir ${await b.url()}`)
        break
      case 'shot': {
        const [nome, largura] = arg.split(/\s+/)
        const caminho = `${SHOTS}/${nome || 'shot'}.png`
        await b.screenshot(caminho, { largura: Number(largura) || 1440 })
        console.log(`shot ${caminho}`)
        break
      }
      case 'clicar':
        await b.clicar(arg)
        console.log(`clicar ok`)
        break
      case 'texto': {
        const [seletor, ...t] = resto
        await b.clicar(seletor, { texto: t.join(' ') })
        console.log(`texto ok`)
        break
      }
      case 'preencher': {
        const [seletor, ...valor] = resto
        await b.preencher(seletor, valor.join(' '))
        console.log(`preencher ok`)
        break
      }
      case 'esperar':
        await b.esperar(arg)
        console.log(`esperar ok`)
        break
      case 'ver': {
        const txt = await b.texto()
        if (!arg) console.log(txt.slice(0, 1500))
        else {
          const achados = txt.match(new RegExp(arg, 'gi'))
          console.log(achados ? achados.join(' | ') : `(nada casou: ${arg})`)
        }
        break
      }
      case 'url':
        console.log(await b.url())
        break
      case 'medir': {
        const m = await b.avaliar(`(() => {
          const el = document.querySelector(${JSON.stringify(arg)});
          const r = el && el.getBoundingClientRect();
          return {
            existe: !!el,
            largura: r ? Math.round(r.width) : null,
            altura: r ? Math.round(r.height) : null,
            viewport: window.innerWidth,
            docRolaHorizontal: document.documentElement.scrollWidth > window.innerWidth,
          };
        })()`)
        console.log(JSON.stringify(m))
        break
      }
      case 'js':
        console.log(JSON.stringify(await b.avaliar(arg)))
        break
      case 'erros': {
        const reais = b.erros.filter((e) => !/favicon|React DevTools/i.test(e))
        console.log(reais.length ? reais.join('\n') : '(nenhum)')
        break
      }
      default:
        console.log(`comando desconhecido: ${cmd}`)
        erro = true
    }
  } catch (e) {
    console.log(`FALHA em "${linha}": ${e.message}`)
    erro = true
  }
}

b.fechar()
process.exit(erro ? 1 : 0)
