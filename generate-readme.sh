#!/usr/bin/env bash
# Regenerates README.md from README-header.md + auto-scanned scripts + README-footer.md
# Run: ./generate-readme.sh  (also called automatically by deploy.sh and pre-commit hook)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"

scripts_section() {
  local index=1
  # Loop through all .user.js files directly in the root directory
  for userscript in "$ROOT"/*.user.js; do
    [ -f "$userscript" ] || continue
    grep -q '// ==UserScript==' "$userscript" 2>/dev/null || continue

    local name install_url filename readme_file
    filename=$(basename "$userscript")
    readme_file="${ROOT}/${filename%.user.js}-README.md"

    name=$(grep -m1 '// @name' "$userscript" | sed 's|.*// @name[[:space:]]*||;s/[[:space:]]*$//')
    install_url=$(grep -m1 '// @downloadURL' "$userscript" | grep -oE 'https://[^ ]+' 2>/dev/null \
               || grep -m1 '// @updateURL'   "$userscript" | grep -oE 'https://[^ ]+' 2>/dev/null \
               || true)

    printf '### %d. %s\n\n' "$index" "$name"

    if [ -f "$readme_file" ]; then
      cat "$readme_file"
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
  cat "$ROOT/README-header.md"
  scripts_section
  cat "$ROOT/README-footer.md"
  printf '\n'
} > "$ROOT/README.md"

echo "· README.md regenerated ($(grep -c '^### [0-9]' "$ROOT/README.md") scripts listed)"
