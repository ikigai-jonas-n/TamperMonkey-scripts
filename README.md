# 🐒 TamperMonkey Scripts

**New here?** Follow these 4 steps to get **IKG Attendance Pro** running (~2 minutes).

---

## 1️⃣ Install Tampermonkey

Add the extension to your browser: [Chrome / Brave](https://chrome.google.com/webstore/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo) · [Firefox](https://addons.mozilla.org/en-US/firefox/addon/tampermonkey/)

## 2️⃣ Allow user scripts

Open **Extensions → Tampermonkey → Details** (Manage Extension). Turn **ON** "Allow User Scripts" and set Site access to **On all sites**.

<img width="509" height="323" alt="Allow User Scripts toggle" src="https://github.com/user-attachments/assets/6358ae3d-428e-4b32-9144-e231806e1ed5" />
<img width="690" height="193" alt="Site access: On all sites" src="https://github.com/user-attachments/assets/f3e121cc-cedb-449c-9626-d111b047a80f" />

## 3️⃣ Turn on fast auto-updates

Without this, you may run an old version for days. Works in the default **Novice** mode.

Open the **Tampermonkey Dashboard → Settings**, then:
* **Userscript Update → Check Interval:** pick the shortest option, **Every 6 Hours**.
* **Externals → Update Interval:** **Always**.
* Click **Save**.
  
<img width="411" height="492" alt="Tampermonkey QR Code" src="https://github.com/user-attachments/assets/b4f07db5-5803-4de0-8122-dc54107bc95b" />
<img width="1423" height="129" alt="Tampermonkey v5 5 1" src="https://github.com/user-attachments/assets/2238c0a3-216f-491c-b250-0acdbfab59f8" />
<img width="964" height="697" alt="Tampermonkey update settings" src="https://github.com/user-attachments/assets/9edeff09-1494-4924-a37a-59efda9c0259" />

Need an update right now? **Dashboard → Utilities → Check for userscript updates**.
<img width="410" height="474" alt="Untitled 2" src="https://github.com/user-attachments/assets/5e033876-d640-48c6-abc4-18158e978bab" />

## 4️⃣ Install the script

Click **Install** below, then **Install** again in the Tampermonkey tab that opens.

---

## 📦 Scripts

### 1. [7.137] IKG Attendance Pro (Autopilot & Alarms)

A complete overhaul of the [Attendance System](https://attendance.iki-utl.cc/): a monthly dashboard that knows your shift, leave and company events.

* **🤖 Auto-login:** signs in with your @ikigai.team Google account and keeps the session alive.
* **⏱️ Leave time & alarms:** shows when you can clock out; one click sets a macOS alarm or a Google Calendar block.
* **🏝️ Deel PTO sync:** leave, pending requests and balances appear on the calendar.
* **🏠 WFH & forgot-punch fixes:** pulled from the WFH form and counted per day.
* **🎉 Company special days:** early release / late start events are credited automatically.
* **📊 Monthly flex balance:** actual vs target hours, with the reason for every short day.

**First run:** the script opens Deel and Google tabs on its own to sign in. Let them finish; they close themselves.


👉 **[Install [7.137] IKG Attendance Pro (Autopilot & Alarms)](https://gist.githubusercontent.com/ikigai-jonas-n/f532c3a6c1b3cdeb7d6bbbfba3ecfd0e/raw/IKG-attendance.user.js)**

---

### 2. [19.23] EnvDashboard Matrix History & Overview (Ultimate Live Engine)

Upgrades the [Env Dashboard](https://lab.iki-utl.cc/dashboard/env-dashboard/) with advanced deployment tracking, timeline overviews, and Jira-like filtering.

**✨ Key Features:**
* **Grid Matrix & UI:** Pinned repos show "Deployments" inside environment cells.
* **Smart Filtering:** Jira-inspired multi-select dropdowns and Fuzzy Text Search.
* **Alerts:** Floating red badge for deployments awaiting approval.


👉 **[Install [19.23] EnvDashboard Matrix History & Overview (Ultimate Live Engine)](https://gist.githubusercontent.com/ikigai-jonas-n/f532c3a6c1b3cdeb7d6bbbfba3ecfd0e/raw/QA-env-dashboard.user.js)**

---

<details>
<summary>🤝 For contributors</summary>

**Once after cloning:**
```bash
cp hooks-pre-commit .git/hooks/pre-commit && chmod +x .git/hooks/pre-commit
```

**Release:** edit the `.user.js` file, then run `git acp "describe your change"`. It bumps `@version`, fixes the update URLs, regenerates this README, commits and pushes. Users get the update on their next update check.

**New script:** add `<name>.user.js` (with a `// ==UserScript==` header) and optionally `<name>-README.md` to the repo root, then `git acp`. Keep every file at the root: the repo mirrors to a gist, and gists reject folders.

</details>

