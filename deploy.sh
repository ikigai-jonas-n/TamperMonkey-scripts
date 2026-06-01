#!/usr/bin/env bash
# Usage: ./deploy.sh
# Auto-discovers every userscript in the root, fixes TamperMonkey URLs, and bumps @version.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"

# ── helpers ───────────────────────────────────────────────────────────────────
is_userscript() {
  grep -q '// ==UserScript==' "$1" 2>/dev/null
}

# ── fix @updateURL / @downloadURL ─────────────────────────────────────────────
fix_urls() {
  local file="$1"
  local filename raw_url
  filename=$(basename "$file")

  # 🎯 Restored exactly to your requested Gist URL!
  raw_url="https://gist.githubusercontent.com/ikigai-jonas-n/f532c3a6c1b3cdeb7d6bbbfba3ecfd0e/raw/${filename}"

  local changed=false

  if grep -q '// @updateURL' "$file"; then
    local current_update
    current_update=$(grep -m1 '// @updateURL' "$file" | grep -oE 'https://[^ ]+' || true)
    if [ "$current_update" != "$raw_url" ]; then
      perl -i -pe "s|// \@updateURL(\s+).*|// \@updateURL\$1$raw_url|" "$file"
      echo "  ✎ @updateURL  fixed → $raw_url"
      changed=true
    fi
  else
    perl -i -pe "s|(// \@version\s+\S+\n)|\$1// \@updateURL    $raw_url\n|" "$file"
    echo "  + @updateURL  added → $raw_url"
    changed=true
  fi

  if grep -q '// @downloadURL' "$file"; then
    local current_download
    current_download=$(grep -m1 '// @downloadURL' "$file" | grep -oE 'https://[^ ]+' || true)
    if [ "$current_download" != "$raw_url" ]; then
      perl -i -pe "s|// \@downloadURL(\s+).*|// \@downloadURL\$1$raw_url|" "$file"
      echo "  ✎ @downloadURL fixed → $raw_url"
      changed=true
    fi
  else
    perl -i -pe "s|(// \@updateURL\s+\S+\n)|\$1// \@downloadURL  $raw_url\n|" "$file"
    echo "  + @downloadURL added → $raw_url"
    changed=true
  fi

  if [ "$changed" = false ]; then
    echo "  · URLs already correct"
  fi
}

# ── version bumper ─────────────────────────────────────────────────────────────
bump_version() {
  local file="$1"
  local current
  current=$(grep -m1 '// @version' "$file" | grep -oE '[0-9]+(\.[0-9]+)+' || true)

  if [ -z "$current" ]; then
    echo "  ⚠  No @version found in $(basename "$file"), skipping bump"
    return
  fi

  local prefix last new_version
  prefix=$(echo "$current" | rev | cut -d. -f2- | rev)
  last=$(echo "$current" | rev | cut -d. -f1 | rev)
  new_version="${prefix}.$(( last + 1 ))"

  perl -i -pe "s|// \@version(\s+)\Q${current}\E|// \@version\${1}${new_version}|" "$file"
  echo "  ↑ @version: $current → $new_version"
}

# ── name version prefix sync ─────────────────────────────────────────────────
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

# ── process all scripts ────────────────────────────────────────────────────────
found=0
for file in "$ROOT"/*.user.js; do
  [ ! -f "$file" ] && continue
  is_userscript "$file" || continue
  
  filename=$(basename "$file")
  found=1
  
  if [ -n "$(git status --porcelain "$file")" ]; then
    echo "→ Processing script changes: $filename"
    fix_urls "$file"
    bump_version "$file"
    sync_name_version "$file"
  else
    fix_urls "$file"
    sync_name_version "$file"
  fi
done

if [ "$found" -eq 0 ]; then
  echo "No .user.js scripts found in the root directory!"
fi