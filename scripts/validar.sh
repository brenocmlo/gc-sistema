#!/usr/bin/env bash
# Plano de validação do gc-sistema, em camadas, da mais barata pra mais caras.
# Roda ANTES de declarar uma task pronta. Ver docs/tecnicos/plano-validacao.md.
#
# Uso:
#   bash scripts/validar.sh                  # todas as camadas, em ordem
#   bash scripts/validar.sh estatico unit    # só as camadas pedidas
#   bash scripts/validar.sh --lista          # o que cada camada faz
#
# Camadas: estatico | unit | build | runtime | dados | escrita
#
# Para no primeiro erro: camada barata que falha invalida as caras, e seguir
# em frente só produz ruído. O resumo final diz o que passou e o que não rodou.
set -uo pipefail

cd "$(dirname "$0")/.."

# Regra do projeto: nada roda contra gc-prod (ver CLAUDE.md). As camadas
# runtime e dados conectam no banco, então a trava vem antes de qualquer uma.
GC_DEV_REF="gzbmhgnpoehormnidmgg"

PORTA="${VALIDACAO_PORTA:-3111}"
BASE_URL="http://127.0.0.1:$PORTA"
BUILD_LOG="$(mktemp)"
ROTAS_BASELINE="scripts/rotas-esperadas.txt"
SERVER_PID=""

limpar() {
  [[ -n "$SERVER_PID" ]] && kill "$SERVER_PID" 2>/dev/null || true
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
build     next build + diff da lista de rotas contra scripts/rotas-esperadas.txt.
          Prova que toda rota monta e que nenhuma sumiu sem intenção.
          NÃO prova que a página abre.
runtime   next start + fetch autenticado das rotas de scripts/validacao-rotas.json.
          Prova que a rota responde 200 com sessão, redireciona sem sessão, e
          que o HTML tem o conteúdo esperado. NÃO prova aparência.
dados     queries reais da aplicação contra gc-dev, sob RLS (scripts/validar-dados.mjs).
          Prova select, JOIN e policy. NÃO prova a tela.
escrita   Server Actions chamadas por HTTP, contra gc-dev (scripts/validar-escrita.mjs).
          Prova criar, editar, mudar status, histórico, anexo e excluir, com as
          regras de perfil. Limpa o que cria. NÃO prova o clique — o formulário
          da tela e o diálogo não são acionados.
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
  titulo "1/6 estático — tsc + lint"
  local t0=$SECONDS
  if npx tsc --noEmit && npm run lint; then
    ok estatico "$((SECONDS - t0))s"
  else
    falhou estatico "$((SECONDS - t0))s"; return 1
  fi
}

camada_unit() {
  titulo "2/6 unitário — npm test"
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
  titulo "3/6 build — next build + rotas"
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
    echo "    bash scripts/validar.sh build --aceitar-rotas"
    falhou build "$((SECONDS - t0))s, rotas divergentes"; return 1
  fi
}

camada_runtime() {
  titulo "4/6 runtime — next start + fetch autenticado"
  local t0=$SECONDS

  if ! exigir_gc_dev; then
    falhou runtime "0s, banco errado"; return 1
  fi

  if [[ ! -d .next ]]; then
    echo "  .next não existe — rode a camada build antes."
    falhou runtime "0s, sem build"; return 1
  fi

  # `next dev` sobrescreve o .next de produção, e aí o `next start` sobe mas
  # devolve 500 em toda rota. Detectar aqui evita caçar o erro no lugar errado.
  if [[ -d .next/static/development ]]; then
    echo "  .next é de um 'next dev' — rode a camada build antes."
    falhou runtime "0s, build de dev"; return 1
  fi

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
    echo "  Costuma ser .next desatualizado: rode a camada build."
    tail -20 /tmp/validar-next.log
    falhou runtime "$((SECONDS - t0))s, /login devolveu $codigo"; return 1
  fi

  if BASE_URL="$BASE_URL" node --env-file=.env.local scripts/validar-runtime.mjs; then
    ok runtime "$((SECONDS - t0))s"
  else
    falhou runtime "$((SECONDS - t0))s"; return 1
  fi
}

camada_dados() {
  titulo "5/6 dados — queries reais contra gc-dev (RLS)"
  local t0=$SECONDS

  if ! exigir_gc_dev; then
    falhou dados "0s, banco errado"; return 1
  fi
  if node --env-file=.env.local scripts/validar-dados.mjs; then
    ok dados "$((SECONDS - t0))s"
  else
    falhou dados "$((SECONDS - t0))s"; return 1
  fi
}

camada_escrita() {
  titulo "6/6 escrita — Server Actions contra gc-dev"
  local t0=$SECONDS

  if ! exigir_gc_dev; then
    falhou escrita "0s, banco errado"; return 1
  fi

  if [[ ! -d .next ]] || [[ -d .next/static/development ]]; then
    echo "  precisa do build de produção (o mapa de actions vem do .next)."
    falhou escrita "0s, sem build"; return 1
  fi

  npx next start -p "$PORTA" > /tmp/validar-next-escrita.log 2>&1 &
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

  if BASE_URL="$BASE_URL" node --env-file=.env.local scripts/validar-escrita.mjs; then
    ok escrita "$((SECONDS - t0))s"
  else
    falhou escrita "$((SECONDS - t0))s"; return 1
  fi
}

# ---------- orquestração ----------
TODAS=(estatico unit build runtime dados escrita)
ACEITAR_ROTAS=0
PEDIDAS=()

for arg in "$@"; do
  case "$arg" in
    --lista|-l) lista; exit 0 ;;
    --aceitar-rotas) ACEITAR_ROTAS=1 ;;
    estatico|unit|build|runtime|dados|escrita) PEDIDAS+=("$arg") ;;
    *) echo "camada desconhecida: $arg (use --lista)" >&2; exit 2 ;;
  esac
done

[[ ${#PEDIDAS[@]} -eq 0 ]] && PEDIDAS=("${TODAS[@]}")
[[ $ACEITAR_ROTAS -eq 1 ]] && rm -f "$ROTAS_BASELINE"

FALHOU=""
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
