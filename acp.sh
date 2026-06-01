#!/usr/bin/env bash

# Grab the commit message
MSG=${1:-"chore: auto-update scripts"}

echo "[acp] 🚀 Starting deployment pipeline..."

# 1. Update active scripts, sync URLs, increment versions, push updates, and build documentation
./deploy.sh

# 2. Stage all modifications (ensuring structural files, scripts, and binaries are bundled)
git add .

# 3. Commit the changes
# 🎯 NOTE: --no-verify bypasses the pre-commit hook execution to prevent processing loops
git commit --no-verify -m "$MSG"

# 4. Push tracking changes to your primary master GitHub repository
git push

echo "[acp] ✅ All done!"