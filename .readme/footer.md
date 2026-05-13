## 🔄 Automatic Updates
Scripts are hosted as Gists to enable seamless background syncing.
* **Auto:** Tampermonkey checks for updates daily.
* **Manual:** Go to Tampermonkey Dashboard -> Utilities -> **Check for userscript updates**.

---

## 🤝 How to Contribute

### First-time setup (run once after cloning this repo)

**Step 1 — Install the pre-commit hook:**

```bash
cp hooks/pre-commit .git/hooks/pre-commit && chmod +x .git/hooks/pre-commit
```

**Step 2 — Clone the script repos** (they're not included in the main clone):

```bash
git clone git@gist.github.com:6849ad29f84369608e4de77021fcad0f.git QA-env-dashboard
git clone git@gist.github.com:e946d3a0431233b4e0f550d1bddf5a2b.git IKG-attendance
```

---

### Day-to-day workflow

1. Edit the `.user.js` inside the relevant folder.
2. From the **repo root**, commit and push:

```bash
git add .
git commit -m "describe your changes"
git push
```

The pre-commit hook fires automatically and:
- Bumps `@version` in every modified script
- Commits & pushes each script to its Gist
- Regenerates this README (install links stay current)
- Tampermonkey users receive the update within 24 hours

---

### Adding a new TamperMonkey script

**No config changes needed** — `deploy.sh` auto-discovers every subfolder that contains a `.git` directory.

#### Step 1 — Create a secret Gist on GitHub

1. Go to **https://gist.github.com**
2. Click **+** (top-right) → create a **secret** Gist
3. Give it a filename ending in `.user.js` and paste your script content
4. Click **Create secret gist**

#### Step 2 — Get the SSH clone URL

On your new Gist page:
1. Click the **Embed** dropdown (top-right of the file)
2. Switch to **Clone via SSH**
3. Copy the URL — it looks like:

```
git@gist.github.com:XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX.git
                     ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
                     32-character hex Gist ID
```

#### Step 3 — Clone it into this repo

From the **repo root**, choose a folder name that matches your script:

```bash
git clone git@gist.github.com:<GIST_ID>.git my-script-name
#                              ^^^^^^^^  ← paste your actual 32-char ID here
#                                                 ^^^^^^^^^^^^^^  ← any short name
```

> ⚠️ **Do not use `git submodule add`** — just `git clone`. This repo uses plain nested git repos, not submodules.

#### Step 4 — Add your files

Your cloned folder already has the `.user.js` (from the Gist). Optionally add a README:

```
my-script-name/
├── my-script-name.user.js   ← already here from the clone
└── README.md                ← optional: shown in "Available Scripts" above
```

`README.md` format (keep it concise — it's embedded directly into this README):

```markdown
One-line summary of what the script does.

**✨ Key Features:**
* Feature one
* Feature two
```

#### Step 5 — Commit and push from the repo root

```bash
git add .
git commit -m "add my-script-name"
git push
```

On commit, automatically:
- `@updateURL` / `@downloadURL` inserted into the `.user.js`
- Script pushed to its Gist
- **This README regenerated** — new script appears in **Available Scripts** with its install link

> Each script folder is an independent Gist repo. The pre-commit hook iterates all of them automatically.
