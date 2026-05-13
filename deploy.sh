#!/usr/bin/env bash
# Usage: ./deploy.sh ["commit message"] [--hook]
# Auto-discovers every subdir that is a git repo, fixes TamperMonkey URLs,
# bumps @version, and deploys to its remote (Gist).
# --hook: called internally by pre-push; skips the final main-repo push to avoid recursion.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
MSG="${1:-Update scripts}"
HOOK_MODE="${2:-}"

# ── helpers ───────────────────────────────────────────────────────────────────

is_userscript() {
  grep -q '// ==UserScript==' "$1" 2>/dev/null
}

gist_id_from_remote() {
  # SSH:   git@gist.github.com:<ID>.git
  # HTTPS: https://gist.github.com/<ID>.git
  git remote get-url origin 2>/dev/null | grep -oE '[0-9a-f]{32}' || true
}

github_username() {
  local file="$1" gist_id="$2"

  # 1. Try extracting from any existing URL in the script header
  local user
  user=$(grep -m1 -oE 'gist\.githubusercontent\.com/[^/]+' "$file" 2>/dev/null \
         | cut -d/ -f2 || true)
  [ -n "$user" ] && { echo "$user"; return; }

  # 2. Fall back to GitHub CLI (requires gh auth)
  user=$(gh api "gists/$gist_id" --jq '.owner.login' 2>/dev/null || true)
  [ -n "$user" ] && { echo "$user"; return; }

  echo ""  # could not determine
}

# ── fix @updateURL / @downloadURL ─────────────────────────────────────────────
fix_urls() {
  local file="$1" gist_id="$2"
  local filename username raw_url

  filename=$(basename "$file")

  username=$(github_username "$file" "$gist_id")
  if [ -z "$username" ]; then
    echo "  ⚠  Cannot determine GitHub username — skipping URL fix for $filename"
    echo "     Set it manually or run: gh auth login"
    return
  fi

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

  [ "$changed" = false ] && echo "  · URLs already correct"
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

  # Bump last numeric segment (7.0 → 7.1, 7.0.3 → 7.0.4)
  local prefix last new_version
  prefix=$(echo "$current" | rev | cut -d. -f2- | rev)
  last=$(echo "$current" | rev | cut -d. -f1 | rev)
  new_version="${prefix}.$(( last + 1 ))"

  perl -i -pe "s|// \@version(\s+)\Q${current}\E|// \@version\${1}${new_version}|" "$file"
  echo "  ↑ @version: $current → $new_version"
}

# ── name version prefix sync ─────────────────────────────────────────────────
# Ensures @name starts with [X.Y] matching current @version. Strips any
# existing bracket prefix first so re-runs don't double-prefix.
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

# ── deploy one gist subdir ────────────────────────────────────────────────────
deploy_gist() {
  local name="$1"
  local dir="$ROOT/$name"

  pushd "$dir" > /dev/null

  # Find the .user.js file (one per folder)
  local userscript
  userscript=$(find . -maxdepth 1 -name "*.user.js" -type f | head -1)

  if [ -n "$userscript" ] && is_userscript "$userscript"; then
    local gist_id
    gist_id=$(gist_id_from_remote)
    if [ -n "$gist_id" ]; then
      fix_urls "$userscript" "$gist_id"
    else
      echo "  ⚠  No Gist ID found in remote URL — skipping URL fix for $name"
    fi
  fi

  if [ -z "$(git status --porcelain)" ]; then
    echo "· No changes: $name"
    popd > /dev/null
    return
  fi

  echo "→ Deploying: $name"
  [ -n "$userscript" ] && is_userscript "$userscript" && bump_version "$userscript"
  [ -n "$userscript" ] && is_userscript "$userscript" && sync_name_version "$userscript"

  git add .
  git commit -m "$MSG"
  git push
  echo "✓ Deployed: $name"

  popd > /dev/null
}

# ── auto-discover: any direct subdir that contains a .git entry ───────────────
found=0
for dir in "$ROOT"/*/; do
  [ -e "${dir}.git" ] || continue
  name=$(basename "$dir")
  deploy_gist "$name"
  found=1
done

[ "$found" -eq 0 ] && echo "No script repos found. Add one: git clone <gist-ssh-url> <folder-name>"

# ── sync main repo (README, deploy.sh, hooks/, etc.) ─────────────────────────
# Skipped when called from pre-push hook — the hook fires during the main push.
if [ "${HOOK_MODE}" != "--hook" ]; then
  pushd "$ROOT" > /dev/null
  "$ROOT/generate-readme.sh"
  if [ -n "$(git status --porcelain)" ]; then
    git add .
    git commit -m "$MSG"
    git push
    echo "✓ Deployed: main repo"
  else
    echo "· No changes: main repo"
  fi
  popd > /dev/null
fi
