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

### 1. [7.89] IKG Attendance Pro (Autopilot & Alarms)

Full Auto-Login, Keep-Alive Token, GCal/Mac Alarms, Deel PTO Sync, and Modern UI.


👉 **[Install [7.89] IKG Attendance Pro (Autopilot & Alarms)](https://gist.githubusercontent.com/ikigai-jonas-n/f532c3a6c1b3cdeb7d6bbbfba3ecfd0e/raw/IKG-attendance.user.js)**

---

### 2. [19.22] EnvDashboard Matrix History & Overview (Ultimate Live Engine)

Pipeline Tooltips, Dashboard Timeline FAB, Auto-Highlight Notifications, Smart Toast Stacking


👉 **[Install [19.22] EnvDashboard Matrix History & Overview (Ultimate Live Engine)](https://gist.githubusercontent.com/ikigai-jonas-n/f532c3a6c1b3cdeb7d6bbbfba3ecfd0e/raw/QA-env-dashboard.user.js)**

---

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

