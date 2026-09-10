---
name: run-gc-sistema
description: Sobe e dirige o gc-sistema (Next.js + Supabase) num Chrome headless para ver uma mudança funcionando na tela de verdade. Use quando pedirem para rodar, iniciar, abrir, testar na tela, clicar, tirar screenshot ou conferir visualmente o app — "roda o app", "abre /propostas", "screenshot da listagem", "run the app", "check my change in the browser". Cobre login, clique, preenchimento de formulário, medição de layout responsivo e coleta de erro de console.
---

# Rodar e dirigir o gc-sistema

App Next.js 14 (App Router) + Supabase. Toda rota de `/(app)` passa por
middleware que exige sessão, então **abrir a URL sem login só prova o
redirect** — dirigir o app significa autenticar primeiro.

Não há Playwright nem `chromium-cli` aqui. O que existe é o Chrome local (o
mesmo que `scripts/docs-pdf.sh` usa) dirigido por CDP através do WebSocket
nativo do Node 24: driver em `scripts/navegador-cdp.mjs`, ~120 linhas, zero
dependência.

Caminhos abaixo são relativos à raiz do repositório.

## Pré-requisitos

Nada de `apt-get`: é macOS, e as duas coisas necessárias já estão no lugar.

```bash
node --version                                    # v24.14.1 — precisa de 24+ (WebSocket nativo)
ls "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"   # o driver usa este binário
grep -c '^VALIDACAO_' .env.local                  # 4 — o login que o driver usa
```

`CHROME_BIN` sobrepõe o caminho do Chrome se ele estiver em outro lugar.

**O `.env.local` precisa apontar para gc-dev.** Os scripts abortam sozinhos se
não apontar (`scripts/gc-dev-guard.mjs`): trabalhar em gc-prod está fora do
escopo do projeto.

## Rodar (caminho do agente)

### 1. Suba o servidor e deixe no ar

```bash
npx next dev -p 3111 > /tmp/gc-dev.log 2>&1 &
for i in $(seq 1 60); do c=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3111/login); [ "$c" = "200" ] && break; sleep 1; done; echo "dev server: $c"
```

Espere o `200`. A primeira compilação leva ~12s — `sleep` fixo não serve.

### 2. Dirija com o driver

O driver lê comandos do stdin, sobe o Chrome sozinho se preciso e **faz login
antes do primeiro comando**:

```bash
node --env-file=.env.local .claude/skills/run-gc-sistema/driver.mjs <<'CMD'
ir /propostas
esperar document.querySelector("table")
ver Data emissão|Valor final|Nova proposta
shot listagem
medir main
erros
CMD
```

Saída real desta sessão:

```
# logado como breno@obraminds.com
ir /propostas
esperar ok
Nova proposta | Data emissão | Valor final
shot /tmp/gc-validacao/shots/listagem.png
{"existe":true,"largura":1200,"altura":815,"viewport":1440,"docRolaHorizontal":false}
(nenhum)
```

Screenshots vão para `/tmp/gc-validacao/shots` (`$VALIDACAO_SHOTS` muda).
**Abra o PNG e olhe.** Tela branca é falha de renderização, não sucesso.

### Comandos

| Comando | O que faz |
|---|---|
| `ir <rota>` | navega e espera o load |
| `shot <nome> [largura]` | screenshot; largura default 1440, use `390` para celular |
| `clicar <seletor>` | clique real de mouse (rola até o elemento e acerta o ponto) |
| `texto <seletor> <texto>` | clica no elemento cujo texto contém `<texto>` |
| `preencher <seletor> <valor>` | setter nativo + eventos `input`/`change` (react-hook-form precisa dos dois) |
| `esperar <expr JS>` | espera a expressão virar verdadeira, 15s |
| `ver [regex]` | texto da página, ou só o que casar com a regex |
| `url` | pathname + query |
| `medir <seletor>` | largura/altura do elemento, viewport e se o documento rola na horizontal |
| `js <expr>` | avalia e imprime |
| `erros` | erros de console acumulados |

### 3. Um fluxo de formulário, verificado

```bash
node --env-file=.env.local .claude/skills/run-gc-sistema/driver.mjs <<'CMD'
ir /propostas
texto a Nova proposta
esperar document.querySelector("#numero")
preencher #numero DRIVER-TESTE
preencher #valor_total 5000
preencher #desconto 500
js document.querySelector("#valor_final_preview").value
preencher #pct_sinal 70
preencher #pct_fd 70
ver Soma das parcelas.{0,20}
clicar button[type="submit"]
esperar document.body.innerText.includes("100%")
ver não pode passar de 100%
url
CMD
```

Devolveu `"R$ 4.500,00"`, `Soma das parcelas 140%`, a mensagem de erro do zod e
`/propostas/nova` — o submit foi barrado no cliente, como deveria. **Este
roteiro não grava nada**, porque nunca chega a salvar.

### 4. Regressão completa, se a mudança for grande

O roteiro fixo de Propostas (criar → enviar → histórico → excluir, com limpeza)
é a camada 7 do plano de validação, e sobe servidor e Chrome sozinha:

```bash
bash scripts/validar.sh navegador     # 20/20 passos, ~30s
bash scripts/validar.sh               # as sete camadas
```

