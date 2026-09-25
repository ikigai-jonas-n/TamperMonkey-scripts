// ==UserScript==
    // @name         [7.128] IKG Attendance Pro (Autopilot & Alarms)
    // @namespace    http://tampermonkey.net/
    // @version      7.128
    // @updateURL    https://gist.githubusercontent.com/ikigai-jonas-n/f532c3a6c1b3cdeb7d6bbbfba3ecfd0e/raw/IKG-attendance.user.js
    // @downloadURL  https://gist.githubusercontent.com/ikigai-jonas-n/f532c3a6c1b3cdeb7d6bbbfba3ecfd0e/raw/IKG-attendance.user.js
    // @description  Full Auto-Login, Keep-Alive Token, GCal/Mac Alarms, Deel PTO Sync, and Modern UI.
    // @author       JonasNg
    // @match        *://attendance.iki-utl.cc/*
    // @match        *://accounts.google.com/*
    // @match        *://ikg.deel.team/*
    // @grant        GM_addStyle
    // @grant        GM_xmlhttpRequest
    // @grant        GM_setValue
    // @grant        GM_getValue
    // @grant        GM_addValueChangeListener
    // @grant        GM_removeValueChangeListener
    // @grant        GM_openInTab
    // @grant        GM_info
    // @connect      gist.github.com
    // @connect      gist.githubusercontent.com
    // @connect      github.com
    // @connect      ikg.deel.team
    // @connect      cdn.jsdelivr.net
    // @connect      date.nager.at
    // @connect      script.google.com
    // @run-at       document-start
    // ==/UserScript==
    
    (function () {
      "use strict";

      // ==========================================
      // 0. STRUCTURED TELEMETRY ENGINE
      // ==========================================
      const IkgLog = {
        formatTime: () => {
          const d = new Date();
          const pad = (n, len = 2) => String(n).padStart(len, "0");
          return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
        },
        _log: (level, msg, data) => {
          const prefix = `%c[IKG] [${IkgLog.formatTime()}] [${level.padEnd(5)}]`;
          let color = "color: #94A3B8;";
          if (level === "INFO") color = "color: #3B82F6; font-weight: bold;";
          if (level === "DEBUG") color = "color: #10B981;";
          if (level === "WARN") color = "color: #F59E0B; font-weight: bold;";
          if (level === "ERROR") color = "color: #EF4444; font-weight: bold;";

          if (data !== undefined) console.log(`${prefix} ${msg}`, color, data);
          else console.log(`${prefix} ${msg}`, color);
        },
        info: (msg, data) => IkgLog._log("INFO", msg, data),
        debug: (msg, data) => IkgLog._log("DEBUG", msg, data),
        warn: (msg, data) => IkgLog._log("WARN", msg, data),
        error: (msg, data) => IkgLog._log("ERROR", msg, data),
      };

      const RUNTIME_VER = (typeof GM_info !== "undefined" && GM_info.script) ? GM_info.script.version : "7.118";
      IkgLog.info(`Attendance Pro Script Initialized v${RUNTIME_VER} (CSP Worker Bypass)`);

      // ==========================================
      // 1. GOOGLE SSO AUTOPILOT (Bypasses Worker CSP)
      // ==========================================
      if (location.hostname === "accounts.google.com") {
        const lastSSOClick = GM_getValue("IKG_SSO_TRIGGERED", 0);

        // 🛡️ SECURITY: Only run if the Attendance portal triggered this within the last 60 seconds
        if (Date.now() - lastSSOClick > 60000) {
          return; // Exit silently. Let the user use their normal Google accounts elsewhere.
        }

        IkgLog.info("Attendance-triggered SSO detected. Engaging Autopilot.");
        const attemptSSOClick = () => {
          const targetEmail = document.querySelector(
            '[data-email$="@ikigai.team"]',
          );
          if (targetEmail) {
            const clickable = targetEmail.closest('[role="link"]');
            if (clickable) {
              IkgLog.debug("Target email found. Simulatin' click.");
              GM_setValue("IKG_SSO_TRIGGERED", 0); // Clear the flag instantly
              clickable.click();
              return true;
            }
          }
          return false;
        };

        const initGoogleAutopilot = () => {
          if (attemptSSOClick()) return;
          IkgLog.debug("Attaching SSO Observer.");
          const obs = new MutationObserver(() => {
            if (attemptSSOClick()) {
              obs.disconnect();
            }
          });
          obs.observe(document.body, { childList: true, subtree: true });
        };

        if (document.body) initGoogleAutopilot();
        else document.addEventListener("DOMContentLoaded", initGoogleAutopilot);

        return; // <-- CRITICAL: Stops execution here so the Worker isn't created on Google's domain.
      }

      // ==========================================
      // 1.5 DEEL PTO TOKEN SNATCHER (Cross-Tab Bridge)
      // ==========================================
      if (location.hostname === "ikg.deel.team") {
        IkgLog.info("Deel Domain Detected. Hunting for Auth Token...");
        let hasClickedDeelLogin = false;

        // 🎯 Helper: Safely checks and sends the token if valid
        const checkAndSendToken = () => {
          const token =
            localStorage.getItem("token") || sessionStorage.getItem("token");
          if (token) {
            try {
              const payload = JSON.parse(atob(token.split(".")[1]));
              if (payload.exp && payload.exp * 1000 < Date.now()) {
                return false; // Token is expired, wait for Deel to refresh it
              }
            } catch (e) {
              /* Not a standard JWT, proceed anyway */
            }

            GM_setValue("IKG_DEEL_TOKEN", token);
            IkgLog.info(
              "✅ FRESH Deel Token secured. Handing back to Attendance App...",
            );
            setTimeout(() => {
              window.close();
            }, 500);
            return true;
          }
          return false;
        };

        // 🎯 Helper: Hunts for the login button
        const attemptDeelLogin = () => {
          if (hasClickedDeelLogin) return false;
          const elements = Array.from(document.querySelectorAll("span, button, a"));

          const loginBtn = elements.find(
            (el) =>
              el.innerText &&
              (el.innerText.includes("IKG Google Workspace") ||
                el.innerText.includes("Log in with IKG")),
          );

          if (loginBtn && loginBtn.offsetParent !== null) {
            hasClickedDeelLogin = true;
            IkgLog.info(
              "Deel login button found. Engaging Autopilot and waiting for Google...",
            );
            GM_setValue("IKG_SSO_TRIGGERED", Date.now()); // Grant VIP pass for Google SSO
            loginBtn.click();
            return true;
          }
          return false;
        };

        // 1. Check immediately on page load
        if (!checkAndSendToken()) {
          attemptDeelLogin();
        }

        // 2. 🎯 CRITICAL FIX: Use MutationObserver instead of spamming setInterval
        const deelObserver = new MutationObserver(() => {
          if (checkAndSendToken()) {
            deelObserver.disconnect(); // Stop observing once we have the token
          } else {
            attemptDeelLogin();
          }
        });

        // Start observing the DOM for React rendering the login button
        if (document.body) {
          deelObserver.observe(document.body, { childList: true, subtree: true });
        } else {
          document.addEventListener("DOMContentLoaded", () => {
            deelObserver.observe(document.body, { childList: true, subtree: true });
          });
        }

        // 3. Fallback: Listen for native storage changes (Instantly catches token generation)
        window.addEventListener("storage", (e) => {
          if (e.key === "token") {
            if (checkAndSendToken()) deelObserver.disconnect();
          }
        });

        return; // CRITICAL: Stop the rest of the Attendance script from rendering on Deel
      }

      // ==========================================
      // 1.6 GAS TOKEN SNATCHER (Runs on script.google.com)
      // ==========================================
      if (location.hostname === "script.google.com") {
        IkgLog.info("GAS Domain Detected. Hunting for Auth Token...");

        const injectScript = document.createElement("script");
        injectScript.textContent = `
            (function() {
                // 1. Intercept Fetch (Google uses fetch for this callback)
                const originalFetch = window.fetch;
                window.fetch = async function(...args) {
                    try {
                        let url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url ? args[0].url : '');
                        if (url && url.includes('callback') && url.includes('token=')) {
                            const urlObj = new URL(url.startsWith('http') ? url : window.location.origin + url);
                            const gasToken = urlObj.searchParams.get('token');
                            const callbackUrl = url.split('?')[0]; 
                            if (gasToken) {
                                window.postMessage({ type: 'IKG_GAS_FOUND', token: gasToken, callbackUrl: callbackUrl }, '*');
                            }
                        }
                    } catch(e) {}
                    return originalFetch.apply(this, args);
                };

                // 2. Intercept XHR (Fallback)
                const originalOpen = XMLHttpRequest.prototype.open;
                XMLHttpRequest.prototype.open = function(method, url, ...rest) {
                    if (typeof url === 'string' && url.includes('callback') && url.includes('token=')) {
                        try {
                            const urlObj = new URL(url.startsWith('http') ? url : window.location.origin + url);
                            const gasToken = urlObj.searchParams.get('token');
                            const callbackUrl = url.split('?')[0]; 
                            if (gasToken) {
                                window.postMessage({ type: 'IKG_GAS_FOUND', token: gasToken, callbackUrl: callbackUrl }, '*');
                            }
                        } catch(e) {}
                    }
                    return originalOpen.call(this, method, url, ...rest);
                };
            })();
        `;
        document.documentElement.appendChild(injectScript);
        injectScript.remove();

        window.addEventListener("message", (e) => {
            if (e.data && e.data.type === 'IKG_GAS_FOUND') {
                IkgLog.info("✅ FRESH GAS Token secured. Handing back to Attendance App...");
                GM_setValue("IKG_GAS_DATA", JSON.stringify({ token: e.data.token, callbackUrl: e.data.callbackUrl, exp: Date.now() + 3000000 }));
                // Close the background tab automatically
                setTimeout(() => window.close(), 500);
            }
        });
        return; // CRITICAL: Stop the rest of the attendance script from running on the Google script page
      }

      // ==========================================
      // ==========================================
      // 1.8 LIGHTWEIGHT BACKGROUND WATCHDOG
      // ==========================================
      let authToken = null;
      let autopilotEnabled = true;

      // Bypasses browser tab-sleeping to check if session died
      const watchdogBlob = new Blob(
        [
          `
            setInterval(() => postMessage('tick'), 10000);
        `,
        ],
        { type: "application/javascript" },
      );
      const watchdog = new Worker(URL.createObjectURL(watchdogBlob));

      watchdog.onmessage = () => {
        const buttons = Array.from(document.querySelectorAll("button"));
        const loginBtn = buttons.find((b) =>
          (b.innerText || "").toUpperCase().includes("SIGN IN WITH GOOGLE"),
        );

        if (loginBtn && loginBtn.offsetParent !== null) {
          if (!autopilotEnabled)
            IkgLog.warn("Session death detected. Re-engaging autopilot.");
          autopilotEnabled = true;
          authToken = null;

          // 🎟️ Create the 60-second VIP Pass
          GM_setValue("IKG_SSO_TRIGGERED", Date.now());
          loginBtn.click();
        }
      };

      // ==========================================
      // 2. DYNAMIC DEPENDENCIES
      // ==========================================
      const triggerConfetti = () => {
        IkgLog.info("Triggering Goal Met Confetti!");
        if (document.getElementById("ikg-confetti-script")) {
          const runScript = document.createElement("script");
          runScript.textContent = `if(typeof confetti === 'function') confetti({ particleCount: 150, spread: 80, origin: { y: 0.6 }, zIndex: 100000 });`;
          document.body.appendChild(runScript);
          setTimeout(() => runScript.remove(), 1000);
          return;
        }
        const script = document.createElement("script");
        script.id = "ikg-confetti-script";
        script.src =
          "https://cdn.jsdelivr.net/npm/canvas-confetti@1.6.0/dist/confetti.browser.min.js";
        script.onload = () => {
          const runScript = document.createElement("script");
          runScript.textContent = `if(typeof confetti === 'function') confetti({ particleCount: 150, spread: 80, origin: { y: 0.6 }, zIndex: 100000 });`;
          document.body.appendChild(runScript);
          setTimeout(() => runScript.remove(), 1000);
        };
        document.head.appendChild(script);
      };

      // ==========================================
      // 3. UPDATED AUDIO & VISUAL ENGINE
      // ==========================================
      const APP_VER = "V9";
      const DEFAULT_GIF_URL =
        "https://gist.github.com/ikigai-jonas-n/7b0a0efcec645ab87ab73c0b3b038d0e/raw/dd23f7a3baa0c680e1b4e92abd18cbb6bf5c3397/bubu-dudu-sseeyall.gif";

      const PRO_TRACKS = [
        {
          id: "pro_fkj",
          name: "FKJ - Just Piano",
          url: "https://gist.github.com/ikigai-jonas-n/7b0a0efcec645ab87ab73c0b3b038d0e/raw/a050f5fbccdec4c213d0f6f0fa9551777e673a38/FKJ%2520-%2520Just%2520Piano%2520(In%2520partnership%2520with%2520Calm).m4a",
          ver: "1.1",
        },
        {
          id: "pro_misch",
          name: "Tom Misch - It Runs Through Me",
          url: "https://gist.github.com/ikigai-jonas-n/7b0a0efcec645ab87ab73c0b3b038d0e/raw/acbaabc5cc49f1f812b863d270b432113c71f92c/Tom%2520Misch%2520-%2520It%2520Runs%2520Through%2520Me.m4a",
          ver: "1.0",
        },
      ];

      const IKG_DB = {
        dbName: "IKG_Audio_DB",
        init: function () {
          return new Promise((resolve, reject) => {
            const req = indexedDB.open(this.dbName, 1);
            req.onupgradeneeded = (e) => {
              e.target.result.createObjectStore("files");
            };
            req.onsuccess = (e) => resolve(e.target.result);
            req.onerror = (e) => reject(e);
          });
        },
        save: async function (key, data) {
          const db = await this.init();
          return new Promise((resolve, reject) => {
            const tx = db.transaction("files", "readwrite");
            tx.objectStore("files").put(data, key);
            tx.oncomplete = resolve;
            tx.onerror = reject;
          });
        },
        get: async function (key) {
          const db = await this.init();
          return new Promise((resolve, reject) => {
            const tx = db.transaction("files", "readonly");
            const req = tx.objectStore("files").get(key);
            req.onsuccess = (e) => resolve(e.target.result);
            req.onerror = reject;
          });
        },
        ensureAssets: async function () {
          for (const track of PRO_TRACKS) {
            const cachedVer = await this.get(`ver_${track.id}`);
            const cachedAudio = await this.get(`data_${track.id}`);
            if (cachedAudio && cachedVer === track.ver) continue;
            this.downloadAsset(
              track.url,
              `data_${track.id}`,
              `ver_${track.id}`,
              track.ver,
              track.name,
            );
          }
        },

        downloadAsset: function (url, dataKey, verKey, verVal, name) {
          IkgLog.info(`📥 Downloading Asset: ${name}...`);
          GM_xmlhttpRequest({
            method: "GET",
            url: url,
            responseType: "blob",
            onload: (res) => {
              if (res.status !== 200) return;
              const reader = new FileReader();
              reader.onloadend = async () => {
                await this.save(dataKey, reader.result);
                await this.save(verKey, verVal);
                IkgLog.info(`✅ ${name} cached.`);
              };
              reader.readAsDataURL(res.response);
            },
          });
        },
      };

      IKG_DB.ensureAssets();

      const SETTINGS_KEY = `IKG_APP_SETTINGS_${APP_VER}`;

      if (
        !localStorage.getItem(SETTINGS_KEY) &&
        localStorage.getItem("IKG_APP_SETTINGS_V5")
      ) {
        localStorage.setItem(
          SETTINGS_KEY,
          localStorage.getItem("IKG_APP_SETTINGS_V5"),
        );
        localStorage.removeItem("IKG_APP_SETTINGS_V5");
      }

      const OVERRIDES_KEY = `IKG_MANUAL_OVERRIDES_${APP_VER}`;

      const getSettings = () => {
        const def = {
          soundType: "pro_fkj",
          mp3Name: "",
          snoozeMins: 5,
          useFlexDef: true,
          triggers: [-0.5, 0],
          triggerUnit: "m",
          snoozeUnit: "m",
          showSeconds: true,
          autoSetAlarm: true,
          manualShift: "auto",
          alarmImgType: "default",
          alarmImgName: "",
          pulseSpeed: 4.0,
          volume: 0.8,
          useManualOverrides: true,
          includeWfhInHours: true, // 🎯 DEFAULT: ON
          syncDays: 7,
        };
        try {
          return { ...def, ...JSON.parse(localStorage.getItem(SETTINGS_KEY)) };
        } catch (e) {
          return def;
        }
      };

      let currentAnalyticsView = "CHART";

      const AudioEngine = {
        ctx: null,
        audioEl: null,
        activeOscillators: [],
        isPlaying: false,
        timeoutId: null,
        initCtx: function () {
          if (!this.ctx)
            this.ctx = new (window.AudioContext || window.webkitAudioContext)();
          if (this.ctx.state === "suspended") this.ctx.resume();
        },
        playTone: function (freq, type, startTime, duration, baseVol = 0.5) {
          const settings = getSettings();
          const vol =
            baseVol * (settings.volume !== undefined ? settings.volume : 0.8);
          const osc = this.ctx.createOscillator();
          const gain = this.ctx.createGain();
          osc.type = type;
          osc.frequency.value = freq;
          osc.connect(gain);
          gain.connect(this.ctx.destination);
          gain.gain.setValueAtTime(0, startTime);
          gain.gain.linearRampToValueAtTime(vol, startTime + 0.05);
          gain.gain.setValueAtTime(vol, startTime + duration - 0.1);
          gain.gain.linearRampToValueAtTime(0, startTime + duration);
          osc.start(startTime);
          osc.stop(startTime + duration);
          this.activeOscillators.push(osc);
        },
        play: async function (overrideType = null) {
          this.stop();
          this.isPlaying = true;
          const settings = getSettings();
          const typeToPlay = overrideType || settings.soundType;

          if (typeToPlay.startsWith("pro_") || typeToPlay === "custom") {
            const key =
              typeToPlay === "custom" ? "custom_alarm_mp3" : `data_${typeToPlay}`;
            const mp3Data = await IKG_DB.get(key);

            if (mp3Data) {
              this.audioEl = new Audio(mp3Data);
              this.audioEl.volume =
                settings.volume !== undefined ? settings.volume : 0.8;
              this.audioEl.loop = true;
              this.audioEl.play().catch((e) => this.playSynthesis("chime"));
            } else {
              this.playSynthesis("chime");
            }
          } else {
            this.playSynthesis(typeToPlay);
          }
        },
        playSynthesis: function (type) {
          this.initCtx();
          const loop = () => {
            if (!this.isPlaying) return;
            let t = this.ctx.currentTime;
            let loopLength = 1.0;
            if (type === "chime") {
              [523.25, 659.25, 783.99, 1046.5].forEach((f, i) =>
                this.playTone(f, "sine", t + i * 0.12, 0.3, 0.4),
              );
              loopLength = 1.5;
            } else if (type === "gentle") {
              this.playTone(440, "triangle", t, 0.8, 0.2);
              this.playTone(554.37, "sine", t + 0.1, 0.8, 0.2);
              this.playTone(659.25, "sine", t + 0.2, 0.8, 0.2);
              loopLength = 2.5;
            } else {
              this.playTone(800, "square", t, 0.15, 0.3);
              this.playTone(800, "square", t + 0.25, 0.15, 0.3);
              loopLength = 1.0;
            }
            this.timeoutId = setTimeout(loop, loopLength * 1000);
          };
          loop();
        },
        stop: function () {
          this.isPlaying = false;
          if (this.timeoutId) clearTimeout(this.timeoutId);
          this.activeOscillators.forEach((o) => {
            try {
              o.stop();
            } catch (e) {}
          });
          this.activeOscillators = [];
          if (this.audioEl) {
            this.audioEl.pause();
            this.audioEl.currentTime = 0;
            this.audioEl = null;
          }
        },
      };

      window.ikgAlarmTimeouts = window.ikgAlarmTimeouts || [];
      window.ikgScheduledTargetMs = window.ikgScheduledTargetMs || null;
      window.ikgTestAlarmTimeout = window.ikgTestAlarmTimeout || null;

      // 🎯 ENHANCED STATUS BADGE RENDERER
    const updateHeaderStatus = (msg, colorVar = "var(--text-muted)") => {
      const statusEl = document.getElementById("ikg-header-status");
      if (statusEl) {
        statusEl.innerHTML = msg;
        statusEl.style.color = colorVar;
        if (colorVar === "var(--success)") {
          statusEl.style.borderColor = "var(--success)";
          statusEl.style.background = "var(--success-bg)";
        } else if (colorVar === "var(--primary)") {
          statusEl.style.borderColor = "var(--primary)";
          statusEl.style.background = "var(--primary-glow)";
        } else if (colorVar === "var(--warn)") {
          statusEl.style.borderColor = "var(--warn)";
          statusEl.style.background = "var(--warn-bg)";
        } else {
          statusEl.style.borderColor = "var(--border)";
          statusEl.style.background = "var(--bg-elevated)";
        }
      }
    };

      const AlarmSystem = {
        overlay: null,
        snoozeTimeout: null,
        currentIsTest: false,
        fire: async function (isTest = false) {
          this.currentIsTest = isTest;
          const settings = getSettings();
          AudioEngine.play();
          if (!isTest) triggerConfetti();

          const unit = (settings.snoozeUnit || "m").toLowerCase();
          const snoozeTimeText =
            unit === "s" ? `${settings.snoozeMins}s` : `${settings.snoozeMins}m`;

          let imgSrc = DEFAULT_GIF_URL;
          if (settings.alarmImgType === "custom") {
            imgSrc =
              (await IKG_DB.get("custom_alarm_img")) ||
              "https://attendance.iki-utl.cc/favicon.png";
          }

          if (!this.overlay) {
            this.overlay = document.createElement("div");
            this.overlay.id = "ikg-ringing-overlay";
            document.body.appendChild(this.overlay);
            this.overlay.addEventListener(
              "click",
              (e) => {
                const target = e.target;
                if (target.id === "ikg-btn-stop") this.stop();
                if (target.id === "ikg-btn-snooze") this.snooze();
              },
              true,
            );
          }

          const pulseAnim =
            settings.pulseSpeed > 0
              ? `animation: ringPulse ${settings.pulseSpeed}s infinite;`
              : "animation: none;";

          this.overlay.innerHTML = `
                    <style>
                        #ikg-ringing-overlay .ringing-box { ${pulseAnim} }
                        .ringing-img { width: 120px; height: 120px; border-radius: 16px; margin-bottom: 16px; object-fit: cover; }
                    </style>
                    <div class="ringing-box">
                        <img src="${imgSrc}" class="ringing-img">
                        <div class="ringing-title">${isTest ? "Test Alarm" : "Time to Log Off!"}</div>
                        <div class="ringing-subtitle">${isTest ? "Audio & Visuals working." : "Target hours reached!"}</div>
                        <div class="ringing-actions">
                            <button id="ikg-btn-stop" class="ring-btn stop">🛑 Stop Alarm</button>
                            <button id="ikg-btn-snooze" class="ring-btn snooze">💤 Snooze (${snoozeTimeText})</button>
                        </div>
                    </div>`;
          this.overlay.classList.add("active");
        },
        stop: function () {
          IkgLog.info("Alarm Stopped by user.");
          AudioEngine.stop();
          if (this.overlay) this.overlay.classList.remove("active");
          if (this.snoozeTimeout) clearTimeout(this.snoozeTimeout);
          updateHeaderStatus("✅ Synced", "var(--success)");

          if (!this.currentIsTest) {
            const todayReal = new Date();
            const pad = (n) => String(n).padStart(2, "0");
            const todayStr = `${todayReal.getFullYear()}-${pad(todayReal.getMonth() + 1)}-${pad(todayReal.getDate())}`;
            localStorage.setItem(`IKG_ALARM_DISMISSED_${todayStr}`, "true");

            const btn = document.getElementById("ikg-btn-alarm");
            if (btn) {
              btn.innerText = `✅ Alarm Dismissed for Today`;
              btn.style.background = "transparent";
              btn.style.color = "var(--text-muted)";
              btn.style.borderColor = "var(--border)";
              btn.style.pointerEvents = "none";
              btn.removeAttribute("id");
            }
          }
        },
        snooze: function () {
          const settings = getSettings();
          const unit = (settings.snoozeUnit || "m").toLowerCase();
          const sMult = unit === "s" ? 1000 : 60000;
          const timeText =
            unit === "s" ? `${settings.snoozeMins}s` : `${settings.snoozeMins}m`;

          IkgLog.info(`Alarm Snoozed for ${timeText}.`);

          AudioEngine.stop();
          if (this.overlay) this.overlay.classList.remove("active");
          if (this.snoozeTimeout) clearTimeout(this.snoozeTimeout);

          this.snoozeTimeout = setTimeout(() => {
            this.fire(this.currentIsTest);
          }, settings.snoozeMins * sMult);

          const btn = document.getElementById("ikg-btn-alarm");
          if (btn) btn.innerText = `💤 Snoozing (${timeText})...`;
          updateHeaderStatus(`💤 Snoozing (${timeText})...`, "var(--warn)");
        },
      };

      const cancelAlarms = () => {
        window.ikgAlarmTimeouts.forEach(clearTimeout);
        window.ikgAlarmTimeouts = [];
        window.ikgScheduledTargetMs = null;

        if (window.ikgTestAlarmTimeout) {
          clearInterval(window.ikgTestAlarmTimeout);
          window.ikgTestAlarmTimeout = null;
          const testBtn = document.getElementById("ikg-btn-test-alarm");
          if (testBtn) {
            testBtn.innerText = "🧪 Run Test";
            testBtn.style.pointerEvents = "auto";
            testBtn.style.opacity = "1";
          }
        }

        sessionStorage.removeItem("IKG_ALARM_TARGET");
        IkgLog.info("Scheduled alarms canceled by user.");

        const setBtn = document.getElementById("ikg-btn-alarm");
        const activeView = document.getElementById("ikg-alarm-active-view");

        if (setBtn && activeView) {
          activeView.style.display = "none";
          setBtn.style.display = "block";
        }

        updateHeaderStatus("🔕 Alarms Cleared", "var(--text-muted)");
      };

      const scheduleAlarms = (endTimeMs, silent = false) => {
        const todayReal = new Date();
        const pad = (n) => String(n).padStart(2, "0");
        const todayStr = `${todayReal.getFullYear()}-${pad(todayReal.getMonth() + 1)}-${pad(todayReal.getDate())}`;

        if (localStorage.getItem(`IKG_ALARM_DISMISSED_${todayStr}`) === "true") {
          if (!silent)
            IkgLog.info("Alarm already dismissed for today. Skipping schedule.");
          return;
        }

        window.ikgAlarmTimeouts.forEach(clearTimeout);
        window.ikgAlarmTimeouts = [];
        window.ikgScheduledTargetMs = endTimeMs;
        sessionStorage.setItem("IKG_ALARM_TARGET", endTimeMs.toString());

        const settings = getSettings();
        if (!silent)
          IkgLog.info("Scheduling alarms", {
            target: new Date(endTimeMs).toLocaleTimeString(),
            triggers: settings.triggers,
          });
        if (Notification.permission !== "granted") Notification.requestPermission();

        const now = Date.now();
        const tMult = settings.triggerUnit === "s" ? 1000 : 60000;

        settings.triggers.forEach((val) => {
          const triggerTimeMs = endTimeMs + val * tMult;
          const triggerDelay = triggerTimeMs - now;

          if (triggerDelay > 0) {
            const tid = setTimeout(() => {
              if (val === 0) {
                AlarmSystem.fire(false);
              } else if (Notification.permission === "granted") {
                const absVal = Math.abs(val);

                const timeText =
                  settings.triggerUnit === "s"
                    ? `${absVal} second(s)`
                    : absVal < 1
                      ? `${Math.round(absVal * 60)} seconds`
                      : `${absVal} minute(s)`;

                let bodyText =
                  val < 0
                    ? `Your shift ends in ${timeText}.`
                    : `You are overworking! Shift ended ${timeText} ago.`;

                new Notification("⏰ Shift Update", {
                  body: bodyText,
                  icon: "https://attendance.iki-utl.cc/favicon.png",
                });
              }
            }, triggerDelay);
            window.ikgAlarmTimeouts.push(tid);
          }
        });

        const setBtn = document.getElementById("ikg-btn-alarm");
        const activeView = document.getElementById("ikg-alarm-active-view");
        const statusText = document.getElementById("ikg-alarm-status-text");

        if (setBtn && activeView && statusText) {
          setBtn.style.display = "none";
          statusText.innerText = `✅ Scheduled (${formatTime(endTimeMs)})`;
          statusText.style.color = "var(--success)";
          activeView.style.background = "var(--success-bg)";
          activeView.style.borderColor = "rgba(16, 185, 129, 0.3)";
          activeView.style.display = "flex";
        }
        if (!silent)
          updateHeaderStatus(
            `✅ Scheduled! (Rings at ${formatTime(endTimeMs)})`,
            "var(--success)",
          );
      };

      const executeTestAlarm = (seconds, btnElement) => {
        const originalText = btnElement.innerText;
        btnElement.style.pointerEvents = "none";
        btnElement.style.opacity = "0.7";

        let timeLeft = seconds;

        const setBtn = document.getElementById("ikg-btn-alarm");
        const activeView = document.getElementById("ikg-alarm-active-view");
        const statusText = document.getElementById("ikg-alarm-status-text");

        if (setBtn && activeView) {
          setBtn.style.display = "none";
          activeView.style.display = "flex";
        }

        const updateTick = () => {
          btnElement.innerText = `⏳ Ringing in ${timeLeft}s...`;
          updateHeaderStatus(`⏳ Test Alarm in ${timeLeft}s...`, "var(--warn)");

          if (activeView && statusText) {
            statusText.innerText = `🧪 Test Ringing in ${timeLeft}s...`;
            statusText.style.color = "var(--warn)";
            activeView.style.background = "var(--warn-bg)";
            activeView.style.borderColor = "rgba(245, 158, 11, 0.3)";
          }
        };

        updateTick();

        if (window.ikgTestAlarmTimeout) clearInterval(window.ikgTestAlarmTimeout);

        window.ikgTestAlarmTimeout = setInterval(() => {
          timeLeft--;
          if (timeLeft > 0) {
            updateTick();
          } else {
            clearInterval(window.ikgTestAlarmTimeout);
            window.ikgTestAlarmTimeout = null;
            AlarmSystem.fire(true);
            btnElement.innerText = originalText;
            btnElement.style.pointerEvents = "auto";
            btnElement.style.opacity = "1";
            updateHeaderStatus("⏰ Test Alarm Ringing!", "var(--warn)");

            if (setBtn && activeView && window.ikgAlarmTimeouts.length === 0) {
              activeView.style.display = "none";
              setBtn.style.display = "block";
            }
          }
        }, 1000);
      };

      const downloadMacAlarmICS = (endTimeMs) => {
        const d = new Date(endTimeMs);
        const pad = (n) => String(n).padStart(2, "0");
        const formatICSDate = (date) =>
          `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;

        const startStr = formatICSDate(d);
        const endStr = formatICSDate(new Date(endTimeMs + 15 * 60000));

        const icsData = [
          "BEGIN:VCALENDAR",
          "VERSION:2.0",
          "PRODID:-//Attendance Pro OS Alarm//EN",
          "BEGIN:VEVENT",
          `UID:shift-${Date.now()}@ikg`,
          `DTSTAMP:${formatICSDate(new Date())}`,
          `DTSTART:${startStr}`,
          `DTEND:${endStr}`,
          "SUMMARY:⏰ Goal Out Reached!",
          "DESCRIPTION:Your shift is over. Time to disconnect.",
          "BEGIN:VALARM",
          "TRIGGER:-PT0M",
          "ACTION:DISPLAY",
          "DESCRIPTION:Shift Goal Reached!",
          "END:VALARM",
          "BEGIN:VALARM",
          "TRIGGER:-PT0M",
          "ACTION:AUDIO",
          "VALUE:URI",
          "ALARM:Basso",
          "END:VALARM",
          "END:VEVENT",
          "END:VCALENDAR",
        ].join("\r\n");

        const blob = new Blob([icsData], { type: "text/calendar;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "Goal_Out_Alarm.ics";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      };

      document.addEventListener(
        "click",
        (e) => {
          const target = e.target.closest ? e.target : e.target.parentElement;
          if (!target || !target.closest) return;

          const alarmBtn = target.closest("#ikg-btn-alarm");
          if (alarmBtn) {
            e.preventDefault();
            e.stopPropagation();
            const endMs = parseInt(alarmBtn.getAttribute("data-endms"), 10);
            if (!isNaN(endMs)) scheduleAlarms(endMs);
          }

          const macAlarmBtn = target.closest("#ikg-btn-mac-alarm");
          if (macAlarmBtn) {
            e.preventDefault();
            e.stopPropagation();
            const endMs = parseInt(macAlarmBtn.getAttribute("data-endms"), 10);
            if (!isNaN(endMs)) {
              downloadMacAlarmICS(endMs);
              const originalText = macAlarmBtn.innerText;
              macAlarmBtn.innerText = "✅ .ics Downloaded!";
              setTimeout(() => (macAlarmBtn.innerText = originalText), 3000);
            }
          }

          const testBtn = target.closest("#ikg-btn-test-alarm");
          if (testBtn) {
            e.preventDefault();
            e.stopPropagation();
            const secInput = document.getElementById("ikg-test-sec");
            const secs = secInput ? parseInt(secInput.value, 10) : 5;
            executeTestAlarm(secs, testBtn);
          }

          const cancelAlarmBtn = target.closest("#ikg-btn-cancel-alarm");
          if (cancelAlarmBtn) {
            e.preventDefault();
            e.stopPropagation();
            cancelAlarms();
          }
        },
        true,
      );

      // ==========================================
      // 4. CORE LOGIC & STATE
      // ==========================================
      let isFetchingData = false;
      const API_BASE = "https://9a2igbhvdb.execute-api.us-west-2.amazonaws.com";
      const CACHE_KEY = `IKG_ATTENDANCE_CACHE_${APP_VER}`;
      const DAY_NOTES_KEY = `IKG_DAY_NOTES_${APP_VER}`;
      const AGG_CACHE_KEY = `IKG_AGGREGATE_CACHE_${APP_VER}`;
      const SYNC_FLAG_KEY = `IKG_FULL_SYNC_DONE_${APP_VER}`;
      const STATS_STATE_KEY = `IKG_STATS_STATE_${APP_VER}`;
      const AUDIT_STATE_KEY = `IKG_AUDIT_STATE_${APP_VER}`;

      const cleanUpAndMigrateStorage = () => {
        const pad = (n) => String(n).padStart(2, "0");
        const d = new Date();
        const todayStr = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
        const keysToRemove = [];

        const baseKeys = ["IKG_ATTENDANCE_CACHE", "IKG_DAY_NOTES", "IKG_AGGREGATE_CACHE", "IKG_FULL_SYNC_DONE", "IKG_STATS_STATE", "IKG_AUDIT_STATE"];

        baseKeys.forEach((base) => {
          const newKey = `${base}_${APP_VER}`;
          if (!localStorage.getItem(newKey)) {
            let highestOldVal = null; let highestOldVer = -1;
            for (let i = 0; i < localStorage.length; i++) {
              const key = localStorage.key(i);
              const match = key.match(new RegExp(`^${base}_V(\\d+)$`));
              if (match) {
                const ver = parseInt(match[1], 10);
                if (ver > highestOldVer) { highestOldVer = ver; highestOldVal = localStorage.getItem(key); }
              }
            }
            if (highestOldVal === null && localStorage.getItem(base)) highestOldVal = localStorage.getItem(base);
            if (highestOldVal !== null) localStorage.setItem(newKey, highestOldVal);
          }
        });

        const dailyPattern = /^(IKG_ALARM_DISMISSED_|IKG_AUTO_ALARM_|IKG_TODAY_FLEX_)(\d{4}-\d{2}-\d{2})$/;
        const versionPattern = /^IKG_.*_V(\d+)$/;
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          const dailyMatch = key.match(dailyPattern);
          if (dailyMatch) { if (dailyMatch[2] < todayStr) keysToRemove.push(key); continue; }
          const verMatch = key.match(versionPattern);
          if (verMatch && !key.endsWith(`_${APP_VER}`)) keysToRemove.push(key);
        }
        keysToRemove.forEach((k) => localStorage.removeItem(k));
      };
      cleanUpAndMigrateStorage();

      let globalTotalDays = 0, globalTotalHours = 0, globalFirstDate = "--";
      const today = new Date();
      let currentViewYear = today.getFullYear(), currentViewMonth = today.getMonth() + 1, activeTab = "cal";
      let currentStatsRange = "7D", currentAuditRange = "ALL", currentStatsMonth = "", currentAuditMonth = "";
      let statsRangeStart = null, statsRangeEnd = null, auditRangeStart = null, auditRangeEnd = null;

      try {
        const savedStats = JSON.parse(localStorage.getItem(STATS_STATE_KEY));
        if (savedStats) { currentStatsRange = savedStats.range || "7D"; currentStatsMonth = savedStats.month || ""; statsRangeStart = savedStats.start ? new Date(savedStats.start) : null; statsRangeEnd = savedStats.end ? new Date(savedStats.end) : null; }
        const savedAudit = JSON.parse(localStorage.getItem(AUDIT_STATE_KEY));
        if (savedAudit) { currentAuditRange = savedAudit.range || "ALL"; currentAuditMonth = savedAudit.month || ""; auditRangeStart = savedAudit.start ? new Date(savedAudit.start) : null; auditRangeEnd = savedAudit.end ? new Date(savedAudit.end) : null; }
      } catch (e) {}

      const safeFloat = (num) => Math.round((num + Number.EPSILON) * 1000000) / 1000000;
      const toYMD = (d) => { const pad = (n) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

      const populateMonthSelect = (selectId, localCache, currentVal) => {
        const selectEl = document.getElementById(selectId);
        if (!selectEl) return currentVal;
        const months = new Set();
        Object.keys(localCache).forEach((dateStr) => { if (localCache[dateStr] && localCache[dateStr].workHours) months.add(dateStr.substring(0, 7)); });
        const sortedMonths = Array.from(months).sort().reverse();
        const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        const currentOptions = Array.from(selectEl.options).map((o) => o.value);
        if (JSON.stringify(currentOptions) !== JSON.stringify(sortedMonths)) {
          selectEl.innerHTML = "";
          if (sortedMonths.length === 0) { selectEl.innerHTML = `<option value="">No Data</option>`; return ""; }
          sortedMonths.forEach((m) => { const [yyyy, mm] = m.split("-"); const name = `${monthNames[parseInt(mm, 10) - 1]} ${yyyy}`; selectEl.innerHTML += `<option value="${m}">${name}</option>`; });
        }
        if (currentVal && sortedMonths.includes(currentVal)) { selectEl.value = currentVal; return currentVal; } 
        else if (sortedMonths.length > 0) { selectEl.value = sortedMonths[0]; return sortedMonths[0]; }
        return "";
      };

      // 🎯 RESTORED GLOBAL TIME FUNCTIONS (Duplicates Removed)
      const formatTime = (ms) => {
        if (!ms) return "--:--";
        const showSecs = getSettings().showSeconds;
        const opts = { hour: "2-digit", minute: "2-digit", hour12: false };
        if (showSecs) opts.second = "2-digit";
        return new Date(ms).toLocaleTimeString([], opts);
      };

      const msToTimeString = (ms) => {
        if (isNaN(ms) || ms === 0) return "--:--";
        const showSecs = getSettings().showSeconds;
        const opts = {
          timeZone: "UTC",
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        };
        if (showSecs) opts.second = "2-digit";
        return new Date(ms).toLocaleTimeString([], opts);
      };

      const formatDurFromDec = (decimalHours, isDelta = false) => {
        if (isNaN(decimalHours)) return "--";
        const showSecs = getSettings().showSeconds;
        const isNeg = decimalHours < 0;
        const totalSeconds = Math.round(Math.abs(decimalHours) * 3600);
        const h = Math.floor(totalSeconds / 3600), m = Math.floor((totalSeconds % 3600) / 60), s = totalSeconds % 60;
        const pad = (n) => String(n).padStart(2, "0");
        let res = "";
        if (h > 0) res = showSecs ? `${h}h ${pad(m)}m ${pad(s)}s` : `${h}h ${pad(m)}m`;
        else res = showSecs ? `${m}m ${pad(s)}s` : `${m}m`;
        if (totalSeconds === 0) res = showSecs ? "0m 00s" : "0m";
        return isDelta ? (isNeg ? `-${res}` : `+${res}`) : res;
      };

      // --- DEEL PTO AUTO-SYNC ENGINE ---
      const ensureDeelToken = () => {
        return new Promise((resolve) => {
          const existingToken = GM_getValue("IKG_DEEL_TOKEN", null);
          if (existingToken) return resolve(existingToken);

          const errorMsg = "⚠️ Deel Auth Token missing! You might not have logged into Deel (ikg.deel.team) in this browser before.";
          IkgLog.warn(`${errorMsg} Opening background tab to auto-snatch...`);
          updateHeaderStatus("Auto-Syncing PTO...", "var(--warn)");

          // 🎟️ Enable SSO Autopilot Pass for Deel + Google SSO
          GM_setValue("IKG_SSO_TRIGGERED", Date.now());

          const deelTab = GM_openInTab("https://ikg.deel.team/", {
            active: false,
            insert: true,
          });

          if (!deelTab) {
            IkgLog.error("❌ Failed to open Deel background tab. Check Tampermonkey popup/tab permissions.");
            alert(`${errorMsg}\n\nPlease open https://ikg.deel.team/ in a new tab, log in once manually, then try syncing again.`);
            return resolve(null);
          }

          const listenerId = GM_addValueChangeListener(
            "IKG_DEEL_TOKEN",
            function (name, old_value, new_value) {
              if (new_value) {
                IkgLog.info("✅ Token caught from Deel tab! Closing background tab...");
                GM_removeValueChangeListener(listenerId);
                try { deelTab.close(); } catch (e) {} 
                resolve(new_value);
              }
            }
          );

          setTimeout(() => {
            GM_removeValueChangeListener(listenerId);
            if (!GM_getValue("IKG_DEEL_TOKEN", null)) {
              IkgLog.error(`❌ ${errorMsg} Auto-snatch timed out after 30s.`);
              updateHeaderStatus("❌ Deel Auth Failed. Log in manually!", "var(--danger)");

              alert(
                "Attendance Pro Alert:\n\n" +
                "Could not retrieve your Deel PTO token automatically.\n" +
                "Reason: You haven't logged into Deel (ikg.deel.team) in this browser session, or SSO timed out.\n\n" +
                "Please open https://ikg.deel.team/ and log in once manually."
              );

              try { deelTab.close(); } catch (e) {}
              resolve(null);
            }
          }, 30000); // 30 seconds timeout
        });
      };

      const fetchAndParseDeelPTO = async (isRetry = false) => {
    const token = await ensureDeelToken();
    if (!token) {
      IkgLog.error("❌ Skipping Deel PTO Sync: No valid Deel Auth Token available.");
      return null;
    }

    const fetchDeel = (path) =>
      new Promise((resolve, reject) => {
        GM_xmlhttpRequest({
          method: "GET",
          url: `https://ikg.deel.team/deelapi/${path}`,
          withCredentials: true,
          headers: {
            Accept: "application/json, text/plain, */*",
            "x-auth-token": token,
            "x-api-version": "2",
            "x-app-host": "ikg.deel.team",
            "x-platform": "web",
            "x-owner": "timeoff-fe",
            Origin: "https://ikg.deel.team",
            Referer: "https://ikg.deel.team/",
          },
          onload: (res) => {
            if (res.status === 401 || res.status === 403)
              reject({ status: res.status });
            else if (res.status === 200) resolve(JSON.parse(res.responseText));
            else reject({ status: res.status });
          },
          onerror: (err) => reject(err),
        });
      });

    try {
      IkgLog.info("Fetching Deel PTO Data natively...");
      let profileId = GM_getValue("IKG_DEEL_PROFILE_ID", null);
      let entData = null;

      if (!profileId) {
        IkgLog.info("Resolving Time-Off Profile UUID...");
        const timeOffsMe = await fetchDeel("time_offs/me");
        profileId = timeOffsMe?.profile?.id;

        if (!profileId)
          throw new Error("Could not find profile.id in /time_offs/me response.");

        GM_setValue("IKG_DEEL_PROFILE_ID", profileId);
        IkgLog.info(`✅ Resolved Time-Off Profile UUID: ${profileId}`);
      }

      try {
        entData = await fetchDeel(`time_offs/profile/${profileId}/entitlements`);
      } catch (entErr) {
        IkgLog.warn("Could not fetch entitlements, skipping...", entErr);
      }

      const toData = await fetchDeel(`time_offs/profile/${profileId}/time_off?orderType=DESC&lightweight=true`);
      const ptoCalendar = {};
      const syncLog = [];

      if (Array.isArray(toData)) {
        toData.forEach((req) => {
          if (req.status !== "USED" && req.status !== "APPROVED") return;

          const startStr = req.startDate.substring(0, 10);
          const endStr = req.endDate.substring(0, 10);
          const typeName = req.timeOffType?.name || "Leave";
          const unit = req.timeOffType?.policy?.entitlementUnit || "BUSINESS_DAY";
          const totalAmt = parseFloat(req.amount) || 0;

          let curr = new Date(startStr + "T00:00:00");
          const end = new Date(endStr + "T00:00:00");
          const daySpan = Math.round((end - curr) / 86400000) + 1;
          const dailyAmt = totalAmt / daySpan;

          while (curr <= end) {
            const pad = (n) => String(n).padStart(2, "0");
            const dStr = `${curr.getFullYear()}-${pad(curr.getMonth() + 1)}-${pad(curr.getDate())}`;
            const isFullDay = unit === "BUSINESS_DAY" || unit === "CALENDAR_DAY";
            const calculatedHours = isFullDay ? dailyAmt * 8 : dailyAmt;

            ptoCalendar[dStr] = {
              isFullDay: isFullDay,
              type: typeName,
              hours: calculatedHours,
            };

            // 🎯 TELEMETRY LOG FOR DEEL PTO
            IkgLog.debug(`[Deel Sync] ${dStr} -> Type: "${typeName}" | Unit: ${unit} | Raw Amt: ${dailyAmt} -> Injected Hrs: ${calculatedHours}h`);

            curr.setDate(curr.getDate() + 1);
          }
        });
      }
      return { ptoCalendar, syncLog };
    } catch (e) {
      if (e.status === 401 && !isRetry) {
        IkgLog.warn("Deel Token expired or invalid. Clearing saved token & retrying...");
        GM_setValue("IKG_DEEL_TOKEN", null);
        GM_setValue("IKG_DEEL_PROFILE_ID", null);
        return await fetchAndParseDeelPTO(true);
      }
      IkgLog.error("❌ Deel PTO Sync Failed:", e.status ? `HTTP Status ${e.status}` : e.message || JSON.stringify(e));
      return null;
    }
  };

      // ==========================================
      // 4. CORE LOGIC & STATE (WITH GAS SUPPORT)
      // ==========================================

