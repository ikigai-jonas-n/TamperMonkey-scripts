# 🐒 TamperMonkey Scripts

*A collection of scripts to build a better, customized frontend experience.*

## 📋 Table of Contents
- [Prerequisites (Setup)](#-prerequisites-setup)
- [Available Scripts](#-available-scripts)
- [Automatic Updates](#-automatic-updates)
- [How to Contribute](#-how-to-contribute)

---

## 🛠 Prerequisites (Setup)

Before installing any scripts, configure your browser:

1. **Install Tampermonkey:** Get the extension for [Chrome/Brave](https://chrome.google.com/webstore/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo) or [Firefox](https://addons.mozilla.org/en-US/firefox/addon/tampermonkey/).
2. **Setup Browser Extension:** You must enable developer scripts. Open Extensions > Tampermonkey > Manage Extension. Toggle **ON** "Allow User Scripts" and ensure Site Access is "On all sites".

<details>
<summary>📸 View Setup Procedure</summary>
<br>
<img width="509" height="323" alt="Brave Settings" src="https://github.com/user-attachments/assets/6358ae3d-428e-4b32-9144-e231806e1ed5" />
<img width="690" height="193" alt="image" src="https://github.com/user-attachments/assets/f3e121cc-cedb-449c-9626-d111b047a80f" />
</details>

---

## 📦 Available Scripts

### 1. [7.78] IKG Attendance Pro (Autopilot & Alarms)

A complete overhaul of the [Attendance System](https://attendance.iki-utl.cc/). Includes a high-level analytics dashboard, auto-login, and cross-device alarms.

**✨ Key Features:**
* **🤖 Autopilot Mode:** Automatically handles "Sign in with Google," selects your @ikigai.team account, and fetches data so you never have to click manually.
* **⏱️ Active Shift & Alarms:** Detects your clock-in time and calculates exactly when you can leave (8h mark).
* **🔔 macOS & GCal Integration:** One-click buttons to send a native macOS Alarm (via Apple Shortcuts) or create a "Busy" block on your Google Calendar.
* **📊 Monthly Analytics:** View total days worked, average hours, and a "Lack" column that accounts for manual PTO/Sick leave entries.
* **💾 Persistent Cache:** Loads instantly using `localStorage`. No more waiting for the scan every time you refresh.


👉 **[Install [7.78] IKG Attendance Pro (Autopilot & Alarms)](https://gist.githubusercontent.com/ikigai-jonas-n/e946d3a0431233b4e0f550d1bddf5a2b/raw/IKG-attendance.user.js)**

---

### 2. [19.20] EnvDashboard Matrix History & Overview (Ultimate Live Engine)

Upgrades the [Env Dashboard](https://lab.iki-utl.cc/dashboard/env-dashboard/) with advanced deployment tracking, timeline overviews, and Jira-like filtering.

**✨ Key Features:**
* **Grid Matrix & UI:** Pinned repos show "Deployments" inside environment cells.
* **Smart Filtering:** Jira-inspired multi-select dropdowns and Fuzzy Text Search.
* **Alerts:** Floating red badge for deployments awaiting approval.


👉 **[Install [19.20] EnvDashboard Matrix History & Overview (Ultimate Live Engine)](https://gist.githubusercontent.com/ikigai-jonas-n/6849ad29f84369608e4de77021fcad0f/raw/QA-env-dashboard.user.js)**

---

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

