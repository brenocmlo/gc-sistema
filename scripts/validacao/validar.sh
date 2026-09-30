#!/usr/bin/env bash
# Plano de validação do gc-sistema, em camadas, da mais barata pra mais caras.
# Roda ANTES de declarar uma task pronta. Ver docs/tecnicos/plano-validacao.md.
#
# Uso:
#   bash scripts/validacao/validar.sh                  # todas as camadas, em ordem
#   bash scripts/validacao/validar.sh estatico unit    # só as camadas pedidas
#   bash scripts/validacao/validar.sh --lista          # o que cada camada faz
#
# Camadas: estatico | unit | build | runtime | dados | escrita | navegador
#
# Para no primeiro erro: camada barata que falha invalida as caras, e seguir
# em frente só produz ruído. O resumo final diz o que passou e o que não rodou.
set -uo pipefail

cd "$(dirname "$0")/../.."

# Pasta de build própria da validação (next.config.mjs lê a variável). Na
# `.next`, o next build daqui corrompia o `next dev` aberto: páginas sem CSS e
# código velho. Os scripts .mjs recebem a mesma variável.
export NEXT_DIST_DIR="${NEXT_DIST_DIR:-.next-validacao}"

# IPv4 primeiro, para os scripts e para o next start/dev (que herdam). A rede
# daqui é IPv6 com NAT64, o Supabase resolve para 64:ff9b::…, e nesse caminho
# a conexão caía no meio da camada escrita com `fetch failed` (fechamento da
# sprint 9, duas rodadas perdidas). Com IPv4 primeiro, passou.
export NODE_OPTIONS="--dns-result-order=ipv4first${NODE_OPTIONS:+ $NODE_OPTIONS}"

# Regra do projeto: nada roda contra gc-prod (ver CLAUDE.md). As camadas
# runtime e dados conectam no banco, então a trava vem antes de qualquer uma.
GC_DEV_REF="gzbmhgnpoehormnidmgg"

PORTA="${VALIDACAO_PORTA:-3111}"
# 9333, não 9222: a 9222 é a de depuração padrão e costuma estar com o Chrome
# de quem desenvolve; aí o Chrome da validação só abria em [::1] e o script
# lia o /json/version do Chrome errado.
PORTA_CDP="${VALIDACAO_PORTA_CDP:-9333}"
BASE_URL="http://127.0.0.1:$PORTA"
BUILD_LOG="$(mktemp)"
ROTAS_BASELINE="scripts/validacao/rotas-esperadas.txt"
SERVER_PID=""
CHROME_PID=""
RECEPTOR_PID=""
# Portas em que ESTA execução subiu servidor. Só essas são derrubadas: uma
# porta que já estava ocupada é de outra pessoa (ou de outra rodada).
PORTAS_NOSSAS=()

# npm/npx não repassam SIGTERM ao servidor que criam: matar o listener da
# porta é o que de fato a libera. Espera ela soltar, para a camada seguinte
# não pegar EADDRINUSE e falar com o servidor da anterior.
derrubar_servidor() {
  local porta="$1" i
  [[ -n "$SERVER_PID" ]] && kill "$SERVER_PID" 2>/dev/null || true
  SERVER_PID=""
  for i in $(seq 1 20); do
    lsof -ti:"$porta" -sTCP:LISTEN 2>/dev/null | xargs -r kill 2>/dev/null || true
    lsof -ti:"$porta" -sTCP:LISTEN >/dev/null 2>&1 || return 0
    sleep 0.5
  done
  echo "  a porta $porta não liberou depois de 10s."
  return 1
}

# Porta ocupada antes de subir o servidor quer dizer que o fetch vai falar com
# outro processo — em 2026-09-29 a escrita testou o servidor que sobrou do
# runtime, e poderia ter sido um `next start` velho, com código antigo.
exigir_porta_livre() {
  local porta="$1" pid
  pid="$(lsof -ti:"$porta" -sTCP:LISTEN 2>/dev/null | head -1)"
  [[ -z "$pid" ]] && return 0
  echo "  a porta $porta já está ocupada: $(ps -o pid=,command= -p "$pid" | cut -c1-100)"
  echo "  Encerre o processo ou use outra porta (VALIDACAO_PORTA / VALIDACAO_PORTA_CDP)."
  return 1
}