// --- GAS INJECTION INTERCEPTOR ---
      const injectScript = document.createElement("script");
      injectScript.textContent = `
            (function() {
                const originalFetch = window.fetch;
                window.fetch = async function(...args) {
                    try {
                        let url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url ? args[0].url : '');
                        let options = args[1] || {}; 
                        let headersObj = (args[0] && args[0].headers) ? args[0].headers : options.headers;
                        
                        if (url && url.includes('9a2igbhvdb.execute-api.us-west-2.amazonaws.com/attendance')) {
                            let token = null;
                            if (headersObj) {
                                if (headersObj instanceof Headers) token = headersObj.get('authorization') || headersObj.get('Authorization');
                                else { const authKey = Object.keys(headersObj).find(k => k.toLowerCase() === 'authorization'); if (authKey) token = headersObj[authKey]; }
                            }
                            if (token) window.dispatchEvent(new CustomEvent('IKG_Token_Found', { detail: token }));
                        }

                        // Catch Google Script Tokens Aggressively
                        if (url && url.includes('script.google.com') && url.includes('token=')) {
                            const urlObj = new URL(url.startsWith('http') ? url : window.location.origin + url);
                            const gasToken = urlObj.searchParams.get('token');
                            if (gasToken) window.dispatchEvent(new CustomEvent('IKG_GAS_Token_Found', { detail: gasToken }));
                        }
                    } catch (e) {}

                    const response = await originalFetch.apply(this, args);
                    if (response.status === 401) window.dispatchEvent(new CustomEvent('IKG_Session_Death'));
                    return response;
                };

                const originalOpen = XMLHttpRequest.prototype.open;
                XMLHttpRequest.prototype.open = function(method, url, ...rest) {
                    if (typeof url === 'string' && url.includes('script.google.com') && url.includes('token=')) {
                        try {
                            const urlObj = new URL(url.startsWith('http') ? url : window.location.origin + url);
                            const gasToken = urlObj.searchParams.get('token');
                            if (gasToken) window.dispatchEvent(new CustomEvent('IKG_GAS_Token_Found', { detail: gasToken }));
                        } catch(e) {}
                    }
                    return originalOpen.call(this, method, url, ...rest);
                };
            })();
      `;
      document.documentElement.appendChild(injectScript);
      injectScript.remove();

      // 🎯 AUTO-RECOVERY RELOAD ENGINE (Exponential Backoff, Max 10 Attempts)
      const handle401Recovery = () => {
        const MAX_RELOAD_ATTEMPTS = 10;
        let attempts = parseInt(sessionStorage.getItem("IKG_RELOAD_ATTEMPTS") || "0", 10);

        if (attempts < MAX_RELOAD_ATTEMPTS) {
          attempts++;
          sessionStorage.setItem("IKG_RELOAD_ATTEMPTS", attempts.toString());
          
          // Exponential backoff: 1s, 2s, 4s, 8s, 16s... (capped at 30s)
          const delayMs = Math.min(30000, Math.pow(2, attempts - 1) * 1000);
          IkgLog.warn(`⚠️ HTTP 401 Auth Error! Auto-reloading in ${(delayMs / 1000).toFixed(1)}s (Attempt ${attempts}/${MAX_RELOAD_ATTEMPTS})...`);
          updateHeaderStatus(`🔄 Auth Error: Reloading in ${(delayMs / 1000).toFixed(0)}s (${attempts}/10)...`, "var(--danger)");

          setTimeout(() => {
            window.location.reload();
          }, delayMs);
        } else {
          IkgLog.error(`❌ Reached max reload limit (${MAX_RELOAD_ATTEMPTS}). Reload halted.`);
          updateHeaderStatus("❌ Session Expired: Please re-login", "var(--danger)");
        }
      };

      let gasAuthToken = null;

      // Reset reload attempts counter whenever a valid token is intercepted
      window.addEventListener("IKG_Token_Found", function (e) {
        if (!authToken) { 
          authToken = e.detail; 
          autopilotEnabled = false; 
          sessionStorage.removeItem("IKG_RELOAD_ATTEMPTS"); // Clear backoff count on valid token
          IkgLog.info("AWS Token Intercepted."); 
        }
      });

      window.addEventListener("IKG_GAS_Token_Found", function(e) {
        if (gasAuthToken !== e.detail) { 
          gasAuthToken = e.detail; 
          IkgLog.info("✅ Google Apps Script (WFH) Token Intercepted!"); 
        }
      });

      window.addEventListener("IKG_Session_Death", function () {
        if (authToken) { 
          IkgLog.warn("API returned 401. Fast session death detected!"); 
          authToken = null; 
          autopilotEnabled = true; 
          handle401Recovery();
        }
      });

      // --- GAS DATA FETCHER (Silent Scraper - Supports ACHNx & AEDo Tokens) ---
  const ensureGasToken = () => {
    return new Promise((resolve) => {
      let gasData = null;
      try { gasData = JSON.parse(GM_getValue("IKG_GAS_DATA", "null")); } catch(e){}
      
      // Reuse token if valid
      if (gasData && gasData.token && gasData.exp > Date.now()) return resolve(gasData);

      IkgLog.info("No active WFH Token. Silently scraping from Google Apps Script HTML...");
      updateHeaderStatus("Securing WFH Token...", "var(--warn)");

      const gasUrl = "https://script.google.com/a/macros/ikigai.team/s/AKfycbyFf90WKuTH_HuePNWHWx6mji5vsgOCR4-g2u8b1n9P7HBedub9YgjzzPY-cBJd9Kax/exec";

      GM_xmlhttpRequest({
        method: "GET",
        url: gasUrl,
        withCredentials: true, // Applies session cookies automatically
        onload: (res) => {
          if (res.status === 200) {
            // 🎯 UPDATED REGEX: Matches both old ACHNx... and new AEDo... token formats
            const match = res.responseText.match(/((?:ACHNx|AEDo|A[a-zA-Z0-9_\-]{5,})[a-zA-Z0-9_\-]+(?:%3A|:)[0-9]+)/);
            
            let rawToken = null;
            if (match && match[1]) {
              rawToken = decodeURIComponent(match[1]);
            } else {
              // Fallback: Look for encoded tokens inside callback URLs embedded in script tags
              const fallbackMatch = res.responseText.match(/token=([A-Za-z0-9_\-%]+)/);
              if (fallbackMatch && fallbackMatch[1]) {
                rawToken = decodeURIComponent(fallbackMatch[1]);
              }
            }

            if (rawToken) {
              IkgLog.info(`✅ WFH Token Secured: ${rawToken.substring(0, 12)}...`);
              const newGasData = {
                token: rawToken,
                callbackUrl: "https://script.google.com/a/ikigai.team/macros/s/AKfycbyFf90WKuTH_HuePNWHWx6mji5vsgOCR4-g2u8b1n9P7HBedub9YgjzzPY-cBJd9Kax/callback",
                exp: Date.now() + 3300000 // Valid ~55 mins
              };
              GM_setValue("IKG_GAS_DATA", JSON.stringify(newGasData));
              return resolve(newGasData);
            }
          }

          IkgLog.error(`❌ Failed to extract WFH token. Status: ${res.status}`);
          updateHeaderStatus("❌ WFH Token Error", "var(--danger)");
          resolve(null);
        },
        onerror: (err) => {
          IkgLog.error("❌ Network error fetching WFH token", err);
          resolve(null);
        }
      });
    });
  };

      const fetchGasRecords = async (dateStr, gasData) => {
        return new Promise((resolve) => {
            const urlWithParams = `${gasData.callbackUrl}?nocache_id=${Math.floor(Math.random()*1000)}&token=${encodeURIComponent(gasData.token)}`;
            const payloadStr = `["getRecordsByDate","[\\"${dateStr}\\"]",null,[0],null,null,1,0]`;
            const formData = `request=${encodeURIComponent(payloadStr)}`;

            GM_xmlhttpRequest({
                method: "POST",
                url: urlWithParams,
                headers: { 
                    "accept": "*/*", 
                    "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
                    "origin": "https://script.google.com",
                    "referer": "https://script.google.com/a/macros/ikigai.team/s/AKfycbyFf90WKuTH_HuePNWHWx6mji5vsgOCR4-g2u8b1n9P7HBedub9YgjzzPY-cBJd9Kax/exec",
                    "x-same-domain": "1"
                },
                data: formData,
                withCredentials: true,
                onload: function(res) {
                    if (res.status === 200) {
                        try {
                            // Dynamically find the start of the JSON array to avoid prefix issues
                            const firstBracket = res.responseText.indexOf('[');
                            if (firstBracket !== -1) {
                                const cleanJsonStr = res.responseText.substring(firstBracket);
                                const parsedArray = JSON.parse(cleanJsonStr);
                                const payloadOp = parsedArray.find(item => item[0] === "op.exec");
                                
                                if (payloadOp && payloadOp[1] && typeof payloadOp[1][1] === 'string') {
                                    const records = JSON.parse(payloadOp[1][1]);
                                    if (records && records.length > 0) IkgLog.debug(`[GAS] ${dateStr} returned ${records.length} punches.`);
                                    resolve(records);
                                    return;
                                } else {
                                    IkgLog.warn(`[GAS] Empty/Invalid payload for ${dateStr}. Google returned:`, res.responseText.substring(0, 100));
                                }
                            }
                        } catch (e) {
                            IkgLog.error(`[GAS Parse Error] ${dateStr}`, e);
                        }
                    } else {
                        IkgLog.error(`[GAS HTTP Error] ${dateStr} returned ${res.status}`);
                    }
                    resolve(null);
                },
                onerror: (err) => {
                    IkgLog.error(`[GAS Network Error] ${dateStr}`, err);
                    resolve(null);
                }
            });
        });
      };

      // ==========================================
      // 5. REACTIVE FOREGROUND AUTOMATION
      // ==========================================
      let hasClickedFetch = false;

      const attemptAppClick = () => {
        if (!autopilotEnabled) return false;
        const buttons = Array.from(document.querySelectorAll("button"));
        const loginBtn = buttons.find((b) =>
          (b.innerText || "").toUpperCase().includes("SIGN IN WITH GOOGLE"),
        );

        if (loginBtn && loginBtn.offsetParent !== null) {
          GM_setValue("IKG_SSO_TRIGGERED", Date.now());
          loginBtn.click();
          return true;
        }

        if (!authToken && !hasClickedFetch) {
          const fetchBtn = buttons.find((b) =>
            (b.innerText || "").toUpperCase().includes("FETCH"),
          );
          if (fetchBtn && fetchBtn.offsetParent !== null) {
            hasClickedFetch = true;
            fetchBtn.click();
            setTimeout(() => {
              hasClickedFetch = false;
            }, 3000);
            return true;
          }
        }
        return false;
      };

      const initAppAutopilot = () => {
        if (attemptAppClick()) return;
        const obs = new MutationObserver(() => {
          if (!autopilotEnabled) obs.disconnect();
          else attemptAppClick();
        });
        obs.observe(document.body, { childList: true, subtree: true });
      };

      document.addEventListener(
        "click",
        (e) => {
          const target = e.target.closest ? e.target : e.target.parentElement;
          if (!target) return;
          if (
            (target.innerText || "").toUpperCase().includes("SIGN IN WITH GOOGLE")
          ) {
            GM_setValue("IKG_SSO_TRIGGERED", Date.now());
          }
        },
        true,
      );

      if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", initAppAutopilot);
      } else {
        initAppAutopilot();
      }

      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") {
          IkgLog.debug("Tab regained focus. Validating sessions...");
          
          // If dates were updated while in background, refresh UI instantly upon returning
          if (window.ikgUpdatedDates && window.ikgUpdatedDates.size > 0) {
            renderCalendar();
          }
          attemptAppClick();

          if (authToken) {
            const todayStr = toYMD(new Date());
            window
              .fetch(
                `${API_BASE}/attendance/range?from=${todayStr}&to=${todayStr}`,
                {
                  headers: { authorization: authToken },
                },
              )
              .catch(() => {});
          }

          if (!GM_getValue("IKG_DEEL_TOKEN", null)) {
            IkgLog.info("Missing Deel token on focus. Snatching silently...");
            ensureDeelToken();
          }
        }
      });

        // 🎯 MASTER BLOCKING HOLIDAY LOCK (Normalized YYYY-MM-DD Map)
      const ensureHolidaysSecured = (year) => {
        const key = `IKG_HOLIDAYS_${year}`;
        const cached = localStorage.getItem(key);
        
        const isCacheHealthy = (str) => { 
          if (!str) return false; 
          try { 
            const obj = JSON.parse(str); 
            const sampleKey = Object.keys(obj)[0]; 
            return sampleKey && sampleKey.includes('-') && Object.keys(obj).length > 0; 
          } catch(e) { return false; } 
        };
        
        if (isCacheHealthy(cached)) return Promise.resolve();

        return new Promise((resolve, reject) => {
          updateHeaderStatus(`Securing ${year} Holidays...`, 'var(--warn)');
          GM_xmlhttpRequest({
            method: "GET", 
            url: `https://cdn.jsdelivr.net/gh/ruyut/TaiwanCalendar/data/${year}.json`, 
            timeout: 10000,
            onload: (res) => {
              if (res.status === 200) {
                try {
                  const list = JSON.parse(res.responseText); 
                  const map = {};
                  list.forEach(d => {
                    if (!d.date) return;
                    const rawD = String(d.date); 
                    let isoDate = rawD;
                    if (rawD.length === 8 && !rawD.includes('-')) {
                      isoDate = `${rawD.slice(0,4)}-${rawD.slice(4,6)}-${rawD.slice(6,8)}`;
                    }
                    if (d.isHoliday) {
                      map[isoDate] = d.description || "國定假日";
                    }
                  });
                  map[`${year}-05-01`] = "勞動節";
                  localStorage.setItem(key, JSON.stringify(map)); 
                  updateHeaderStatus('✅ Synced', 'var(--success)'); 
                  resolve();
                } catch(e) { reject("Malformed JSON from CDN"); }
              } else { reject(`HTTP ${res.status}`); }
            },
            ontimeout: () => reject("CDN Timeout"), 
            onerror: () => reject("Network Failure")
          });
        });
      };

    // 🎯 DDD REPOSITORY: Optimized Single-Read Snapshot
    const IKG_DataStore = {
      buildSnapshot: function() {
        const d = new Date();
        const y = d.getFullYear();
        // Read holiday JSON once per snapshot build
        const currentHolidays = JSON.parse(localStorage.getItem(`IKG_HOLIDAYS_${y}`) || "{}");
        
        return { 
          cache: JSON.parse(localStorage.getItem(CACHE_KEY) || "{}"), 
          pto: JSON.parse(localStorage.getItem(DAY_NOTES_KEY) || "{}"), 
          overrides: JSON.parse(localStorage.getItem(OVERRIDES_KEY) || "{}"), 
          settings: getSettings(),
          holidays: currentHolidays
        };
      },
      getDayContext: function(dateStr, snapshot) {
        return { 
          dateStr, 
          record: snapshot.cache[dateStr], 
          note: snapshot.pto[dateStr], 
          override: snapshot.overrides[dateStr], 
          settings: snapshot.settings, 
          holidays: snapshot.holidays 
        };
      }
    };

