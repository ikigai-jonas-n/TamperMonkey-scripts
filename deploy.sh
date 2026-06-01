#!/usr/bin/env bash
# Usage: ./deploy.sh
# Intelligently syncs Tampermonkey scripts to their respective Gists and updates README.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"

# ── Ensure GitHub CLI is installed ────────────────────────────────────────────
if ! command -v gh &> /dev/null; then
  echo "❌ Error: GitHub CLI ('gh') is required for surgical Gist deployment."
  exit 1
fi

# ── Helpers ───────────────────────────────────────────────────────────────────
is_userscript() {
  grep -q '// ==UserScript==' "$1" 2>/dev/null
}

inject_urls() {
  local file="$1"
  local raw_url="$2"

  if grep -q '// @updateURL' "$file"; then
    perl -i -pe "s|// \@updateURL(\s+).*|// \@updateURL\$1$raw_url|" "$file"
  else
    perl -i -pe "s|(// \@version\s+\S+\n)|\$1// \@updateURL    $raw_url\n|" "$file"
  fi

  if grep -q '// @downloadURL' "$file"; then
    perl -i -pe "s|// \@downloadURL(\s+).*|// \@downloadURL\$1$raw_url|" "$file"
  else
    perl -i -pe "s|(// \@updateURL\s+\S+\n)|\$1// \@downloadURL  $raw_url\n|" "$file"
  fi
}

bump_version() {
  local file="$1"
  local current
  current=$(grep -m1 '// @version' "$file" | grep -oE '[0-9]+(\.[0-9]+)+' || true)
  [ -z "$current" ] && return

  local prefix last new_version
  prefix=$(echo "$current" | rev | cut -d. -f2- | rev)
  last=$(echo "$current" | rev | cut -d. -f1 | rev)
  new_version="${prefix}.$(( last + 1 ))"

  perl -i -pe "s|// \@version(\s+)\Q${current}\E|// \@version\${1}${new_version}|" "$file"
  echo "  ↑ @version: $current → $new_version"
}

sync_name_version() {
  local file="$1"
  local version name clean new_name
  version=$(grep -m1 '// @version' "$file" | grep -oE '[0-9]+(\.[0-9]+)+' || true)
  [ -z "$version" ] && return

  name=$(grep -m1 '// @name' "$file" | sed 's|.*// @name[[:space:]]*||;s/[[:space:]]*$//')
  clean=$(echo "$name" | sed 's/^\[[^]]*\][[:space:]]*//')
  new_name="[$version] $clean"

  if [ "$name" != "$new_name" ]; then
    perl -i -pe "s|// \@name(\s+).*|// \@name\${1}${new_name}|" "$file"
    echo "  ✎ @name: $name → $new_name"
  fi
}

# ── Core File Processor ───────────────────────────────────────────────────────
process_file() {
  local file="$1"
  local filename
  filename=$(basename "$file")

  echo "→ Processing script: $filename"
  
  bump_version "$file"
  sync_name_version "$file"

  # Intelligently extract the Gist ID from the script's own header
  local gist_id
  gist_id=$(grep -m1 -oE 'gist\.githubusercontent\.com/[^/]+/[a-f0-9]+' "$file" | cut -d/ -f3 || true)
  
  if [ -n "$gist_id" ]; then
    local username
    username=$(grep -m1 -oE 'gist\.githubusercontent\.com/[^/]+/' "$file" | cut -d/ -f2 || echo "ikigai-jonas-n")
    local raw_url="https://gist.githubusercontent.com/${username}/${gist_id}/raw/${filename}"
    
    inject_urls "$file" "$raw_url"
    
    echo "  ☁️  Pushing to existing Gist ($gist_id)..."
    gh gist edit "$gist_id" "$file" > /dev/null
    echo "  ✓  Gist updated."
  else
    echo "  ☁️  No Gist URL found. Creating new Gist automatically..."
    local gist_url
    gist_url=$(gh gist create "$file" --public)
    gist_id=$(echo "$gist_url" | grep -oE '[a-f0-9]+$')
    
    local username
    username=$(gh api user -q .login)
    local raw_url="https://gist.githubusercontent.com/${username}/${gist_id}/raw/${filename}"
    
    inject_urls "$file" "$raw_url"
    
    echo "  ☁️  Updating Gist with new self-referencing URLs..."
    gh gist edit "$gist_id" "$file" > /dev/null
    echo "  ✓  New Gist created & configured."
  fi
}

# ── README GENERATOR ──────────────────────────────────────────────────────────
regenerate_readme() {
  echo "→ Regenerating README.md..."
  local index=1
  local tmp_body="${ROOT}/.readme_body.tmp"
  > "$tmp_body"

  for userscript in "$ROOT"/*.js; do
    [ -f "$userscript" ] || continue
    is_userscript "$userscript" || continue

    local name install_url filename readme_file
    filename=$(basename "$userscript")
    readme_file="${ROOT}/${filename%.*}-README.md"

    name=$(grep -m1 '// @name' "$userscript" | sed 's|.*// @name[[:space:]]*||;s/[[:space:]]*$//')
    install_url=$(grep -m1 '// @downloadURL' "$userscript" | grep -oE 'https://[^ ]+' 2>/dev/null \
               || grep -m1 '// @updateURL'   "$userscript" | grep -oE 'https://[^ ]+' 2>/dev/null \
               || true)

    printf '### %d. %s\n\n' "$index" "$name" >> "$tmp_body"

    if [ -f "$readme_file" ]; then
      cat "$readme_file" >> "$tmp_body"
    else
      local desc
      desc=$(grep -m1 '// @description' "$userscript" | sed 's|.*// @description[[:space:]]*||;s/[[:space:]]*$//')
      printf '%s\n' "$desc" >> "$tmp_body"
    fi
    printf '\n\n' >> "$tmp_body"

    if [ -n "$install_url" ]; then
      printf '👉 **[Install %s](%s)**\n' "$name" "$install_url" >> "$tmp_body"
    else
      printf '> ⚠️  Install URL not set yet.\n' >> "$tmp_body"
    fi

    printf '\n---\n\n' >> "$tmp_body"
    index=$((index + 1))
  done

  {
    cat "$ROOT/README-header.md"
    cat "$tmp_body"
    cat "$ROOT/README-footer.md"
    printf '\n'
  } > "$ROOT/README.md"

  rm -f "$tmp_body"
  echo "  · README.md regenerated ($((index - 1)) scripts listed)"
}

# ── Main Loop ─────────────────────────────────────────────────────────────────
found=0
for file in "$ROOT"/*.js; do
  [ ! -f "$file" ] && continue
  is_userscript "$file" || continue
  found=1
  
  if [ -n "$(git status --porcelain "$file")" ]; then
    process_file "$file"
  fi
done

if [ "$found" -eq 0 ]; then
  echo "No UserScripts found in the root directory!"
else
  regenerate_readme
fi