#!/usr/bin/env bash

# Grab the commit message
MSG=${1:-"chore: auto-update scripts"}

echo "[acp] 🚀 Starting deployment pipeline..."

# 1. Safely deploy submodules (Commits the Gists without environment variable bleed)
./deploy.sh "$MSG"

# 2. Regenerate your README
./generate-readme.sh

# 3. Stage the parent repo (This now successfully grabs the updated README and submodule hashes!)
git add .

# 4. Commit the parent
git commit -m "$MSG"

# 5. Push the parent
git push

echo "[acp] ✅ All done!"