limpar() {
  [[ -n "$SERVER_PID" ]] && kill "$SERVER_PID" 2>/dev/null || true
  [[ -n "$CHROME_PID" ]] && kill "$CHROME_PID" 2>/dev/null || true
  [[ -n "$RECEPTOR_PID" ]] && kill "$RECEPTOR_PID" 2>/dev/null || true
  local porta
  for porta in "${PORTAS_NOSSAS[@]+"${PORTAS_NOSSAS[@]}"}"; do
    lsof -ti:"$porta" -sTCP:LISTEN 2>/dev/null | xargs -r kill 2>/dev/null || true
  done
  rm -f "$BUILD_LOG"
}
trap limpar EXIT

# ---------- saída ----------
VERDE=$'\033[32m'; VERMELHO=$'\033[31m'; CINZA=$'\033[90m'; NEGRITO=$'\033[1m'; ZERA=$'\033[0m'
RESUMO=()

titulo() { printf '\n%s>> %s%s\n' "$NEGRITO" "$1" "$ZERA"; }
ok()     { RESUMO+=("${VERDE}ok${ZERA}     $1 ${CINZA}($2)${ZERA}"); }
falhou() { RESUMO+=("${VERMELHO}FALHOU${ZERA} $1 ${CINZA}($2)${ZERA}"); }
pulou()  { RESUMO+=("${CINZA}-      $1 (não rodou)${ZERA}"); }

lista() {
  cat <<'TXT'
estatico  tsc --noEmit + next lint. Prova que compila e segue o lint.
          NÃO prova que roda.
unit      npm test. Prova a regra pura dos helpers (node --test).
          NÃO prova query, render nem integração.
build     next build + diff da lista de rotas contra scripts/validacao/rotas-esperadas.txt.
          Prova que toda rota monta e que nenhuma sumiu sem intenção.
          NÃO prova que a página abre.
runtime   next start + fetch autenticado das rotas de scripts/validacao/validacao-rotas.json.
          Prova que a rota responde 200 com sessão, redireciona sem sessão, e
          que o HTML tem o conteúdo esperado. NÃO prova aparência.
dados     queries reais da aplicação contra gc-dev, sob RLS (scripts/validacao/validar-dados.mjs).
          Prova select, JOIN e policy. NÃO prova a tela.
escrita   Server Actions chamadas por HTTP, contra gc-dev (scripts/validacao/validar-escrita.mjs).
          Prova criar, editar, mudar status, histórico, anexo e excluir, com as
          regras de perfil. Limpa o que cria. NÃO prova o clique.
navegador Chrome headless dirigido por CDP sobre o `next dev`
          (scripts/validacao/validar-navegador.mjs). Prova o que só roda no cliente: zod
          do formulário, cálculo ao vivo, diálogo condicional, toast, navegação
          e o ConfirmDialog. Deixa screenshots. Mais lenta que as outras.
TXT
}

exigir_gc_dev() {
  local url ref
  url="$(sed -nE 's/^NEXT_PUBLIC_SUPABASE_URL=(.*)$/\1/p' .env.local | tail -1)"
  ref="$(printf '%s' "$url" | sed -E 's#^https?://([^.]+)\..*#\1#')"

  if [[ "$ref" != "$GC_DEV_REF" ]]; then
    echo "  .env.local aponta pra '$ref', não pra gc-dev ($GC_DEV_REF)."
    echo "  Trabalhar em gc-prod está fora do escopo — ver CLAUDE.md."
    return 1
  fi
}

# ---------- camadas ----------
camada_estatico() {
  titulo "1/7 estático — tsc + lint"
  local t0=$SECONDS
  if npx tsc --noEmit && npm run lint; then
    ok estatico "$((SECONDS - t0))s"
  else
    falhou estatico "$((SECONDS - t0))s"; return 1
  fi
}

camada_unit() {
  titulo "2/7 unitário — npm test"
  local t0=$SECONDS
  local saida limpa casos
  if saida="$(npm test 2>&1)"; then
    limpa="$(printf '%s' "$saida" | sed -E $'s/\033\[[0-9;]*m//g')"
    echo "$limpa" | grep -E '^ℹ (tests|pass|fail)' || true
    casos="$(echo "$limpa" | sed -nE 's/^ℹ pass ([0-9]+)$/\1/p' | tail -1)"
    ok unit "$((SECONDS - t0))s, ${casos:-?} casos"
  else
    echo "$saida" | tail -30
    falhou unit "$((SECONDS - t0))s"; return 1
  fi
}

