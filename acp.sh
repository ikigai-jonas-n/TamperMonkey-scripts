#!/usr/bin/env bash

# Grab the commit message
MSG=${1:-"chore: auto-update scripts"}

echo "[acp] 🚀 Starting deployment pipeline..."

# 1. Update scripts, fix URLs, and bump versions
./deploy.sh "$MSG"

# 2. Regenerate your README
./generate-readme.sh

# 3. Stage everything (This ensures your .gif and .m4a files are tracked!)
git add .

# 4. Commit the changes
# 🎯 THE FIX: --no-verify prevents the pre-commit hook from causing a double-bump loop!
git commit --no-verify -m "$MSG"

# 5. Push to your new standard GitHub repository
git push

echo "[acp] ✅ All done!"