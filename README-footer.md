## 🔄 Automatic Updates
Scripts are hosted in this Gist to enable seamless background syncing.
* **Auto:** Tampermonkey checks for updates daily.
* **Manual:** Go to Tampermonkey Dashboard -> Utilities -> **Check for userscript updates**.

---

## 🤝 How to Contribute

### First-time setup (run once after cloning this repo)

**Install the pre-commit hook:**

```bash
cp hooks-pre-commit .git/hooks/pre-commit && chmod +x .git/hooks/pre-commit
```

---

### Day-to-day workflow

1. Edit any `.user.js` file directly in the root directory.
2. Commit and push:

```bash
git add .
git commit -m "describe your changes"
git push
```

The pre-commit hook fires automatically and:
- Bumps `@version` in every modified script.
- Fixes `@updateURL` / `@downloadURL` tags in the scripts to point to raw files in this main Gist.
- Regenerates this README (install links stay current).
- Tampermonkey users receive the update within 24 hours.

---

### Adding a new TamperMonkey script

Adding a new script is incredibly simple now since everything is in the root directory of this Gist:

#### Step 1 — Create the script file
Create a new file in the root directory ending in `.user.js` (e.g. `my-awesome-script.user.js`) and paste your UserScript content. Ensure it starts with the standard header block:
```javascript
// ==UserScript==
// @name         My Awesome Script
// @version      1.0
// ==/UserScript==
```

#### Step 2 — Create the README file (optional)
Create a markdown file in the root matching your script's base name ending in `-README.md` (e.g. `my-awesome-script-README.md`). Keep it concise:
```markdown
One-line summary of what the script does.

**✨ Key Features:**
* Feature one
* Feature two
```

#### Step 3 — Commit and push
```bash
git add .
git commit -m "Add my-awesome-script"
git push
```

The pre-commit hook will automatically:
- Inject correct `@updateURL` and `@downloadURL` tags pointing to this Gist.
- Sync the `@name` version prefix.
- Regenerate this `README.md` so your new script appears under the **Available Scripts** list with its install link!