// ==========================================
  // 1. REFINED LUNCH-AWARE PTO ENGINE (9.0h GROSS BASE)
  // ==========================================
  const calculateDailyTarget = (ptoHrs, ptoType = "", isFullPTO = false) => {
    let finalTarget = 9.0; // Standard Gross Shift (8.0h net work + 1.0h mandatory lunch)
    let calculationReason = "";

    if (isFullPTO || ptoHrs >= 8.0) {
      finalTarget = 0.0;
      calculationReason = "Full-day PTO (Target = 0h)";
    } 
    else if (ptoHrs === 0) {
      finalTarget = 9.0;
      calculationReason = "Standard Gross Shift (8.0h work + 1.0h lunch)";
    } 
    else if (ptoHrs >= 4.25 && ptoHrs <= 5.25) {
      const typeLower = (ptoType || '').toLowerCase();
      if (typeLower.includes("pm") || typeLower.includes("afternoon") || ptoHrs >= 4.5) {
        finalTarget = 2.75; // 09:00 to 11:45 AM (Exempt from lunch)
        calculationReason = `Afternoon PTO (${ptoHrs}h). User works 09:00~11:45 AM`;
      } else {
        finalTarget = 5.0; // 13:00 to 18:00 PM
        calculationReason = `Morning PTO (${ptoHrs}h). User works 13:00~18:00 PM`;
      }
    } 
    else {
      finalTarget = Math.max(0, 9.0 - ptoHrs);
      calculationReason = `Direct Partial PTO Deduction: 9.0h - ${ptoHrs}h PTO`;
    }

    if (ptoHrs > 0 || isFullPTO) {
      IkgLog.info(`[Target Engine] Input: { ptoHrs: ${ptoHrs}h, type: "${ptoType}", isFullPTO: ${isFullPTO} } -> Target: ${finalTarget}h | ${calculationReason}`);
    }

    return finalTarget;
  };

  // 🎯 UNIFIED COLOR TONE CALCULATOR (8.5h Lime Green / 9.0h Green Thresholds)
  const getDailyColorGrade = (effectiveHrs, targetHrs, isToday, isYesterdayGrace) => {
    if (targetHrs === 0 && effectiveHrs === 0) return { color: 'var(--text-muted)', label: 'none' };
    
    if (isToday && effectiveHrs < targetHrs) {
      return { color: '#F59E0B', label: 'today-active' }; // Amber
    }
    if (isYesterdayGrace && effectiveHrs < targetHrs) {
      return { color: 'var(--text-muted)', label: 'yesterday-grace' }; // Suppressed
    }

    // 🔑 COLOR-CODING THRESHOLDS BASED ON EFFECTIVE HOURS WORKED
    if (effectiveHrs < 8.5) {
      return { color: '#EF4444', label: 'deficit' }; // 🔴 Red (Short < 8.5h)
    } else if (effectiveHrs >= 8.5 && effectiveHrs < 9.0) {
      return { color: '#84CC16', label: 'acceptable' }; // 🟢 Lime Green (8.5h <= x < 9.0h)
    } else if (effectiveHrs >= 9.0 && effectiveHrs < 10.0) {
      return { color: '#10B981', label: 'surplus' }; // 🟢 Core Green (x >= 9.0h)
    } else {
      return { color: '#059669', label: 'overachiever' }; // 🟢 Deep Emerald (x >= 10.0h)
    }
  };

  // 🎯 DDD DOMAIN MODEL: Evaluates day context using 9.0h Gross Shift Baseline
  const evaluateDay = (ctx) => {
    const { dateStr, record, note, override, settings, holidays } = ctx;
    let ptoHrs = note ? (parseFloat(note.deductedHours) || 0) : 0;
    const ptoType = note ? (note.type || 'PTO') : '';

    const isFullPTO = !!(note && note.isPTO) || ptoHrs >= 8.0;
    const isPartialPTO = !isFullPTO && ptoHrs > 0;
    if (isFullPTO) ptoHrs = 9.0;

    const isIgnored = settings.useManualOverrides !== false && !!(override && override.isIgnored);
    const isWFH = !!(record && record.isWFH);

    let effStart = record?.startTime ? new Date(record.startTime).getTime() : null;
    let effEnd = record?.endTime ? new Date(record.endTime).getTime() : null;
    
    let rawActualHrs = (effStart && effEnd) 
      ? safeFloat((effEnd - effStart) / 3600000) 
      : ((record && record.workHours) ? parseFloat(record.workHours) : 0);

    let actualHrs = (isWFH && settings.includeWfhInHours === false) ? 0 : rawActualHrs;
    
    // Strict Spoofed Check: Only true when explicit manual times exist
    let isSpoofed = false;
    if (settings.useManualOverrides !== false && override && (override.manualIn || override.manualOut)) {
      const [y, m, d] = dateStr.split('-');
      let effStartD = override.manualIn ? new Date(y, parseInt(m, 10)-1, d, ...override.manualIn.split(':')) : (effStart ? new Date(effStart) : null);
      let effEndD = override.manualOut ? new Date(y, parseInt(m, 10)-1, d, ...override.manualOut.split(':')) : (effEnd ? new Date(effEnd) : null);

      if (effStartD && effEndD) { 
        actualHrs = Math.max(0, (effEndD - effStartD) / 3600000); 
        effStart = effStartD.getTime(); 
        effEnd = effEndD.getTime(); 
        isSpoofed = true; 
      }
      else if (effStartD) { 
        actualHrs = 0; 
        effStart = effStartD.getTime(); 
        effEnd = null; 
        isSpoofed = true; 
      }
    }

    const [y, m, d] = dateStr.split('-');
    const dObj = new Date(parseInt(y, 10), parseInt(m, 10)-1, parseInt(d, 10));
    const isPublicHoliday = !!(holidays && holidays[dateStr]);
    const holidayName = isPublicHoliday ? holidays[dateStr] : '';
    const isWeekend = dObj.getDay() === 0 || dObj.getDay() === 6;
    const isRestDay = isWeekend || isPublicHoliday;

    const nowReal = new Date();
    const todayD = new Date(nowReal.getFullYear(), nowReal.getMonth(), nowReal.getDate());
    const todayStr = toYMD(nowReal);
    const isToday = dateStr === todayStr;

    const yesterdayD = new Date(todayD);
    yesterdayD.setDate(yesterdayD.getDate() - 1);
    
    const isYesterdayGrace = (dateStr === toYMD(yesterdayD)) && (nowReal.getHours() < 18);

    let targetHrs = 0;
    let isWorkingDay = false;
    const hasNoPunches = !effStart && !effEnd && actualHrs === 0;

    if (hasNoPunches && ptoHrs === 0) { 
      targetHrs = 0; isWorkingDay = false; 
    } else if (!isRestDay || ptoHrs > 0) { 
      targetHrs = calculateDailyTarget(ptoHrs, ptoType, isFullPTO);
      if (dObj <= todayD) isWorkingDay = true; 
    } else if (isRestDay && actualHrs > 0) { 
      targetHrs = 0; isWorkingDay = true; 
    }

    const effectiveHrs = isFullPTO ? 9.0 : (actualHrs + ptoHrs);

    // Flex Delta calculated against 9.0h gross daily baseline
    let flexHrs = (isWorkingDay && !isToday && !isYesterdayGrace && !isIgnored) 
      ? (effectiveHrs - (isFullPTO ? 9.0 : targetHrs)) 
      : 0;

    const grade = getDailyColorGrade(effectiveHrs, targetHrs, isToday, isYesterdayGrace);

    let dayStatus = grade.label;
    if (isPublicHoliday && hasNoPunches) {
      dayStatus = 'holiday';
    } else if (isWeekend && hasNoPunches) {
      dayStatus = 'weekend-empty';
    }

    return { 
      isFullPTO, isPartialPTO, ptoHrs, ptoType, isIgnored, isWFH, 
      actualHrs, effStart, effEnd, effectiveHrs, targetHrs, flexHrs, 
      isWorkingDay, isPublicHoliday, holidayName, status: dayStatus, 
      color: grade.color, chartColor: grade.color, heatmapBg: grade.color, 
      isSpoofed, isYesterdayGrace 
    };
  };

  // 🎯 SELF-HEALING CACHE GAPS FILLER (Purges Stale Overwrites & Keeps Max Punch Times)
  const fillCacheGaps = (startStr, endStr, records, cache) => {
    const recordMap = {}; 
    records.forEach((r) => (recordMap[r.PK] = r));
    let curr = new Date(startStr); 
    const end = new Date(endStr);
    
    while (curr <= end) { 
      const dStr = toYMD(curr); 
      const existing = cache[dStr] || {};
      const newRec = recordMap[dStr];
      
      if (newRec) {
        // Strict Epoch MS Conversion
        const oldStartMs = existing.startTime ? new Date(existing.startTime).getTime() : null;
        const oldEndMs = existing.endTime ? new Date(existing.endTime).getTime() : null;
        const newStartMs = newRec.startTime ? new Date(newRec.startTime).getTime() : null;
        const newEndMs = newRec.endTime ? new Date(newRec.endTime).getTime() : null;

        // Preserve WFH flags
        newRec.isWFH = !!(newRec.isWFH || existing.isWFH);
        newRec.gasSynced = !!(newRec.gasSynced || existing.gasSynced);
        
        // 🔑 EARLIEST IN / LATEST OUT (Prevents stale AWS 17:20 from choking GAS 19:36)
        if (oldStartMs && (!newStartMs || oldStartMs < newStartMs)) {
          newRec.startTime = oldStartMs;
        } else if (newStartMs) {
          newRec.startTime = newStartMs;
        }

        if (oldEndMs && (!newEndMs || oldEndMs > newEndMs)) {
          newRec.endTime = oldEndMs;
        } else if (newEndMs) {
          newRec.endTime = newEndMs;
        }

        const finalStartMs = newRec.startTime ? new Date(newRec.startTime).getTime() : null;
        const finalEndMs = newRec.endTime ? new Date(newRec.endTime).getTime() : null;

        // Force workHours calculation on merged values
        if (finalStartMs && finalEndMs) {
          newRec.workHours = safeFloat((finalEndMs - finalStartMs) / 3600000);
        }

        const isStartChanged = oldStartMs !== finalStartMs;
        const isEndChanged = oldEndMs !== finalEndMs;

        if (isStartChanged || isEndChanged) {
          if (!window.ikgUpdatedDates) window.ikgUpdatedDates = new Set();
          window.ikgUpdatedDates.add(dStr);
        }

        cache[dStr] = newRec;
      } else if (existing && Object.keys(existing).length > 0) {
        cache[dStr] = existing;
      } else {
        cache[dStr] = null;
      }

      curr.setDate(curr.getDate() + 1); 
    }
  };

      let chartHoverHandler = null;

      const drawNativeChart = (canvasId, labels, dataItems) => {
        const canvas = document.getElementById(canvasId);
        if (!canvas) return;
        const ctx = canvas.getContext("2d");
        const parent = canvas.parentElement;

        const rect = parent.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;

        const dpr = window.devicePixelRatio || 1;
        canvas.style.width = `${rect.width}px`;
        canvas.style.height = `${rect.height}px`;
        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
        ctx.scale(dpr, dpr);

        const w = rect.width;
        const h = rect.height;
        ctx.clearRect(0, 0, w, h);
        if (dataItems.length === 0) return;

        const padTop = 30,
          padBottom = 50,
          padLeft = 40,
          padRight = 10;
        const chartW = w - padLeft - padRight;
        const chartH = h - padTop - padBottom;

        const maxVal = Math.max(12, ...dataItems.map((d) => d.val + d.pto)) + 1;

        ctx.fillStyle = "#94A3B8";
        ctx.font = "11px sans-serif";
        ctx.textAlign = "right";
        ctx.textBaseline = "middle";
        for (let i = 0; i <= maxVal; i += 2) {
          const y = padTop + chartH - (i / maxVal) * chartH;
          ctx.fillText(i, padLeft - 10, y);
          ctx.beginPath();
          ctx.moveTo(padLeft, y);
          ctx.lineTo(padLeft + chartW, y);
          ctx.strokeStyle = "rgba(255,255,255,0.05)";
          ctx.stroke();
        }

        const spacing = chartW / dataItems.length;
        const barW = Math.min(spacing * 0.8, 40);
        ctx.textAlign = "center";

        dataItems.forEach((item, i) => {
          const x = padLeft + i * spacing + spacing / 2;
          const actualBarH = (item.val / maxVal) * chartH;
          const ptoBarH = (item.pto / maxVal) * chartH;
          const yBase = padTop + chartH;

          if (item.val > 0) {
            ctx.save();
            // 🎯 GHOST RENDERING: Drop opacity to 30% if marked as ignored
            if (item.isIgnored) ctx.globalAlpha = 0.3; 
            
            ctx.fillStyle = item.color;
            ctx.beginPath();
            if (ctx.roundRect)
              ctx.roundRect(
                x - barW / 2,
                yBase - actualBarH,
                barW,
                actualBarH,
                item.pto === 0 ? [4, 4, 0, 0] : [0, 0, 0, 0],
              );
            else ctx.rect(x - barW / 2, yBase - actualBarH, barW, actualBarH);
            ctx.fill();
            ctx.restore();
          }

          if (item.pto > 0) {
            ctx.fillStyle = "#8B5CF6";
            ctx.beginPath();
            if (ctx.roundRect)
              ctx.roundRect(
                x - barW / 2,
                yBase - actualBarH - ptoBarH,
                barW,
                ptoBarH,
                [4, 4, 0, 0],
              );
            else
              ctx.rect(x - barW / 2, yBase - actualBarH - ptoBarH, barW, ptoBarH);
            ctx.fill();
          }

          const totalVal = item.val + item.pto;
          if (totalVal > 0) {
            ctx.fillStyle = item.isIgnored ? "rgba(255,255,255,0.4)" : "rgba(255,255,255,0.9)";
            ctx.font = "bold 10px sans-serif";
            ctx.textBaseline = "bottom";
            ctx.fillText(totalVal.toFixed(1), x, yBase - actualBarH - ptoBarH - 4);
          }

          ctx.fillStyle = "#94A3B8";
          ctx.font = "11px sans-serif";
          ctx.textBaseline = "middle";
          ctx.textAlign = "right";
          ctx.save();
          ctx.translate(x, padTop + chartH + 16);
          ctx.rotate(-Math.PI / 4);
          ctx.fillText(labels[i], 0, 0);
          ctx.restore();
        });

        let tooltip = document.getElementById("ikg-chart-tooltip");
        if (!tooltip) {
          tooltip = document.createElement("div");
          tooltip.id = "ikg-chart-tooltip";
          tooltip.style.cssText =
            "position:absolute; background:var(--bg-elevated); color:var(--text-main); padding:10px 14px; border-radius:8px; font-size:12px; font-weight:500; border:1px solid var(--border); box-shadow:0 12px 28px rgba(0,0,0,0.6); pointer-events:none; opacity:0; transition:opacity 0.1s; z-index:100; white-space:nowrap; line-height:1.5; font-family:var(--font-family);";
          parent.appendChild(tooltip);
        }

        if (chartHoverHandler)
          canvas.removeEventListener("mousemove", chartHoverHandler);
        if (window.chartLeaveHandler)
          canvas.removeEventListener("mouseleave", window.chartLeaveHandler);

        chartHoverHandler = (e) => {
          const r = canvas.getBoundingClientRect();
          const mouseX = e.clientX - r.left;
          const chartX = mouseX - padLeft;
          if (chartX < 0 || chartX > chartW) {
            tooltip.style.opacity = 0;
            return;
          }

          const index = Math.floor(chartX / spacing);
          if (index >= 0 && index < dataItems.length) {
            const item = dataItems[index];
            const cleanPtoLabel = item.ptoType ? item.ptoType.split(" - ")[0] : "PTO";

            let text = `<div style="color:var(--text-muted); font-size:11px; margin-bottom:8px; font-weight:700; letter-spacing:0.05em; text-transform:uppercase;">${labels[index]}</div>`;

            if (item.isIgnored) {
              text += `<div style="color:var(--warn); font-size:9px; font-weight:700; margin-bottom:8px; background:rgba(245,158,11,0.15); border:1px solid rgba(245,158,11,0.3); padding:2px 6px; border-radius:4px; width:fit-content;">⚠️ IGNORED PUNCH</div>`;
            }

            const totalHrs = item.val + item.pto;
            const totalColor = item.isIgnored ? "var(--text-muted)" : (totalHrs >= 9.0 ? "var(--success)" : "var(--danger)");

            text += `<div style="display: grid; grid-template-columns: 20px 1fr; gap: 4px 8px; align-items: center; font-size: 13px;">`;

            if (item.val > 0) {
              text += `
                <div style="text-align:center; font-size:14px;" title="Worked">⏱️</div>
                <div style="color:${item.isIgnored ? 'var(--text-muted)' : 'var(--text-main)'};"><b>${item.val.toFixed(2)}h</b></div>
              `;
            }
            if (item.pto > 0 && !item.isFullPTO) {
              text += `
                <div style="text-align:center; font-size:14px;" title="PTO">🏝️</div>
                <div style="color:var(--pto);"><b>${item.pto.toFixed(2)}h</b> <span style="font-size:10px; opacity:0.75;">(${cleanPtoLabel})</span></div>
              `;
            }

            if (totalHrs > 0) {
              text += `<div style="grid-column: 1 / -1; margin: 4px 0; border-top: 1px dashed var(--border);"></div>`;
              text += `
                <div style="text-align:center; font-size:14px;" title="Total">📊</div>
                <div style="color:${totalColor}; font-weight:700;">${totalHrs.toFixed(2)}h</div>
              `;
            } else if (item.isFullPTO) {
              text += `<div style="grid-column: 1 / -1; color:var(--pto); font-weight:700; margin-top:4px;">🏝️ Full Day PTO</div>`;
            }

            // 🎯 Add WFH Flag to Chart Tooltip
            if (item.isWFH && !item.isIgnored) {
              text += `<div style="grid-column: 1 / -1; color:var(--primary); font-weight:700; margin-top:4px; font-size:11px;">🏠 Work From Home</div>`;
            }

            text += `</div>`;

            if (item.isSpoofed) {
              text += `<div style="color:var(--warn); font-size:10px; margin-top:8px; font-weight:600;">⚠️ Manual Override Active</div>`;
            }

            tooltip.innerHTML = text;
            tooltip.style.left = `${mouseX + 20}px`;
            tooltip.style.top = `${e.clientY - r.top - 40}px`;
            tooltip.style.opacity = 1;
          } else {
            tooltip.style.opacity = 0;
          }
        };

        window.chartLeaveHandler = () => {
          tooltip.style.opacity = 0;
        };
        canvas.addEventListener("mousemove", chartHoverHandler);
        canvas.addEventListener("mouseleave", window.chartLeaveHandler);
      };

      GM_addStyle(`
            :root {
                --bg-base: #0B0D12; --bg-surface: #14171F; --bg-elevated: #1F232E;
                --primary: #3B82F6; --primary-hover: #60A5FA; --primary-glow: rgba(59, 130, 246, 0.15);
                --text-main: #F8FAFC; --text-muted: #94A3B8; --border: #2A2E39;
                --success: #10B981; --success-bg: rgba(16, 185, 129, 0.1);
                --danger: #EF4444; --danger-bg: rgba(239, 68, 68, 0.1);
                --warn: #F59E0B; --warn-bg: rgba(245, 158, 11, 0.1);
                --pto: #8B5CF6; --pto-bg: rgba(139, 92, 246, 0.1);
                --font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            }
            #ikg-fab { position: fixed; bottom: 32px; right: 32px; background: var(--primary); color: #fff; padding: 14px 28px; border-radius: 50px; font-family: var(--font-family); font-weight: 600; font-size: 15px; cursor: pointer; box-shadow: 0 8px 24px var(--primary-glow); z-index: 9998; transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1); user-select: none; border: none; }
            #ikg-fab:hover { background: var(--primary-hover); transform: translateY(-3px); box-shadow: 0 12px 28px rgba(59, 130, 246, 0.3); }
            #ikg-modal-backdrop { position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(0,0,0,0.75); backdrop-filter: blur(8px); z-index: 9999; display: none; align-items: center; justify-content: center; opacity: 0; transition: opacity 0.3s ease; font-family: var(--font-family); }
            #ikg-modal-backdrop.open { display: flex; opacity: 1; }
            #ikg-modal { width: 1300px; max-width: 95vw; height: 850px; max-height: 90vh; background: var(--bg-base); border-radius: 20px; border: 1px solid var(--border); box-shadow: 0 32px 64px rgba(0,0,0,0.8); display: flex; flex-direction: column; overflow: hidden; color: var(--text-main); transform: scale(0.97); transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1); position: relative; }
            #ikg-modal-backdrop.open #ikg-modal { transform: scale(1); }
            #ikg-modal-header { padding: 0 32px; height: 72px; border-bottom: 1px solid var(--border); display: flex; justify-content: space-between; align-items: center; background: var(--bg-surface); }
            .ikg-title-area { 
              display: flex; 
              align-items: center; 
              gap: 8px; 
              font-size: 18px; 
              font-weight: 700; 
              letter-spacing: -0.02em; 
              white-space: nowrap; 
          }
            .ikg-tab-group { display: flex; gap: 8px; height: 100%; align-items: center; margin-left: 40px; }
            .ikg-tab { height: 100%; display: flex; align-items: center; padding: 0 20px; cursor: pointer; font-weight: 600; color: var(--text-muted); border-bottom: 3px solid transparent; transition: 0.2s; user-select: none; }
            .ikg-tab:hover { color: var(--text-main); }
            .ikg-tab.active { color: var(--primary); border-bottom-color: var(--primary); }
            .ikg-header-actions { margin-left: auto; display: flex; align-items: center; gap: 16px; }
            .ikg-header-status { font-size: 11px; font-weight: 600; padding: 6px 12px; border-radius: 20px; background: var(--bg-elevated); border: 1px solid var(--border); color: var(--text-muted); transition: 0.3s; user-select: none; display: flex; align-items: center; gap: 6px; }
            #ikg-close { cursor: pointer; font-size: 28px; color: var(--text-muted); line-height: 1; transition: color 0.2s; }
            #ikg-close:hover { color: var(--text-main); }
            #ikg-modal-body { display: flex; flex: 1; overflow: hidden; position: relative; }

            .ikg-view { display: none; width: 100%; height: 100%; flex: 1; }
            .ikg-view.active { display: flex; }
            #view-settings.active { justify-content: center; }

            #ikg-calendar-pane { flex: 2.5; border-right: 1px solid var(--border); display: flex; flex-direction: column; background: var(--bg-base); height: 100%; position: relative;}
            .ikg-cal-header { display: flex; justify-content: space-between; align-items: center; padding: 20px 32px; font-size: 22px; font-weight: 600; letter-spacing: -0.02em;}
            .ikg-cal-nav { background: var(--bg-elevated); border: 1px solid var(--border); color: var(--text-main); width: 36px; height: 36px; border-radius: 8px; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: 0.2s; }
            .ikg-cal-nav:hover { background: var(--border); }
            .ikg-cal-nav.hidden { visibility: hidden; pointer-events: none; }
            .ikg-grid-header { display: grid; grid-template-columns: repeat(7, 1fr); text-align: right; font-size: 12px; color: var(--text-muted); text-transform: uppercase; padding: 0 16px 12px 16px; font-weight: 600; letter-spacing: 0.05em;}
            .ikg-grid-header div { padding-right: 12px; }
            .ikg-grid { display: grid; grid-template-columns: repeat(7, 1fr); grid-auto-rows: 1fr; gap: 1px; background: var(--border); flex: 1; overflow: hidden; border-top: 1px solid var(--border); }
            .ikg-day { background: var(--bg-surface); padding: 8px 10px; display: flex; flex-direction: column; transition: all 0.2s ease; position: relative; cursor: pointer; }
            .ikg-day.empty { background: var(--bg-base); cursor: default; }
            .ikg-day:hover:not(.empty) { background: var(--bg-elevated); z-index: 2; box-shadow: 0 4px 12px rgba(0,0,0,0.3); }
            .ikg-date-header { display: flex; justify-content: flex-end; align-items: center; margin-bottom: auto; }
            .ikg-date-num { font-size: 14px; font-weight: 600; color: var(--text-muted); }
            .ikg-day.today .ikg-date-num { background: var(--primary); color: #fff; width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; border-radius: 50%; }
            .skeleton { animation: pulse 1.5s infinite; background: linear-gradient(90deg, var(--bg-surface) 0%, var(--bg-elevated) 50%, var(--bg-surface) 100%); background-size: 200% 100%; border-radius: 6px; }
            @keyframes pulse { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
            .skel-hrs { height: 22px; width: 60px; margin-bottom: 8px; }
            .skel-box { height: 40px; width: 100%; }
            .ikg-cell-data { display: flex; flex-direction: column; gap: 4px; margin-top: auto; }
            .ikg-total-hrs { font-size: 16px; font-weight: 700; letter-spacing: -0.03em; min-height: 20px; display:flex; align-items:center; gap:6px; }
            .ikg-total-hrs.good { color: var(--success); }
            .ikg-total-hrs.bad { color: var(--danger); }
            .ikg-total-hrs.pending { color: var(--warn); }
            .ikg-times { display: flex; flex-direction: column; gap: 1px; font-size: 10px; color: var(--text-muted); font-weight: 500; background: rgba(0,0,0,0.2); padding: 5px 6px; border-radius: 6px; overflow: hidden; }
            .ikg-times.pending { border: 1px dashed var(--warn); background: var(--warn-bg); }
            .ikg-times div { display: flex; justify-content: space-between; align-items: center; }
            .ikg-times span { color: var(--text-main); font-family: monospace; font-size: 10.5px; letter-spacing: -0.5px;}
            .pto-pill { background: var(--pto-bg); color: var(--pto); border: 1px solid var(--pto); padding: 4px 8px; border-radius: 6px; font-size: 11px; font-weight: 600; text-align: center; margin-top:auto;}

            .ikg-summary-pane { flex: 1; padding: 24px; overflow-y: auto; background: var(--bg-surface); display: flex; flex-direction: column; gap: 20px; justify-content: flex-start; }
            .ikg-card { background: var(--bg-base); border: 1px solid var(--border); border-radius: 12px; padding: 16px 20px; flex-shrink: 0; }
            .ikg-card-title { font-size: 11px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: 16px; font-weight: 600; }
            .ikg-stat-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; font-size: 13px; font-weight: 500;}
            .ikg-stat-row:last-child { margin-bottom: 0; }
            .ikg-stat-val { font-weight: 600; color: var(--text-main); font-size: 14px;}
            .ikg-stat-val.good { color: var(--success); }
            .ikg-stat-val.bad { color: var(--danger); }
            #ikg-active-shift { background: var(--primary-glow); border: 1px solid var(--primary); border-radius: 12px; padding: 20px; transition: all 0.3s ease; flex-shrink: 0; }
            .ikg-active-header { color: var(--primary); font-weight: 600; margin-bottom: 12px; display: flex; align-items: center; gap: 8px; font-size: 15px;}
            .ikg-btn-outline { background: transparent; border: 1px solid var(--primary); color: var(--primary); padding: 8px 10px; border-radius: 6px; cursor: pointer; font-size: 12px; font-weight: 600; text-decoration: none; text-align: center; display: block; margin-top: 10px; transition: 0.2s;}
            .ikg-btn-outline:hover { background: var(--primary); color: #fff; }

            .ikg-popup-modal { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%) scale(0.95); background: var(--bg-elevated); border: 1px solid var(--border); border-radius: 16px; padding: 24px; box-shadow: 0 24px 48px rgba(0,0,0,0.9); z-index: 100; display: none; opacity: 0; transition: all 0.2s ease; }
            .ikg-popup-modal.open { display: block; opacity: 1; transform: translate(-50%, -50%) scale(1); }
            #ikg-day-modal { width: 320px; }
            .modal-overlay { position: absolute; top:0; left:0; right:0; bottom:0; background: rgba(0,0,0,0.5); backdrop-filter: blur(2px); z-index: 99; display: none; }
            .modal-overlay.open { display: block; }
            .dm-title { font-size: 18px; font-weight: 600; margin-bottom: 16px; color: var(--text-main); display:flex; justify-content:space-between; align-items:center;}
            .dm-toggle { display: flex; align-items: center; justify-content: space-between; background: var(--bg-base); padding: 12px 16px; border-radius: 8px; border: 1px solid var(--border); cursor: pointer; user-select: none; }
            .dm-toggle.active { border-color: var(--pto); background: var(--pto-bg); }
            .dm-btn { width: 100%; background: var(--primary); color: #fff; border: none; padding: 12px; border-radius: 8px; font-weight: 600; margin-top: 16px; cursor: pointer; transition: 0.2s;}
            .dm-btn:hover { background: var(--primary-hover); }

            .shift-actions-grid { display: grid; grid-template-columns: 1fr auto; gap: 8px; margin-top: 12px; }
            .shift-export-row { display: flex; gap: 12px; margin-top: 12px; justify-content: space-between; border-top: 1px dashed var(--border); padding-top: 10px; }
            .export-link { font-size: 11px; color: var(--text-muted); text-decoration: none; display: flex; align-items: center; gap: 4px; transition: 0.2s; font-weight: 600; }
            .export-link:hover { color: var(--text-main); }
            .btn-cancel { background: transparent; color: var(--danger); border: 1px solid var(--danger); padding: 8px 12px; border-radius: 6px; cursor: pointer; font-size: 12px; font-weight: 600; transition: 0.2s; margin-top: 0; }
            .btn-cancel:hover { background: var(--danger-bg); }

            select.ikg-filter-btn {
                appearance: none; -webkit-appearance: none; -moz-appearance: none;
                padding-right: 20px !important;
                background-image: url("data:image/svg+xml;utf8,<svg fill='%2394A3B8' height='18' viewBox='0 0 24 24' width='18' xmlns='http://www.w3.org/2000/svg'><path d='M7 10l5 5 5-5z'/></svg>") !important;
                background-repeat: no-repeat !important;
                background-position: right 2px center !important;
                background-color: transparent;
                outline: none; cursor: pointer; text-align: center;
                font-family: inherit;
            }
            select.ikg-filter-btn.active {
                background-image: url("data:image/svg+xml;utf8,<svg fill='%233B82F6' height='18' viewBox='0 0 24 24' width='18' xmlns='http://www.w3.org/2000/svg'><path d='M7 10l5 5 5-5z'/></svg>") !important;
                background-color: var(--bg-surface);
            }
            select.ikg-filter-btn option { background: var(--bg-elevated); color: var(--text-main); }

            .ikg-cal-group { display: flex; gap: 8px; align-items: center; background: var(--bg-surface); padding: 4px 8px; border-radius: 6px; border: 1px solid var(--border); position: absolute; top: 100%; right: 0; margin-top: 6px; z-index: 50; box-shadow: 0 6px 16px rgba(0,0,0,0.4); justify-content: flex-end; }
            .ikg-cal-input-wrapper { position: relative; display: flex; align-items: center; }
            .ikg-ov-dateinput { padding: 6px 26px 6px 10px; border: 1px solid var(--border); background: var(--bg-base); color: var(--text-main); font-size: 12px; outline: none; width: 110px; cursor: pointer; text-align: center; border-radius: 4px; transition: 0.2s; font-family: var(--font-family); }
            .ikg-ov-dateinput:hover, .ikg-ov-dateinput.active { border-color: var(--primary); }
            .ikg-cal-clear-btn { position: absolute; right: 4px; top: 50%; transform: translateY(-50%); background: none; border: none; font-size: 14px; color: var(--text-muted); cursor: pointer; padding: 2px; border-radius: 50%; display: none; line-height: 1;}
            .ikg-cal-clear-btn:hover { color: var(--danger); }
            .ikg-cal-popup { display: none; position: absolute; top: 115%; right: 0; background: var(--bg-elevated); color: var(--text-main); border-radius: 8px; padding: 20px; border: 1px solid var(--border); box-shadow: 0 10px 30px rgba(0,0,0,0.8); z-index: 1000000; flex-direction: row; gap: 30px; user-select: none;}
            .ikg-cal-popup.active { display: flex; }
            .ikg-cal-month { width: 230px; }
            .ikg-cal-header-popup { display: flex; justify-content: space-between; align-items: center; font-size: 14px; font-weight: bold; margin-bottom: 16px; padding: 0 4px; }
            .ikg-cal-month-title { flex-grow: 1; text-align: center; letter-spacing: 0.5px; color: var(--text-main); }
            .ikg-cal-btn { background: var(--bg-surface); border: 1px solid var(--border); color: var(--text-muted); font-size: 12px; cursor: pointer; width: 24px; height: 24px; border-radius: 6px; transition: 0.2s; display: flex; align-items: center; justify-content: center; padding: 0; }
            .ikg-cal-btn:hover { color: #fff; background: var(--primary); border-color: var(--primary); }
            .ikg-cal-btn-placeholder { width: 24px; }
            .ikg-cal-weekdays { display: grid; grid-template-columns: repeat(7, 1fr); text-align: center; color: var(--primary); font-size: 11px; margin-bottom: 8px; font-weight: 600; }
            .ikg-cal-days { display: grid; grid-template-columns: repeat(7, 1fr); gap: 2px 0; }
            .ikg-cal-day-cell { padding: 8px 0; text-align: center; cursor: pointer; font-size: 12px; color: var(--text-main); font-weight: 500; border-radius: 4px; }
            .ikg-cal-day-cell.disabled { opacity: 0.2; cursor: not-allowed; }
            .ikg-cal-day-cell:not(.empty):not(.disabled):hover { background: var(--border); }
            .ikg-cal-day-cell.in-range { background: var(--primary-glow); }
            .ikg-cal-day-cell.start-date, .ikg-cal-day-cell.end-date { background: var(--primary); color: #fff; }

            #view-settings { padding: 32px 48px; overflow-y: auto; background: var(--bg-surface); }
            .set-container { width: 100%; max-width: 900px; display: grid; grid-template-columns: 1fr 1fr; gap: 24px; align-items: start; }
            .set-header-wrap { grid-column: 1 / -1; margin-bottom: 0; }
            .set-header { font-size: 24px; font-weight: 700; color: var(--text-main); margin-bottom: 8px; letter-spacing: -0.02em; }
            .set-group { display: flex; flex-direction: column; gap: 12px; margin-bottom: 20px; }
            .set-group:last-child { margin-bottom: 0; }
            .set-label { font-size: 12px; color: var(--text-muted); font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; }
            .set-row { display: flex; gap: 12px; align-items: center; }
            .set-input { width: 100%; background: var(--bg-base); color: var(--text-main); border: 1px solid var(--border); border-radius: 8px; padding: 10px; font-family: var(--font-family); font-size: 14px; outline: none; }
            .set-input:focus { border-color: var(--primary); }
            .set-select { flex: 1; background: var(--bg-base); color: var(--text-main); border: 1px solid var(--border); border-radius: 8px; padding: 10px; font-family: var(--font-family); font-size: 14px; outline: none; cursor:pointer; }
            .set-select:focus { border-color: var(--primary); }
            .file-upload-wrapper { display: none; margin-top: 8px; border: 1px dashed var(--border); border-radius: 8px; padding: 16px; text-align: center; background: var(--bg-base); transition: 0.2s; }
            .file-upload-wrapper.visible { display: block; }
            .file-upload-label { cursor: pointer; color: var(--primary); font-weight: 600; font-size: 13px; display: inline-block; padding: 6px 16px; background: var(--primary-glow); border-radius: 6px; transition: 0.2s;}
            .file-upload-label:hover { background: rgba(59, 130, 246, 0.25); }
            .file-name { font-size: 11px; color: var(--text-muted); margin-top: 10px; word-break: break-all; }
            .checkbox-label { display: flex; align-items: center; gap: 8px; font-size: 14px; color: var(--text-main); cursor: pointer; }
            .ikg-sync-btn { width: 100%; background: var(--primary); color: #fff; border: none; padding: 12px; border-radius: 10px; font-weight: 600; font-size: 14px; cursor: pointer; text-align: center; transition: 0.2s; box-shadow: 0 4px 12px var(--primary-glow); }
            .ikg-sync-btn:hover:not(:disabled) { background: var(--primary-hover); transform: translateY(-1px); }
            .ikg-sync-btn:disabled { background: var(--bg-elevated); color: var(--text-muted); cursor: not-allowed; box-shadow: none; border: 1px solid var(--border); }

            #ikg-ringing-overlay { position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(0,0,0,0.85); backdrop-filter: blur(10px); z-index: 99999; display: none; align-items: center; justify-content: center; opacity: 0; transition: opacity 0.3s; font-family: var(--font-family); }
            #ikg-ringing-overlay.active { display: flex; opacity: 1; }
            .ringing-box { background: var(--bg-surface); border: 1px solid var(--border); border-radius: 24px; padding: 40px; width: 400px; max-width: 90vw; text-align: center; box-shadow: 0 0 100px rgba(59, 130, 246, 0.2); animation: ringPulse 2s infinite; }
            @keyframes ringPulse { 0% { box-shadow: 0 0 40px rgba(59, 130, 246, 0.2); transform: scale(1); } 50% { box-shadow: 0 0 80px rgba(59, 130, 246, 0.5); transform: scale(1.02); } 100% { box-shadow: 0 0 40px rgba(59, 130, 246, 0.2); transform: scale(1); } }
            .ringing-icon { font-size: 64px; margin-bottom: 16px; animation: shake 0.5s infinite; display: inline-block; }
            @keyframes shake { 0% { transform: rotate(0deg); } 25% { transform: rotate(15deg); } 50% { transform: rotate(0deg); } 75% { transform: rotate(-15deg); } 100% { transform: rotate(0deg); } }
            .ringing-title { font-size: 28px; font-weight: 700; color: var(--text-main); margin-bottom: 8px; }
            .ringing-subtitle { font-size: 15px; color: var(--text-muted); margin-bottom: 32px; }
            .ringing-actions { display: flex; flex-direction: column; gap: 12px; }
            .ring-btn { width: 100%; padding: 16px; border-radius: 12px; font-size: 16px; font-weight: 700; cursor: pointer; border: none; transition: 0.2s; }
            .ring-btn.stop { background: var(--danger); color: #fff; box-shadow: 0 8px 24px rgba(239, 68, 68, 0.3); }
            .ring-btn.stop:hover { background: #DC2626; transform: translateY(-2px); box-shadow: 0 12px 28px rgba(239, 68, 68, 0.4); }
            .ring-btn.snooze { background: var(--bg-elevated); color: var(--text-main); border: 1px solid var(--border); }
            .ring-btn.snooze:hover { background: var(--border); }

            #ikg-chart-pane { flex: 2.5; border-right: 1px solid var(--border); background: var(--bg-base); padding: 32px; display: flex; flex-direction: column; overflow: hidden; position: relative; }
            .ikg-chart-header-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; }
            .ikg-chart-title { font-size: 20px; font-weight: 600; letter-spacing: -0.02em; color: var(--text-main); }
            .ikg-filter-group { display: flex; background: var(--bg-elevated); border-radius: 8px; padding: 4px; border: 1px solid var(--border); }
            .ikg-filter-btn { background: transparent; color: var(--text-muted); border: none; padding: 6px 16px; border-radius: 6px; font-size: 12px; font-weight: 600; cursor: pointer; transition: 0.2s; }
            .ikg-filter-btn:hover:not(.active) { color: var(--text-main); }
            .ikg-filter-btn.active { background: var(--bg-surface); color: var(--primary); box-shadow: 0 2px 8px rgba(0,0,0,0.2); }
            .ikg-canvas-container { flex: 1; position: relative; width: 100%; height: 100%; min-height: 0; }
            .ikg-canvas-container canvas { width: 100% !important; height: 100% !important; display: block; }

            #ikg-heatmap-wrapper { display: none; height: 100%; width: 100%; flex-direction: column; gap: 4px; overflow-x: hidden; padding-bottom: 8px; align-items: center;}
            #ikg-heatmap-months { position: relative; height: 16px; margin-left: 36px; width: 100%; max-width: 100%; }
            .hm-layout { display: flex; flex: 1; min-height: 0; gap: 8px; width: 100%; max-width: 100%; justify-content: center; }
            .hm-y-axis { display: grid; grid-template-rows: repeat(7, 1fr); gap: 4px; font-size: 10px; color: var(--text-muted); width: 28px; padding-right: 6px; text-align: right; }
            #ikg-heatmap-grid { display: grid; grid-template-rows: repeat(7, 1fr); grid-auto-flow: column; gap: 4px; flex: 1; align-content: stretch; width: 100%; justify-content: center; }

            .ikg-heat-sq {
                position: relative;
                border-radius: 4px; width: 100%; height: 100%; min-width: 0; min-height: 0;
                cursor: pointer; transition: transform 0.1s; display: flex; align-items: center; justify-content: center;
                font-size: clamp(8px, 1.2vw, 12px); font-weight: 700; color: rgba(255,255,255,0.95); user-select: none;
                overflow: hidden;
            }
            #ikg-heatmap-wrapper::-webkit-scrollbar { height: 6px; }
            #ikg-heatmap-wrapper::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; }

            .ikg-heat-sq {
                position: relative;
                border-radius: 4px; width: 100%; height: 100%; min-width: 32px; min-height: 32px;
                cursor: pointer; transition: transform 0.1s; display: flex; align-items: center; justify-content: center;
                font-size: 12px; font-weight: 700; color: rgba(255,255,255,0.95); user-select: none;
            }
            .heat-date { position: absolute; top: 3px; left: 4px; font-size: 8px; color: rgba(255,255,255,0.6); font-weight: 600; pointer-events: none; transition: opacity 0.2s;}
            @media (max-width: 1100px) {
                .ikg-heat-sq { font-size: 10px; min-width: 24px; min-height: 24px; }
                .heat-date { opacity: 0; }
                .ikg-heat-sq:hover .heat-date { opacity: 1; }
            }
            #view-audit { padding: 32px 48px; overflow-y: auto; background: var(--bg-surface); flex-direction: column;}
            .audit-table { width: 100%; border-collapse: collapse; margin-bottom: 32px; font-size: 13px; }
            .audit-table th { text-align: left; padding: 12px; border-bottom: 1px solid var(--border); color: var(--text-muted); font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; font-size: 11px;}
            .audit-table td { padding: 12px; border-bottom: 1px solid var(--border); color: var(--text-main); font-family: monospace; font-size: 12px; }
            .audit-table tr:hover { background: var(--bg-elevated); }

            /* 🎯 TOOLTIP BASE & BOUNDARY BREAKOUT FIX */
          .ikg-day { overflow: visible !important; }
          
          .ikg-fast-tt { position: relative; cursor: help; border-bottom: 1px dotted rgba(148, 163, 184, 0.5); display: inline-block; }
          .ikg-fast-tt.no-dot { border-bottom: none; }
          .ikg-fast-tt::after { 
              content: attr(data-title); 
              position: absolute; 
              bottom: 125%; 
              left: 50%; 
              transform: translateX(-50%) translateY(4px); 
              width: max-content; 
              max-width: 260px; 
              background: var(--bg-elevated); 
              color: var(--text-main); 
              font-family: var(--font-family); 
              font-size: 11px; 
              font-weight: 500; 
              padding: 6px 10px; 
              border-radius: 6px; 
              border: 1px solid var(--border); 
              box-shadow: 0 12px 28px rgba(0,0,0,0.95); 
              opacity: 0; 
              visibility: hidden; 
              transition: opacity 0.05s linear 0s, transform 0.05s linear 0s;
              will-change: opacity, transform;
              z-index: 100001; 
              pointer-events: none; 
              white-space: normal; 
              line-height: 1.4; 
              text-align: center; 
              margin-bottom: 6px; 
          }
          .ikg-fast-tt:hover::after { 
              opacity: 1; 
              visibility: visible; 
              transform: translateX(-50%) translateY(0); 
          }

          /* 🎯 TOP ROW FIX: Offset tooltips horizontally right to prevent blocking IN/OUT times */
          .ikg-grid > .ikg-day:nth-child(-n+7) .ikg-fast-tt::after {
              bottom: auto;
              top: -4px;
              left: 100%;
              margin-bottom: 0;
              margin-left: 8px;
              transform: translateX(-4px) translateY(0);
          }
          .ikg-grid > .ikg-day:nth-child(-n+7) .ikg-fast-tt:hover::after {
              transform: translateX(0) translateY(0);
          }

          /* 🎯 TOP RIGHT CORNER FIX (Fri/Sat): Offset left to prevent clipping off screen */
          .ikg-grid > .ikg-day:nth-child(6) .ikg-fast-tt::after,
          .ikg-grid > .ikg-day:nth-child(7) .ikg-fast-tt::after {
              left: auto;
              right: 100%;
              margin-left: 0;
              margin-right: 8px;
              transform: translateX(4px) translateY(0);
          }
          .ikg-grid > .ikg-day:nth-child(6) .ikg-fast-tt:hover::after,
          .ikg-grid > .ikg-day:nth-child(7) .ikg-fast-tt:hover::after {
              transform: translateX(0) translateY(0);
          }

          /* Left & Right Edge Alignments */
          .ikg-fast-tt.tt-right::after { left: auto; right: 0; transform: translateX(0) translateY(4px); }
          .ikg-fast-tt.tt-right:hover::after { transform: translateX(0) translateY(0); }

            span[title] { border-bottom: 1px dotted rgba(148, 163, 184, 0.5); cursor: help; }

            /* 🎯 NEW DATA GLOW ANIMATIONS */
        @keyframes ikgGlowPulse {
            0% { box-shadow: inset 0 0 0px var(--primary), 0 0 0px var(--primary); border-color: var(--primary); }
            50% { box-shadow: inset 0 0 15px var(--primary), 0 0 20px var(--primary); border-color: var(--primary-hover); }
            100% { box-shadow: inset 0 0 0px var(--primary), 0 0 0px var(--primary); border-color: var(--border); }
        }
        .ikg-day.wfh-updated {
            animation: ikgGlowPulse 2.5s ease-in-out infinite;
            border: 1px solid var(--primary) !important;
            z-index: 5;
        }
        .ikg-day.wfh-updated::before {
            content: '✨ UPDATED';
            position: absolute;
            top: 4px;
            left: 6px;
            font-size: 8px;
            font-weight: 800;
            color: var(--primary);
            letter-spacing: 0.5px;
            pointer-events: none;
        }
        `);

      // --- ACTIVE SHIFT UI RENDERER ---
      const updateActiveShiftUI = () => {
        let localCache = JSON.parse(localStorage.getItem(CACHE_KEY) || "{}");
        let dayNotes = JSON.parse(localStorage.getItem(DAY_NOTES_KEY) || "{}");
        const appSettings = getSettings();
        const overrides = JSON.parse(localStorage.getItem(OVERRIDES_KEY) || "{}");

        const todayReal = new Date();
        const todayStr = toYMD(todayReal);
        const isDismissed =
          localStorage.getItem(`IKG_ALARM_DISMISSED_${todayStr}`) === "true";

        let realMonthBalance = 0;
        let lockedShift = null;
        const prefixRealMonth = `${todayReal.getFullYear()}-${String(todayReal.getMonth() + 1).padStart(2, "0")}`;

        const shiftCounts = {
          "09:00 ~ 18:00": 0,
          "09:30 ~ 18:30": 0,
          "10:00 ~ 19:00": 0,
          "13:00 ~ 22:00": 0,
        };

        const snapshot = IKG_DataStore.buildSnapshot();

        for (let i = 1; i <= 31; i++) {
          const dStr = `${prefixRealMonth}-${String(i).padStart(2, "0")}`;
          if (!dStr || dStr > todayStr) continue;

          const evalDay = evaluateDay(IKG_DataStore.getDayContext(dStr, snapshot));
          const record = snapshot.cache[dStr];

          if (i < todayReal.getDate() && evalDay.isWorkingDay) {
            realMonthBalance = safeFloat(realMonthBalance + evalDay.flexHrs);
          }

          if (!evalDay.isFullPTO && record && record.startTime) {
            const startD = new Date(record.startTime);
            const h = startD.getHours();
            const m = startD.getMinutes();
            if (h < 9 || (h === 9 && m < 30)) shiftCounts["09:00 ~ 18:00"]++;
            else if (h === 9 && m >= 30) shiftCounts["09:30 ~ 18:30"]++;
            else if (h >= 10 && h < 13) shiftCounts["10:00 ~ 19:00"]++;
            else if (h >= 13) shiftCounts["13:00 ~ 22:00"]++;
          }
        }

        if (appSettings.manualShift && appSettings.manualShift !== "auto") {
          lockedShift = appSettings.manualShift;
        } else {
          let maxCount = 0;
          for (const [shift, count] of Object.entries(shiftCounts)) {
            if (count > maxCount) {
              maxCount = count;
              lockedShift = shift;
            }
          }
        }

        if (!lockedShift) lockedShift = "Undetermined";
        let lockedShiftDisplay = lockedShift;
        let lockedShiftTitle =
          "Determined by your most frequent check-in this month. See Rules tab.";

        if (appSettings.manualShift && appSettings.manualShift !== "auto") {
          lockedShiftDisplay = `${lockedShift} (Manual)`;
          lockedShiftTitle = "Manually overridden in Settings. HR Approved.";
        }

        let useFlexTodayRaw = localStorage.getItem(`IKG_TODAY_FLEX_${todayStr}`);
        if (useFlexTodayRaw === null)
          useFlexTodayRaw = appSettings.useFlexDef ? "true" : "false";
        const applyFlex = useFlexTodayRaw === "true";
        const flexStr = formatDurFromDec(realMonthBalance, true);

        let shiftEndHour = 18;
        let shiftEndMin = 0;
        if (lockedShift && lockedShift.includes("~")) {
          const outStr = lockedShift.split("~")[1].trim();
          const parts = outStr.split(":");
          shiftEndHour = parseInt(parts[0], 10);
          shiftEndMin = parseInt(parts[1], 10);
        }
        let baseShiftEndD = new Date(todayReal);
        baseShiftEndD.setHours(shiftEndHour, shiftEndMin, 0, 0);
        const baseShiftEndMs = baseShiftEndD.getTime();

        const todaysEval = evaluateDay(IKG_DataStore.getDayContext(todayStr, snapshot));
        
        let todaysFlexGoal = safeFloat(9.0 - todaysEval.ptoHrs);
        let appliedFlexToday = 0;

        let container = document.getElementById("ikg-active-shift-container");
        if (!container) return;

        if (todaysEval.effStart && !todaysEval.isIgnored) {
          const startMs = todaysEval.effStart;
          const minCheckoutMs = baseShiftEndMs - todaysEval.ptoHrs * 3600000;

          if (applyFlex && realMonthBalance > 0) {
            const requiredMs = todaysFlexGoal * 3600000;
            const expectedOutMs = startMs + requiredMs;
            const lateMs = expectedOutMs - minCheckoutMs;

            if (lateMs > 0) {
              const lateHrs = lateMs / 3600000;
              const maxBurnable = Math.min(0.5, lateHrs); // Cap at 30 mins
              appliedFlexToday = Math.min(realMonthBalance, maxBurnable);
              todaysFlexGoal = safeFloat(todaysFlexGoal - appliedFlexToday);
            }
          }

          if (todaysFlexGoal < 0) todaysFlexGoal = 0;
          let targetMs = startMs + todaysFlexGoal * 3600 * 1000;

          if (targetMs < minCheckoutMs) {
            targetMs = minCheckoutMs;
            todaysFlexGoal = (targetMs - startMs) / 3600000;
          }

          const isCompleted = todaysEval.actualHrs >= todaysFlexGoal && todaysEval.actualHrs > 0;
          const gcalStart = new Date(targetMs).toISOString().replace(/[-:]|\.\d{3}/g, "");
          const gcalEnd = new Date(targetMs + 15 * 60000).toISOString().replace(/[-:]|\.\d{3}/g, "");

          if (isCompleted) {
            container.innerHTML = `<div id="ikg-active-shift" style="border-color: var(--success); background: var(--success-bg); padding: 16px; border-radius: 12px;"><div class="ikg-active-header" style="color: var(--success); margin-bottom: 4px;">🎉 Shift Completed</div><div style="font-size:12px; color: var(--text-main);">Goal reached! Time to disconnect.</div></div>`;
          } else {
            const alarmTime = formatTime(targetMs);
            let flexBadge = "";
            let applyFlexHtml = "";

            if (realMonthBalance > 0) {
              if (applyFlex) {
                if (appliedFlexToday > 0) {
                  const appliedStr = formatDurFromDec(appliedFlexToday, false);
                  flexBadge = `<span class="ikg-fast-tt" data-title="Burned ${appliedStr} of your ${flexStr} total balance to offset late check-in." style="display:inline-block; white-space:nowrap; background:var(--warn); color:#000; padding:2px 6px; border-radius:4px; font-size:10px; font-weight:700; cursor:help;">-${appliedStr} Flex Applied</span>`;
                  applyFlexHtml = `Apply Flex (-${appliedStr} applied today)`;
                } else {
                  applyFlexHtml = `Apply Flex (No late check-in to offset)`;
                }
              } else {
                applyFlexHtml = `Apply Monthly Flex (${flexStr} available)`;
              }
            } else if (realMonthBalance < 0) {
              flexBadge = `<span class="ikg-fast-tt" data-title="You have a deficit this month. Work past 9.0h to reduce it." style="display:inline-block; white-space:nowrap; background:var(--danger); color:#fff; padding:2px 6px; border-radius:4px; font-size:10px; font-weight:700; cursor:help;">${flexStr} Deficit</span>`;
              applyFlexHtml = `No Flex Available (${flexStr})`;
            } else {
              applyFlexHtml = `Apply Monthly Flex (Balance is 0)`;
            }

            let alarmSection = "";
            if (isDismissed) {
              alarmSection = `<div style="text-align:center; font-size:12px; color:var(--text-muted); font-weight:600; padding:8px 0; background: var(--bg-elevated); border-radius: 6px; border: 1px solid var(--border); margin-bottom: 12px;">✅ Alarm Dismissed for Today</div>`;
            } else {
              alarmSection = `
                            <div id="alarm-ui-container" style="margin-bottom: 12px;">
                                <button id="ikg-btn-alarm" data-endms="${targetMs}" class="ikg-btn-outline" style="margin-top:0; width:100%; padding: 8px; border-radius: 6px; font-size: 12px; font-weight: 600;">🔔 Set Browser Alarm</button>

                                <div id="ikg-alarm-active-view" style="display:none; align-items:center; justify-content:space-between; background:var(--success-bg); border:1px solid rgba(16, 185, 129, 0.3); border-radius:6px; padding:6px 10px;">
                                    <span id="ikg-alarm-status-text" style="font-size:12px; color:var(--success); font-weight:600;">✅ Scheduled!</span>
                                    <button id="ikg-btn-cancel-alarm" style="background:transparent; color:var(--danger); border:1px solid var(--danger); padding:4px 8px; border-radius:4px; cursor:pointer; font-size:11px; font-weight:700; transition:0.2s;">🔕 Cancel</button>
                                </div>
                            </div>
                        `;
            }

            const checkboxDisabled = realMonthBalance <= 0 ? "disabled" : "";
            const checkboxOpacity = realMonthBalance <= 0 ? "0.5" : "1";
            
            const spoofBadge = todaysEval.isSpoofed ? `<span class="ikg-fast-tt" data-title="Using Manual Override time" style="font-size:9px; background:rgba(245,158,11,0.15); border:1px solid rgba(245,158,11,0.3); color:var(--warn); padding:2px 5px; border-radius:4px; margin-left:8px; font-weight:700; vertical-align:middle; cursor:help;">⚠️ OVERRIDE</span>` : '';

            container.innerHTML = `
                        <div id="ikg-active-shift" style="background: var(--bg-base); border: 1px solid var(--border); border-radius: 12px; padding: 16px; box-shadow: 0 4px 12px rgba(0,0,0,0.1);">

                            <div class="ikg-active-header" style="margin-bottom: 12px; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid var(--border); padding-bottom: 10px;">
                                <div style="color: var(--primary); font-weight: 700; display: flex; align-items: center; gap: 8px; font-size: 15px;">
                                    ⏱️ Active Shift Today
                                </div>
                                <div class="ikg-fast-tt tt-right no-dot" data-title="${lockedShiftTitle}" style="background: rgba(139, 92, 246, 0.1); border: 1px solid rgba(139, 92, 246, 0.3); color: #c4b5fd; padding: 4px 8px; border-radius: 6px; font-size: 11px; font-family: monospace; font-weight: 600; display: flex; align-items: center; gap: 4px;">
                                    🔒 ${lockedShiftDisplay}
                                </div>
                            </div>

                            <div style="display: grid; grid-template-columns: auto 1fr; gap: 8px 12px; font-size: 13px; margin-bottom: 12px; color: var(--text-main); align-items: center;">
                                <div style="color: var(--text-muted); font-weight: 500;">In:</div>
                                <div style="display: flex; align-items: center; min-width: 0;"><b style="font-family: monospace; font-size: 15px; letter-spacing: 0.5px;">${formatTime(startMs)}</b>${spoofBadge}</div>

                                <div class="ikg-fast-tt no-dot" data-title="Note: Calendar shows system checkout time (lags 1 day). Trust the Goal Out above." style="color: var(--text-muted); font-weight: 500; display: flex; align-items: center; gap: 6px; width: fit-content; border-bottom: 1px dotted var(--text-muted);">
                                    Goal Out <span style="display:inline-flex; align-items:center; justify-content:center; width:14px; height:14px; background:var(--border); color:var(--text-muted); border-radius:4px; font-size:10px; font-weight:bold; font-family:serif;">i</span>:
                                </div>
                                <div style="display: flex; align-items: center; flex-wrap: wrap; gap: 8px; min-width: 0;">
                                    <b style="font-family: monospace; font-size: 15px; color: var(--primary); letter-spacing: 0.5px;">${alarmTime}</b>
                                    <span style="font-size: 11px; color: var(--text-muted); font-weight: 500;">(${todaysFlexGoal.toFixed(2)}h)</span>
                                    ${flexBadge}
                                </div>
                            </div>

                            <label id="ikg-flex-toggle-wrap" style="display:flex; align-items:center; gap: 8px; margin-bottom: 12px; background: var(--bg-elevated); padding: 8px 10px; border-radius: 6px; cursor:${realMonthBalance <= 0 ? "not-allowed" : "pointer"}; border: 1px solid var(--border); opacity:${checkboxOpacity}; transition: border-color 0.2s;" onmouseover="this.style.borderColor='var(--primary)'" onmouseout="this.style.borderColor='var(--border)'">
                                <input type="checkbox" id="ikg-today-flex" ${applyFlex && realMonthBalance > 0 ? "checked" : ""} ${checkboxDisabled} style="width:14px; height:14px; cursor:${realMonthBalance <= 0 ? "not-allowed" : "pointer"}; accent-color: var(--primary);">
                                <span style="font-size:12px; font-weight: 500; color:var(--text-main); user-select:none;">${applyFlexHtml}</span>
                            </label>

                            ${alarmSection}

                            <div style="display:grid; grid-template-columns: 1fr 1fr; gap:8px; border-top:1px dashed var(--border); padding-top:12px;">
                                <a href="https://calendar.google.com/calendar/render?action=TEMPLATE&text=Clock+Out+⏰&dates=${gcalStart}/${gcalEnd}&details=Time+to+go+home!" target="_blank" class="ikg-btn-outline" style="margin:0; font-size:11px; font-weight: 600; display:flex; align-items:center; justify-content:center; text-align: center; gap:6px; padding: 8px; border-radius: 6px; text-decoration: none; line-height: 1.2; box-sizing: border-box;">🗓️ Open in GCal</a>
                                <a href="#" id="ikg-btn-mac-alarm" data-endms="${targetMs}" class="ikg-btn-outline" style="margin:0; font-size:11px; font-weight: 600; display:flex; align-items:center; justify-content:center; text-align: center; gap:6px; padding: 8px; border-radius: 6px; text-decoration: none; line-height: 1.2; box-sizing: border-box;">🍎 Download Mac OS .ics</a>
                            </div>
                        </div>
                    `;

            const flexToggle = document.getElementById("ikg-today-flex");
            if (flexToggle) {
              flexToggle.addEventListener("change", (e) => {
                localStorage.setItem(
                  `IKG_TODAY_FLEX_${todayStr}`,
                  e.target.checked,
                );
                sessionStorage.removeItem("IKG_ALARM_TARGET");
                updateActiveShiftUI();
              });
            }

            setTimeout(() => {
              const btn = document.getElementById("ikg-btn-alarm");
              if (!btn) return;

              const cachedTarget = sessionStorage.getItem("IKG_ALARM_TARGET");
              if (
                appSettings.autoSetAlarm &&
                window.ikgScheduledTargetMs !== targetMs &&
                cachedTarget !== targetMs.toString()
              ) {
                scheduleAlarms(targetMs, false);
              } else if (
                window.ikgScheduledTargetMs === targetMs ||
                cachedTarget === targetMs.toString()
              ) {
                if (
                  window.ikgAlarmTimeouts.length === 0 &&
                  cachedTarget === targetMs.toString()
                ) {
                  scheduleAlarms(targetMs, true);
                } else {
                  const activeView = document.getElementById(
                    "ikg-alarm-active-view",
                  );
                  const statusText = document.getElementById(
                    "ikg-alarm-status-text",
                  );
                  if (activeView && statusText) {
                    btn.style.display = "none";
                    statusText.innerText = `✅ Scheduled (${formatTime(targetMs)})`;
                    statusText.style.color = "var(--success)";
                    activeView.style.background = "var(--success-bg)";
                    activeView.style.borderColor = "rgba(16, 185, 129, 0.3)";
                    activeView.style.display = "flex";
                  }
                }
              }
            }, 10);
          }
        } else {
          container.innerHTML = "";
        }
      };

      const parseLocalDate = (dateString) => {
        if (!dateString) return null;
        const [y, m, d] = dateString.split("-");
        return new Date(parseInt(y, 10), parseInt(m, 10) - 1, parseInt(d, 10));
      };
      const formatDateForInput = (date) => {
        return date
          ? `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, "0")}/${String(date.getDate()).padStart(2, "0")}`
          : "";
      };

      class IkgDualCal {
        constructor(
          containerId,
          startInputId,
          endInputId,
          startClearId,
          endClearId,
          onRangeChange,
        ) {
          this.container = document.getElementById(containerId);
          this.startInput = document.getElementById(startInputId);
          this.endInput = document.getElementById(endInputId);
          this.startClear = document.getElementById(startClearId);
          this.endClear = document.getElementById(endClearId);
          this.onRangeChange = onRangeChange;

          this.popup = document.createElement("div");
          this.popup.className = "ikg-cal-popup";
          this.container.appendChild(this.popup);

          this.currentMonth = new Date();
          this.rangeStart = null;
          this.rangeEnd = null;
          this.activeTarget = null;

          document.addEventListener("click", (e) => {
            if (
              !e.composedPath().includes(this.popup) &&
              !e.composedPath().includes(this.startInput) &&
              !e.composedPath().includes(this.endInput) &&
              !e.composedPath().includes(this.startClear) &&
              !e.composedPath().includes(this.endClear)
            )
              this.closePopup();
          });

          this.startInput.addEventListener("click", (e) => {
            e.stopPropagation();
            this.openPopup("start");
          });
          this.endInput.addEventListener("click", (e) => {
            e.stopPropagation();
            this.openPopup("end");
          });

          this.startClear.addEventListener("click", (e) => {
            e.stopPropagation();
            this.rangeStart = null;
            this.startInput.value = "";
            this.startClear.style.display = "none";
            this.onRangeChange();
          });
          this.endClear.addEventListener("click", (e) => {
            e.stopPropagation();
            this.rangeEnd = null;
            this.endInput.value = "";
            this.endClear.style.display = "none";
            this.onRangeChange();
          });

          this.popup.addEventListener("click", (e) => {
            e.stopPropagation();
            const minM =
              globalFirstDate !== "--" ? new Date(globalFirstDate) : new Date();
            minM.setDate(1);
            minM.setHours(0, 0, 0, 0);

            const currM = new Date(
              this.currentMonth.getFullYear(),
              this.currentMonth.getMonth(),
              1,
            );

            if (e.target.closest(".prev")) {
              if (currM <= minM) return;
              this.currentMonth.setMonth(this.currentMonth.getMonth() - 1);
              this.render();
            } else if (e.target.closest(".next")) {
              const nextM = new Date(
                this.currentMonth.getFullYear(),
                this.currentMonth.getMonth() + 1,
                1,
              );
              const today = new Date();
              today.setDate(1);
              today.setHours(0, 0, 0, 0);
              if (nextM > today) return;
              this.currentMonth.setMonth(this.currentMonth.getMonth() + 1);
              this.render();
            } else if (
              e.target.closest(".ikg-cal-day-cell:not(.empty):not(.disabled)")
            ) {
              const dayCell = e.target.closest(".ikg-cal-day-cell");
              const selected = parseLocalDate(dayCell.dataset.date);

              if (this.activeTarget === "start") {
                if (this.rangeEnd && selected > this.rangeEnd) return;
                this.rangeStart = selected;
                this.startInput.value = formatDateForInput(selected);
                this.startClear.style.display = "block";
                if (!this.rangeEnd) this.openPopup("end");
                else this.closePopup();
              } else {
                if (this.rangeStart && selected < this.rangeStart) return;
                this.rangeEnd = selected;
                this.endInput.value = formatDateForInput(selected);
                this.endClear.style.display = "block";
                this.closePopup();
              }
              this.onRangeChange();
            }
          });
        }
        openPopup(target) {
          this.activeTarget = target;
          this.startInput.classList.toggle("active", target === "start");
          this.endInput.classList.toggle("active", target === "end");
          this.currentMonth =
            target === "start" && this.rangeStart
              ? new Date(this.rangeStart)
              : target === "end" && this.rangeEnd
                ? new Date(this.rangeEnd)
                : new Date();
          this.render();
          this.popup.classList.add("active");
        }
        closePopup() {
          this.popup.classList.remove("active");
          this.startInput.classList.remove("active");
          this.endInput.classList.remove("active");
        }
        render() {
          const y = this.currentMonth.getFullYear(),
            m = this.currentMonth.getMonth(),
            next = new Date(y, m + 1, 1);
          this.popup.innerHTML = `${this.buildMonth(y, m, true)}${this.buildMonth(next.getFullYear(), next.getMonth(), false)}`;
          this.updateSelectionUI();
        }
        buildMonth(year, month, isLeft) {
          const firstDay = new Date(year, month, 1).getDay(),
            daysInMonth = new Date(year, month + 1, 0).getDate();
          const today = new Date();
          today.setHours(23, 59, 59, 999);
          let daysHtml = "";
          for (let i = 0; i < firstDay; i++)
            daysHtml += `<div class="ikg-cal-day-cell empty"></div>`;
          for (let i = 1; i <= daysInMonth; i++) {
            const c = new Date(year, month, i),
              dStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(i).padStart(2, "0")}`;
            daysHtml += `<div class="ikg-cal-day-cell ${c > today ? "disabled" : ""}" data-date="${dStr}">${i}</div>`;
          }
          const prevBtn = isLeft
            ? '<button class="ikg-cal-btn prev">❮</button>'
            : '<div class="ikg-cal-btn-placeholder"></div>';
          const nextBtn = !isLeft
            ? '<button class="ikg-cal-btn next">❯</button>'
            : '<div class="ikg-cal-btn-placeholder"></div>';
          return `
                <div class="ikg-cal-month">
                    <div class="ikg-cal-header-popup">${prevBtn}<span class="ikg-cal-month-title">${year} / ${String(month + 1).padStart(2, "0")}</span>${nextBtn}</div>
                    <div class="ikg-cal-weekdays"><div>Su</div><div>Mo</div><div>Tu</div><div>We</div><div>Th</div><div>Fr</div><div>Sa</div></div>
                    <div class="ikg-cal-days">${daysHtml}</div>
                </div>`;
        }
        updateSelectionUI() {
          const st = this.rangeStart ? this.rangeStart.getTime() : null,
            et = this.rangeEnd ? this.rangeEnd.getTime() : null;
          this.popup
            .querySelectorAll(".ikg-cal-day-cell:not(.empty)")
            .forEach((el) => {
              const ct = parseLocalDate(el.dataset.date).getTime();
              el.classList.remove("start-date", "end-date", "in-range");
              if (st && ct === st) el.classList.add("start-date");
              if (et && ct === et) el.classList.add("end-date");
              if (st && et && ct > st && ct < et) el.classList.add("in-range");
            });
        }
      }

      let statsCalInstance = null;
      let auditCalInstance = null;

      // --- RENDER CALENDAR ENGINE (WITH 3-DAY GRACE PERIOD & PTO WARNINGS) ---
      async function renderCalendar() {
        try { await ensureHolidaysSecured(currentViewYear); } catch(e) { return; }

        const grid = document.getElementById('ikg-cal-grid');
        const headerText = document.getElementById("ikg-cal-month-text");
        const prevBtn = document.getElementById("ikg-prev-month");
        const nextBtn = document.getElementById("ikg-next-month");

        if (!grid) return;

        const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
        headerText.innerText = `${monthNames[currentViewMonth - 1]} ${currentViewYear}`;

        const todayReal = new Date();
        nextBtn.classList.toggle("hidden", currentViewYear === todayReal.getFullYear() && currentViewMonth === todayReal.getMonth() + 1);
        if (globalFirstDate !== "--") {
          const fd = new Date(globalFirstDate);
          prevBtn.classList.toggle("hidden", currentViewYear === fd.getFullYear() && currentViewMonth === fd.getMonth() + 1);
        }

        const firstDay = new Date(currentViewYear, currentViewMonth - 1, 1).getDay();
        const daysInMonth = new Date(currentViewYear, currentViewMonth, 0).getDate();

        const monthStr = `${currentViewYear}-${String(currentViewMonth).padStart(2, "0")}`;
        const todayStr = `${todayReal.getFullYear()}-${String(todayReal.getMonth() + 1).padStart(2, "0")}-${String(todayReal.getDate()).padStart(2, "0")}`;

        const snapshot = IKG_DataStore.buildSnapshot();

        let monthWorkedDays = 0, monthTotalHours = 0, monthTargetHours = 0, monthFullPTODays = 0, monthPartialPTODays = 0;
        let monthWFHHours = 0, monthOfficeHours = 0, monthPTOHours = 0;
        let monthWFHDays = 0, monthOfficeDays = 0;
        const missingDays = [];

        // 🎯 DYNAMIC MONTH EVALUATION RULES (Grace Period Checks)
        const currentRealMonthStr = `${todayReal.getFullYear()}-${String(todayReal.getMonth() + 1).padStart(2, "0")}`;
        const prevMonthD = new Date(todayReal.getFullYear(), todayReal.getMonth() - 1, 1);
        const prevMonthStr = `${prevMonthD.getFullYear()}-${String(prevMonthD.getMonth() + 1).padStart(2, "0")}`;

        // Calculate working days elapsed in the current real month
        let workingDaysElapsedInCurrentMonth = 0;
        let checkIter = new Date(todayReal.getFullYear(), todayReal.getMonth(), 1);
        const currentHolidays = JSON.parse(localStorage.getItem(`IKG_HOLIDAYS_${todayReal.getFullYear()}`) || "{}");

        while (checkIter <= todayReal) {
          const dStr = toYMD(checkIter);
          const dayOfWeek = checkIter.getDay();
          if (dayOfWeek !== 0 && dayOfWeek !== 6 && !currentHolidays[dStr]) {
            workingDaysElapsedInCurrentMonth++;
          }
          checkIter.setDate(checkIter.getDate() + 1);
        }

        // Determine if the currently viewed month should be evaluated for warnings
        let isTargetForWarning = false;
        if (monthStr === currentRealMonthStr) {
          isTargetForWarning = true; // Current month always evaluates
        } else if (monthStr === prevMonthStr && workingDaysElapsedInCurrentMonth <= 3) {
          isTargetForWarning = true; // Previous month evaluates ONLY if <= 3 working days into current month
        }

        let htmlBuffer = "";
        for (let i = 0; i < firstDay; i++) htmlBuffer += `<div class="ikg-day empty"></div>`;

        for (let i = 1; i <= daysInMonth; i++) {
          const dateStr = `${monthStr}-${String(i).padStart(2, "0")}`;
          const record = snapshot.cache[dateStr];
          const evalDay = evaluateDay(IKG_DataStore.getDayContext(dateStr, snapshot));

          let isToday = dateStr === todayStr;
          let cellContent = "";
          let partialPill = "";

          // 🎯 MISSING-DAY EVALUATION
          if (isTargetForWarning && evalDay.isWorkingDay && !isToday && evalDay.actualHrs === 0 && !evalDay.isFullPTO && evalDay.ptoHrs === 0) {
            missingDays.push(dateStr);
          }

          // 🔑 ACCUMULATE MONTHLY TOTALS (Fixed PTO Ghost Hours in July)
          if (evalDay.isWorkingDay && !isToday && !evalDay.isYesterdayGrace && !evalDay.isIgnored) {
            monthWorkedDays++;

            if (evalDay.isFullPTO) {
              monthFullPTODays++;
              // 🎯 Full PTO days add 0h to Actual Worked Hours & 0h to Target
              // Net Flex balance for a Full PTO day is exactly 0.0h
            } else {
              // Real Worked Days: Add actual worked hours + partial PTO
              monthTotalHours = safeFloat(monthTotalHours + evalDay.effectiveHrs);
              monthTargetHours = safeFloat(monthTargetHours + evalDay.targetHrs);

              if (evalDay.isPartialPTO) monthPartialPTODays++;
              monthPTOHours = safeFloat(monthPTOHours + evalDay.ptoHrs);

              if (evalDay.actualHrs > 0) {
                if (evalDay.isWFH) {
                  monthWFHHours = safeFloat(monthWFHHours + evalDay.actualHrs);
                  monthWFHDays++;
                } else {
                  monthOfficeHours = safeFloat(monthOfficeHours + evalDay.actualHrs);
                  monthOfficeDays++;
                }
              }
            }
          }

          if (isFetchingData && dateStr <= todayStr && record === undefined && !evalDay.isFullPTO) {
              cellContent = `<div class="ikg-cell-data"><div class="skeleton skel-hrs"></div><div class="skeleton skel-box"></div></div>`;
          } else if (evalDay.status === 'holiday') {
              cellContent = `<div class="pto-pill" style="background:rgba(59,130,246,0.1); color:var(--primary); border-color:var(--primary);">🎊 ${evalDay.holidayName}</div>`;
          } else if (evalDay.status === 'weekend-empty') {
              cellContent = ``; 
          } else if (evalDay.status === 'omitted') {
              if (evalDay.ptoType) {
                  cellContent = `<div class="pto-pill" style="background:rgba(245, 158, 11, 0.1); color:var(--warn); border-color:var(--warn);">🌴 ${evalDay.ptoType}</div>`;
              } else {
                  cellContent = `<div style="margin:auto; color:var(--text-muted); font-size:11px; font-weight:600; text-align:center; opacity: 0.5;">No Punches</div>`;
              }
          } else if (evalDay.isFullPTO) {
              cellContent = `<div class="pto-pill">🏝️ ${evalDay.ptoType}</div>`;
          } else if (evalDay.effStart || evalDay.effEnd || evalDay.isSpoofed || evalDay.actualHrs > 0) {
            let pendingIcon = ""; 
            let timesClass = "";

            const inTimeDisplay = evalDay.effStart ? formatTime(evalDay.effStart) : (record?.startTime ? formatTime(record.startTime) : "--:--");
            let outTimeDisplay = evalDay.effEnd ? formatTime(evalDay.effEnd) : (record?.endTime ? formatTime(record.endTime) : "--:--");

            if (evalDay.status === "pending") {
                timesClass = "pending"; 
                pendingIcon = ' <span style="font-size:12px; margin-bottom:2px;" title="Waiting for checkout data...">⌛</span>'; 
                outTimeDisplay = "Pending";
            }

            if (evalDay.isWFH) {
                partialPill += `<div class="ikg-fast-tt no-dot" data-title="Work From Home" style="font-size:9px; background:var(--primary); color:#fff; padding:2px 5px; border-radius:4px; font-weight:700; letter-spacing:0.5px; white-space:nowrap; box-shadow: 0 2px 4px rgba(59,130,246,0.3); cursor:help; margin-right:auto; margin-left: 2px;">🏠 WFH</div>`;
            }

            const shortPtoName = evalDay.ptoType ? evalDay.ptoType.split(" - ")[0] : "PTO";
            
            // 🎯 FIXED: Removed 'overflow: hidden' from outer div so CSS ::after tooltip is not clipped
            if (evalDay.isPartialPTO) {
                const fullPtoTitle = `${evalDay.ptoType} (+${evalDay.ptoHrs}h)`;
                partialPill += `<div class="ikg-fast-tt no-dot" data-title="${fullPtoTitle}" style="font-size:9px; background:var(--pto); color:#fff; padding:2px 5px; border-radius:4px; font-weight:700; letter-spacing:0.5px; white-space:nowrap; box-shadow: 0 2px 4px rgba(139,92,246,0.3); cursor:help; margin-right:auto; margin-left: 2px;"><span style="display:inline-block; max-width:65px; overflow:hidden; text-overflow:ellipsis; vertical-align:bottom;">+${evalDay.ptoHrs}h ${shortPtoName}</span></div>`;
            }

            // 🎯 BADGE SEPARATION & UNIFORM CELL WIDTH ALIGNMENT
            const overrideBadge = (evalDay.isSpoofed && !evalDay.isIgnored)
              ? `<span class="ikg-fast-tt no-dot" data-title="Manual Override Active (Custom Times)" style="font-size:9px; background:rgba(245,158,11,0.2); border:1px solid rgba(245,158,11,0.4); color:var(--warn); padding:1px 4px; border-radius:4px; font-weight:800; white-space:nowrap; flex-shrink:0; cursor:help;">✏️ OVR</span>` 
              : '';

            const ignoredBadge = evalDay.isIgnored 
              ? `<span class="ikg-fast-tt no-dot" data-title="Omitted from System Totals" style="font-size:9px; background:rgba(239,68,68,0.2); border:1px solid rgba(239,68,68,0.4); color:var(--danger); padding:1px 4px; border-radius:4px; font-weight:800; white-space:nowrap; flex-shrink:0; cursor:help;">⚠️ IGNORED</span>` 
              : '';

            let graceBadge = "";
            if (evalDay.status === "yesterday-grace") {
                graceBadge = `<span class="ikg-fast-tt no-dot" data-title="System checkout syncs lag by 1 day. Hour thresholds remain unpenalized until 6:00 PM today." style="font-size:9px; background:rgba(148,163,184,0.15); border:1px solid rgba(148,163,184,0.3); color:var(--text-muted); padding:1px 4px; border-radius:4px; font-weight:700; white-space:nowrap; flex-shrink:0; cursor:help;">⏳ LAG</span>`;
            } else if (evalDay.status === "today-active") {
                graceBadge = `<span class="ikg-fast-tt no-dot" data-title="Shift actively in progress today." style="font-size:9px; background:rgba(245,158,11,0.15); border:1px solid rgba(245,158,11,0.3); color:var(--warn); padding:1px 4px; border-radius:4px; font-weight:700; white-space:nowrap; flex-shrink:0; cursor:help;">⏱️ IN PROGRESS</span>`;
            }

            const flexTooltip = evalDay.flexHrs >= 0 ? `+${formatDurFromDec(evalDay.flexHrs, false)}` : `Short by ${formatDurFromDec(Math.abs(evalDay.flexHrs), false)}`;
            let activeShiftStyles = isToday && evalDay.status !== "pass" && evalDay.status !== "partial-pto-pass" ? "background:var(--primary-glow); border:1px solid var(--border);" : "";

            cellContent = `
                <div class="ikg-cell-data">
                    <div class="ikg-total-hrs" style="color:${evalDay.color}; width:100%; margin-bottom:4px; min-height:22px; display:flex; align-items:center; justify-content:space-between; gap:4px;">
                        <span class="ikg-fast-tt no-dot" data-title="${flexTooltip}">${evalDay.actualHrs > 0 ? evalDay.actualHrs.toFixed(2) + "h" : isToday ? "--.--h" : "0.00h"}</span>
                        <div style="display:flex; align-items:center; gap:3px; flex-wrap:nowrap; overflow:hidden; margin-left:auto;">
                            ${pendingIcon} ${graceBadge} ${overrideBadge} ${ignoredBadge}
                        </div>
                    </div>
                    <div class="ikg-times ${timesClass}" style="margin-top:auto; ${activeShiftStyles}">
                        <div>IN <span>${inTimeDisplay}</span></div>
                        <div>OUT <span>${outTimeDisplay}</span></div>
                    </div>
                </div>`;
        }

        // 🎯 Check if this date was updated during the latest sync cycle
      const isRecentlyUpdated = window.ikgUpdatedDates && window.ikgUpdatedDates.has(dateStr);
      const glowClass = isRecentlyUpdated ? "wfh-updated" : "";

          htmlBuffer += `
          <div class="ikg-day ${isToday ? "today" : ""} ${glowClass}" data-date="${dateStr}">
              <div class="ikg-date-header" style="align-items: center; justify-content: flex-end;">
                  ${partialPill}
                  <div class="ikg-date-num">${i}</div>
              </div>
              ${cellContent}
          </div>`;
        }

        const totalCells = firstDay + daysInMonth;
        for (let i = 0; i < 42 - totalCells; i++) htmlBuffer += `<div class="ikg-day empty"></div>`;

        requestAnimationFrame(() => {
          grid.innerHTML = htmlBuffer;

          const netBalance = safeFloat(monthTotalHours - monthTargetHours);
          let subDays = [];
          if (monthOfficeDays > 0) subDays.push(`🏢 ${monthOfficeDays}`);
          if (monthWFHDays > 0) subDays.push(`🏠 ${monthWFHDays}`);
          let ptoTxt = [];
          if (monthFullPTODays > 0) ptoTxt.push(`${monthFullPTODays} Full`);
          if (monthPartialPTODays > 0) ptoTxt.push(`${monthPartialPTODays} Part`);
          if (ptoTxt.length > 0) subDays.push(`🏝️ ${ptoTxt.join(', ')}`);

          let daysHtml = `<div style="display:flex; flex-direction:column; align-items:flex-end; gap:4px;"><div style="white-space:nowrap;">${monthWorkedDays}</div>`;
          if (subDays.length > 0) {
              daysHtml += `<div style="font-size:10px; color:var(--text-muted); font-weight:500; text-align:right;">${subDays.join(' | ')}</div>`;
          }
          daysHtml += `</div>`;

          const sideDaysEl = document.getElementById("side-val-days");
          if (sideDaysEl) {
            sideDaysEl.innerHTML = daysHtml;
            if (sideDaysEl.parentElement) {
                sideDaysEl.parentElement.style.alignItems = "flex-start";
                sideDaysEl.parentElement.style.gap = "12px";
            }
          }
          
          const sideActualEl = document.getElementById("side-val-actual");
          if (sideActualEl) {
            sideActualEl.innerHTML = `
                <div style="display:flex; flex-direction:column; align-items:flex-end; gap:4px;">
                    <div style="white-space:nowrap;">${formatDurFromDec(monthTotalHours, false)}</div>
                    <div style="font-size:10px; color:var(--text-muted); font-weight:500; text-align:right;">🏢 ${formatDurFromDec(monthOfficeHours, false)} | 🏠 ${formatDurFromDec(monthWFHHours, false)} | 🏝️ ${formatDurFromDec(monthPTOHours, false)}</div>
                </div>`;
            if (sideActualEl.parentElement) {
                sideActualEl.parentElement.style.alignItems = "flex-start";
                sideActualEl.parentElement.style.gap = "12px";
            }
          }

          const targetEl = document.getElementById("side-val-target");
          if (targetEl) targetEl.innerText = formatDurFromDec(monthTargetHours, false);

          const balanceEl = document.getElementById("side-val-net");
          if (balanceEl) {
            let insightEl = document.getElementById("ikg-flex-insight");
            if (!insightEl) { insightEl = document.createElement("div"); insightEl.id = "ikg-flex-insight"; balanceEl.parentNode.insertAdjacentElement("afterend", insightEl); }

            if (netBalance > 0) {
              balanceEl.innerHTML = `<span class="good">${formatDurFromDec(netBalance, true)}</span>`;
              const burnDays = Math.ceil(netBalance / 0.5);
              insightEl.innerHTML = `<div style="font-size:11px; color:var(--warn); background:var(--warn-bg); border:1px solid rgba(245, 158, 11, 0.3); padding:8px 10px; border-radius:6px; margin-top:12px; display:flex; gap:8px; align-items:flex-start; line-height:1.4;"><span style="font-size:14px;">💡</span><span>Flex burns max <b>30m/day</b> to offset late arrivals.<br>Requires <b>~${burnDays} planned late-ins</b> to clear.</span></div>`;
            } else if (netBalance < 0) {
              balanceEl.innerHTML = `<span class="bad">${formatDurFromDec(netBalance, true)}</span>`;
              insightEl.innerHTML = "";
            } else {
              balanceEl.innerHTML = `<span style="color:var(--text-muted)">Perfect</span>`;
              insightEl.innerHTML = "";
            }
          }

          // 🎯 RENDER INTERACTIVE WARNING CARD WITH UN-IGNORE TRAY
          renderMissingDaysWarning(missingDays);

          updateActiveShiftUI();
        });
      }

      // 🎯 INTERACTIVE SIDEBAR WARNING CARD (WITH UN-IGNORE MANAGEMENT)
      const IGNORED_WARNINGS_KEY = `IKG_IGNORED_MISSING_DAYS_${APP_VER}`;

      const renderMissingDaysWarning = (missingDays = []) => {
        let warnContainer = document.getElementById("ikg-missing-days-card");
        let userIgnoredDays = [];
        try { userIgnoredDays = JSON.parse(localStorage.getItem(IGNORED_WARNINGS_KEY) || "[]"); } catch(e){}

        // Filter out user-ignored dates from active warnings
        const activeMissing = missingDays.filter(d => !userIgnoredDays.includes(d));
        const monthIgnored = userIgnoredDays.filter(d => missingDays.includes(d));

        if (activeMissing.length === 0 && monthIgnored.length === 0) {
          if (warnContainer) warnContainer.remove();
          return;
        }

        if (!warnContainer) {
          warnContainer = document.createElement("div");
          warnContainer.id = "ikg-missing-days-card";
          warnContainer.className = "ikg-card";
          warnContainer.style.cssText = "background: rgba(239, 68, 68, 0.08); border: 1px solid var(--danger); margin-top: 16px;";

          const summaryPane = document.querySelector(".ikg-summary-pane");
          if (summaryPane) summaryPane.appendChild(warnContainer);
        }

        // HTML template for active warnings
        const activeBadgesHtml = activeMissing.map(d => `
          <span style="display:inline-flex; align-items:center; gap:4px; background:rgba(239,68,68,0.2); padding:2px 6px; border-radius:4px; font-size:11px;">
              <b style="color:var(--text-main); font-family:monospace;">${d}</b>
              <button class="ikg-ignore-date-btn" data-date="${d}" style="background:none; border:none; color:var(--text-muted); cursor:pointer; font-size:10px; padding:0 2px; line-height:1;" title="Ignore warning for ${d}">✕</button>
          </span>
        `).join(" ");

        // HTML template for un-ignoring dates
        const ignoredBadgesHtml = monthIgnored.map(d => `
          <span style="display:inline-flex; align-items:center; gap:4px; background:var(--bg-elevated); border:1px solid var(--border); padding:2px 6px; border-radius:4px; font-size:11px;">
              <span style="color:var(--text-muted); font-family:monospace;">${d}</span>
              <button class="ikg-unignore-date-btn" data-date="${d}" style="background:none; border:none; color:var(--success); cursor:pointer; font-size:11px; font-weight:bold; padding:0 2px; line-height:1;" title="Restore warning for ${d}">+ Restore</button>
          </span>
        `).join(" ");

        const activeSectionHtml = activeMissing.length > 0 ? `
          <div class="ikg-card-title" style="color: var(--danger); display:flex; align-items:center; gap:6px; margin-bottom:8px;">
              ⚠️ Missing Attendance (${activeMissing.length} Days)
          </div>
          <div style="font-size: 12px; color: var(--text-main); line-height: 1.5; display:flex; flex-direction:column; gap:10px;">
              <div>
                  Working day(s) with <b>no punches, no WFH, and no PTO</b>:
                  <div style="margin-top:6px; display:flex; flex-wrap:wrap; gap:6px;">${activeBadgesHtml}</div>
              </div>
              <div style="border-top:1px dashed rgba(239,68,68,0.3); padding-top:8px;">
                  <b style="color:var(--warn);">Required Action:</b>
                  <ol style="margin:4px 0 0 16px; padding:0; display:flex; flex-direction:column; gap:4px; color:var(--text-muted); font-size:11px;">
                      <li><b>Forgot PTO?</b> Apply on Deel for these date(s).</li>
                      <li><b>Forgot Punchcard?</b> Report to HR with browser history or colleague vouch via Slack.</li>
                  </ol>
              </div>
          </div>
        ` : `<div style="font-size:12px; color:var(--success); font-weight:600;">✅ All active warnings resolved or ignored.</div>`;

        const ignoredSectionHtml = monthIgnored.length > 0 ? `
          <div style="border-top:1px solid var(--border); margin-top:12px; padding-top:8px;">
              <details style="cursor:pointer;">
                  <summary style="font-size:11px; color:var(--text-muted); font-weight:600; user-select:none;">🙈 Ignored Warnings (${monthIgnored.length})</summary>
                  <div style="margin-top:8px; display:flex; flex-wrap:wrap; gap:6px;">${ignoredBadgesHtml}</div>
              </details>
          </div>
        ` : '';

        warnContainer.innerHTML = activeSectionHtml + ignoredSectionHtml;

        // 🎯 EVENT LISTENERS FOR IGNORE / UN-IGNORE BUTTONS
        warnContainer.querySelectorAll(".ikg-ignore-date-btn").forEach(btn => {
          btn.addEventListener("click", (e) => {
            const dateToIgnore = e.target.getAttribute("data-date");
            if (!dateToIgnore) return;

            let list = [];
            try { list = JSON.parse(localStorage.getItem(IGNORED_WARNINGS_KEY) || "[]"); } catch(err){}
            if (!list.includes(dateToIgnore)) list.push(dateToIgnore);
            localStorage.setItem(IGNORED_WARNINGS_KEY, JSON.stringify(list));

            alert(
              `Attendance Pro:\n\n` +
              `Warning for [${dateToIgnore}] has been suppressed.\n\n` +
              `If you want to un-ignore this date later, expand the "🙈 Ignored Warnings" section at the bottom of the warning card and click "Restore".`
            );

            renderCalendar();
          });
        });

        warnContainer.querySelectorAll(".ikg-unignore-date-btn").forEach(btn => {
          btn.addEventListener("click", (e) => {
            const dateToRestore = e.target.getAttribute("data-date");
            if (!dateToRestore) return;

            let list = [];
            try { list = JSON.parse(localStorage.getItem(IGNORED_WARNINGS_KEY) || "[]"); } catch(err){}
            list = list.filter(d => d !== dateToRestore);
            localStorage.setItem(IGNORED_WARNINGS_KEY, JSON.stringify(list));

            renderCalendar();
          });
        });
      };

      function renderSettings() {
        const settings = getSettings();
        const soundSelect = document.getElementById("set-sound");

        if (soundSelect) {
          soundSelect.value = settings.soundType;
          if (soundSelect.selectedIndex === -1) {
            soundSelect.value = "pro_fkj";
            settings.soundType = "pro_fkj";
            localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
          }
        }

        const volSlider = document.getElementById("set-volume");
        if (volSlider) {
          volSlider.value = settings.volume !== undefined ? settings.volume : 0.8;
          document.getElementById("set-volume-val").innerText =
            `${Math.round(volSlider.value * 100)}%`;
        }

        const overrideCheckbox = document.getElementById("set-use-overrides");
        if (overrideCheckbox) {
          overrideCheckbox.checked = settings.useManualOverrides !== false;
        }

        // 🎯 NEW: WFH Toggle State Binding
        const wfhCheckbox = document.getElementById("set-include-wfh");
        if (wfhCheckbox) {
          wfhCheckbox.checked = settings.includeWfhInHours !== false;
        }

        const syncDaysEl = document.getElementById("set-sync-days");
        if (syncDaysEl) syncDaysEl.value = settings.syncDays || 7;

        const manualShiftEl = document.getElementById("set-manual-shift");
        if (manualShiftEl) manualShiftEl.value = settings.manualShift || "auto";

        const uploadWrap = document.getElementById("set-upload-wrap");
        const fileNameEl = document.getElementById("set-file-name");

        if (settings.soundType === "custom") {
          uploadWrap.classList.add("visible");
          if (settings.mp3Name)
            fileNameEl.innerText = `Current Audio: ${settings.mp3Name}`;
        } else {
          uploadWrap.classList.remove("visible");
        }

        document.getElementById("set-use-flex").checked = settings.useFlexDef;
        document.getElementById("set-show-secs").checked = settings.showSeconds;
        document.getElementById("set-auto-alarm").checked = settings.autoSetAlarm;
        document.getElementById("set-snooze").value = settings.snoozeMins;
        document.getElementById("set-snooze-unit").value =
          settings.snoozeUnit || "m";
        document.getElementById("set-trigger-unit").value =
          settings.triggerUnit || "m";
        document.getElementById("set-triggers").value =
          settings.triggers.join(", ");

        document.getElementById("set-img-type").value = settings.alarmImgType;
        document.getElementById("set-pulse-speed").value = settings.pulseSpeed;

        const imgWrap = document.getElementById("set-img-upload-wrap");
        const imgPreview = document.getElementById("set-img-preview");

        if (settings.alarmImgType === "custom") {
          imgWrap.classList.add("visible");
          if (settings.alarmImgName)
            document.getElementById("set-img-name").innerText =
              settings.alarmImgName;
          IKG_DB.get("custom_alarm_img").then((data) => {
            imgPreview.src = data || "https://attendance.iki-utl.cc/favicon.png";
          });
        } else {
          imgWrap.classList.remove("visible");
          imgPreview.src = DEFAULT_GIF_URL;
        }
      }

      // --- DATA AUDIT FIX (8.5h Target Alignment) ---
      async function renderAudit(localCache) {
        const targetY = currentAuditMonth ? parseInt(currentAuditMonth.split('-')[0], 10) : new Date().getFullYear();
        try { await ensureHolidaysSecured(targetY); } catch(e) { return; }
        currentAuditMonth = populateMonthSelect('ikg-audit-month', localCache, currentAuditMonth);

        const dayNotes = JSON.parse(localStorage.getItem(DAY_NOTES_KEY) || "{}");
        const overrides = JSON.parse(localStorage.getItem(OVERRIDES_KEY) || "{}");
        const allDates = [...new Set([
            ...Object.keys(localCache).filter((d) => localCache[d] && localCache[d].workHours),
            ...Object.keys(dayNotes).filter((d) => dayNotes[d] && (dayNotes[d].isPTO || dayNotes[d].isPartialPTO)),
            ...Object.keys(overrides).filter((d) => overrides[d] && (overrides[d].manualIn || overrides[d].manualOut || overrides[d].isIgnored))
        ])].sort().reverse();

        let filteredDates = [];
        const todayObj = new Date(); todayObj.setHours(0, 0, 0, 0);
        const pad = (n) => String(n).padStart(2, "0");
        const todayStr = `${todayObj.getFullYear()}-${pad(todayObj.getMonth() + 1)}-${pad(todayObj.getDate())}`;

        if (currentAuditRange === "7D") {
          let iterDate = new Date(todayObj); let wDaysCount = 1;
          if (iterDate.getDay() === 0 || iterDate.getDay() === 6) wDaysCount = 0;
          while (wDaysCount < 7) { iterDate.setDate(iterDate.getDate() - 1); if (iterDate.getDay() !== 0 && iterDate.getDay() !== 6) wDaysCount++; }
          filteredDates = allDates.filter((d) => new Date(d) >= iterDate);
        } else if (currentAuditRange === "30D") {
          const cutoff = new Date(todayObj.getTime() - 29 * 86400000);
          filteredDates = allDates.filter((d) => new Date(d) >= cutoff);
        } else if (currentAuditRange === "MONTH") { filteredDates = allDates.filter((d) => d.startsWith(currentAuditMonth)); } 
        else if (currentAuditRange === "CUSTOM") {
          const rStart = auditCalInstance ? auditCalInstance.rangeStart : null;
          const rEnd = auditCalInstance ? auditCalInstance.rangeEnd : null;
          filteredDates = allDates.filter((d) => { const cur = parseLocalDate(d); if (rStart && cur < rStart) return false; if (rEnd && cur > rEnd) return false; return true; });
        } else if (currentAuditRange === "ALL") { filteredDates = allDates; }

        // Update Table Header to 8.5h
        const tableHeader = document.querySelector(".audit-table thead tr");
        if (tableHeader) {
          tableHeader.innerHTML = `
            <th>Date</th>
            <th>Clock-In</th>
            <th>Clock-Out</th>
            <th>Total Shift</th>
            <th>Flex (Vs 9h Base)</th>
          `;
        }

        const tbody = document.getElementById("audit-table-body");
        if (!tbody) return; let html = ""; const snapshot = IKG_DataStore.buildSnapshot();

        filteredDates.forEach((dateStr) => {
          const evalDay = evaluateDay(IKG_DataStore.getDayContext(dateStr, snapshot));

          if (evalDay.effStart || evalDay.actualHrs > 0 || evalDay.isIgnored || evalDay.ptoHrs > 0) {
            const isToday = dateStr === todayStr;
            const exactHrs = evalDay.actualHrs;
            
            // Flex calculation using 8.5h base target
            const exactFlexHrs = (isToday || evalDay.isYesterdayGrace || evalDay.isIgnored) ? 0 : evalDay.flexHrs;
            const flexStr = exactFlexHrs === 0 ? "-" : formatDurFromDec(exactFlexHrs, true);

            const startDisplay = evalDay.effStart ? formatTime(evalDay.effStart) : "--:--";
            const endDisplay = evalDay.effEnd ? formatTime(evalDay.effEnd) : "--:--";

            let reasonHtml = evalDay.isPartialPTO ? `<div style="font-size:11px; color:var(--pto); font-weight:600; margin-top:4px;">inc. +${evalDay.ptoHrs}h ${evalDay.ptoType}</div>` : '';
            if (evalDay.isSpoofed) reasonHtml += `<div style="font-size:10px; color:var(--warn); margin-top:4px;">(Manual Override)</div>`;
            if (evalDay.isYesterdayGrace) reasonHtml += `<div style="font-size:10px; color:var(--text-muted); margin-top:4px;">⏳ Lag Grace (Excluded from Net)</div>`;
            if (evalDay.isIgnored) reasonHtml += `<div style="font-size:10px; color:var(--danger); margin-top:4px;">⚠️ Ignored (Excluded from Net)</div>`;
            if (evalDay.isPublicHoliday) reasonHtml += `<div style="font-size:10px; color:var(--primary); margin-top:4px;">🎊 ${evalDay.holidayName}</div>`;
            if (evalDay.isWFH) reasonHtml += `<div style="font-size:10px; color:var(--primary); margin-top:4px;">🏠 Work From Home (GAS)</div>`;

            html += `
                <tr>
                    <td>${dateStr}</td>
                    <td>${startDisplay}</td>
                    <td>${endDisplay}</td>
                    <td>${formatDurFromDec(exactHrs, false)}</td>
                    <td style="color:${evalDay.color}; font-weight:bold; line-height: 1.4;">
                        ${flexStr} ${reasonHtml}
                    </td>
                </tr>`;
          }
        });
        tbody.innerHTML = html;
      }

    // --- ANALYTICS FIX ---
      async function renderAnalytics(localCache) {
        const targetY = currentStatsMonth ? parseInt(currentStatsMonth.split('-')[0], 10) : new Date().getFullYear();
        try { await ensureHolidaysSecured(targetY); } catch(e) { return; }
        currentStatsMonth = populateMonthSelect('ikg-stats-month', localCache, currentStatsMonth);
        
        const dayNotes = JSON.parse(localStorage.getItem(DAY_NOTES_KEY) || "{}");
        const overrides = JSON.parse(localStorage.getItem(OVERRIDES_KEY) || "{}");

        const allDates = [
          ...new Set([
            ...Object.keys(localCache).filter((d) => localCache[d] && localCache[d].workHours),
            ...Object.keys(dayNotes).filter((d) => dayNotes[d] && (dayNotes[d].isPTO || dayNotes[d].isPartialPTO)),
            ...Object.keys(overrides).filter((d) => overrides[d] && (overrides[d].manualIn || overrides[d].manualOut || overrides[d].isIgnored))
          ])
        ].sort();

        let filteredDates = [];
        const todayObj = new Date();
        todayObj.setHours(0, 0, 0, 0);

        const pad = (n) => String(n).padStart(2, "0");
        const todayStr = `${todayObj.getFullYear()}-${pad(todayObj.getMonth() + 1)}-${pad(todayObj.getDate())}`;

        if (currentStatsRange === "7D") {
          let iterDate = new Date(todayObj);
          let wDaysCount = 1;
          if (iterDate.getDay() === 0 || iterDate.getDay() === 6) wDaysCount = 0;
          while (wDaysCount < 7) {
            iterDate.setDate(iterDate.getDate() - 1);
            if (iterDate.getDay() !== 0 && iterDate.getDay() !== 6) wDaysCount++;
          }
          filteredDates = allDates.filter((d) => new Date(d) >= iterDate);
        } else if (currentStatsRange === "30D") {
          const cutoff = new Date(todayObj.getTime() - 29 * 86400000);
          filteredDates = allDates.filter((d) => new Date(d) >= cutoff);
        } else if (currentStatsRange === "MONTH") {
          filteredDates = allDates.filter((d) => d.startsWith(currentStatsMonth));
        } else if (currentStatsRange === "CUSTOM") {
          const rStart = statsCalInstance ? statsCalInstance.rangeStart : null;
          const rEnd = statsCalInstance ? statsCalInstance.rangeEnd : null;
          filteredDates = allDates.filter((d) => {
            const cur = parseLocalDate(d);
            if (rStart && cur < rStart) return false;
            if (rEnd && cur > rEnd) return false;
            return true;
          });
        } else if (currentStatsRange === "ALL") {
          filteredDates = allDates;
        }

        const settings = getSettings();
        let inMsArr = [];
        let outMsArr = [];
        let shiftHrsArr = [];
        
        // 🎯 NEW: Added Day trackers for WFH and Office
        let filterTotalDays = 0, filterTotalHours = 0, filterTargetHours = 0, filterFullPTODays = 0, filterPartialPTODays = 0;
        let filterWFHHours = 0, filterOfficeHours = 0, filterPTOHours = 0;
        let filterWFHDays = 0, filterOfficeDays = 0;

        const snapshot = IKG_DataStore.buildSnapshot();

        filteredDates.forEach((dateStr) => {
          const evalDay = evaluateDay(IKG_DataStore.getDayContext(dateStr, snapshot));
          const hrs = evalDay.actualHrs;
          const isToday = dateStr === todayStr;

          if (evalDay.isWorkingDay && !isToday) {
            filterTotalDays++;
            filterTotalHours = safeFloat(filterTotalHours + evalDay.effectiveHrs);
            filterTargetHours = safeFloat(filterTargetHours + evalDay.targetHrs);
            filterPTOHours = safeFloat(filterPTOHours + evalDay.ptoHrs);
            
            if (evalDay.isFullPTO) {
                filterFullPTODays++;
            } else {
                if (evalDay.isPartialPTO) filterPartialPTODays++;
                
                if (evalDay.actualHrs > 0) {
                    if (evalDay.isWFH) {
                        filterWFHHours = safeFloat(filterWFHHours + evalDay.actualHrs);
                        filterWFHDays++;
                    } else {
                        filterOfficeHours = safeFloat(filterOfficeHours + evalDay.actualHrs);
                        filterOfficeDays++;
                    }
                }
            }
          }

          if (!evalDay.isFullPTO && !evalDay.isIgnored && hrs > 0) {
            if (dateStr !== todayStr || (dateStr === todayStr && hrs >= 9.0)) {
              if (evalDay.effStart && evalDay.effEnd) {
                const start = new Date(evalDay.effStart);
                const end = new Date(evalDay.effEnd);
                inMsArr.push(
                  start.getHours() * 3600000 +
                    start.getMinutes() * 60000 +
                    start.getSeconds() * 1000,
                );
                outMsArr.push(
                  end.getHours() * 3600000 +
                    end.getMinutes() * 60000 +
                    end.getSeconds() * 1000,
                );
              }
              shiftHrsArr.push(hrs);
            }
          }
        });

        const getMean = (arr) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : NaN;
        const getMedian = (arr) => {
          if (!arr.length) return NaN;
          const s = [...arr].sort((a, b) => a - b);
          const mid = Math.floor(s.length / 2);
          return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid];
        };
        const getStdDev = (arr, mean) => {
          if (arr.length <= 1) return 0;
          const variance = arr.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / arr.length;
          return Math.sqrt(variance);
        };
        const getRange = (arr) => arr.length ? Math.max(...arr) - Math.min(...arr) : NaN;
        const getMode = (arr) => {
          if (!arr.length) return NaN;
          const counts = {};
          let maxCount = 0;
          let modeVal = arr[0];
          arr.forEach((v) => {
            const binned = Math.round(v * 10) / 10;
            counts[binned] = (counts[binned] || 0) + 1;
            if (counts[binned] > maxCount) {
              maxCount = counts[binned];
              modeVal = binned;
            }
          });
          return modeVal;
        };

        const meanShift = getMean(shiftHrsArr);

        document.getElementById("habit-val-in-mean").innerText = msToTimeString(getMean(inMsArr));
        document.getElementById("habit-val-in-med").innerText = msToTimeString(getMedian(inMsArr));
        document.getElementById("habit-val-out-mean").innerText = msToTimeString(getMean(outMsArr));
        document.getElementById("habit-val-out-med").innerText = msToTimeString(getMedian(outMsArr));
        document.getElementById("habit-val-hrs-mean").innerText = isNaN(meanShift) ? "--" : formatDurFromDec(meanShift, false);
        document.getElementById("habit-val-hrs-med").innerText = isNaN(getMedian(shiftHrsArr)) ? "--" : formatDurFromDec(getMedian(shiftHrsArr), false);
        document.getElementById("habit-val-hrs-mode").innerText = isNaN(getMode(shiftHrsArr)) ? "--" : `~${getMode(shiftHrsArr).toFixed(1)}h`;
        document.getElementById("habit-val-hrs-std").innerText = isNaN(getStdDev(shiftHrsArr, meanShift)) ? "--" : `±${formatDurFromDec(getStdDev(shiftHrsArr, meanShift), false)}`;
        document.getElementById("habit-val-hrs-range").innerText = isNaN(getRange(shiftHrsArr)) ? "--" : formatDurFromDec(getRange(shiftHrsArr), false);

        filterTargetHours = safeFloat(filterTotalDays * 9.0);

        const titleMap = {
          "7D": "Past 7 Working Days",
          "30D": "Past 30 Days",
          MONTH: `${currentStatsMonth} Totals`,
          CUSTOM: "Custom Range Totals",
          ALL: "Lifetime System Stats",
        };
        const summaryTitle = document.getElementById("stats-summary-title");
        if (summaryTitle) summaryTitle.innerText = titleMap[currentStatsRange] || "System Stats";

        // 🎯 NEW: Sub-render arrays for Analytics Explicit Breakdown
        let filterSubDays = [];
        if (filterOfficeDays > 0) filterSubDays.push(`🏢 ${filterOfficeDays}`);
        if (filterWFHDays > 0) filterSubDays.push(`🏠 ${filterWFHDays}`);
        let filterPtoTxt = [];
        if (filterFullPTODays > 0) filterPtoTxt.push(`${filterFullPTODays} Full`);
        if (filterPartialPTODays > 0) filterPtoTxt.push(`${filterPartialPTODays} Part`);
        if (filterPtoTxt.length > 0) filterSubDays.push(`🏝️ ${filterPtoTxt.join(', ')}`);

        // 🎯 Use flex-column to force strict rightward alignment
        let filterDaysHtml = `<div style="display:flex; flex-direction:column; align-items:flex-end; gap:4px;"><div style="white-space:nowrap;">${filterTotalDays}</div>`;
        if (filterSubDays.length > 0) {
            filterDaysHtml += `<div style="font-size:10px; color:var(--text-muted); font-weight:500; text-align:right;">${filterSubDays.join(' | ')}</div>`;
        }
        filterDaysHtml += `</div>`;

        const allDaysEl = document.getElementById("all-val-days");
        allDaysEl.innerHTML = filterDaysHtml;
        if (allDaysEl.parentElement) {
            allDaysEl.parentElement.style.alignItems = "flex-start"; // Align to top
            allDaysEl.parentElement.style.gap = "12px"; // Prevent text collision
        }
        
        const allActualEl = document.getElementById("all-val-hours");
        allActualEl.innerHTML = `
            <div style="display:flex; flex-direction:column; align-items:flex-end; gap:4px;">
                <div style="white-space:nowrap;">${formatDurFromDec(filterTotalHours, false)}</div>
                <div style="font-size:10px; color:var(--text-muted); font-weight:500; text-align:right;">🏢 ${formatDurFromDec(filterOfficeHours, false)} | 🏠 ${formatDurFromDec(filterWFHHours, false)} | 🏝️ ${formatDurFromDec(filterPTOHours, false)}</div>
            </div>`;
        if (allActualEl.parentElement) {
            allActualEl.parentElement.style.alignItems = "flex-start";
            allActualEl.parentElement.style.gap = "12px";
        }

        document.getElementById("all-val-target").innerText = formatDurFromDec(filterTargetHours, false);
        document.getElementById("all-val-first").innerText = filteredDates.length > 0 ? filteredDates[0] : "--";

        const canvasContainer = document.querySelector(".ikg-canvas-container");
        const heatmapWrapper = document.getElementById("ikg-heatmap-wrapper");

        if (currentAnalyticsView === "GRID") {
          canvasContainer.style.display = "none";
          heatmapWrapper.style.display = "flex";
          const heatmapGrid = document.getElementById("ikg-heatmap-grid");
          const monthsContainer = document.getElementById("ikg-heatmap-months");
          heatmapGrid.innerHTML = "";
          monthsContainer.innerHTML = "";

          if (filteredDates.length > 0) {
            let start = new Date(filteredDates[0]);
            let end = new Date(filteredDates[filteredDates.length - 1]);

            start.setHours(0, 0, 0, 0);
            start.setDate(start.getDate() - start.getDay());
            end.setHours(0, 0, 0, 0);
            end.setDate(end.getDate() + (6 - end.getDay()));

            let maxEnd = new Date(todayObj);
            maxEnd.setDate(maxEnd.getDate() + (6 - maxEnd.getDay()));
            if (end > maxEnd) end = maxEnd;

            const totalDays = Math.round((end - start) / 86400000) + 1;
            const totalCols = totalDays / 7;

            heatmapGrid.style.gridTemplateColumns = `repeat(${totalCols}, minmax(32px, 75px))`;

            monthsContainer.style.display = "grid";
            monthsContainer.style.gridTemplateColumns = `repeat(${totalCols}, minmax(32px, 75px))`;
            monthsContainer.style.gap = "4px";

            let curr = new Date(start);
            let currentMonth = -1;
            for (let c = 0; c < totalCols; c++) {
              let isNewMonth = false;
              let monthName = "";
              for (let r = 0; r < 7; r++) {
                const dStr = `${curr.getFullYear()}-${String(curr.getMonth() + 1).padStart(2, "0")}-${String(curr.getDate()).padStart(2, "0")}`;
                if (curr.getMonth() !== currentMonth && curr.getDate() <= 7) {
                  currentMonth = curr.getMonth();
                  isNewMonth = true;
                  monthName = curr.toLocaleString("default", { month: "short" });
                }
                
                const evalDay = evaluateDay(IKG_DataStore.getDayContext(dStr, snapshot));
                const shortPto = evalDay.ptoType ? evalDay.ptoType.split(" - ")[0] : "PTO";

                let color = "var(--bg-elevated)";
                let title = dStr;
                let pointerEvent = "";
                let innerTxt = "";

                if (curr > todayObj) {
                  color = "transparent";
                  title = "";
                  pointerEvent = "pointer-events:none;";
                } else if (evalDay.isIgnored) {
                  color = "var(--border)";
                  title = `${dStr} | Ignored`;
                  innerTxt = "⚠️";
                } else if (evalDay.status === "full-pto") {
                  color = evalDay.heatmapBg;
                  title = `${dStr} | ${evalDay.ptoHrs}h ${shortPto}`;
                  innerTxt = "PTO";
                } else if (evalDay.actualHrs > 0) {
                  color = evalDay.heatmapBg;
                  if (evalDay.isPartialPTO)
                    title = `${dStr} | ${evalDay.effectiveHrs.toFixed(2)}h (${evalDay.actualHrs.toFixed(1)}h worked + ${evalDay.ptoHrs}h ${shortPto})`;
                  else title = `${dStr} | ${evalDay.actualHrs.toFixed(2)}h worked`;

                  if (evalDay.isSpoofed) title += " ⚠️(Override)";
                  innerTxt = evalDay.effectiveHrs.toFixed(1);
                } else if (evalDay.status === "pending") {
                  color = evalDay.heatmapBg;
                  title += " | Pending";
                  innerTxt = "⌛";
                }

                heatmapGrid.innerHTML += `
                  <div class="ikg-heat-sq" style="background:${color}; ${pointerEvent}" data-date="${dStr}" data-jump="${dStr}">
                      <div class="heat-date">${curr.getDate()}</div>
                      <div>${innerTxt}</div>
                  </div>`;
                curr.setDate(curr.getDate() + 1);
              }

              if (isNewMonth) {
                monthsContainer.innerHTML += `<div style="font-size:11px; color:var(--text-muted); font-weight:500;">${monthName}</div>`;
              } else {
                monthsContainer.innerHTML += `<div></div>`;
              }
            }
          }
        } else {
          canvasContainer.style.display = "block";
          heatmapWrapper.style.display = "none";
          const dataItems = [];
          const labels = [];
          
          filteredDates.forEach((dStr) => {
            const d = new Date(dStr);
            const isDense = filteredDates.length > 60;
            const evalDay = evaluateDay(IKG_DataStore.getDayContext(dStr, snapshot));

            labels.push(
              isDense
                ? `${d.getMonth() + 1}/${d.getDate()}`
                : `${d.toLocaleString("default", { month: "short" })} ${d.getDate()}`
            );

            dataItems.push({
              dateStr: dStr,
              val: evalDay.actualHrs,
              pto: evalDay.ptoHrs,
              color: evalDay.chartColor,
              isSpoofed: evalDay.isSpoofed,
              isIgnored: evalDay.isIgnored,
              isWFH: evalDay.isWFH,
              ptoType: evalDay.ptoType,
            });
          });

          drawNativeChart("ikg-main-chart", labels, dataItems);
        }
      }

      // ==========================================
  // ACTIVE VISIBILITY GLOW TIMER CONTROLLER
  // ==========================================
  const ActiveGlowTracker = {
    accumulatedMs: 0,
    targetMs: 8000, // 8 seconds of active viewing required
    intervalId: null,

    start: function (onComplete) {
      this.stop(); // Clear any existing timer
      this.accumulatedMs = 0;

      const tick = () => {
        // Only accumulate time when the tab is actively visible to the user!
        if (document.visibilityState === "visible") {
          this.accumulatedMs += 200;
          if (this.accumulatedMs >= this.targetMs) {
            this.stop();
            if (typeof onComplete === "function") onComplete();
          }
        }
      };

      this.intervalId = setInterval(tick, 200);
    },

    stop: function () {
      if (this.intervalId) {
        clearInterval(this.intervalId);
        this.intervalId = null;
      }
    }
  };

      function buildUI() {
        // 🎯 DYNAMIC VERSION EXTRACTION (Tampermonkey Native API)
        let SCRIPT_VER = "v7.120";
        try {
          if (typeof GM_info !== "undefined" && GM_info && GM_info.script && GM_info.script.version) {
            SCRIPT_VER = GM_info.script.version.startsWith("v") ? GM_info.script.version : `v${GM_info.script.version}`;
          }
        } catch (e) {}

        // 🎯 UNIVERSAL VERSION BADGE INJECTOR
        const injectVerBadge = () => {
          if (document.getElementById("ikg-ver-badge")) return true;

          const titleContainer = 
            document.querySelector(".ikg-title-area") || 
            document.querySelector("#ikg-modal-header > div:first-child");

          if (titleContainer) {
            const badge = document.createElement("span");
            badge.id = "ikg-ver-badge";
            badge.style.cssText = "font-size:11px; font-weight:700; color:var(--text-muted); background:var(--bg-base); border:1px solid var(--border); padding:2px 8px; border-radius:12px; margin-left:8px; font-family:monospace; line-height:1.2; display:inline-block !important; vertical-align:middle;";
            badge.innerText = SCRIPT_VER;
            titleContainer.appendChild(badge);
            IkgLog.info(`✅ Bound Version Badge to Header: ${SCRIPT_VER}`);
            return true;
          }
          return false;
        };

        if (!injectVerBadge() && document.body) {
          const verObserver = new MutationObserver((mutations, obs) => {
            if (injectVerBadge()) obs.disconnect(); // Stop watching once bound
          });
          verObserver.observe(document.body, { childList: true, subtree: true });
        }

        IkgLog.info(`[UI Engine] Initializing Dashboard UI (${SCRIPT_VER})...`);

        if (document.getElementById("ikg-fab")) {
          injectVerBadge();
          return;
        }

        const fab = document.createElement("button");
        fab.id = "ikg-fab";
        fab.innerHTML = "📊 Dashboard";
        document.body.appendChild(fab);

        const backdrop = document.createElement("div");
        backdrop.id = "ikg-modal-backdrop";
        backdrop.innerHTML = `
                <div id="ikg-modal">
                    <header id="ikg-modal-header">
                        <div class="ikg-title-area" style="display: flex !important; align-items: center !important; gap: 8px !important; white-space: nowrap !important;">
                            <img src="favicon.png" style="width: 28px; height: 28px; background: var(--primary); border-radius: 6px; flex-shrink: 0; object-fit: contain;" alt="IKG Logo">
                            <span style="font-size:18px; font-weight:700; color:var(--text-main);">Attendance Pro</span>
                            <span id="ikg-ver-badge" style="font-size:11px; font-weight:700; color:var(--text-muted); background:var(--bg-base); border:1px solid var(--border); padding:2px 8px; border-radius:12px; margin-left:4px; font-family:monospace; line-height:1.2; display:inline-block !important;">${SCRIPT_VER}</span>
                        </div>
                        <div class="ikg-tab-group">
                          <div class="ikg-tab active" id="tab-cal">🗓️ Calendar</div>
                          <div class="ikg-tab" id="tab-stats">📈 Analytics</div>
                          <div class="ikg-tab" id="tab-audit">🔍 Data Audit</div>
                          <div class="ikg-tab" id="tab-rules">📜 Rules</div>
                          <div class="ikg-tab" id="tab-settings">⚙️ Settings</div>
                      </div>
                      <div class="ikg-header-actions">
                          <div id="ikg-header-status" class="ikg-header-status">🤖 Autopilot engaging...</div>
                          <div id="ikg-close">&times;</div>
                      </div>
                  </header>

                    <div id="ikg-modal-body">
                        <div id="view-cal" class="ikg-view active">
                            <div id="ikg-calendar-pane">
                                <div class="ikg-cal-header">
                                    <button class="ikg-cal-nav" id="ikg-prev-month"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 18l-6-6 6-6"/></svg></button>
                                    <span id="ikg-cal-month-text">Loading...</span>
                                    <button class="ikg-cal-nav" id="ikg-next-month"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg></button>
                                </div>
                                <div class="ikg-grid-header"><div>Sun</div><div>Mon</div><div>Tue</div><div>Wed</div><div>Thu</div><div>Fri</div><div>Sat</div></div>
                                <div class="ikg-grid" id="ikg-cal-grid"></div>

                                <div class="day-modal-overlay"></div>
                                <div id="ikg-day-modal" class="ikg-popup-modal">
                                    <div class="dm-title" id="dm-title-date">
                                        <div style="display:flex; align-items:center; gap:8px;">
                                            <span id="dm-date-label">Date</span>
                                            <span id="dm-override-badge" style="font-size:10px; padding:2px 6px; border-radius:4px; font-weight:700; display:none;"></span>
                                        </div>
                                        <span id="dm-close-btn" style="cursor:pointer; color:var(--text-muted); font-size:24px; line-height:1;">&times;</span>
                                    </div>
                                    <div style="background:var(--bg-base); padding:16px; border-radius:12px; border:1px solid var(--border);">
                                        <div style="font-size:12px; font-weight:600; color:var(--text-muted); margin-bottom:12px; display:flex; align-items:center; gap:6px;">
                                            ⏱️ Manual Shift Override
                                            <span id="dm-save-status" style="margin-left:auto; font-size:10px; color:var(--success); font-weight:700; opacity:0; transition:opacity 0.3s;">Saved ✓</span>
                                        </div>
                                        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:12px;">
                                            <div>
                                                <label style="font-size:10px; color:var(--text-muted); text-transform:uppercase; font-weight:600; margin-bottom:6px; display:block;">Clock In</label>
                                                <input type="time" step="1" id="dm-manual-in" class="set-input" style="padding:10px; font-size:15px; width:100%; box-sizing:border-box; cursor:pointer;">
                                            </div>
                                            <div>
                                                <label style="font-size:10px; color:var(--text-muted); text-transform:uppercase; font-weight:600; margin-bottom:6px; display:block;">Clock Out</label>
                                                <input type="time" step="1" id="dm-manual-out" class="set-input" style="padding:10px; font-size:15px; width:100%; box-sizing:border-box; cursor:pointer;">
                                            </div>
                                        </div>

                                        <div id="dm-calc-preview" style="font-size:11px; color:var(--text-muted); margin-top:8px; text-align:right; font-weight:600; min-height:16px;"></div>

                                        <label style="display:flex; align-items:center; gap:8px; margin-top:12px; padding-top:12px; border-top:1px dashed var(--border); cursor:pointer; user-select:none;">
                                            <input type="checkbox" id="dm-ignore-toggle" style="width:16px; height:16px; accent-color:var(--danger);">
                                            <span style="font-size:11px; font-weight:600; color:var(--danger);">⚠️ Ignore from Flex/Stats (Pending HR)</span>
                                        </label>

                                        <div style="margin-top:16px; border-top:1px solid var(--border); padding-top:12px;">
                                            <button id="dm-btn-remove-override" style="width:100%; background:transparent; border:1px solid var(--danger); color:var(--danger); padding:8px 12px; border-radius:8px; font-size:12px; font-weight:700; cursor:pointer; transition:0.2s; display:none;" onmouseover="this.style.background='var(--danger-bg)'" onmouseout="this.style.background='transparent'">
                                                🗑️ Remove Manual Override
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div class="ikg-summary-pane">
                                <div id="ikg-active-shift-container"></div>

                                <div class="ikg-card">
                                    <div class="ikg-card-title">This Month</div>
                                    <div class="ikg-stat-row"><span>Effective Days</span><span class="ikg-stat-val" id="side-val-days">0</span></div>
                                    <div class="ikg-stat-row"><span>Actual Hours</span><span class="ikg-stat-val" id="side-val-actual">0h</span></div>
                                    <div class="ikg-stat-row"><span>Target Hours</span><span class="ikg-stat-val" id="side-val-target" style="color:var(--text-muted);">0h</span></div>
                                    <div class="ikg-stat-row" style="margin-top:12px; padding-top:12px; border-top:1px solid var(--border);">
                                        <span>Net Balance</span><span class="ikg-stat-val" id="side-val-net">--</span>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div id="view-stats" class="ikg-view">
                            <div id="ikg-chart-pane">
                                <div class="ikg-chart-header-row">
                                    <div class="ikg-chart-title">Working Hours</div>
                                    <div style="display: flex; gap: 16px; align-items: center;">
                                        <div class="ikg-filter-group" style="margin-right: 12px;">
                                            <button class="ikg-filter-btn view-toggle active" data-view="CHART">📊 Chart</button>
                                            <button class="ikg-filter-btn view-toggle" data-view="GRID">🟩 Grid</button>
                                        </div>
                                        <div style="position: relative; display:flex; flex-direction:column; align-items:flex-end;">
                                            <div class="ikg-filter-group">
                                                <button class="ikg-filter-btn stats-filter" data-range="7D">7 Working Days</button>
                                                <button class="ikg-filter-btn stats-filter active" data-range="30D">30D</button>
                                                <select id="ikg-stats-month" class="ikg-filter-btn stats-filter ikg-month-select" data-range="MONTH"></select>
                                                <button class="ikg-filter-btn stats-filter" data-range="ALL">All Time</button>
                                                <button class="ikg-filter-btn stats-filter" data-range="CUSTOM">Custom</button>
                                            </div>
                                            <div id="stats-cal-container" class="ikg-cal-group" style="display:none;">
                                                🗓️
                                                <div class="ikg-cal-input-wrapper"><input type="text" id="stats-date-start" class="ikg-ov-dateinput" placeholder="Start Date" readonly><button id="stats-clear-start" class="ikg-cal-clear-btn">×</button></div>
                                                <span style="color:var(--text-muted); font-weight:bold;">→</span>
                                                <div class="ikg-cal-input-wrapper"><input type="text" id="stats-date-end" class="ikg-ov-dateinput" placeholder="End Date" readonly><button id="stats-clear-end" class="ikg-cal-clear-btn">×</button></div>
                                            </div>
                                        </div>
                                    </div>
                                </div> <div class="ikg-canvas-container"><canvas id="ikg-main-chart"></canvas></div>

                                <div id="ikg-heatmap-wrapper">
                                    <div id="ikg-heatmap-months"></div>
                                    <div class="hm-layout">
                                        <div class="hm-y-axis">
                                            <div>Sun</div><div>Mon</div><div>Tue</div><div>Wed</div><div>Thu</div><div>Fri</div><div>Sat</div>
                                        </div>
                                        <div id="ikg-heatmap-grid"></div>
                                    </div>
                                </div>

                            </div>

                            <div class="ikg-summary-pane">
                                <div class="ikg-card">
                                    <div class="ikg-card-title">Shift Insights</div>
                                    <div class="ikg-stat-row"><span class="ikg-fast-tt" data-title="The mathematical average of all shifts.">Average Length</span><span class="ikg-stat-val" id="habit-val-hrs-mean">--</span></div>
                                    <div class="ikg-stat-row"><span class="ikg-fast-tt" data-title="The true middle value, ignoring extreme long/short days.">Typical Length</span><span class="ikg-stat-val" id="habit-val-hrs-med">--</span></div>
                                    <div class="ikg-stat-row"><span class="ikg-fast-tt" data-title="The shift length you hit most frequently.">Most Common</span><span class="ikg-stat-val" id="habit-val-hrs-mode">--</span></div>
                                    <div class="ikg-stat-row" style="margin-top:8px; padding-top:8px; border-top:1px solid var(--border);">
                                        <span class="ikg-fast-tt" data-title="How much your shifts usually fluctuate from the average (Standard Deviation).">Typical Variation</span><span class="ikg-stat-val" id="habit-val-hrs-std">--</span>
                                    </div>
                                    <div class="ikg-stat-row"><span class="ikg-fast-tt" data-title="The difference between your longest and shortest shift.">Max Gap</span><span class="ikg-stat-val" id="habit-val-hrs-range">--</span></div>
                                </div>

                                <div class="ikg-card">
                                    <div class="ikg-card-title">Routine Patterns</div>
                                    <div class="ikg-stat-row"><span class="ikg-fast-tt" data-title="Your most representative clock-in time.">Typical Clock-In</span><span class="ikg-stat-val" id="habit-val-in-med">--:--</span></div>
                                    <div class="ikg-stat-row"><span class="ikg-fast-tt" data-title="Mathematical average clock-in time.">Average Clock-In</span><span class="ikg-stat-val" id="habit-val-in-mean">--:--</span></div>
                                    <div class="ikg-stat-row" style="margin-top:8px; padding-top:8px; border-top:1px solid var(--border);">
                                        <span class="ikg-fast-tt" data-title="Your most representative clock-out time.">Typical Clock-Out</span><span class="ikg-stat-val" id="habit-val-out-med">--:--</span>
                                    </div>
                                    <div class="ikg-stat-row"><span class="ikg-fast-tt" data-title="Mathematical average clock-out time.">Average Clock-Out</span><span class="ikg-stat-val" id="habit-val-out-mean">--:--</span></div>
                                </div>

                                <div class="ikg-card" style="margin-top: auto;">
                                    <div class="ikg-card-title" id="stats-summary-title">Lifetime System Stats</div>
                                    <div class="ikg-stat-row"><span>Total Days</span><span class="ikg-stat-val" id="all-val-days">0</span></div>
                                    <div class="ikg-stat-row"><span>Actual Hours</span><span class="ikg-stat-val" id="all-val-hours">0h</span></div>
                                    <div class="ikg-stat-row"><span>Target Hours</span><span class="ikg-stat-val" id="all-val-target" style="color:var(--text-muted);">0h</span></div>
                                    <div class="ikg-stat-row"><span>First Day</span><span class="ikg-stat-val" id="all-val-first">--</span></div>
                                </div>
                            </div>
                        </div>

                        <div id="view-audit" class="ikg-view">
                            <div class="ikg-chart-header-row" style="margin-bottom:8px;">
                                <div style="font-size:24px; font-weight:700; color:var(--text-main);">Data Audit Logs</div>
                                <div style="position: relative; display:flex; flex-direction:column; align-items:flex-end;">
                                    <div class="ikg-filter-group">
                                        <button class="ikg-filter-btn audit-filter" data-range="7D">7 Working Days</button>
                                        <button class="ikg-filter-btn audit-filter active" data-range="30D">30D</button>
                                        <select id="ikg-audit-month" class="ikg-filter-btn audit-filter ikg-month-select" data-range="MONTH"></select>
                                        <button class="ikg-filter-btn audit-filter" data-range="ALL">All Time</button>
                                        <button class="ikg-filter-btn audit-filter" data-range="CUSTOM">Custom</button>
                                    </div>
                                    <div id="audit-cal-container" class="ikg-cal-group" style="display:none;">
                                        🗓️
                                        <div class="ikg-cal-input-wrapper"><input type="text" id="audit-date-start" class="ikg-ov-dateinput" placeholder="Start Date" readonly><button id="audit-clear-start" class="ikg-cal-clear-btn">×</button></div>
                                        <span style="color:var(--text-muted); font-weight:bold;">→</span>
                                        <div class="ikg-cal-input-wrapper"><input type="text" id="audit-date-end" class="ikg-ov-dateinput" placeholder="End Date" readonly><button id="audit-clear-end" class="ikg-cal-clear-btn">×</button></div>
                                    </div>
                                </div>
                            </div>
                            <div style="font-size:14px; color:var(--text-muted); margin-bottom:24px;">Complete transparency into how your Total Hours and Flex Time are calculated.</div>
                            <table class="audit-table">
                                <thead>
                                    <tr>
                                        <th>Date</th>
                                        <th>Clock-In</th>
                                        <th>Clock-Out</th>
                                        <th>Total Shift</th>
                                        <th>Flex (Vs 9.0h)</th>
                                    </tr>
                                </thead>
                                <tbody id="audit-table-body">
                                </tbody>
                            </table>
                        </div>

                        <div id="view-settings" class="ikg-view" style="padding: 32px 48px; overflow-y: auto; background: var(--bg-surface); justify-content: center; align-items: flex-start;">
                            <div class="set-container">

                                <div class="set-header-wrap">
                                    <div class="set-header">⚙️ Preferences & Customization</div>
                                    <div style="font-size:14px; color:var(--text-muted); margin-bottom: 8px;">Configure how Attendance Pro behaves. (Changes save automatically)</div>
                                </div>

                                <div class="ikg-card" style="margin: 0; display: flex; flex-direction: column; gap: 16px;">
                                    <div class="ikg-card-title">General & Display</div>
                                    <label class="checkbox-label">
                                        <input type="checkbox" id="set-use-flex" style="width:16px; height:16px; accent-color: var(--primary);">
                                        <span>Auto-subtract banked Flex from Goal Out</span>
                                    </label>
                                    <label class="checkbox-label">
                                        <input type="checkbox" id="set-show-secs" style="width:16px; height:16px; accent-color: var(--primary);">
                                        <span>Show exact seconds (HH:MM:SS)</span>
                                    </label>
                                    <label class="checkbox-label">
                                        <input type="checkbox" id="set-include-wfh" style="width:16px; height:16px; accent-color: var(--primary);">
                                        <span>Calculate WFH hours into Work Totals & Flex</span>
                                    </label>
                                    <label class="checkbox-label" style="margin-bottom: 8px;">
                                        <input type="checkbox" id="set-use-overrides" style="width:16px; height:16px; accent-color: var(--primary);">
                                        <span><b style="color:var(--warn);">Enable Override:</b> Force app to use my Manual Inputs</span>
                                    </label>
                                    <div class="set-group" style="margin-top: auto; margin-bottom: 0;">
                                        <label class="set-label">Monthly Shift Override</label>
                                        <select id="set-manual-shift" class="set-select" style="padding: 8px;">
                                            <option value="auto">🤖 Auto-Detect (1st Check-in)</option>
                                            <option value="09:00 ~ 18:00">09:00 ~ 18:00</option>
                                            <option value="09:30 ~ 18:30">09:30 ~ 18:30</option>
                                            <option value="10:00 ~ 19:00">10:00 ~ 19:00</option>
                                            <option value="13:00 ~ 22:00">13:00 ~ 22:00</option>
                                        </select>
                                    </div>
                                </div>

                                <div class="ikg-card" style="margin: 0; display: flex; flex-direction: column; gap: 16px;">
                                    <div class="ikg-card-title">Alarm Behavior</div>
                                    <label class="checkbox-label">
                                        <input type="checkbox" id="set-auto-alarm" style="width:16px; height:16px; accent-color: var(--primary);">
                                        <span>Auto-set background alarm for shifts</span>
                                    </label>
                                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
                                        <div class="set-group" style="margin-bottom:0;">
                                            <label class="set-label" style="font-size: 10px;">Triggers (- Before / + After)</label>
                                            <div class="set-row" style="gap: 4px;">
                                                <input type="text" id="set-triggers" class="set-input" placeholder="-15, 0, 5" style="padding: 8px;">
                                                <select id="set-trigger-unit" class="set-select" style="padding: 8px 4px; width: 55px; flex: none;">
                                                    <option value="m">Min</option>
                                                    <option value="s">Sec</option>
                                                </select>
                                            </div>
                                        </div>
                                        <div class="set-group" style="margin-bottom:0;">
                                            <label class="set-label" style="font-size: 10px;">Snooze Duration</label>
                                            <div class="set-row" style="gap: 4px;">
                                                <input type="number" id="set-snooze" class="set-input" min="1" style="padding: 8px;">
                                                <select id="set-snooze-unit" class="set-select" style="padding: 8px 4px; width: 55px; flex: none;">
                                                    <option value="m">Min</option>
                                                    <option value="s">Sec</option>
                                                </select>
                                            </div>
                                        </div>
                                    </div>
                                    <div class="set-group" style="margin-top: auto; margin-bottom: 0;">
                                        <label class="set-label">Test Alarm (Audio + Visual)</label>
                                        <div class="set-row">
                                            <input type="number" id="ikg-test-sec" class="set-input" value="5" min="1" max="60" style="width: 60px; padding: 8px;">
                                            <button id="ikg-btn-test-alarm" class="ikg-btn-outline" style="margin-top:0; flex: 1; padding: 8px;">🧪 Run Test</button>
                                        </div>
                                    </div>
                                </div>

                                <div class="ikg-card" style="margin: 0; display: flex; flex-direction: column; gap: 12px;">
                                    <div class="ikg-card-title" style="margin-bottom: 0;">Alarm Media</div>

                                    <div style="font-size:11px; color:var(--warn); padding:6px 8px; background:var(--warn-bg); border-radius:6px; border:1px solid var(--warn); line-height: 1.3;">
                                        💡 <b>Mac sleep blocks alarms.</b> Use GCal to push to phone.
                                    </div>

                                    <div style="display: flex; gap: 8px; align-items: center; margin-top: 4px;">
                                        <select id="set-sound" class="set-select" style="padding: 6px 8px; font-size: 12px; height: 32px;">
                                            <option value="pro_fkj">🎹 FKJ - Just Piano (Def)</option>
                                            <option value="pro_misch">🎸 Tom Misch</option>
                                            <option value="chime">🔔 Joyful Chime</option>
                                            <option value="gentle">🌅 Gentle Wake</option>
                                            <option value="beep">⏰ Classic Beep</option>
                                            <option value="custom">📁 Custom Audio</option>
                                        </select>
                                        <button id="ikg-btn-preview" class="ikg-btn-outline" style="margin: 0; padding: 6px 10px; font-size: 12px; height: 32px; flex-shrink: 0;">▶️ Play</button>
                                    </div>

                                    <div style="display: flex; gap: 8px; align-items: center; margin-top: 4px; padding: 0 4px;">
                                        <span style="font-size: 11px; color: var(--text-muted); font-weight: 600;">VOL</span>
                                        <input type="range" id="set-volume" min="0" max="1" step="0.05" value="0.8" style="flex: 1; accent-color: var(--primary); height: 4px; border-radius: 2px; cursor: pointer;">
                                        <span id="set-volume-val" style="font-size: 11px; color: var(--text-main); font-family: monospace; width: 32px; text-align: right;">80%</span>
                                    </div>

                                    <div id="set-upload-wrap" class="file-upload-wrapper" style="padding: 8px; margin: 0;">
                                        <label class="file-upload-label" for="set-file-input" style="padding: 4px 12px; font-size: 11px;">Upload MP3</label>
                                        <input type="file" id="set-file-input" accept="audio/*" style="display:none;">
                                        <div class="file-name" id="set-file-name" style="margin-top: 4px;">Max size: 15MB</div>
                                    </div>

                                    <hr style="border: 0; border-top: 1px dashed var(--border); margin: 4px 0;">

                                    <div style="display: flex; gap: 8px; align-items: center;">
                                        <img id="set-img-preview" src="https://attendance.iki-utl.cc/favicon.png" style="width: 32px; height: 32px; border-radius: 6px; object-fit: cover; border: 1px solid var(--border); background: var(--bg-base); flex-shrink: 0;">
                                        <select id="set-img-type" class="set-select" style="padding: 6px 8px; font-size: 12px; height: 32px;">
                                            <option value="default">Default GIF</option>
                                            <option value="custom">🖼️ Custom Img</option>
                                        </select>
                                        <div class="ikg-fast-tt no-dot" data-title="Pulse Animation Speed (0 to disable)" style="display: flex; align-items: center; gap: 4px; flex-shrink: 0;">
                                            <input type="number" id="set-pulse-speed" class="set-input" step="0.1" min="0" placeholder="Speed" style="padding: 6px; font-size: 12px; width: 50px; height: 32px; text-align: center;">
                                            <span style="font-size: 11px; color: var(--text-muted);">sec</span>
                                        </div>
                                    </div>
                                    <div id="set-img-upload-wrap" class="file-upload-wrapper" style="padding: 8px; margin: 0;">
                                        <label class="file-upload-label" for="set-img-input" style="padding: 4px 12px; font-size: 11px;">Upload Image/GIF</label>
                                        <input type="file" id="set-img-input" accept="image/*" style="display:none;">
                                        <div class="file-name" id="set-img-name" style="margin-top: 4px;">GIFs supported!</div>
                                    </div>
                                </div>

                                <div class="ikg-card" style="margin: 0; display: flex; flex-direction: column; gap: 12px;">
                                    <div class="ikg-card-title">Data Synchronization</div>

                                    <div class="set-group" style="margin-bottom: 8px;">
                                        <label class="set-label">Auto-Sync History</label>
                                        <select id="set-sync-days" class="set-select" style="padding: 8px;">
                                            <option value="7">Past 7 Working Days</option>
                                            <option value="14">Past 14 Working Days</option>
                                            <option value="30">Past 30 Working Days</option>
                                            <option value="60">Past 60 Working Days</option>
                                        </select>
                                    </div>

                                    <div style="font-size:11px; color:var(--text-muted); line-height:1.5;">
                                        Data syncs <b>automatically</b>. Use this button to force a manual hard-refresh.
                                    </div>
                                    <button class="ikg-sync-btn" id="ikg-btn-fetch" disabled style="margin-top: auto; padding: 10px;">Manual Sync Data</button>
                                </div>

                            </div>
                        </div>

                        <div id="view-rules" class="ikg-view" style="padding: 32px 48px; overflow-y: auto; background: var(--bg-surface);">
                            <div style="width: 100%; max-width: 900px; margin: 0 auto; display: flex; flex-direction: column; gap: 20px;">

                                <div class="set-header-wrap">
                                    <div class="set-header">📜 Shift & Flex Rules</div>
                                </div>

                                <div class="ikg-card">
                                    <div class="ikg-card-title">1. Core Shifts</div>
                                    <div style="display: flex; gap: 12px; margin-top: 8px;">
                                        <div style="flex: 1; background: var(--bg-surface); padding: 12px; border-radius: 8px; border: 1px solid var(--border); text-align: center; font-family: monospace; font-size: 14px; font-weight: bold; color: var(--text-main);">09:00 ~ 18:00</div>
                                        <div style="flex: 1; background: var(--bg-surface); padding: 12px; border-radius: 8px; border: 1px solid var(--border); text-align: center; font-family: monospace; font-size: 14px; font-weight: bold; color: var(--text-main);">09:30 ~ 18:30</div>
                                        <div style="flex: 1; background: var(--bg-surface); padding: 12px; border-radius: 8px; border: 1px solid var(--border); text-align: center; font-family: monospace; font-size: 14px; font-weight: bold; color: var(--text-main);">10:00 ~ 19:00</div>
                                        <div style="flex: 1; background: var(--bg-surface); padding: 12px; border-radius: 8px; border: 1px solid var(--border); text-align: center; font-family: monospace; font-size: 14px; font-weight: bold; color: var(--text-main);">13:00 ~ 22:00</div>
                                    </div>
                                </div>

                                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px;">
                                    <div class="ikg-card" style="margin: 0; display: flex; flex-direction: column;">
                                        <div class="ikg-card-title" style="color: var(--success);">2. 🟢 Earning Flex Time</div>
                                        <div style="font-size: 13px; color: var(--text-main); line-height: 1.6;">
                                            Any time worked over 9 hours automatically banks as Flex.<br><br>
                                            <b>Early In:</b> In at <code style="font-family: monospace; background: rgba(0,0,0,0.2); padding: 2px 6px; border-radius: 4px; border: 1px solid var(--border);">08:45</code>, out at <code style="font-family: monospace; background: rgba(0,0,0,0.2); padding: 2px 6px; border-radius: 4px; border: 1px solid var(--border);">18:00</code> 👉 Bank <b>15m</b>.<br>
                                            <b>Late Out:</b> In at <code style="font-family: monospace; background: rgba(0,0,0,0.2); padding: 2px 6px; border-radius: 4px; border: 1px solid var(--border);">09:00</code>, out at <code style="font-family: monospace; background: rgba(0,0,0,0.2); padding: 2px 6px; border-radius: 4px; border: 1px solid var(--border);">18:30</code> 👉 Bank <b>30m</b>.<br>
                                            <div style="font-size: 11px; color: var(--text-muted); margin-top: 6px; border-top: 1px dashed var(--border); padding-top: 6px;">* Official approved Overtime (OT) is calculated separately.</div>
                                        </div>
                                    </div>

                                    <div class="ikg-card" style="margin: 0; display: flex; flex-direction: column;">
                                        <div class="ikg-card-title" style="color: var(--warn);">3. 🟠 Late Arrival (30m Grace)</div>
                                        <div style="font-size: 13px; color: var(--text-main); line-height: 1.6;">
                                            Up to <code style="font-family: monospace; background: rgba(0,0,0,0.2); padding: 2px 6px; border-radius: 4px; border: 1px solid var(--border);">29m 59s</code> late keeps your earlier shift.<br><br>
                                            Locked to <code style="font-family: monospace; background: rgba(0,0,0,0.2); padding: 2px 6px; border-radius: 4px; border: 1px solid var(--border);">09:00</code> but in at <code style="font-family: monospace; background: rgba(0,0,0,0.2); padding: 2px 6px; border-radius: 4px; border: 1px solid var(--border);">09:29</code>?<br>
                                            <b>A:</b> Use Flex and leave at <code style="font-family: monospace; background: rgba(0,0,0,0.2); padding: 2px 6px; border-radius: 4px; border: 1px solid var(--border);">18:00</code>.<br>
                                            <b>B:</b> Work full 9h and leave at <code style="font-family: monospace; background: rgba(0,0,0,0.2); padding: 2px 6px; border-radius: 4px; border: 1px solid var(--border);">18:29</code>.
                                        </div>
                                    </div>
                                </div>

                                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px;">
                                    <div class="ikg-card" style="margin: 0; display: flex; flex-direction: column;">
                                        <div class="ikg-card-title" style="color: var(--text-muted);">4. 🔒 Monthly Shift Detection</div>
                                        <div style="font-size: 13px; color: var(--text-main); line-height: 1.6;">
                                            Your <b>most frequent check-in</b> determines your core shift for the month.<br><br>
                                            Exceptions like morning sick leave won't break the auto-detection.
                                        </div>
                                    </div>

                                    <div class="ikg-card" style="margin: 0; display: flex; flex-direction: column; background: rgba(239, 68, 68, 0.05); border-color: rgba(239, 68, 68, 0.3);">
                                        <div class="ikg-card-title" style="color: var(--danger);">5. ⛔ Checkout Blackouts</div>
                                        <div style="font-size: 13px; color: var(--text-main); line-height: 1.6;">
                                            <b>Cannot</b> clock out during earlier shift window.<br><br>
                                            Locked to <code style="font-family: monospace; background: rgba(0,0,0,0.2); padding: 2px 6px; border-radius: 4px; border: 1px solid var(--border);">09:30</code>? Checkout at <code style="font-family: monospace; font-size: 13px; color: var(--danger); background: rgba(239, 68, 68, 0.15); padding: 2px 6px; border-radius: 4px; border: 1px solid rgba(239, 68, 68, 0.3);">18:00:00 ~ 18:29:59</code> is forbidden.
                                        </div>
                                    </div>
                                </div>

                            </div>
                        </div>

                    </div>
                </div>
                <div class="modal-overlay"></div>
            `;
        document.body.appendChild(backdrop);

        // 🎯 DOM TELEMETRY VERIFICATION
      const badgeEl = document.getElementById("ikg-ver-badge");
      if (badgeEl) {
        IkgLog.info(`✅ Version badge successfully rendered into DOM with text: "${badgeEl.innerText}"`);
      } else {
        IkgLog.error("❌ Version badge element (#ikg-ver-badge) failed to inject into DOM.");
      }

        // Instantiate Custom Calendars
        statsCalInstance = new IkgDualCal(
          "stats-cal-container",
          "stats-date-start",
          "stats-date-end",
          "stats-clear-start",
          "stats-clear-end",
          () => {
            saveStatsState();
            renderAnalytics(JSON.parse(localStorage.getItem(CACHE_KEY) || "{}"));
          },
        );
        statsCalInstance.rangeStart = statsRangeStart;
        statsCalInstance.rangeEnd = statsRangeEnd;
        if (statsRangeStart) {
          document.getElementById("stats-date-start").value =
            formatDateForInput(statsRangeStart);
          document.getElementById("stats-clear-start").style.display = "block";
        }
        if (statsRangeEnd) {
          document.getElementById("stats-date-end").value =
            formatDateForInput(statsRangeEnd);
          document.getElementById("stats-clear-end").style.display = "block";
        }

        auditCalInstance = new IkgDualCal(
          "audit-cal-container",
          "audit-date-start",
          "audit-date-end",
          "audit-clear-start",
          "audit-clear-end",
          () => {
            saveAuditState();
            renderAudit(JSON.parse(localStorage.getItem(CACHE_KEY) || "{}"));
          },
        );
        auditCalInstance.rangeStart = auditRangeStart;
        auditCalInstance.rangeEnd = auditRangeEnd;
        if (auditRangeStart) {
          document.getElementById("audit-date-start").value =
            formatDateForInput(auditRangeStart);
          document.getElementById("audit-clear-start").style.display = "block";
        }
        if (auditRangeEnd) {
          document.getElementById("audit-date-end").value =
            formatDateForInput(auditRangeEnd);
          document.getElementById("audit-clear-end").style.display = "block";
        }

        setTimeout(() => backdrop.classList.add("open"), 10);

        fab.addEventListener("click", () => {
          IkgLog.debug("Modal opened.");
          backdrop.classList.add("open");
          renderCalendar();
        });
        document.getElementById("ikg-close").addEventListener("click", () => {
          IkgLog.debug("Modal closed.");
          backdrop.classList.remove("open");
        });

        backdrop.addEventListener(
          "click",
          (e) => {
            if (e.target === backdrop) backdrop.classList.remove("open");
          },
          true,
        );

        const switchTab = (tabId, viewId) => {
          document
            .querySelectorAll(".ikg-tab")
            .forEach((t) => t.classList.remove("active"));
          document
            .querySelectorAll(".ikg-view")
            .forEach((v) => v.classList.remove("active"));
          document.getElementById(tabId).classList.add("active");
          document.getElementById(viewId).classList.add("active");
        };

        document.getElementById("tab-cal").addEventListener("click", () => {
          switchTab("tab-cal", "view-cal");
          activeTab = "cal";
        });
        document.getElementById("tab-stats").addEventListener("click", () => {
          switchTab("tab-stats", "view-stats");
          activeTab = "stats";
          renderAnalytics(JSON.parse(localStorage.getItem(CACHE_KEY) || "{}"));
        });
        document.getElementById("tab-audit").addEventListener("click", () => {
          switchTab("tab-audit", "view-audit");
          activeTab = "audit";
          renderAudit(JSON.parse(localStorage.getItem(CACHE_KEY) || "{}"));
        });
        document.getElementById("tab-rules").addEventListener("click", () => {
          switchTab("tab-rules", "view-rules");
          activeTab = "rules";
        });
        document.getElementById("tab-settings").addEventListener("click", () => {
          switchTab("tab-settings", "view-settings");
          activeTab = "settings";
          renderSettings();
        });

        const saveStatsState = () => {
          localStorage.setItem(
            STATS_STATE_KEY,
            JSON.stringify({
              range: currentStatsRange,
              month: currentStatsMonth,
              start: statsCalInstance ? statsCalInstance.rangeStart : null,
              end: statsCalInstance ? statsCalInstance.rangeEnd : null,
            }),
          );
        };
        const saveAuditState = () => {
          localStorage.setItem(
            AUDIT_STATE_KEY,
            JSON.stringify({
              range: currentAuditRange,
              month: currentAuditMonth,
              start: auditCalInstance ? auditCalInstance.rangeStart : null,
              end: auditCalInstance ? auditCalInstance.rangeEnd : null,
            }),
          );
        };

        document.querySelectorAll(".stats-filter").forEach((btn) => {
          btn.classList.remove("active");
          if (btn.dataset.range === currentStatsRange) btn.classList.add("active");
        });
        document.getElementById("stats-cal-container").style.display =
          currentStatsRange === "CUSTOM" ? "flex" : "none";

        document.querySelectorAll(".audit-filter").forEach((btn) => {
          btn.classList.remove("active");
          if (btn.dataset.range === currentAuditRange) btn.classList.add("active");
        });
        document.getElementById("audit-cal-container").style.display =
          currentAuditRange === "CUSTOM" ? "flex" : "none";

        const savedAgg = localStorage.getItem(AGG_CACHE_KEY);
        if (savedAgg) {
          try {
            const parsed = JSON.parse(savedAgg);
            globalTotalDays = parsed.globalTotalDays || 0;
            globalTotalHours = parsed.globalTotalHours || 0;
            globalFirstDate = parsed.globalFirstDate || "--";
            document.getElementById("all-val-days").innerText = globalTotalDays;
            document.getElementById("all-val-hours").innerText = formatDurFromDec(
              globalTotalHours,
              false,
            );
            document.getElementById("all-val-first").innerText = globalFirstDate;
          } catch (e) {
            IkgLog.error("Failed to parse aggregate cache", e);
          }
        }

        renderCalendar();
        renderAnalytics(JSON.parse(localStorage.getItem(CACHE_KEY) || "{}"));
        renderAudit(JSON.parse(localStorage.getItem(CACHE_KEY) || "{}"));
        renderSettings();

        // --- FILTER BUTTON LISTENERS ---
        document.querySelectorAll(".stats-filter").forEach((btn) => {
          btn.addEventListener("click", (e) => {
            if (e.target.tagName === "SELECT" && currentStatsRange === "MONTH")
              return;
            document
              .querySelectorAll(".stats-filter")
              .forEach((b) => b.classList.remove("active"));
            e.target.classList.add("active");
            currentStatsRange = e.target.getAttribute("data-range");

            document.getElementById("stats-cal-container").style.display =
              currentStatsRange === "CUSTOM" ? "flex" : "none";
            saveStatsState();
            IkgLog.info(`Stats range changed: ${currentStatsRange}`);
            renderAnalytics(JSON.parse(localStorage.getItem(CACHE_KEY) || "{}"));
          });
        });

        document
          .getElementById("ikg-stats-month")
          .addEventListener("change", (e) => {
            document
              .querySelectorAll(".stats-filter")
              .forEach((b) => b.classList.remove("active"));
            e.target.classList.add("active");
            currentStatsRange = "MONTH";
            currentStatsMonth = e.target.value;
            saveStatsState();
            IkgLog.info(`Stats month changed: ${currentStatsMonth}`);
            renderAnalytics(JSON.parse(localStorage.getItem(CACHE_KEY) || "{}"));
          });

        document.querySelectorAll(".audit-filter").forEach((btn) => {
          btn.addEventListener("click", (e) => {
            if (e.target.tagName === "SELECT" && currentAuditRange === "MONTH")
              return;
            document
              .querySelectorAll(".audit-filter")
              .forEach((b) => b.classList.remove("active"));
            e.target.classList.add("active");
            currentAuditRange = e.target.getAttribute("data-range");

            document.getElementById("audit-cal-container").style.display =
              currentAuditRange === "CUSTOM" ? "flex" : "none";
            saveAuditState();
            IkgLog.info(`Audit range changed: ${currentAuditRange}`);
            renderAudit(JSON.parse(localStorage.getItem(CACHE_KEY) || "{}"));
          });
        });

        document
          .getElementById("ikg-audit-month")
          .addEventListener("change", (e) => {
            document
              .querySelectorAll(".audit-filter")
              .forEach((b) => b.classList.remove("active"));
            e.target.classList.add("active");
            currentAuditRange = "MONTH";
            currentAuditMonth = e.target.value;
            saveAuditState();
            IkgLog.info(`Audit month changed: ${currentAuditMonth}`);
            renderAudit(JSON.parse(localStorage.getItem(CACHE_KEY) || "{}"));
          });

        window.addEventListener("resize", () => {
          if (activeTab === "stats" && currentStatsRange !== "ALL") {
            renderAnalytics(JSON.parse(localStorage.getItem(CACHE_KEY) || "{}"));
          }
        });

        const smartMonthNavigate = () => {
          renderCalendar();
          let localCache = JSON.parse(localStorage.getItem(CACHE_KEY) || "{}");
          const viewPrefix = `${currentViewYear}-${String(currentViewMonth).padStart(2, "0")}`;
          const daysInViewMonth = new Date(
            currentViewYear,
            currentViewMonth,
            0,
          ).getDate();
          const todayStr = toYMD(new Date());

          for (let i = 1; i <= daysInViewMonth; i++) {
            const dateStr = `${viewPrefix}-${String(i).padStart(2, "0")}`;
            if (dateStr <= todayStr && localCache[dateStr] === undefined) {
              IkgLog.info(
                `Uncached day detected (${dateStr}). Auto-triggering background sync.`,
              );
              const syncBtn = document.getElementById("ikg-btn-fetch");
              if (!syncBtn.disabled) syncBtn.click();
              break;
            }
          }
        };

        document.getElementById("ikg-prev-month").addEventListener("click", () => {
          currentViewMonth--;
          if (currentViewMonth === 0) {
            currentViewMonth = 12;
            currentViewYear--;
          }
          smartMonthNavigate();
        });
        document.getElementById("ikg-next-month").addEventListener("click", () => {
          currentViewMonth++;
          if (currentViewMonth === 13) {
            currentViewMonth = 1;
            currentViewYear++;
          }
          smartMonthNavigate();
        });

        const heatmapGridEl = document.getElementById("ikg-heatmap-grid");
        if (heatmapGridEl) {
          heatmapGridEl.addEventListener("click", (e) => {
            const heatSq = e.target.closest(".ikg-heat-sq");
            if (heatSq) {
              const jumpStr = heatSq.getAttribute("data-jump");
              if (jumpStr) {
                const targetDate = new Date(jumpStr);
                currentViewYear = targetDate.getFullYear();
                currentViewMonth = targetDate.getMonth() + 1;

                const calTabBtn = document.getElementById("tab-cal");
                if (calTabBtn) calTabBtn.click();
                renderCalendar();
              }
            }
          });

          let gridTooltip = document.getElementById("ikg-grid-tooltip");

          heatmapGridEl.addEventListener("mousemove", (e) => {
            const sq = e.target.closest(".ikg-heat-sq");
            if (sq) {
              const dStr = sq.getAttribute("data-jump");
              if (!dStr) {
                if (gridTooltip) gridTooltip.style.opacity = "0";
                return;
              }

              const snapshot = IKG_DataStore.buildSnapshot();
              const evalDay = evaluateDay(IKG_DataStore.getDayContext(dStr, snapshot));

              if (evalDay.status === "none") {
                if (gridTooltip) gridTooltip.style.opacity = "0";
                return;
              }

              const cleanPtoLabel = evalDay.ptoType ? evalDay.ptoType.split(" - ")[0] : "PTO";
              const dObj = new Date(dStr);
              const monthNames = [
                "JAN", "FEB", "MAR", "APR", "MAY", "JUN",
                "JUL", "AUG", "SEP", "OCT", "NOV", "DEC",
              ];
              const formattedDateLabel = `${monthNames[dObj.getMonth()]} ${dObj.getDate()}`;

              let text = `<div style="color:var(--text-muted); font-size:11px; margin-bottom:8px; font-weight:700; letter-spacing:0.05em; text-transform:uppercase;">${formattedDateLabel}</div>`;

              const totalHrs = evalDay.actualHrs + evalDay.ptoHrs;
              const totalColor =
                totalHrs >= 9.0 ? "var(--success)" : "var(--danger)";

              text += `<div style="display: grid; grid-template-columns: 20px 1fr; gap: 4px 8px; align-items: center; font-size: 13px;">`;

              if (evalDay.actualHrs > 0) {
                text += `
                    <div style="text-align:center; font-size:14px;" title="Worked">⏱️</div>
                    <div style="color:var(--text-main);"><b>${evalDay.actualHrs.toFixed(2)}h</b></div>
                `;
              }
              if (evalDay.ptoHrs > 0 && !evalDay.isFullPTO) {
                text += `
                    <div style="text-align:center; font-size:14px;" title="PTO">🏝️</div>
                    <div style="color:var(--pto);"><b>${evalDay.ptoHrs.toFixed(2)}h</b> <span style="font-size:10px; opacity:0.75;">(${cleanPtoLabel})</span></div>
                `;
              }

              if (totalHrs > 0 && !evalDay.isIgnored) {
                text += `<div style="grid-column: 1 / -1; margin: 4px 0; border-top: 1px dashed var(--border);"></div>`;
                text += `
                    <div style="text-align:center; font-size:14px;" title="Total">📊</div>
                    <div style="color:${totalColor}; font-weight:700;">${totalHrs.toFixed(2)}h</div>
                `;
              } else if (evalDay.isFullPTO) {
                text += `<div style="grid-column: 1 / -1; color:var(--pto); font-weight:700; margin-top:4px;">🏝️ Full Day PTO</div>`;
              } else if (evalDay.status === "pending") {
                text += `<div style="grid-column: 1 / -1; color:var(--warn); font-weight: 600; margin-top:4px;">⌛ Pending</div>`;
              } else if (evalDay.isIgnored) {
                text += `<div style="grid-column: 1 / -1; color:var(--text-muted); font-weight: 600; margin-top:4px;">⚠️ Ignored Day</div>`;
              }

              text += `</div>`;

              if (evalDay.isSpoofed) {
                text += `<div style="color:var(--warn); font-size:10px; margin-top:8px; font-weight:600;">⚠️ Manual Override Active</div>`;
              }

              if (!gridTooltip) {
                gridTooltip = document.createElement("div");
                gridTooltip.id = "ikg-grid-tooltip";
                gridTooltip.style.cssText =
                  "position:absolute; background:var(--bg-elevated); color:var(--text-main); padding:10px 14px; border-radius:8px; font-size:12px; font-weight:500; border:1px solid var(--border); box-shadow:0 12px 28px rgba(0,0,0,0.6); pointer-events:none; opacity:0; transition:opacity 0.1s; z-index:100; white-space:nowrap; line-height:1.5; font-family:var(--font-family);";
                document.getElementById("ikg-chart-pane").appendChild(gridTooltip);
              }

              const paneRect = document
                .getElementById("ikg-chart-pane")
                .getBoundingClientRect();
              gridTooltip.innerHTML = text;
              gridTooltip.style.left = `${e.clientX - paneRect.left + 20}px`;
              gridTooltip.style.top = `${e.clientY - paneRect.top - 40}px`;
              gridTooltip.style.opacity = "1";
            } else {
              if (gridTooltip) gridTooltip.style.opacity = "0";
            }
          });

          heatmapGridEl.addEventListener("mouseleave", () => {
            if (gridTooltip) gridTooltip.style.opacity = "0";
          });
        }

        const dmOverlay = document.querySelector(".day-modal-overlay");
        // ==========================================
        // DAY MODAL & MANUAL OVERRIDE CONTROLLER
        // ==========================================
        const dmModal = document.getElementById("ikg-day-modal");
        let activeModalDate = null;
        let saveTimeout = null;

        const updateModalPreviewAndBadge = () => {
          if (!activeModalDate) return;
          const overrides = JSON.parse(localStorage.getItem(OVERRIDES_KEY) || "{}");
          const existingOv = overrides[activeModalDate];

          const badgeEl = document.getElementById("dm-override-badge");
          const removeBtn = document.getElementById("dm-btn-remove-override");
          const calcPreviewEl = document.getElementById("dm-calc-preview");

          const hasActiveOverride = !!(existingOv && (existingOv.manualIn || existingOv.manualOut || existingOv.isIgnored));

          if (hasActiveOverride) {
            badgeEl.innerText = "⚠️ OVERRIDDEN";
            badgeEl.style.background = "rgba(245,158,11,0.2)";
            badgeEl.style.color = "var(--warn)";
            badgeEl.style.border = "1px solid rgba(245,158,11,0.4)";
            badgeEl.style.display = "inline-block";
            removeBtn.style.display = "block";
          } else {
            badgeEl.innerText = "🤖 SYSTEM NATIVE";
            badgeEl.style.background = "var(--bg-elevated)";
            badgeEl.style.color = "var(--text-muted)";
            badgeEl.style.border = "1px solid var(--border)";
            badgeEl.style.display = "inline-block";
            removeBtn.style.display = "none";
          }

          // Live Duration Preview Calculation
          const manIn = document.getElementById("dm-manual-in").value;
          const manOut = document.getElementById("dm-manual-out").value;
          if (manIn && manOut) {
            const [y, m, d] = activeModalDate.split('-');
            const inD = new Date(y, parseInt(m, 10)-1, d, ...manIn.split(':'));
            const outD = new Date(y, parseInt(m, 10)-1, d, ...manOut.split(':'));
            const diffHrs = Math.max(0, (outD - inD) / 3600000);
            calcPreviewEl.innerText = `Override Duration: ${diffHrs.toFixed(2)}h`;
            calcPreviewEl.style.color = "var(--primary)";
          } else {
            calcPreviewEl.innerText = "";
          }
        };

        const handleAutoSave = () => {
          if (!activeModalDate) return;
          const manIn = document.getElementById("dm-manual-in").value;
          const manOut = document.getElementById("dm-manual-out").value;
          const isIgnored = document.getElementById("dm-ignore-toggle").checked;

          let overrides = JSON.parse(localStorage.getItem(OVERRIDES_KEY) || "{}");

          // 🔑 CLEAN UP: Only write override entry if manual times or ignore is active
          if (manIn || manOut || isIgnored) {
            overrides[activeModalDate] = {
              manualIn: manIn || null,
              manualOut: manOut || null,
              isIgnored: isIgnored,
            };
          } else {
            delete overrides[activeModalDate];
          }
          localStorage.setItem(OVERRIDES_KEY, JSON.stringify(overrides));

          const statusEl = document.getElementById("dm-save-status");
          if (statusEl) {
            statusEl.style.opacity = "1";
            clearTimeout(saveTimeout);
            saveTimeout = setTimeout(() => {
              statusEl.style.opacity = "0";
            }, 1200);
          }

          updateModalPreviewAndBadge();

          const cache = JSON.parse(localStorage.getItem(CACHE_KEY) || "{}");
          renderCalendar();
          if (activeTab === "stats") renderAnalytics(cache);
          if (activeTab === "audit") renderAudit(cache);
        };

        // Remove Override Button Listener
        document.getElementById("dm-btn-remove-override").addEventListener("click", () => {
          if (!activeModalDate) return;
          let overrides = JSON.parse(localStorage.getItem(OVERRIDES_KEY) || "{}");
          delete overrides[activeModalDate];
          localStorage.setItem(OVERRIDES_KEY, JSON.stringify(overrides));

          document.getElementById("dm-manual-in").value = "";
          document.getElementById("dm-manual-out").value = "";
          document.getElementById("dm-ignore-toggle").checked = false;

          IkgLog.info(`🗑️ Removed manual override for ${activeModalDate}`);
          updateModalPreviewAndBadge();

          const cache = JSON.parse(localStorage.getItem(CACHE_KEY) || "{}");
          renderCalendar();
          if (activeTab === "stats") renderAnalytics(cache);
          if (activeTab === "audit") renderAudit(cache);
        });

        const inputIn = document.getElementById("dm-manual-in");
        const inputOut = document.getElementById("dm-manual-out");
        const ignoreToggle = document.getElementById("dm-ignore-toggle");

        if (inputIn) inputIn.addEventListener("input", handleAutoSave);
        if (inputOut) inputOut.addEventListener("input", handleAutoSave);
        if (ignoreToggle) ignoreToggle.addEventListener("change", handleAutoSave);

        const calGrid = document.getElementById("ikg-cal-grid");
        if (calGrid) {
          calGrid.addEventListener("click", (e) => {
            const dayEl = e.target.closest(".ikg-day:not(.empty)");
            if (dayEl) {
              activeModalDate = dayEl.getAttribute("data-date");
              const titleDateSpan = document.getElementById("dm-date-label");
              if (titleDateSpan) titleDateSpan.innerText = activeModalDate;

              const overrides = JSON.parse(localStorage.getItem(OVERRIDES_KEY) || "{}");
              const localCache = JSON.parse(localStorage.getItem(CACHE_KEY) || "{}");
              const record = localCache[activeModalDate];

              const toTimeInputStr = (ms) => {
                if (!ms) return "";
                const d = new Date(ms);
                const pad = (n) => String(n).padStart(2, "0");
                return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
              };

              if (inputIn)
                inputIn.value =
                  overrides[activeModalDate]?.manualIn ||
                  (record?.startTime ? toTimeInputStr(record.startTime) : "");
              if (inputOut)
                inputOut.value =
                  overrides[activeModalDate]?.manualOut ||
                  (record?.endTime ? toTimeInputStr(record.endTime) : "");

              if (ignoreToggle)
                ignoreToggle.checked = !!overrides[activeModalDate]?.isIgnored;

              updateModalPreviewAndBadge();

              if (dmModal) dmModal.classList.add("open");
            }
          });
        }

        const closeBtn = document.getElementById("dm-close-btn");
        if (closeBtn) {
          closeBtn.addEventListener("click", () => {
            if (dmModal) dmModal.classList.remove("open");
          });
        }

        document.addEventListener("click", (e) => {
          if (dmModal && dmModal.classList.contains("open")) {
            if (
              !dmModal.contains(e.target) &&
              !e.target.closest(".ikg-day") &&
              !e.target.closest(".ikg-heat-sq")
            ) {
              dmModal.classList.remove("open");
            }
          }
        });

        document.querySelectorAll(".view-toggle").forEach((btn) => {
          btn.addEventListener("click", (e) => {
            document
              .querySelectorAll(".view-toggle")
              .forEach((b) => b.classList.remove("active"));
            e.target.classList.add("active");
            currentAnalyticsView = e.target.getAttribute("data-view");
            renderAnalytics(JSON.parse(localStorage.getItem(CACHE_KEY) || "{}"));
          });
        });

        const overrideCheckbox = document.getElementById("set-use-overrides");
        if (overrideCheckbox) {
          overrideCheckbox.checked = getSettings().useManualOverrides;
          overrideCheckbox.addEventListener("change", (e) => {
            const s = getSettings();
            s.useManualOverrides = e.target.checked;
            localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
            renderCalendar();
          });
        }

        dmOverlay.addEventListener("click", () => {
          dmOverlay.classList.remove("open");
          dmModal.classList.remove("open");
        });

        let tempMp3Data = null;
        let tempMp3Name = "";
        let tempImgData = null;
        let tempImgName = "";

        const autoSaveSettings = async () => {
          const settings = getSettings();
          settings.soundType = document.getElementById("set-sound").value;
          settings.snoozeMins =
            parseFloat(document.getElementById("set-snooze").value) || 5;
          settings.snoozeUnit = document.getElementById("set-snooze-unit").value;
          settings.triggerUnit = document.getElementById("set-trigger-unit").value;
          settings.useFlexDef = document.getElementById("set-use-flex").checked;
          settings.showSeconds = document.getElementById("set-show-secs").checked;
          settings.autoSetAlarm = document.getElementById("set-auto-alarm").checked;
          settings.manualShift = document.getElementById("set-manual-shift").value;
          settings.alarmImgType = document.getElementById("set-img-type").value;
          settings.pulseSpeed =
            parseFloat(document.getElementById("set-pulse-speed").value) || 0;

          const overrideCheckbox = document.getElementById("set-use-overrides");
          if (overrideCheckbox)
            settings.useManualOverrides = overrideCheckbox.checked;

          const wfhCheckbox = document.getElementById("set-include-wfh");
          if (wfhCheckbox)
            settings.includeWfhInHours = wfhCheckbox.checked;

          const syncDaysEl = document.getElementById("set-sync-days");
          if (syncDaysEl) settings.syncDays = parseInt(syncDaysEl.value, 10) || 7;

          const volVal = parseFloat(document.getElementById("set-volume").value);
          settings.volume = isNaN(volVal) ? 0.8 : volVal;

          const triggersStr = document.getElementById("set-triggers").value;
          settings.triggers = triggersStr
            .split(",")
            .map((s) => parseFloat(s.trim()))
            .filter((n) => !isNaN(n))
            .sort((a, b) => a - b);
          if (settings.triggers.length === 0) settings.triggers = [0];

          if (settings.soundType === "custom" && tempMp3Data) {
            await IKG_DB.save("custom_alarm_mp3", tempMp3Data);
            settings.mp3Name = tempMp3Name;
          }
          if (settings.alarmImgType === "custom" && tempImgData) {
            await IKG_DB.save("custom_alarm_img", tempImgData);
            settings.alarmImgName = tempImgName;
          }

          localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
          IkgLog.info("Auto-saved Settings", settings);
          renderCalendar();
          updateHeaderStatus("✅ Settings Saved", "var(--success)");
          setTimeout(() => updateHeaderStatus("✅ Synced", "var(--success)"), 2000);
        };

        [
          "set-sound",
          "set-img-type",
          "set-pulse-speed",
          "set-snooze",
          "set-snooze-unit",
          "set-trigger-unit",
          "set-use-flex",
          "set-show-secs",
          "set-include-wfh",
          "set-auto-alarm",
          "set-manual-shift",
          "set-volume",
          "set-use-overrides",
          "set-sync-days",
        ].forEach((id) => {
          const el = document.getElementById(id);
          if (el) el.addEventListener("change", autoSaveSettings);
        });

        document.getElementById("set-volume").addEventListener("input", (e) => {
          const val = parseFloat(e.target.value);
          document.getElementById("set-volume-val").innerText =
            `${Math.round(val * 100)}%`;
          if (AudioEngine.isPlaying && AudioEngine.audioEl) {
            AudioEngine.audioEl.volume = val;
          }
        });

        document.getElementById("set-sound").addEventListener("change", (e) => {
          const wrap = document.getElementById("set-upload-wrap");
          if (e.target.value === "custom") wrap.classList.add("visible");
          else wrap.classList.remove("visible");
        });

        document
          .getElementById("set-img-type")
          .addEventListener("change", async (e) => {
            const wrap = document.getElementById("set-img-upload-wrap");
            const preview = document.getElementById("set-img-preview");
            if (e.target.value === "custom") {
              wrap.classList.add("visible");
              if (tempImgData) preview.src = tempImgData;
              else {
                const savedImg = await IKG_DB.get("custom_alarm_img");
                preview.src =
                  savedImg || "https://attendance.iki-utl.cc/favicon.png";
              }
            } else {
              wrap.classList.remove("visible");
              preview.src = DEFAULT_GIF_URL;
            }
          });

        document
          .getElementById("set-file-input")
          .addEventListener("change", (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (ev) => {
              tempMp3Data = ev.target.result;
              tempMp3Name = file.name;
              document.getElementById("set-file-name").innerText =
                `Selected: ${file.name}`;
              autoSaveSettings();
            };
            reader.readAsDataURL(file);
          });

        document.getElementById("set-img-input").addEventListener("change", (e) => {
          const file = e.target.files[0];
          if (!file) return;
          const reader = new FileReader();
          reader.onload = (ev) => {
            tempImgData = ev.target.result;
            tempImgName = file.name;
            document.getElementById("set-img-name").innerText =
              `Selected: ${file.name}`;
            document.getElementById("set-img-preview").src = tempImgData;
            autoSaveSettings();
          };
          reader.readAsDataURL(file);
        });

        let isPreviewing = false;
        document
          .getElementById("ikg-btn-preview")
          .addEventListener("click", async (e) => {
            const btn = e.target;
            if (isPreviewing) {
              AudioEngine.stop();
              isPreviewing = false;
              btn.innerText = "▶️ Play";
              btn.style.borderColor = "var(--primary)";
              btn.style.color = "var(--primary)";
            } else {
              const type = document.getElementById("set-sound").value;
              if (type === "custom" && tempMp3Data) {
                AudioEngine.stop();
                AudioEngine.isPlaying = true;
                AudioEngine.audioEl = new Audio(tempMp3Data);
                AudioEngine.audioEl
                  .play()
                  .catch((e) => IkgLog.error("Preview failed", e));
              } else {
                await AudioEngine.play(type);
              }
              isPreviewing = true;
              btn.innerText = "⏹️ Stop";
              btn.style.borderColor = "var(--danger)";
              btn.style.color = "var(--danger)";
            }
          });

        let hasAutoSynced = false;

        setInterval(() => {
          const fetchBtn = document.getElementById("ikg-btn-fetch");
          if (authToken && fetchBtn && fetchBtn.disabled && !isFetchingData) {
            fetchBtn.disabled = false;
            if (!hasAutoSynced) {
              hasAutoSynced = true;
              IkgLog.info(
                "Initial Page Load detected. Auto-triggering full data sync...",
              );
              fetchBtn.click();
            }
          }
        }, 500);

  // ==========================================
  // 2. UNIVERSAL SMART CATCH-UP SYNC LISTENER
  // ==========================================
  document
    .getElementById("ikg-btn-fetch")
    .addEventListener("click", async (e) => {
      IkgLog.info("Sync Triggered via Progressive Catch-Up Protocol.");
      const btn = document.getElementById("ikg-btn-fetch");
      btn.disabled = true;
      isFetchingData = true;

      const isForceRescan = e && e.shiftKey;

      const syncStatus = { aws: "⏳", wfh: "⏳", deel: "⏳" };
      const updateSyncProgressUI = () => {
        updateHeaderStatus(
          `⚡ Syncing: AWS ${syncStatus.aws} | WFH ${syncStatus.wfh} | Deel ${syncStatus.deel}`,
          "var(--primary)"
        );
      };

      const triggerUIRefresh = () => {
        renderCalendar();
        if (activeTab === "stats") renderAnalytics(localCache);
        if (activeTab === "audit") renderAudit(localCache);
      };

      try {
        let localCache = JSON.parse(localStorage.getItem(CACHE_KEY) || "{}");
        let dayNotes = JSON.parse(localStorage.getItem(DAY_NOTES_KEY) || "{}");

        const todayReal = new Date();
        const todayStr = toYMD(todayReal);
        const tomorrowReal = new Date(todayReal);
        tomorrowReal.setDate(tomorrowReal.getDate() + 1);

        // 🎯 UNIVERSAL CATCH-UP TIME TRACKER
        const LAST_SYNC_KEY = `IKG_LAST_UNIVERSAL_SYNC_TIME_${APP_VER}`;
        const lastSyncMs = parseInt(localStorage.getItem(LAST_SYNC_KEY) || "0", 10);
        const nowMs = Date.now();
        const daysGap = lastSyncMs > 0 ? Math.ceil((nowMs - lastSyncMs) / (1000 * 60 * 60 * 24)) : 30;

        const settings = getSettings();
        const dynamicSyncDays = Math.max(settings.syncDays || 7, daysGap + 2);

        if (isForceRescan) {
          IkgLog.warn("⚡ SHIFT-CLICK DETECTED: Clearing WFH cache flags.");
          Object.keys(localCache).forEach((k) => {
            if (localCache[k]) delete localCache[k].gasSynced;
          });
        }

        const MAX_AWS_TTL_DATE = new Date(todayReal.getTime() - 90 * 86400000);
        const MAX_AWS_TTL_STR = toYMD(MAX_AWS_TTL_DATE);

        // =========================================================================
        // 🎯 TASK 1: AWS Attendance Sync (Preserves WFH / PTO on re-render)
        // =========================================================================
        const runAttendanceSync = async () => {
          syncStatus.aws = "🔄";
          updateSyncProgressUI();

          let iterDate = new Date(todayReal);
          let wDaysCount = 0;
          while (wDaysCount < dynamicSyncDays) {
            iterDate.setDate(iterDate.getDate() - 1);
            if (iterDate.getDay() !== 0 && iterDate.getDay() !== 6) wDaysCount++;
          }
          let startXStr = toYMD(iterDate);
          if (startXStr < MAX_AWS_TTL_STR) startXStr = MAX_AWS_TTL_STR;

          const fetchTasks = [
            window
              .fetch(`${API_BASE}/attendance/range?from=${startXStr}&to=${toYMD(tomorrowReal)}`, {
                method: "GET",
                headers: { accept: "*/*", authorization: authToken },
              })
              .then((res) => { if (res.status === 401) handle401Recovery(); return res.json(); })
              .then((data) => fillCacheGaps(startXStr, todayStr, data.records || [], localCache))
              .catch(() => {}),
          ];

          await Promise.all(fetchTasks);

          sessionStorage.removeItem("IKG_RELOAD_ATTEMPTS");
          // Persist preserved cache before re-rendering UI
          localStorage.setItem(CACHE_KEY, JSON.stringify(localCache));
          
          syncStatus.aws = "✅";
          updateSyncProgressUI();
          triggerUIRefresh(); // 🎨 Immediate UI update without losing WFH/PTO
        };

        // =========================================================================
        // 🎯 TASK 2: Deel PTO Sync
        // =========================================================================
        const runDeelSync = async () => {
          syncStatus.deel = "🔄";
          updateSyncProgressUI();

          await fetchAndParseDeelPTO();

          // Refresh local dayNotes reference
          dayNotes = JSON.parse(localStorage.getItem(DAY_NOTES_KEY) || "{}");

          syncStatus.deel = "✅";
          updateSyncProgressUI();
          triggerUIRefresh(); // 🎨 Immediate UI update with PTO pills
        };

        // =========================================================================
        // 🎯 TASK 3: Targeted WFH Sync (Fixed 12h/24h Time Parser for Sept 23)
        // =========================================================================
        let gasFoundCount = 0;
        const runWfhSync = async () => {
          syncStatus.wfh = "🔄";
          updateSyncProgressUI();

          const gasData = await ensureGasToken();
          if (!gasData || !gasData.token) {
            syncStatus.wfh = "⚠️";
            updateSyncProgressUI();
            return;
          }

          localCache = JSON.parse(localStorage.getItem(CACHE_KEY) || "{}");
          dayNotes = JSON.parse(localStorage.getItem(DAY_NOTES_KEY) || "{}");

          const datesToCheck = [];

          const getWednesday = (d) => {
            const date = new Date(d);
            const day = date.getDay();
            const diff = date.getDate() - day + (day === 0 ? -4 : 3);
            return new Date(date.setDate(diff));
          };

          const currentWed = getWednesday(todayReal);
          if (currentWed <= todayReal) datesToCheck.push(toYMD(currentWed));
          
          const lastWed = new Date(currentWed);
          lastWed.setDate(lastWed.getDate() - 7);
          datesToCheck.push(toYMD(lastWed));

          const viewMonthPrefix = `${currentViewYear}-${String(currentViewMonth).padStart(2, "0")}`;
          const daysInViewMonth = new Date(currentViewYear, currentViewMonth, 0).getDate();
          const holidays = JSON.parse(localStorage.getItem(`IKG_HOLIDAYS_${currentViewYear}`) || "{}");

          for (let i = 1; i <= daysInViewMonth; i++) {
            const dStr = `${viewMonthPrefix}-${String(i).padStart(2, "0")}`;
            if (dStr > todayStr) break;

            const dObj = new Date(currentViewYear, currentViewMonth - 1, i);
            const dayOfWeek = dObj.getDay();

            if (dayOfWeek !== 0 && dayOfWeek !== 6 && !holidays[dStr]) {
              const record = localCache[dStr] || {};
              const note = dayNotes[dStr] || {};

              const hasIn = !!record.startTime;
              const hasOut = !!record.endTime;
              const actualHrs = parseFloat(record.workHours) || 0;
              const ptoHrs = parseFloat(note.deductedHours) || 0;
              const isFullPTO = !!(note.isPTO) || ptoHrs >= 8.0;

              const targetHrs = calculateDailyTarget(ptoHrs, note.type || '', isFullPTO);

              const isIncomplete = (hasIn && !hasOut) || (!hasIn && hasOut);
              const isShort = targetHrs > 0 && (actualHrs + ptoHrs) < targetHrs;

              if ((isIncomplete || isShort || !record.gasSynced) || isForceRescan) {
                datesToCheck.push(dStr);
              }
            }
          }

          const uniqueDates = [...new Set(datesToCheck)].sort().reverse().slice(0, 7);

          if (uniqueDates.length === 0) {
            syncStatus.wfh = "✅";
            updateSyncProgressUI();
            return;
          }

          IkgLog.info(`⚡ Targeted WFH Sync: Querying ${uniqueDates.length} dates:`, uniqueDates);

          let completedCount = 0;

          // 🎯 Helper: Parses "11:36" or "19:36" into proper PM Epoch MS
          const parsePmsTime = (dateStr, timeStr, isClockOut = false) => {
            if (!timeStr) return null;
            const [y, m, d] = dateStr.split('-');
            const parts = timeStr.split(':');
            let hrs = parseInt(parts[0], 10);
            const mins = parseInt(parts[1], 10) || 0;
            const secs = parseInt(parts[2], 10) || 0;

            // If it's a clock out and hours < 12 (e.g. 11:36 or 07:36), convert to 24h PM time
            if (isClockOut && hrs < 12 && hrs >= 1) {
              hrs += 12;
            }

            return new Date(y, parseInt(m, 10) - 1, d, hrs, mins, secs).getTime();
          };

          for (const dStr of uniqueDates) {
            try {
              const gasRecords = await fetchGasRecords(dStr, gasData);
              if (!localCache[dStr]) localCache[dStr] = {};
              localCache[dStr].gasSynced = true;

              if (gasRecords && gasRecords.length > 0) {
                let cIn = null, cOut = null;
                gasRecords.forEach((r) => {
                  if (r.type === "Clock In") { if (!cIn || r.time < cIn) cIn = r.time; } 
                  else if (r.type === "Clock Out") { if (!cOut || r.time > cOut) cOut = r.time; }
                });

                if (cIn || cOut) {
                  const newStartMs = parsePmsTime(dStr, cIn, false);
                  const newEndMs = parsePmsTime(dStr, cOut, true); // Enforces 19:36 PM conversion

                  const existingRecord = localCache[dStr] || {};
                  const existingStartMs = existingRecord.startTime ? new Date(existingRecord.startTime).getTime() : null;
                  const existingEndMs = existingRecord.endTime ? new Date(existingRecord.endTime).getTime() : null;

                  const prevStartStr = existingStartMs ? formatTime(existingStartMs) : null;
                  const prevEndStr = existingEndMs ? formatTime(existingEndMs) : null;

                  if (newStartMs) {
                    if (!existingStartMs || newStartMs < existingStartMs) {
                      localCache[dStr].startTime = newStartMs;
                    }
                  } else if (existingStartMs) {
                    localCache[dStr].startTime = existingStartMs;
                  }

                  if (newEndMs) {
                    if (!existingEndMs || newEndMs > existingEndMs || isForceRescan) {
                      localCache[dStr].endTime = newEndMs;
                    }
                  } else if (existingEndMs) {
                    localCache[dStr].endTime = existingEndMs;
                  }

                  const finalStartMs = localCache[dStr].startTime ? new Date(localCache[dStr].startTime).getTime() : null;
                  const finalEndMs = localCache[dStr].endTime ? new Date(localCache[dStr].endTime).getTime() : null;

                  if (finalStartMs && finalEndMs) {
                    localCache[dStr].workHours = safeFloat((finalEndMs - finalStartMs) / 3600000);
                  }

                  localCache[dStr].isWFH = true;

                  const finalStartStr = finalStartMs ? formatTime(finalStartMs) : null;
                  const finalEndStr = finalEndMs ? formatTime(finalEndMs) : null;

                  const isStartDiff = prevStartStr !== finalStartStr;
                  const isEndDiff = prevEndStr !== finalEndStr;
                  const wasNewlyTaggedWFH = !existingRecord.isWFH;

                  const isTrulyUpdated = (isStartDiff || isEndDiff || wasNewlyTaggedWFH) && !isForceRescan;

                  if (isTrulyUpdated) {
                    if (!window.ikgUpdatedDates) window.ikgUpdatedDates = new Set();
                    window.ikgUpdatedDates.add(dStr);
                    gasFoundCount++;
                    IkgLog.info(`✨ WFH RECORD CHANGED [${dStr}]: IN ${finalStartStr || '--'} | OUT ${finalEndStr || '--'} (${localCache[dStr].workHours}h)`);
                  } else {
                    IkgLog.debug(`🏠 WFH Merged [${dStr}]: IN ${finalStartStr || '--'} | OUT ${finalEndStr || '--'} (${localCache[dStr].workHours}h)`);
                  }
                }
              } else {
                if (!localCache[dStr].startTime && !localCache[dStr].endTime) {
                  localCache[dStr].isWFH = false;
                }
              }
            } catch (e) {
              IkgLog.error(`Error fetching WFH for ${dStr}:`, e);
            } finally {
              completedCount++;
              syncStatus.wfh = `(${completedCount}/${uniqueDates.length})`;
              updateSyncProgressUI();
            }
          }

          localStorage.setItem(CACHE_KEY, JSON.stringify(localCache));
          syncStatus.wfh = "✅";
          updateSyncProgressUI();
          triggerUIRefresh();
        };

        updateSyncProgressUI();

        // 🎯 STEP 1: AWS & Deel PTO run in parallel, rendering UI as each finishes
        await Promise.all([runAttendanceSync(), runDeelSync()]);

        // 🎯 STEP 2: WFH runs with full cache & PTO awareness
        await runWfhSync();

        localStorage.setItem(LAST_SYNC_KEY, nowMs.toString());

        // 🎯 STEP 3: Handle Active Visibility Glow Clear
        const glowCount = window.ikgUpdatedDates ? window.ikgUpdatedDates.size : 0;
        if (glowCount > 0) {
          updateHeaderStatus(`✨ ${glowCount} Days Updated!`, "var(--primary)");
          
          // Trigger initial render so the glow appears
          triggerUIRefresh();

          // Start active view accumulator (only counts while tab is visible)
          ActiveGlowTracker.start(() => {
            if (window.ikgUpdatedDates) window.ikgUpdatedDates.clear();
            triggerUIRefresh();
            updateHeaderStatus("✅ Synced", "var(--success)");
            IkgLog.info("✨ Active 8-second viewing duration completed. Glow cleared.");
          });
        } else {
          updateHeaderStatus("✅ Synced", "var(--success)");
        }

      } catch (err) {
        IkgLog.error("Critical Sync Error", err);
        updateHeaderStatus("❌ Sync Error", "var(--danger)");
      } finally {
        btn.disabled = false;
        isFetchingData = false;
      }
    });
      }

      if (document.readyState === "loading")
        document.addEventListener("DOMContentLoaded", buildUI);
      else buildUI();
    })();
