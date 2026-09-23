/**
 * Empacota a regra de ingestão (src/lib/{historico,itens,propostas,ingestao}.ts)
 * num JS único, para colar no Code node "Montar ingestão" do workflow n8n
 * "Obraminds - Processar Documento" (thlKSZcBPX84Y51N).
 *
 *   node scripts/empacotar-ingestao-n8n.mjs > /tmp/ingestao-n8n.js
 *
 * Por que existe: enquanto o n8n não alcança a rota POST /api/ingestao/proposta
 * (não há deploy do gc-sistema apontando para o gc-dev), o workflow grava por
 * REST — mas com a MESMA regra, não com uma cópia escrita à mão. Mudou o
 * ingestao.ts ou um helper que ele usa, regere e cole de novo no nó (a parte
 * acima de "===== fim do codigo gerado =====").
 *
 * Sem dependência: usa o stripTypeScriptTypes do próprio Node (>= 22.13).
 */
import { readFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import { execSync } from 'node:child_process'

const raiz = new URL('../src/lib/', import.meta.url).pathname
const ordem = ['historico', 'itens', 'propostas', 'ingestao']
let saida = ''
for (const nome of ordem) {
  let js = stripTypeScriptTypes(readFileSync(`${raiz}${nome}.ts`, 'utf8'))
  const exportados = []
  js = js.replace(/^export\s*\{[^}]*\}\s*from\s*['"][^'"]+['"];?\s*$/gm, '')
  js = js.replace(/^export\s+type\s*\{[^}]*\}\s*from\s*['"][^'"]+['"];?\s*$/gm, '')
  js = js.replace(/^import\s*\{([^}]*)\}\s*from\s*['"]\.\/(\w+)\.ts['"];?/gm, (_, nomes, mod) => `const {${nomes}} = __mod_${mod};`)
  if (/^import /m.test(js)) throw new Error(`${nome}.ts: import que o empacotador não trata`)
  js = js.replace(/^export\s+(async\s+function|function|const|let|class)\s+(\w+)/gm, (_, kw, n) => {
    exportados.push(n)
    return `${kw} ${n}`
  })
  if (/^export /m.test(js)) throw new Error(`${nome}.ts: export que o empacotador não trata`)
  saida += `const __mod_${nome} = (() => {\n${js}\nreturn { ${exportados.join(', ')} };\n})();\n`
}
let commit = 'working tree'
try {
  commit = execSync('git log -1 --format=%h -- src/lib/historico.ts src/lib/itens.ts src/lib/propostas.ts src/lib/ingestao.ts').toString().trim()
} catch {}
process.stdout.write(
  `// ===== GERADO de src/lib/{historico,itens,propostas,ingestao}.ts (commit ${commit}) =====\n` +
    `// Não edite aqui: mude o .ts no gc-sistema e rode scripts/empacotar-ingestao-n8n.mjs.\n` +
    saida,
)
