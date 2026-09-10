#!/usr/bin/env bash
# Aplica um seed de supabase/ em gc-dev, sem copiar e colar no SQL Editor.
#
#   bash scripts/aplicar-seed.sh supabase/seed_propostas.sql
#   bash scripts/aplicar-seed.sh --verificar supabase/seed_propostas.sql
#
# Os arquivos de seed são escritos pra colar no SQL Editor do Studio — é o
# caminho documentado, e continua valendo. Este script existe porque o caminho
# manual não é repetível: quem for recriar gc-dev amanhã ia abrir o navegador,
# achar o arquivo e colar. Aqui é um comando.
#
# Roda via `supabase db query --linked`, que aplica e persiste (verificado em
# 2026-09-08 com o seed de propostas: 12 linhas inseridas).
#
# NÃO é migration: seed é dado de teste, e por isso fica fora de
# supabase/migrations/ e nunca entra num `db push`.
set -euo pipefail

cd "$(dirname "$0")/.."

VERIFICAR=0
if [[ "${1:-}" == "--verificar" ]]; then
  VERIFICAR=1
  shift
fi

ARQUIVO="${1:-}"
if [[ -z "$ARQUIVO" || ! -f "$ARQUIVO" ]]; then
  echo "uso: bash scripts/aplicar-seed.sh [--verificar] <arquivo.sql>" >&2
  echo "seeds disponíveis:" >&2
  ls supabase/seed_*.sql 2>/dev/null | sed 's/^/  /' >&2
  exit 1
fi

# Trava de ambiente: a regra do projeto é não trabalhar em gc-prod.
GC_DEV_REF="gzbmhgnpoehormnidmgg"
url="$(sed -nE 's/^NEXT_PUBLIC_SUPABASE_URL=(.*)$/\1/p' .env.local | tail -1)"
ref="$(printf '%s' "$url" | sed -E 's#^https?://([^.]+)\..*#\1#')"

if [[ "$ref" != "$GC_DEV_REF" ]]; then
  echo "FALHA: .env.local aponta pra '$ref', não pra gc-dev ($GC_DEV_REF)." >&2
  echo "  Seed é dado de teste — não vai pra outro ambiente. Ver CLAUDE.md." >&2
  exit 1
fi

if [[ -z "${SUPABASE_ACCESS_TOKEN:-}" ]]; then
  export SUPABASE_ACCESS_TOKEN="$(sed -nE 's/^SUPABASE_ACCESS_TOKEN=(.*)$/\1/p' .env.local | tail -1)"
fi

if [[ -z "${SUPABASE_ACCESS_TOKEN:-}" ]]; then
  echo "FALHA: SUPABASE_ACCESS_TOKEN ausente (.env.local ou ambiente)." >&2
  exit 1
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# O arquivo tem três partes: insert, query de verificação e cleanup comentado.
# Recorta pelos cabeçalhos, pra rodar uma coisa por vez.
python3 - "$ARQUIVO" "$TMP" "$VERIFICAR" <<'PY'
import sys, pathlib
arquivo, tmp, verificar = sys.argv[1], sys.argv[2], sys.argv[3] == '1'
s = pathlib.Path(arquivo).read_text()

marca_verif = '-- Verificação'
marca_clean = '-- CLEANUP'

if verificar:
    if marca_verif not in s:
        print('FALHA: este seed não tem bloco de verificação.', file=sys.stderr)
        sys.exit(1)
    corpo = s[s.index(marca_verif):]
    corpo = corpo[:corpo.index(marca_clean)] if marca_clean in corpo else corpo
    # tira o cabeçalho de comentário
    linhas = [l for l in corpo.splitlines() if not l.strip().startswith('--')]
    corpo = '\n'.join(linhas)
else:
    corpo = s[:s.index(marca_verif)] if marca_verif in s else s

pathlib.Path(tmp, 'trecho.sql').write_text(corpo)
PY

if [[ $VERIFICAR -eq 1 ]]; then
  echo ">> verificando $ARQUIVO em gc-dev"
else
  echo ">> aplicando $ARQUIVO em gc-dev"
fi

npx --yes supabase@latest db query --linked --file "$TMP/trecho.sql" 2>&1 \
  | python3 -c "
import sys, json, re
t = sys.stdin.read()
m = re.search(r'\{.*\}', t, re.S)
if not m:
    print(t.strip()); sys.exit(1)
d = json.loads(m.group(0))
rows = d.get('rows', [])
if not rows:
    print('   ok — sem linhas de retorno (o insert não devolve nada)')
else:
    print(f'   {len(rows)} linha(s):')
    for r in rows:
        print('    ', ' · '.join(f'{k}={v}' for k, v in r.items()))
"