camada_build() {
  titulo "3/7 build — next build + rotas"
  local t0=$SECONDS
  if ! npm run build > "$BUILD_LOG" 2>&1; then
    tail -30 "$BUILD_LOG"
    falhou build "$((SECONDS - t0))s"; return 1
  fi

  # Lista de rotas do output, sem cores nem tamanhos: só os caminhos.
  local rotas
  rotas="$(sed -E 's/\x1b\[[0-9;]*m//g' "$BUILD_LOG" \
    | grep -E '^[┌├└][^ ]* (ƒ|○|●) ' \
    | awk '{print $3}' | sort)"

  if [[ ! -f "$ROTAS_BASELINE" ]]; then
    echo "$rotas" > "$ROTAS_BASELINE"
    echo "  baseline criada: $ROTAS_BASELINE ($(echo "$rotas" | wc -l | tr -d ' ') rotas)"
    ok build "$((SECONDS - t0))s, baseline criada"
    return 0
  fi

  local n_atual n_base
  n_atual="$(echo "$rotas" | wc -l | tr -d ' ')"
  n_base="$(wc -l < "$ROTAS_BASELINE" | tr -d ' ')"

  if diff -u "$ROTAS_BASELINE" <(echo "$rotas") > /tmp/rotas.diff; then
    echo "  $n_atual rotas, iguais à baseline"
    ok build "$((SECONDS - t0))s, $n_atual rotas"
  else
    echo "  rotas mudaram ($n_base → $n_atual):"
    sed -E 's/^/    /' /tmp/rotas.diff | grep -E '^\s+[+-]/' || true
    echo "  Se a mudança é intencional, atualize a baseline:"
    echo "    bash scripts/validacao/validar.sh build --aceitar-rotas"
    falhou build "$((SECONDS - t0))s, rotas divergentes"; return 1
  fi
}

camada_runtime() {
  titulo "4/7 runtime — next start + fetch autenticado"
  local t0=$SECONDS

  if ! exigir_gc_dev; then
    falhou runtime "0s, banco errado"; return 1
  fi

  if [[ ! -d "$NEXT_DIST_DIR" ]]; then
    echo "  $NEXT_DIST_DIR não existe — rode a camada build antes."
    falhou runtime "0s, sem build"; return 1
  fi

  # `next dev` sobrescreve o $NEXT_DIST_DIR de produção, e aí o `next start` sobe mas
  # devolve 500 em toda rota. Detectar aqui evita caçar o erro no lugar errado.
  if [[ -d "$NEXT_DIST_DIR/static/development" ]]; then
    echo "  $NEXT_DIST_DIR é de um 'next dev' — rode a camada build antes:"
    echo "    bash scripts/validacao/validar.sh build runtime"
    echo "  (a camada 'navegador' roda next dev e deixa o $NEXT_DIST_DIR assim; rodando"
    echo "   o plano inteiro isso não acontece, porque build vem antes.)"
    falhou runtime "0s, build de dev"; return 1
  fi

  if ! exigir_porta_livre "$PORTA"; then
    falhou runtime "0s, porta ocupada"; return 1
  fi
  PORTAS_NOSSAS+=("$PORTA")
  npx next start -p "$PORTA" > /tmp/validar-next.log 2>&1 &
  SERVER_PID=$!

  # Espera qualquer resposta HTTP (mesmo 5xx): "não respondeu" e "respondeu
  # errado" são problemas diferentes e precisam de mensagens diferentes.
  local i codigo=000
  for i in $(seq 1 40); do
    codigo="$(curl -s -o /dev/null -w '%{http_code}' "$BASE_URL/login")"
    [[ "$codigo" != "000" ]] && break
    sleep 1
  done

  if [[ "$codigo" == "000" ]]; then
    tail -20 /tmp/validar-next.log
    falhou runtime "$((SECONDS - t0))s, servidor não respondeu"; return 1
  fi

  if [[ "$codigo" != "200" ]]; then
    echo "  /login devolveu $codigo — o servidor subiu, mas a aplicação não."
    echo "  Costuma ser $NEXT_DIST_DIR desatualizado: rode a camada build."
    tail -20 /tmp/validar-next.log
    falhou runtime "$((SECONDS - t0))s, /login devolveu $codigo"; return 1
  fi

  local r=0
  BASE_URL="$BASE_URL" node --env-file=.env.local scripts/validacao/validar-runtime.mjs || r=$?
  derrubar_servidor "$PORTA"
  if [[ $r -eq 0 ]]; then
    ok runtime "$((SECONDS - t0))s"
  else
    falhou runtime "$((SECONDS - t0))s"; return 1
  fi
}

