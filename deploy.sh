#!/usr/bin/env bash
# Usage: ./deploy.sh ["commit message"] [--hook]
# Auto-discovers every userscript in the root, fixes TamperMonkey URLs,
# bumps @version, and regenerates the README.
# --hook: called internally by pre-commit; skips the final commit/push to avoid recursion.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
MSG="${1:-Update scripts}"
HOOK_MODE="${2:-}"
GIST_ID="f532c3a6c1b3cdeb7d6bbbfba3ecfd0e"

# ── helpers ───────────────────────────────────────────────────────────────────

is_userscript() {
  grep -q '// ==UserScript==' "$1" 2>/dev/null
}

github_username() {
  local file="$1" gist_id="$2"
  local user

  # 1. Try extracting from any existing URL in the script header
  user=$(grep -m1 -oE 'gist\.githubusercontent\.com/[^/]+' "$file" 2>/dev/null \
         | cut -d/ -f2 || true)
  if [ -n "$user" ]; then
    echo "$user"
    return
  fi

  # 2. Fall back to Git remote URL if possible
  user=$(git remote get-url origin 2>/dev/null | grep -oE 'github\.com[:/][^/]+' | cut -d: -f2 | cut -d/ -f2 || true)
  if [ -n "$user" ]; then
    echo "$user"
    return
  fi

  # 3. Fall back to GitHub CLI (requires gh auth)
  user=$(gh api "gists/$gist_id" --jq '.owner.login' 2>/dev/null || true)
  if [ -n "$user" ]; then
    echo "$user"
    return
  fi

  echo "ikigai-jonas-n"  # default fallback based on files
}

# ── fix @updateURL / @downloadURL ─────────────────────────────────────────────
fix_urls() {
  local file="$1" gist_id="$2"
  local filename username raw_url

  filename=$(basename "$file")
  username=$(github_username "$file" "$gist_id")

  # Always-latest raw URL (no commit hash)
  raw_url="https://gist.githubusercontent.com/${username}/${gist_id}/raw/${filename}"

  local changed=false

  # Fix or insert @updateURL
  if grep -q '// @updateURL' "$file"; then
    local current_update
    current_update=$(grep -m1 '// @updateURL' "$file" | grep -oE 'https://[^ ]+' || true)
    if [ "$current_update" != "$raw_url" ]; then
      perl -i -pe "s|// \@updateURL(\s+).*|// \@updateURL\$1$raw_url|" "$file"
      echo "  ✎ @updateURL  fixed → $raw_url"
      changed=true
    fi
  else
    # Insert after @version line
    perl -i -pe "s|(// \@version\s+\S+\n)|\$1// \@updateURL    $raw_url\n|" "$file"
    echo "  + @updateURL  added → $raw_url"
    changed=true
  fi

  # Fix or insert @downloadURL
  if grep -q '// @downloadURL' "$file"; then
    local current_download
    current_download=$(grep -m1 '// @downloadURL' "$file" | grep -oE 'https://[^ ]+' || true)
    if [ "$current_download" != "$raw_url" ]; then
      perl -i -pe "s|// \@downloadURL(\s+).*|// \@downloadURL\$1$raw_url|" "$file"
      echo "  ✎ @downloadURL fixed → $raw_url"
      changed=true
    fi
  else
    # Insert after @updateURL line
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

  # Bump last numeric segment (7.83 → 7.84)
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
  if [ -z "$version" ]; then
    return
  fi

  name=$(grep -m1 '// @name' "$file" | sed 's|.*// @name[[:space:]]*||;s/[[:space:]]*$//')
  clean=$(echo "$name" | sed 's/^\[[^]]*\][[:space:]]*//')
  new_name="[$version] $clean"

  if [ "$name" != "$new_name" ]; then
    perl -i -pe "s|// \@name(\s+).*|// \@name\${1}${new_name}|" "$file"
    echo "  ✎ @name: $name → $new_name"
  fi
}

# ── process all scripts ────────────────────────────────────────────────────────
process_scripts() {
  local found=0
  for file in "$ROOT"/*.user.js; do
    if [ ! -f "$file" ]; then
      continue
    fi
    if ! is_userscript "$file"; then
      continue
    fi
    local filename
    filename=$(basename "$file")

    found=1
    # Check if the file is modified (has staged, unstaged, or untracked changes)
    if [ -n "$(git status --porcelain "$file")" ]; then
      echo "→ Processing script changes: $filename"
      fix_urls "$file" "$GIST_ID"
      bump_version "$file"
      sync_name_version "$file"
    else
      # Still ensure the URLs are up to date and correct
      fix_urls "$file" "$GIST_ID"
      sync_name_version "$file"
    fi
  done

  if [ "$found" -eq 0 ]; then
    echo "No .user.js scripts found in the root directory!"
  fi
}

process_scripts

# # ── sync Gist (README, deploy.sh, hooks, etc.) ─────────────────────────────────
# # Skipped when called from pre-commit hook to avoid infinite recursion
# if [ "${HOOK_MODE}" != "--hook" ]; then
#   "$ROOT/generate-readme.sh"
#   if [ -n "$(git status --porcelain)" ]; then
#     git add .
#     git commit -m "$MSG"
#     git push
#     echo "✓ Deployed changes to private Gist"
#   else
#     echo "· No changes to deploy"
#   fi
# fi
