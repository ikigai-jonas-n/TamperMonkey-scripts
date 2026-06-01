#!/usr/bin/env bash

# Grab the commit message
MSG=${1:-"chore: auto-update scripts"}

echo "[acp] 🚀 Starting deployment pipeline..."

# 1. Update scripts, fix URLs, bump versions, push to individual Gists, AND build the README
./deploy.sh

# 2. Stage everything
git add .

# 3. Commit the changes (--no-verify avoids the pre-commit hook double-bump bug)
git commit --no-verify -m "$MSG"

# 4. Push to standard GitHub Repo
git push

echo "[acp] ✅ All done!"