camada_dados() {
  titulo "5/7 dados — queries reais contra gc-dev (RLS)"
  local t0=$SECONDS

  if ! exigir_gc_dev; then
    falhou dados "0s, banco errado"; return 1
  fi
  if node --env-file=.env.local scripts/validacao/validar-dados.mjs; then
    ok dados "$((SECONDS - t0))s"
  else
    falhou dados "$((SECONDS - t0))s"; return 1
  fi
}

camada_escrita() {
  titulo "6/7 escrita — Server Actions contra gc-dev"
  local t0=$SECONDS

  if ! exigir_gc_dev; then
    falhou escrita "0s, banco errado"; return 1
  fi

  if [[ ! -d "$NEXT_DIST_DIR" ]] || [[ -d "$NEXT_DIST_DIR/static/development" ]]; then
    echo "  precisa do build de produção (o mapa de actions vem do $NEXT_DIST_DIR)."
    falhou escrita "0s, sem build"; return 1
  fi

  if ! exigir_porta_livre "$PORTA"; then
    falhou escrita "0s, porta ocupada"; return 1
  fi

  # O envio de documento pela tela chama o webhook do n8n. Sem
  # VALIDACAO_ENVIO_REAL=1, o webhook é um receptor local (receptor-n8n.mjs):
  # o next start recebe a URL e um token de teste pelo ambiente (que vence o
  # .env.local), e o roteiro confere o que chegou lá.
  local env_n8n=()
  if [[ "${VALIDACAO_ENVIO_REAL:-}" != "1" ]]; then
    local porta_n8n=$((PORTA + 2))
    if ! exigir_porta_livre "$porta_n8n"; then
      falhou escrita "0s, porta do receptor ocupada"; return 1
    fi
    node scripts/validacao/receptor-n8n.mjs "$porta_n8n" &
    RECEPTOR_PID=$!
    # Sem o disown, o kill no fim da camada sai no log como "Terminated".
    disown "$RECEPTOR_PID" 2>/dev/null || true
    local token_n8n="validacao-$RANDOM$RANDOM"
    env_n8n=(
      N8N_DOCUMENTO_WEBHOOK_URL="http://127.0.0.1:$porta_n8n/webhook/processar-documento"
      N8N_DOCUMENTO_TOKEN="$token_n8n"
      VALIDACAO_RECEPTOR_N8N="http://127.0.0.1:$porta_n8n"
      VALIDACAO_N8N_TOKEN="$token_n8n"
    )
  fi

  PORTAS_NOSSAS+=("$PORTA")
  env "${env_n8n[@]+"${env_n8n[@]}"}" npx next start -p "$PORTA" > /tmp/validar-next-escrita.log 2>&1 &
  SERVER_PID=$!

  local i codigo=000
  for i in $(seq 1 40); do
    codigo="$(curl -s -o /dev/null -w '%{http_code}' "$BASE_URL/login")"
    [[ "$codigo" != "000" ]] && break
    sleep 1
  done

  if [[ "$codigo" != "200" ]]; then
    echo "  /login devolveu $codigo — servidor não está servindo a aplicação."
    tail -20 /tmp/validar-next-escrita.log
    falhou escrita "$((SECONDS - t0))s, /login devolveu $codigo"; return 1
  fi

  local r=0
  env "${env_n8n[@]+"${env_n8n[@]}"}" BASE_URL="$BASE_URL" \
    node --env-file=.env.local scripts/validacao/validar-escrita.mjs || r=$?
  derrubar_servidor "$PORTA"
  [[ -n "$RECEPTOR_PID" ]] && kill "$RECEPTOR_PID" 2>/dev/null || true
  RECEPTOR_PID=""
  if [[ $r -eq 0 ]]; then
    ok escrita "$((SECONDS - t0))s"
  else
    falhou escrita "$((SECONDS - t0))s"; return 1
  fi
}