Ver `docs/tecnicos/plano-validacao.md`.

## Rodar (caminho humano)

```bash
npm run dev     # http://localhost:3000, login em /login
```

Serve para olhar com os próprios olhos. Para um agente headless não serve:
nenhuma rota de `/(app)` abre sem sessão.

## Escrita no banco: cuidado

O driver loga como **admin em gc-dev**, então clicar em "Salvar" ou "Excluir"
grava de verdade. Duas regras:

1. **Limpe o que criar.** Use um número reconhecível (`DRIVER-...`) e exclua
   pela própria tela no fim.
2. **Confira depois.** Uma execução interrompida no meio deixa sobra — foi o
   que aconteceu nesta sessão, com uma proposta `RUN-131923` órfã. Para
   auditar: abrir `/propostas` e procurar números de teste.

## Gotchas

Coisas que pareciam funcionar e não funcionavam:

- **`.next` de dev e de produção brigam.** Um `next dev` sobrescreve o build de
  produção; depois `next start` sobe, imprime "Ready", e devolve **500 em toda
  rota**. Sintoma enganoso: parece que o servidor não subiu. Rode
  `npm run build` antes de usar `next start`. O `scripts/validar.sh` detecta
  `.next/static/development` e avisa.

- **Prontidão do servidor: nunca teste com `curl -sf`.** O `-f` trata 500 como
  falha de conexão, e aí "não respondeu" e "respondeu errado" viram a mesma
  mensagem. Teste com `-w '%{http_code}'` e compare com `200`.

- **O perfil do Chrome guarda cookie entre execuções.** Sem
  `Network.clearBrowserCookies` no começo, a segunda execução já está logada e
  a asserção "sem sessão vai pro /login" falha sem motivo. O driver limpa
  sozinho.

- **`Emulation.setDeviceMetricsOverride` com `mobile: true` impõe viewport
  mínimo de ~552px**, justamente mascarando a largura estreita que se quer
  medir. O driver usa `mobile: false`; pedir 390 entrega 390.

- **Espere o reflow com `setTimeout`, não `requestAnimationFrame`.** No
  headless o rAF depende de pintura e às vezes não dispara depois de trocar o
  viewport — o `Runtime.evaluate` fica pendurado até estourar o timeout. Custou
  um `FALHA em "shot ...": timeout` inexplicável.

- **Texto repetido precisa de escopo.** "Excluir" existe no header **e** no
  `ConfirmDialog`. Sem `[role="dialog"] button`, o clique volta pro header e o
  diálogo nunca confirma — a espera estoura em algo que parece não ter relação.

- **Toast morre antes de você olhar.** O sonner vive ~4s, e a primeira
  compilação de uma rota em `next dev` leva mais que isso — então o toast de
  criação já expirou quando o detalhe aparece. Afira toast em navegação já
  compilada.

- **Trecho de HTML nunca atravessa interpolação de JSX.** O SSR do React insere
  `<!-- -->` entre texto literal e `{valor}`: `Proposta {numero}` não existe
  como string contínua. Espere `SEED-VENCIDA-001`, não `Proposta SEED-...`.

- **A sidebar não é responsiva.** `w-60 shrink-0` sem breakpoint: em 390px ela
  ocupa 240px, sobram **150px** de conteúdo e o documento passa a rolar na
  horizontal. Vale para as quatro listagens. Reproduza com
  `shot x 390` + `medir main`. É problema conhecido e **não corrigido** — está
  registrado em `docs/4.5-status-entrega.md`.

## Troubleshooting

| Sintoma | Causa e correção |
|---|---|
| `FALHA: .../login não respondeu (500)` | `.next` de dev servido por `next start`. Rode `npm run build`, ou use `next dev`. |
| `FALHA ao abrir o Chrome em "..." : spawn ... ENOENT` | Chrome fora do caminho padrão: exporte `CHROME_BIN`. |
| `FALHA: Chrome não abriu a porta 9222` | Binário existe mas não subiu — veja se já há Chrome usando a porta. |
| `FALHA: ... só roda contra gc-dev` | `.env.local` aponta pra outro projeto Supabase. Trabalhar em gc-prod é fora do escopo. |
| `sem elemento pra clicar: <sel>` | O elemento não renderizou ainda. Ponha um `esperar` antes. |
| `timeout: Runtime.evaluate` | Página navegou no meio do comando; refaça o `ir` e espere. |
| `esperando demais por: X` | Antes de mexer no código, **olhe o screenshot** — costuma ser a asserção errada, não a tela. |
| Porta ocupada ao relançar | `lsof -ti:3111,9222 -sTCP:LISTEN \| xargs -r kill` (npm não repassa SIGTERM ao filho). |

## Arquivos

| Arquivo | O que é |
|---|---|
| `.claude/skills/run-gc-sistema/driver.mjs` | driver ad-hoc: comandos pelo stdin |
| `scripts/navegador-cdp.mjs` | o CDP em si — navegar, clicar, medir, screenshot |
| `scripts/validar-navegador.mjs` | roteiro fixo de Propostas (camada 7) |
| `scripts/gc-dev-guard.mjs` | trava: nada roda fora de gc-dev |
