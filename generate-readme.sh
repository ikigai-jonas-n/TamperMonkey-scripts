#!/usr/bin/env bash
# Regenerates README.md from .readme/header.md + auto-scanned scripts + .readme/footer.md
# Run: ./generate-readme.sh  (also called automatically by deploy.sh and the pre-push hook)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"

scripts_section() {
  local index=1
  for dir in "$ROOT"/*/; do
    [ -e "${dir}.git" ] || continue

    local userscript
    userscript=$(find "$dir" -maxdepth 1 -name "*.user.js" -type f | head -1)
    [ -z "$userscript" ] && continue
    grep -q '// ==UserScript==' "$userscript" 2>/dev/null || continue

    local name install_url
    name=$(grep -m1 '// @name' "$userscript" | sed 's|.*// @name[[:space:]]*||;s/[[:space:]]*$//')
    install_url=$(grep -m1 '// @downloadURL' "$userscript" | grep -oE 'https://[^ ]+' 2>/dev/null \
               || grep -m1 '// @updateURL'   "$userscript" | grep -oE 'https://[^ ]+' 2>/dev/null \
               || true)

    printf '### %d. %s\n\n' "$index" "$name"

    if [ -f "${dir}README.md" ]; then
      cat "${dir}README.md"
    else
      local desc
      desc=$(grep -m1 '// @description' "$userscript" | sed 's|.*// @description[[:space:]]*||;s/[[:space:]]*$//')
      printf '%s' "$desc"
    fi
    printf '\n\n'

    if [ -n "$install_url" ]; then
      printf '👉 **[Install %s](%s)**\n' "$name" "$install_url"
    else
      printf '> ⚠️  Install URL not set yet — run `./deploy.sh` to generate it.\n'
    fi

    printf '\n---\n\n'
    index=$((index + 1))
  done
}

{
  cat "$ROOT/.readme/header.md"
  scripts_section
  cat "$ROOT/.readme/footer.md"
  printf '\n'
} > "$ROOT/README.md"

echo "· README.md regenerated ($(grep -c '^### [0-9]' "$ROOT/README.md") scripts listed)"