camada_navegador() {
  titulo "7/7 navegador — Chrome headless sobre o next dev"
  local t0=$SECONDS

  if ! exigir_gc_dev; then
    falhou navegador "0s, banco errado"; return 1
  fi

  local chrome="${CHROME_BIN:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
  if [[ ! -x "$chrome" ]]; then
    echo "  Chrome não encontrado em: $chrome (defina CHROME_BIN)."
    falhou navegador "0s, sem Chrome"; return 1
  fi

  # `next dev` de propósito: a camada exercita o cliente, e o dev server dá erro
  # legível. Porta própria pra não colidir com a camada runtime.
  local porta_dev=$((PORTA + 1))
  if ! exigir_porta_livre "$porta_dev" || ! exigir_porta_livre "$PORTA_CDP"; then
    falhou navegador "0s, porta ocupada"; return 1
  fi
  PORTAS_NOSSAS+=("$porta_dev")
  npx next dev -p "$porta_dev" > /tmp/validar-next-dev.log 2>&1 &
  SERVER_PID=$!

  "$chrome" --headless=new --remote-debugging-port="$PORTA_CDP" --no-first-run     --user-data-dir="/tmp/gc-validacao/chrome-profile-$PORTA_CDP" about:blank     > /tmp/validar-chrome.log 2>&1 &
  CHROME_PID=$!

  local i codigo=000
  for i in $(seq 1 90); do
    codigo="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$porta_dev/login")"
    [[ "$codigo" == "200" ]] && break
    sleep 1
  done

  if [[ "$codigo" != "200" ]]; then
    echo "  /login devolveu $codigo no next dev."
    tail -20 /tmp/validar-next-dev.log
    falhou navegador "$((SECONDS - t0))s, dev server não respondeu"; return 1
  fi

  for i in $(seq 1 30); do
    curl -sf -o /dev/null "http://127.0.0.1:$PORTA_CDP/json/version" && break
    sleep 1
  done

  # A porta do CDP vai junto: sem ela o script conectava sempre na 9222 e, com
  # duas rodadas em paralelo (VALIDACAO_PORTA_CDP diferente), dirigia o Chrome
  # da outra. Pelo mesmo motivo o perfil do Chrome é um por porta.
  if BASE_URL="http://127.0.0.1:$porta_dev" VALIDACAO_PORTA_CDP="$PORTA_CDP" \
    node --env-file=.env.local scripts/validacao/validar-navegador.mjs; then
    ok navegador "$((SECONDS - t0))s"
  else
    falhou navegador "$((SECONDS - t0))s"; return 1
  fi
}

# ---------- orquestração ----------
TODAS=(estatico unit build runtime dados escrita navegador)
ACEITAR_ROTAS=0
PEDIDAS=()

for arg in "$@"; do
  case "$arg" in
    --lista|-l) lista; exit 0 ;;
    --aceitar-rotas) ACEITAR_ROTAS=1 ;;
    estatico|unit|build|runtime|dados|escrita|navegador) PEDIDAS+=("$arg") ;;
    *) echo "camada desconhecida: $arg (use --lista)" >&2; exit 2 ;;
  esac
done

[[ ${#PEDIDAS[@]} -eq 0 ]] && PEDIDAS=("${TODAS[@]}")
[[ $ACEITAR_ROTAS -eq 1 ]] && rm -f "$ROTAS_BASELINE"

FALHOU=""

# Sobra de rodada interrompida esconde dado de que outra camada depende e a
# faz falhar com mensagem enganosa. Confere uma vez, antes da primeira camada
# que usa o banco.
if [[ " ${PEDIDAS[*]} " =~ \ (runtime|dados|escrita|navegador)\  ]]; then
  titulo "0/7 sobras — registros VALIDA-* e RUN-* de rodadas anteriores"
  if ! exigir_gc_dev || ! node --env-file=.env.local scripts/validacao/verificar-sobras.mjs; then
    falhou sobras "gc-dev com sobras"
    FALHOU="sobras"
  fi
fi

for camada in "${TODAS[@]}"; do
  # Mantém sempre a ordem barato → caro, independente da ordem dos argumentos.
  [[ " ${PEDIDAS[*]} " == *" $camada "* ]] || continue

  if [[ -n "$FALHOU" ]]; then
    pulou "$camada"
    continue
  fi

  "camada_$camada" || FALHOU="$camada"
done

printf '\n%s>> resumo%s\n' "$NEGRITO" "$ZERA"
for linha in "${RESUMO[@]}"; do printf '  %s\n' "$linha"; done

if [[ -n "$FALHOU" ]]; then
  printf '\n%sReprovado na camada %s. Task NÃO está pronta.%s\n' "$VERMELHO" "$FALHOU" "$ZERA"
  exit 1
fi

printf '\n%sTodas as camadas pedidas passaram.%s Registre os números no doc do bloco.\n' "$VERDE" "$ZERA"
