#!/usr/bin/env bash
# Converte docs/*.md em .pdf com a identidade visual dos relatórios de entrega.
# Sem dependência no package.json: markdown via `npx marked` e PDF via Chrome
# headless. O HTML é intermediário e vive só no diretório temporário — só o
# .md (fonte) e o .pdf (entrega) ficam no repositório.
#
# Uso:
#   bash scripts/docs-pdf.sh                      # docs/*.md e docs/*/*.md
#   bash scripts/docs-pdf.sh docs/sprint-4/4.2-status-entrega.md
set -euo pipefail

cd "$(dirname "$0")/.."

CHROME="${CHROME_BIN:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
if [[ ! -x "$CHROME" ]]; then
  echo "Chrome não encontrado em: $CHROME" >&2
  echo "Defina CHROME_BIN com o caminho do binário." >&2
  exit 1
fi

TEMPLATE="scripts/docs-pdf.css"
TMPDIR_RUN="$(mktemp -d)"
trap 'rm -rf "$TMPDIR_RUN"' EXIT

targets=("$@")
if [[ ${#targets[@]} -eq 0 ]]; then
  # docs/*.md são as entregas por bloco; docs/<subpasta>/*.md, o resto.
  shopt -s nullglob
  targets=(docs/*.md docs/*/*.md)
  shopt -u nullglob
fi

for md in "${targets[@]}"; do
  [[ -f "$md" ]] || { echo "ignorado (não existe): $md" >&2; continue; }
  # README é índice de pasta, não relatório: não vira PDF.
  [[ "$(basename "$md")" == "README.md" ]] && continue

  base="${md%.md}"
  # Título = primeiro heading H1 do arquivo, sem o "# ".
  title="$(sed -n 's/^# //p' "$md" | head -1)"
  [[ -n "$title" ]] || title="$(basename "$base")"

  body="$TMPDIR_RUN/body.html"
  npx -y marked@15 --gfm -i "$md" -o "$body"

  {
    printf '<!doctype html>\n<html lang="pt-BR">\n<head>\n<meta charset="utf-8">\n'
    printf '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n'
    printf '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@500;600;700&family=IBM+Plex+Mono:wght@400;500&family=Source+Serif+4:opsz,wght@8..60,400;8..60,600&display=block">\n'
    printf '<title>%s</title>\n<style>\n' "$title"
    cat "$TEMPLATE"
    printf '</style>\n</head>\n<body>\n<main>\n'
    cat "$body"
    printf '</main>\n</body>\n</html>\n'
  } > "$TMPDIR_RUN/page.html"

  "$CHROME" --headless --disable-gpu --no-pdf-header-footer --virtual-time-budget=4000 \
    --print-to-pdf="$PWD/$base.pdf" "file://$TMPDIR_RUN/page.html" >/dev/null 2>&1

  echo "gerado: $base.pdf"
done
