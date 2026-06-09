    // ==UserScript==
    // @name         [7.92] IKG Attendance Pro (Autopilot & Alarms)
    // @namespace    http://tampermonkey.net/
    // @version      7.92
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
    // @connect      gist.github.com
    // @connect      gist.githubusercontent.com
    // @connect      github.com
    // @connect      ikg.deel.team
    // @run-at       document-start
    // ==/UserScript==

    (function () {
        'use strict';

        // ==========================================
        // 0. STRUCTURED TELEMETRY ENGINE
        // ==========================================
        const IkgLog = {
            formatTime: () => {
                const d = new Date();
                const pad = (n, len = 2) => String(n).padStart(len, '0');
                return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
            },
            _log: (level, msg, data) => {
                const prefix = `%c[IKG] [${IkgLog.formatTime()}] [${level.padEnd(5)}]`;
                let color = 'color: #94A3B8;';
                if (level === 'INFO') color = 'color: #3B82F6; font-weight: bold;';
                if (level === 'DEBUG') color = 'color: #10B981;';
                if (level === 'WARN') color = 'color: #F59E0B; font-weight: bold;';
                if (level === 'ERROR') color = 'color: #EF4444; font-weight: bold;';

                if (data !== undefined) console.log(`${prefix} ${msg}`, color, data);
                else console.log(`${prefix} ${msg}`, color);
            },
            info: (msg, data) => IkgLog._log('INFO', msg, data),
            debug: (msg, data) => IkgLog._log('DEBUG', msg, data),
            warn: (msg, data) => IkgLog._log('WARN', msg, data),
            error: (msg, data) => IkgLog._log('ERROR', msg, data)
        };

        IkgLog.info("Attendance Pro Script Initialized v38.16 (CSP Worker Bypass)");

        // ==========================================
        // 1. GOOGLE SSO AUTOPILOT (Bypasses Worker CSP)
        // ==========================================
        if (location.hostname === 'accounts.google.com') {
            const lastSSOClick = GM_getValue('IKG_SSO_TRIGGERED', 0);

            // 🛡️ SECURITY: Only run if the Attendance portal triggered this within the last 60 seconds
            if (Date.now() - lastSSOClick > 60000) {
                return; // Exit silently. Let the user use their normal Google accounts elsewhere.
            }

            IkgLog.info("Attendance-triggered SSO detected. Engaging Autopilot.");
            const attemptSSOClick = () => {
                const targetEmail = document.querySelector('[data-email$="@ikigai.team"]');
                if (targetEmail) {
                    const clickable = targetEmail.closest('[role="link"]');
                    if (clickable) {
                        IkgLog.debug("Target email found. Simulatin' click.");
                        GM_setValue('IKG_SSO_TRIGGERED', 0); // Clear the flag instantly
                        clickable.click();
                        return true;
                    }
                }
                return false;
            };

            const initGoogleAutopilot = () => {
                if (attemptSSOClick()) return;
                IkgLog.debug("Attaching SSO Observer.");
                const obs = new MutationObserver(() => { if (attemptSSOClick()) { obs.disconnect(); } });
                obs.observe(document.body, { childList: true, subtree: true });
            };

            if (document.body) initGoogleAutopilot();
            else document.addEventListener('DOMContentLoaded', initGoogleAutopilot);

            return; // <-- CRITICAL: Stops execution here so the Worker isn't created on Google's domain.
        }

        // ==========================================
        // 1.5 DEEL PTO TOKEN SNATCHER (Cross-Tab Bridge)
        // ==========================================
        if (location.hostname === 'ikg.deel.team') {
            IkgLog.info("Deel Domain Detected. Hunting for Auth Token...");
            let hasClickedDeelLogin = false;

            // 🎯 Helper: Safely checks and sends the token if valid
            const checkAndSendToken = () => {
                const token = localStorage.getItem('token') || sessionStorage.getItem('token');
                if (token) {
                    try {
                        const payload = JSON.parse(atob(token.split('.')[1]));
                        if (payload.exp && (payload.exp * 1000 < Date.now())) {
                            return false; // Token is expired, wait for Deel to refresh it
                        }
                    } catch (e) { /* Not a standard JWT, proceed anyway */ }

                    GM_setValue('IKG_DEEL_TOKEN', token);
                    IkgLog.info("✅ FRESH Deel Token secured. Handing back to Attendance App...");
                    setTimeout(() => { window.close(); }, 500); 
                    return true;
                }
                return false;
            };

            // 🎯 Helper: Hunts for the login button
            const attemptDeelLogin = () => {
                if (hasClickedDeelLogin) return false;
                const elements = Array.from(document.querySelectorAll('span, button, a'));
                
                const loginBtn = elements.find(el => el.innerText && (el.innerText.includes('IKG Google Workspace') || el.innerText.includes('Log in with IKG')));
                
                if (loginBtn && loginBtn.offsetParent !== null) {
                    hasClickedDeelLogin = true;
                    IkgLog.info("Deel login button found. Engaging Autopilot and waiting for Google...");
                    GM_setValue('IKG_SSO_TRIGGERED', Date.now()); // Grant VIP pass for Google SSO
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
                document.addEventListener('DOMContentLoaded', () => {
                    deelObserver.observe(document.body, { childList: true, subtree: true });
                });
            }

            // 3. Fallback: Listen for native storage changes (Instantly catches token generation)
            window.addEventListener('storage', (e) => {
                if (e.key === 'token') {
                    if (checkAndSendToken()) deelObserver.disconnect();
                }
            });

            return; // CRITICAL: Stop the rest of the Attendance script from rendering on Deel
        }

        // ==========================================
        // ==========================================
        // 1.8 LIGHTWEIGHT BACKGROUND WATCHDOG
        // ==========================================
        let authToken = null;
        let autopilotEnabled = true;

        // Bypasses browser tab-sleeping to check if session died
        const watchdogBlob = new Blob([`
            setInterval(() => postMessage('tick'), 10000);
        `], { type: 'application/javascript' });
        const watchdog = new Worker(URL.createObjectURL(watchdogBlob));

        watchdog.onmessage = () => {
            const buttons = Array.from(document.querySelectorAll('button'));
            const loginBtn = buttons.find(b => (b.innerText || '').toUpperCase().includes('SIGN IN WITH GOOGLE'));

            if (loginBtn && loginBtn.offsetParent !== null) {
                if (!autopilotEnabled) IkgLog.warn("Session death detected. Re-engaging autopilot.");
                autopilotEnabled = true;
                authToken = null;

                // 🎟️ Create the 60-second VIP Pass
                GM_setValue('IKG_SSO_TRIGGERED', Date.now());
                loginBtn.click();
            }
        };

        // ==========================================
        // 2. DYNAMIC DEPENDENCIES
        // ==========================================
        const triggerConfetti = () => {
            IkgLog.info("Triggering Goal Met Confetti!");
            if (document.getElementById('ikg-confetti-script')) {
                const runScript = document.createElement('script');
                runScript.textContent = `if(typeof confetti === 'function') confetti({ particleCount: 150, spread: 80, origin: { y: 0.6 }, zIndex: 100000 });`;
                document.body.appendChild(runScript);
                setTimeout(() => runScript.remove(), 1000);
                return;
            }
            const script = document.createElement('script');
            script.id = 'ikg-confetti-script';
            script.src = 'https://cdn.jsdelivr.net/npm/canvas-confetti@1.6.0/dist/confetti.browser.min.js';
            script.onload = () => {
                const runScript = document.createElement('script');
                runScript.textContent = `if(typeof confetti === 'function') confetti({ particleCount: 150, spread: 80, origin: { y: 0.6 }, zIndex: 100000 });`;
                document.body.appendChild(runScript);
                setTimeout(() => runScript.remove(), 1000);
            };
            document.head.appendChild(script);
        };

        // ==========================================
        // 3. UPDATED AUDIO & VISUAL ENGINE
        // ==========================================
        const APP_VER = 'V9';
        const DEFAULT_GIF_URL = "https://gist.github.com/ikigai-jonas-n/7b0a0efcec645ab87ab73c0b3b038d0e/raw/dd23f7a3baa0c680e1b4e92abd18cbb6bf5c3397/bubu-dudu-sseeyall.gif";

        const PRO_TRACKS = [
            { id: 'pro_fkj', name: 'FKJ - Just Piano', url: "https://gist.github.com/ikigai-jonas-n/7b0a0efcec645ab87ab73c0b3b038d0e/raw/a050f5fbccdec4c213d0f6f0fa9551777e673a38/FKJ%2520-%2520Just%2520Piano%2520(In%2520partnership%2520with%2520Calm).m4a", ver: "1.1" },
            { id: 'pro_misch', name: 'Tom Misch - It Runs Through Me', url: "https://gist.github.com/ikigai-jonas-n/7b0a0efcec645ab87ab73c0b3b038d0e/raw/acbaabc5cc49f1f812b863d270b432113c71f92c/Tom%2520Misch%2520-%2520It%2520Runs%2520Through%2520Me.m4a", ver: "1.0" }
        ];

        const IKG_DB = {
            dbName: 'IKG_Audio_DB',
            init: function () {
                return new Promise((resolve, reject) => {
                    const req = indexedDB.open(this.dbName, 1);
                    req.onupgradeneeded = e => { e.target.result.createObjectStore('files'); };
                    req.onsuccess = e => resolve(e.target.result);
                    req.onerror = e => reject(e);
                });
            },
            save: async function (key, data) {
                const db = await this.init();
                return new Promise((resolve, reject) => {
                    const tx = db.transaction('files', 'readwrite');
                    tx.objectStore('files').put(data, key);
                    tx.oncomplete = resolve; tx.onerror = reject;
                });
            },
            get: async function (key) {
                const db = await this.init();
                return new Promise((resolve, reject) => {
                    const tx = db.transaction('files', 'readonly');
                    const req = tx.objectStore('files').get(key);
                    req.onsuccess = e => resolve(e.target.result);
                    req.onerror = reject;
                });
            },
            ensureAssets: async function () {
                // ONLY download audio tracks. The browser will handle the GIF natively.
                for (const track of PRO_TRACKS) {
                    const cachedVer = await this.get(`ver_${track.id}`);
                    const cachedAudio = await this.get(`data_${track.id}`);
                    if (cachedAudio && cachedVer === track.ver) continue;
                    this.downloadAsset(track.url, `data_${track.id}`, `ver_${track.id}`, track.ver, track.name);
                }
            },

            downloadAsset: function (url, dataKey, verKey, verVal, name) {
                IkgLog.info(`📥 Downloading Asset: ${name}...`);
                GM_xmlhttpRequest({
                    method: "GET", url: url, responseType: "blob",
                    onload: (res) => {
                        if (res.status !== 200) return;
                        const reader = new FileReader();
                        reader.onloadend = async () => {
                            await this.save(dataKey, reader.result);
                            await this.save(verKey, verVal);
                            IkgLog.info(`✅ ${name} cached.`);
                        };
                        reader.readAsDataURL(res.response);
                    }
                });
            }
        };

        // Trigger download check immediately on script start
        IKG_DB.ensureAssets();

        const SETTINGS_KEY = `IKG_APP_SETTINGS_${APP_VER}`;

        // Graceful migration so you don't lose your previous alarm settings!
        if (!localStorage.getItem(SETTINGS_KEY) && localStorage.getItem('IKG_APP_SETTINGS_V5')) {
            localStorage.setItem(SETTINGS_KEY, localStorage.getItem('IKG_APP_SETTINGS_V5'));
            localStorage.removeItem('IKG_APP_SETTINGS_V5'); // <-- Immediately burn the old key
        }

        const OVERRIDES_KEY = `IKG_MANUAL_OVERRIDES_${APP_VER}`;

        const getSettings = () => {
            const def = {
                soundType: 'pro_fkj', mp3Name: '', snoozeMins: 5, useFlexDef: false,
                triggers: [-0.5, 0], triggerUnit: 'm', snoozeUnit: 'm',
                showSeconds: true, autoSetAlarm: true, manualShift: 'auto',
                alarmImgType: 'default', alarmImgName: '', pulseSpeed: 4.0, volume: 0.8,
                useManualOverrides: true // NEW: Enables the Source of Truth toggle
            };
            try { return { ...def, ...JSON.parse(localStorage.getItem(SETTINGS_KEY)) }; } catch (e) { return def; }
        };
        
        // NEW: Analytics View State
        let currentAnalyticsView = 'CHART';

        const AudioEngine = {
            ctx: null, audioEl: null, activeOscillators: [], isPlaying: false, timeoutId: null,
            initCtx: function () {
                if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)();
                if (this.ctx.state === 'suspended') this.ctx.resume();
            },
            playTone: function (freq, type, startTime, duration, baseVol = 0.5) {
                const settings = getSettings();
                const vol = baseVol * (settings.volume !== undefined ? settings.volume : 0.8);
                const osc = this.ctx.createOscillator(); const gain = this.ctx.createGain();
                osc.type = type; osc.frequency.value = freq; osc.connect(gain); gain.connect(this.ctx.destination);
                gain.gain.setValueAtTime(0, startTime); gain.gain.linearRampToValueAtTime(vol, startTime + 0.05);
                gain.gain.setValueAtTime(vol, startTime + duration - 0.1); gain.gain.linearRampToValueAtTime(0, startTime + duration);
                osc.start(startTime); osc.stop(startTime + duration); this.activeOscillators.push(osc);
            },
            play: async function (overrideType = null) {
                this.stop();
                this.isPlaying = true;
                const settings = getSettings();
                const typeToPlay = overrideType || settings.soundType;

                if (typeToPlay.startsWith('pro_') || typeToPlay === 'custom') {
                    const key = (typeToPlay === 'custom') ? 'custom_alarm_mp3' : `data_${typeToPlay}`;
                    const mp3Data = await IKG_DB.get(key);

                    if (mp3Data) {
                        this.audioEl = new Audio(mp3Data);
                        this.audioEl.volume = settings.volume !== undefined ? settings.volume : 0.8;
                        this.audioEl.loop = true;
                        this.audioEl.play().catch(e => this.playSynthesis('chime'));
                    } else {
                        this.playSynthesis('chime');
                    }
                } else {
                    this.playSynthesis(typeToPlay);
                }
            },
            playSynthesis: function (type) {
                this.initCtx();
                const loop = () => {
                    if (!this.isPlaying) return;
                    let t = this.ctx.currentTime; let loopLength = 1.0;
                    if (type === 'chime') { [523.25, 659.25, 783.99, 1046.50].forEach((f, i) => this.playTone(f, 'sine', t + i * 0.12, 0.3, 0.4)); loopLength = 1.5; }
                    else if (type === 'gentle') { this.playTone(440, 'triangle', t, 0.8, 0.2); this.playTone(554.37, 'sine', t + 0.1, 0.8, 0.2); this.playTone(659.25, 'sine', t + 0.2, 0.8, 0.2); loopLength = 2.5; }
                    else { this.playTone(800, 'square', t, 0.15, 0.3); this.playTone(800, 'square', t + 0.25, 0.15, 0.3); loopLength = 1.0; }
                    this.timeoutId = setTimeout(loop, loopLength * 1000);
                };
                loop();
            },
            stop: function () {
                this.isPlaying = false;
                if (this.timeoutId) clearTimeout(this.timeoutId);
                this.activeOscillators.forEach(o => { try { o.stop(); } catch (e) { } }); this.activeOscillators = [];
                if (this.audioEl) { this.audioEl.pause(); this.audioEl.currentTime = 0; this.audioEl = null; }
            }
        };

        window.ikgAlarmTimeouts = window.ikgAlarmTimeouts || [];
        window.ikgScheduledTargetMs = window.ikgScheduledTargetMs || null;
        window.ikgTestAlarmTimeout = window.ikgTestAlarmTimeout || null;

        const updateHeaderStatus = (msg, colorVar = 'var(--text-muted)') => {
            const statusEl = document.getElementById('ikg-header-status');
            if (statusEl) {
                statusEl.innerHTML = msg; statusEl.style.color = colorVar;
                if (colorVar === 'var(--success)') { statusEl.style.borderColor = 'var(--success)'; statusEl.style.background = 'var(--success-bg)'; }
                else if (colorVar === 'var(--primary)') { statusEl.style.borderColor = 'var(--primary)'; statusEl.style.background = 'var(--primary-glow)'; }
                else if (colorVar === 'var(--warn)') { statusEl.style.borderColor = 'var(--warn)'; statusEl.style.background = 'var(--warn-bg)'; }
                else { statusEl.style.borderColor = 'var(--border)'; statusEl.style.background = 'var(--bg-elevated)'; }
            }
        };

        const AlarmSystem = {
            overlay: null, snoozeTimeout: null, currentIsTest: false,
            fire: async function (isTest = false) {
                this.currentIsTest = isTest;
                const settings = getSettings();
                AudioEngine.play();
                if (!isTest) triggerConfetti();

                // 🛡️ Bulletproof unit parsing
                const unit = (settings.snoozeUnit || 'm').toLowerCase();
                const snoozeTimeText = unit === 's' ? `${settings.snoozeMins}s` : `${settings.snoozeMins}m`;

                // Native load for Default, IndexedDB for Custom
                let imgSrc = DEFAULT_GIF_URL;
                if (settings.alarmImgType === 'custom') {
                    imgSrc = await IKG_DB.get('custom_alarm_img') || 'https://attendance.iki-utl.cc/favicon.png';
                }

                if (!this.overlay) {
                    this.overlay = document.createElement('div'); this.overlay.id = 'ikg-ringing-overlay';
                    document.body.appendChild(this.overlay);
                    this.overlay.addEventListener('click', (e) => {
                        const target = e.target;
                        if (target.id === 'ikg-btn-stop') this.stop();
                        if (target.id === 'ikg-btn-snooze') this.snooze();
                    }, true);
                }

                const pulseAnim = settings.pulseSpeed > 0 ? `animation: ringPulse ${settings.pulseSpeed}s infinite;` : 'animation: none;';

                this.overlay.innerHTML = `
                    <style>
                        #ikg-ringing-overlay .ringing-box { ${pulseAnim} }
                        .ringing-img { width: 120px; height: 120px; border-radius: 16px; margin-bottom: 16px; object-fit: cover; }
                    </style>
                    <div class="ringing-box">
                        <img src="${imgSrc}" class="ringing-img">
                        <div class="ringing-title">${isTest ? 'Test Alarm' : 'Time to Log Off!'}</div>
                        <div class="ringing-subtitle">${isTest ? 'Audio & Visuals working.' : 'Target hours reached!'}</div>
                        <div class="ringing-actions">
                            <button id="ikg-btn-stop" class="ring-btn stop">🛑 Stop Alarm</button>
                            <button id="ikg-btn-snooze" class="ring-btn snooze">💤 Snooze (${snoozeTimeText})</button>
                        </div>
                    </div>`;
                this.overlay.classList.add('active');
            },
            stop: function () {
                IkgLog.info("Alarm Stopped by user.");
                AudioEngine.stop();
                if (this.overlay) this.overlay.classList.remove('active');
                if (this.snoozeTimeout) clearTimeout(this.snoozeTimeout);
                updateHeaderStatus('✅ Synced', 'var(--success)');

                if (!this.currentIsTest) {
                    const todayReal = new Date();
                    const pad = n => String(n).padStart(2, '0');
                    const todayStr = `${todayReal.getFullYear()}-${pad(todayReal.getMonth() + 1)}-${pad(todayReal.getDate())}`;
                    localStorage.setItem(`IKG_ALARM_DISMISSED_${todayStr}`, "true");

                    const btn = document.getElementById('ikg-btn-alarm');
                    if (btn) {
                        btn.innerText = `✅ Alarm Dismissed for Today`;
                        btn.style.background = 'transparent';
                        btn.style.color = 'var(--text-muted)';
                        btn.style.borderColor = 'var(--border)';
                        btn.style.pointerEvents = 'none';
                        btn.removeAttribute('id');
                    }
                }
            },
            snooze: function () {
                const settings = getSettings();
                const unit = (settings.snoozeUnit || 'm').toLowerCase();
                const sMult = unit === 's' ? 1000 : 60000;
                const timeText = unit === 's' ? `${settings.snoozeMins}s` : `${settings.snoozeMins}m`;

                IkgLog.info(`Alarm Snoozed for ${timeText}.`);

                AudioEngine.stop();
                if (this.overlay) this.overlay.classList.remove('active');
                if (this.snoozeTimeout) clearTimeout(this.snoozeTimeout);

                this.snoozeTimeout = setTimeout(() => { this.fire(this.currentIsTest); }, settings.snoozeMins * sMult);

                const btn = document.getElementById('ikg-btn-alarm');
                if (btn) btn.innerText = `💤 Snoozing (${timeText})...`;
                updateHeaderStatus(`💤 Snoozing (${timeText})...`, 'var(--warn)');
            }
        };

        const cancelAlarms = () => {
            window.ikgAlarmTimeouts.forEach(clearTimeout);
            window.ikgAlarmTimeouts = [];
            window.ikgScheduledTargetMs = null;

            if (window.ikgTestAlarmTimeout) {
                clearInterval(window.ikgTestAlarmTimeout);
                window.ikgTestAlarmTimeout = null;
                const testBtn = document.getElementById('ikg-btn-test-alarm');
                if (testBtn) {
                    testBtn.innerText = "🧪 Run Test";
                    testBtn.style.pointerEvents = 'auto';
                    testBtn.style.opacity = '1';
                }
            }

            sessionStorage.removeItem('IKG_ALARM_TARGET');
            IkgLog.info("Scheduled alarms canceled by user.");

            const setBtn = document.getElementById('ikg-btn-alarm');
            const activeView = document.getElementById('ikg-alarm-active-view');

            if (setBtn && activeView) {
                activeView.style.display = 'none';
                setBtn.style.display = 'block';
            }

            updateHeaderStatus('🔕 Alarms Cleared', 'var(--text-muted)');
        };

        const scheduleAlarms = (endTimeMs, silent = false) => {
            const todayReal = new Date();
            const pad = n => String(n).padStart(2, '0');
            const todayStr = `${todayReal.getFullYear()}-${pad(todayReal.getMonth() + 1)}-${pad(todayReal.getDate())}`;

            if (localStorage.getItem(`IKG_ALARM_DISMISSED_${todayStr}`) === "true") {
                if (!silent) IkgLog.info("Alarm already dismissed for today. Skipping schedule.");
                return;
            }

            window.ikgAlarmTimeouts.forEach(clearTimeout);
            window.ikgAlarmTimeouts = [];
            window.ikgScheduledTargetMs = endTimeMs;
            sessionStorage.setItem('IKG_ALARM_TARGET', endTimeMs.toString());

            const settings = getSettings();
            if (!silent) IkgLog.info("Scheduling alarms", { target: new Date(endTimeMs).toLocaleTimeString(), triggers: settings.triggers });
            if (Notification.permission !== 'granted') Notification.requestPermission();

            const now = Date.now();
            const tMult = settings.triggerUnit === 's' ? 1000 : 60000;

            settings.triggers.forEach(val => {
                const triggerTimeMs = endTimeMs + (val * tMult);
                const triggerDelay = triggerTimeMs - now;

                if (triggerDelay > 0) {
                    const tid = setTimeout(() => {
                        if (val === 0) { AlarmSystem.fire(false); }
                        else if (Notification.permission === 'granted') {
                            const absVal = Math.abs(val);

                            // 🎯 Clean formatting: converts fraction of a minute to seconds natively!
                            const timeText = settings.triggerUnit === 's'
                                ? `${absVal} second(s)`
                                : (absVal < 1 ? `${Math.round(absVal * 60)} seconds` : `${absVal} minute(s)`);

                            let bodyText = val < 0
                                ? `Your shift ends in ${timeText}.`
                                : `You are overworking! Shift ended ${timeText} ago.`;

                            new Notification('⏰ Shift Update', { body: bodyText, icon: 'https://attendance.iki-utl.cc/favicon.png' });
                        }
                    }, triggerDelay);
                    window.ikgAlarmTimeouts.push(tid);
                }
            });

            const setBtn = document.getElementById('ikg-btn-alarm');
            const activeView = document.getElementById('ikg-alarm-active-view');
            const statusText = document.getElementById('ikg-alarm-status-text');

            if (setBtn && activeView && statusText) {
                setBtn.style.display = 'none';
                statusText.innerText = `✅ Scheduled (${formatTime(endTimeMs)})`;
                statusText.style.color = 'var(--success)';
                activeView.style.background = 'var(--success-bg)';
                activeView.style.borderColor = 'rgba(16, 185, 129, 0.3)';
                activeView.style.display = 'flex';
            }
            if (!silent) updateHeaderStatus(`✅ Scheduled! (Rings at ${formatTime(endTimeMs)})`, 'var(--success)');
        };

        const executeTestAlarm = (seconds, btnElement) => {
            const originalText = btnElement.innerText;
            btnElement.style.pointerEvents = 'none';
            btnElement.style.opacity = '0.7';

            let timeLeft = seconds;

            const setBtn = document.getElementById('ikg-btn-alarm');
            const activeView = document.getElementById('ikg-alarm-active-view');
            const statusText = document.getElementById('ikg-alarm-status-text');

            if (setBtn && activeView) {
                setBtn.style.display = 'none';
                activeView.style.display = 'flex';
            }

            const updateTick = () => {
                btnElement.innerText = `⏳ Ringing in ${timeLeft}s...`;
                updateHeaderStatus(`⏳ Test Alarm in ${timeLeft}s...`, 'var(--warn)');

                if (activeView && statusText) {
                    statusText.innerText = `🧪 Test Ringing in ${timeLeft}s...`;
                    statusText.style.color = 'var(--warn)';
                    activeView.style.background = 'var(--warn-bg)';
                    activeView.style.borderColor = 'rgba(245, 158, 11, 0.3)';
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
                    btnElement.style.pointerEvents = 'auto';
                    btnElement.style.opacity = '1';
                    updateHeaderStatus('⏰ Test Alarm Ringing!', 'var(--warn)');

                    if (setBtn && activeView && window.ikgAlarmTimeouts.length === 0) {
                        activeView.style.display = 'none';
                        setBtn.style.display = 'block';
                    }
                }
            }, 1000);
        };

        const downloadMacAlarmICS = (endTimeMs) => {
            const d = new Date(endTimeMs);
            const pad = n => String(n).padStart(2, '0');
            const formatICSDate = date => `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;

            const startStr = formatICSDate(d);
            const endStr = formatICSDate(new Date(endTimeMs + 15 * 60000));

            const icsData = [
                'BEGIN:VCALENDAR',
                'VERSION:2.0',
                'PRODID:-//Attendance Pro OS Alarm//EN',
                'BEGIN:VEVENT',
                `UID:shift-${Date.now()}@ikg`,
                `DTSTAMP:${formatICSDate(new Date())}`,
                `DTSTART:${startStr}`,
                `DTEND:${endStr}`,
                'SUMMARY:⏰ Goal Out Reached!',
                'DESCRIPTION:Your shift is over. Time to disconnect.',
                'BEGIN:VALARM',
                'TRIGGER:-PT0M',
                'ACTION:DISPLAY',
                'DESCRIPTION:Shift Goal Reached!',
                'END:VALARM',
                'BEGIN:VALARM',
                'TRIGGER:-PT0M',
                'ACTION:AUDIO',
                'VALUE:URI',
                'ALARM:Basso',
                'END:VALARM',
                'END:VEVENT',
                'END:VCALENDAR'
            ].join('\r\n');

            const blob = new Blob([icsData], { type: 'text/calendar;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'Goal_Out_Alarm.ics';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        };

        document.addEventListener('click', (e) => {
            const target = e.target.closest ? e.target : e.target.parentElement;
            if (!target || !target.closest) return;

            const alarmBtn = target.closest('#ikg-btn-alarm');
            if (alarmBtn) {
                e.preventDefault(); e.stopPropagation();
                const endMs = parseInt(alarmBtn.getAttribute('data-endms'), 10);
                if (!isNaN(endMs)) scheduleAlarms(endMs);
            }

            const macAlarmBtn = target.closest('#ikg-btn-mac-alarm');
            if (macAlarmBtn) {
                e.preventDefault(); e.stopPropagation();
                const endMs = parseInt(macAlarmBtn.getAttribute('data-endms'), 10);
                if (!isNaN(endMs)) {
                    downloadMacAlarmICS(endMs);
                    const originalText = macAlarmBtn.innerText;
                    macAlarmBtn.innerText = "✅ .ics Downloaded!";
                    setTimeout(() => macAlarmBtn.innerText = originalText, 3000);
                }
            }

            const testBtn = target.closest('#ikg-btn-test-alarm');
            if (testBtn) {
                e.preventDefault(); e.stopPropagation();
                const secInput = document.getElementById('ikg-test-sec');
                const secs = secInput ? parseInt(secInput.value, 10) : 5;
                executeTestAlarm(secs, testBtn);
            }

            const cancelAlarmBtn = target.closest('#ikg-btn-cancel-alarm');
            if (cancelAlarmBtn) {
                e.preventDefault(); e.stopPropagation();
                cancelAlarms();
            }
        }, true);

        // ==========================================
        // 4. CORE LOGIC & STATE
        // ==========================================
        let isFetchingData = false;
        const API_BASE = 'https://9a2igbhvdb.execute-api.us-west-2.amazonaws.com';

        // Apply Unified Versioning
        const CACHE_KEY = `IKG_ATTENDANCE_CACHE_${APP_VER}`;
        const DAY_NOTES_KEY = `IKG_DAY_NOTES_${APP_VER}`;
        const AGG_CACHE_KEY = `IKG_AGGREGATE_CACHE_${APP_VER}`;
        const SYNC_FLAG_KEY = `IKG_FULL_SYNC_DONE_${APP_VER}`;
        const STATS_STATE_KEY = `IKG_STATS_STATE_${APP_VER}`;
        const AUDIT_STATE_KEY = `IKG_AUDIT_STATE_${APP_VER}`;

        // --- SMART MIGRATION & GARBAGE COLLECTOR ---
        const cleanUpAndMigrateStorage = () => {
            const pad = n => String(n).padStart(2, '0');
            const d = new Date();
            const todayStr = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
            const keysToRemove = [];

            const baseKeys = [
                'IKG_ATTENDANCE_CACHE', 'IKG_DAY_NOTES', 'IKG_AGGREGATE_CACHE',
                'IKG_FULL_SYNC_DONE', 'IKG_STATS_STATE', 'IKG_AUDIT_STATE'
            ];

            baseKeys.forEach(base => {
                const newKey = `${base}_${APP_VER}`;
                if (!localStorage.getItem(newKey)) {
                    let highestOldVal = null;
                    let highestOldVer = -1;
                    
                    // 1. Look for highest versioned key
                    for (let i = 0; i < localStorage.length; i++) {
                        const key = localStorage.key(i);
                        const match = key.match(new RegExp(`^${base}_V(\\d+)$`));
                        if (match) {
                            const ver = parseInt(match[1], 10);
                            if (ver > highestOldVer) {
                                highestOldVer = ver;
                                highestOldVal = localStorage.getItem(key);
                            }
                        }
                    }
                    
                    // 2. 🎯 CRITICAL FIX: Rescue unversioned legacy keys if no versioned ones exist!
                    if (highestOldVal === null && localStorage.getItem(base)) {
                        highestOldVal = localStorage.getItem(base);
                        IkgLog.info(`Rescued unversioned legacy data for: ${base}`);
                    }

                    // 3. Migrate
                    if (highestOldVal !== null) {
                        localStorage.setItem(newKey, highestOldVal);
                        IkgLog.info(`Migrated data to ${newKey}`);
                    }
                }
            });

            // GARBAGE COLLECTION
            const dailyPattern = /^(IKG_ALARM_DISMISSED_|IKG_AUTO_ALARM_|IKG_TODAY_FLEX_)(\d{4}-\d{2}-\d{2})$/;
            const versionPattern = /^IKG_.*_V(\d+)$/;

            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                const dailyMatch = key.match(dailyPattern);
                if (dailyMatch) {
                    if (dailyMatch[2] < todayStr) keysToRemove.push(key);
                    continue;
                }
                const verMatch = key.match(versionPattern);
                if (verMatch && !key.endsWith(`_${APP_VER}`)) {
                    keysToRemove.push(key);
                }
            }
            keysToRemove.forEach(k => localStorage.removeItem(k));
        };
        cleanUpAndMigrateStorage(); // Execute instantly on load

        let globalTotalDays = 0; let globalTotalHours = 0; let globalFirstDate = "--";
        const today = new Date(); let currentViewYear = today.getFullYear(); let currentViewMonth = today.getMonth() + 1;
        let activeShiftHtml = ""; let activeTab = 'cal';

        // State Variables with Defaults
        let currentStatsRange = '7D'; let currentAuditRange = 'ALL';
        let currentStatsMonth = ''; let currentAuditMonth = '';
        let statsRangeStart = null, statsRangeEnd = null;
        let auditRangeStart = null, auditRangeEnd = null;

        // Load Filter States from Cache
        try {
            const savedStats = JSON.parse(localStorage.getItem(STATS_STATE_KEY));
            if (savedStats) {
                currentStatsRange = savedStats.range || '7D';
                currentStatsMonth = savedStats.month || '';
                statsRangeStart = savedStats.start ? new Date(savedStats.start) : null;
                statsRangeEnd = savedStats.end ? new Date(savedStats.end) : null;
            }
            const savedAudit = JSON.parse(localStorage.getItem(AUDIT_STATE_KEY));
            if (savedAudit) {
                currentAuditRange = savedAudit.range || 'ALL';
                currentAuditMonth = savedAudit.month || '';
                auditRangeStart = savedAudit.start ? new Date(savedAudit.start) : null;
                auditRangeEnd = savedAudit.end ? new Date(savedAudit.end) : null;
            }
        } catch (e) { }

        // Increased precision to 6 decimal places to accurately capture exact seconds
const safeFloat = (num) => Math.round((num + Number.EPSILON) * 1000000) / 1000000;
        const toYMD = (d) => { const pad = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

        const populateMonthSelect = (selectId, localCache, currentVal) => {
            const selectEl = document.getElementById(selectId);
            if (!selectEl) return currentVal;

            const months = new Set();
            Object.keys(localCache).forEach(dateStr => {
                if (localCache[dateStr] && localCache[dateStr].workHours) {
                    months.add(dateStr.substring(0, 7));
                }
            });

            const sortedMonths = Array.from(months).sort().reverse();
            const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

            const currentOptions = Array.from(selectEl.options).map(o => o.value);
            if (JSON.stringify(currentOptions) !== JSON.stringify(sortedMonths)) {
                selectEl.innerHTML = '';
                if (sortedMonths.length === 0) {
                    selectEl.innerHTML = `<option value="">No Data</option>`;
                    return '';
                }
                sortedMonths.forEach(m => {
                    const [yyyy, mm] = m.split('-');
                    const name = `${monthNames[parseInt(mm, 10) - 1]} ${yyyy}`;
                    selectEl.innerHTML += `<option value="${m}">${name}</option>`;
                });
            }

            if (currentVal && sortedMonths.includes(currentVal)) {
                selectEl.value = currentVal;
                return currentVal;
            } else if (sortedMonths.length > 0) {
                selectEl.value = sortedMonths[0];
                return sortedMonths[0];
            }
            return '';
        };

        const formatTime = (ms) => {
            if (!ms) return '--:--';
            const showSecs = getSettings().showSeconds;
            const opts = { hour: '2-digit', minute: '2-digit', hour12: false };
            if (showSecs) opts.second = '2-digit';
            return new Date(ms).toLocaleTimeString([], opts);
        };

        const msToTimeString = (ms) => {
            if (isNaN(ms) || ms === 0) return '--:--';
            const showSecs = getSettings().showSeconds;
            const opts = { timeZone: 'UTC', hour: '2-digit', minute: '2-digit', hour12: false };
            if (showSecs) opts.second = '2-digit';
            return new Date(ms).toLocaleTimeString([], opts);
        };

        const formatDurFromDec = (decimalHours, isDelta = false) => {
            if (isNaN(decimalHours)) return '--';
            const showSecs = getSettings().showSeconds;

            const isNeg = decimalHours < 0;
            const totalSeconds = Math.round(Math.abs(decimalHours) * 3600);
            const h = Math.floor(totalSeconds / 3600);
            const m = Math.floor((totalSeconds % 3600) / 60);
            const s = totalSeconds % 60;

            const pad = n => String(n).padStart(2, '0');

            let res = '';
            if (h > 0) {
                res = showSecs ? `${h}h ${pad(m)}m ${pad(s)}s` : `${h}h ${pad(m)}m`;
            } else {
                res = showSecs ? `${m}m ${pad(s)}s` : `${m}m`;
            }

            if (totalSeconds === 0) res = showSecs ? '0m 00s' : '0m';

            if (isDelta) {
                return isNeg ? `-${res}` : `+${res}`;
            }
            return res;
        };

        const fillCacheGaps = (startStr, endStr, records, cache) => {
            const recordMap = {}; records.forEach(r => recordMap[r.PK] = r);
            let curr = new Date(startStr); const end = new Date(endStr);
            while (curr <= end) { const dStr = toYMD(curr); cache[dStr] = recordMap[dStr] || null; curr.setDate(curr.getDate() + 1); }
        };

        // --- DEEL PTO AUTO-SYNC ENGINE ---
        const ensureDeelToken = () => {
            return new Promise((resolve) => {
                const existingToken = GM_getValue('IKG_DEEL_TOKEN', null);
                if (existingToken) return resolve(existingToken);

                IkgLog.warn("No Deel token found. Opening background tab to auto-snatch...");
                updateHeaderStatus("Auto-Syncing PTO...", "var(--warn)");

                const deelTab = GM_openInTab('https://ikg.deel.team/', { active: false, insert: true });
                
                if (!deelTab) {
                    IkgLog.error("Failed to open background tab. Check Tampermonkey permissions.");
                    return resolve(null);
                }

                const listenerId = GM_addValueChangeListener('IKG_DEEL_TOKEN', function (name, old_value, new_value, remote) {
                    if (new_value) {
                        IkgLog.info("Token caught from Deel tab!");
                        GM_removeValueChangeListener(listenerId);
                        resolve(new_value);
                    }
                });

                // 🎯 CRITICAL FIX: Increased timeout to 60 seconds to allow full Google SSO Redirect chain
                setTimeout(() => {
                    GM_removeValueChangeListener(listenerId);
                    if (!GM_getValue('IKG_DEEL_TOKEN', null)) {
                        IkgLog.error("Timeout waiting for Deel tab.");
                        updateHeaderStatus("❌ Deel Auth Failed. Log in manually!", "var(--danger)");
                        
                        // 🎯 LOUD WARNING: Forces the user to fix their broken session
                        if (confirm("Attendance Pro:\n\nAuto-Login to Deel failed or took too long.\nPlease open Deel, log in manually once, then return here to sync.\n\nOpen Deel now?")) {
                            window.open('https://ikg.deel.team/', '_blank');
                        }

                        try { deelTab.close(); } catch(e) {} // Force close the stuck background tab
                        resolve(null);
                    }
                }, 60000); // 60 seconds instead of 15!
            });
        };

        const fetchAndParseDeelPTO = async (isRetry = false) => {
            const token = await ensureDeelToken();
            if (!token) return null;

            const fetchDeel = (path) => new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: "GET", 
                url: `https://ikg.deel.team/deelapi/${path}`,
                withCredentials: true, // 🎯 CRITICAL: Passes Deel's session cookies cross-origin
                headers: {
                    "Accept": "application/json, text/plain, */*",
                    "x-auth-token": token,
                    "x-api-version": "2",
                    "x-app-host": "ikg.deel.team",
                    "x-platform": "web",         // 🎯 Spoofs Deel's frontend client
                    "x-owner": "timeoff-fe",     // 🎯 Required for this specific API route
                    "Origin": "https://ikg.deel.team",
                    "Referer": "https://ikg.deel.team/"
                },
                onload: (res) => {
                    if (res.status === 401 || res.status === 403) reject({ status: res.status });
                    else if (res.status === 200) resolve(JSON.parse(res.responseText));
                    else reject({ status: res.status });
                },
                onerror: (err) => reject(err)
            });
        });

            try {
            IkgLog.info("Fetching Deel PTO Data natively...");
            let profileId = GM_getValue('IKG_DEEL_PROFILE_ID', null);
            let entData = null;

            if (!profileId) {
                IkgLog.info("Resolving Time-Off Profile UUID...");
                const timeOffsMe = await fetchDeel('time_offs/me');
                
                // 🎯 THE FIX: Directly grab the ID from the JSON instead of guessing with Regex!
                profileId = timeOffsMe?.profile?.id;
                
                if (!profileId) throw new Error("Could not find profile.id in /time_offs/me response.");
                
                GM_setValue('IKG_DEEL_PROFILE_ID', profileId);
                IkgLog.info(`✅ Successfully resolved Time-Off Profile UUID: ${profileId}`);
            }

            // 🎯 MAKE ENTITLEMENTS SAFE: If Deel removed this endpoint, we catch the error 
            // and continue so it doesn't block the actual PTO days from syncing.
            try {
                entData = await fetchDeel(`time_offs/profile/${profileId}/entitlements`);
            } catch (entErr) {
                IkgLog.warn("Could not fetch entitlements (Deel may have changed this API), skipping...", entErr);
            }

            const toData = await fetchDeel(`time_offs/profile/${profileId}/time_off?orderType=DESC&lightweight=true`);
            const ptoCalendar = {}; const syncLog = [];

            if (entData && entData.entitlements) {
                entData.entitlements.forEach(ent => {
                    const name = ent.Policy?.name || "Leave";
                    const unit = ent.Policy?.entitlementUnit || "HOUR";
                    const adj = parseFloat(ent.balanceAdjusted) || 0;
                    if (adj !== 0) syncLog.push(`[${name}] Adj: ${adj} ${unit}s`);
                });
            }

            if (Array.isArray(toData)) {
                toData.forEach(req => {
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
                        const pad = n => String(n).padStart(2, '0');
                        const dStr = `${curr.getFullYear()}-${pad(curr.getMonth() + 1)}-${pad(curr.getDate())}`;

                        const isFullDay = (unit === "BUSINESS_DAY" || unit === "CALENDAR_DAY");

                        ptoCalendar[dStr] = {
                            isFullDay: isFullDay,
                            type: typeName,
                            hours: isFullDay ? dailyAmt * 8 : dailyAmt
                        };
                        curr.setDate(curr.getDate() + 1);
                    }
                });
            }
            return { ptoCalendar, syncLog };

        } catch (e) {
    if (e.status === 401 && !isRetry) {
        IkgLog.warn("Deel Token expired. Clearing and retrying...");
        GM_setValue('IKG_DEEL_TOKEN', null);
        GM_setValue('IKG_DEEL_PROFILE_ID', null);
        return await fetchAndParseDeelPTO(true);
    }
    // 🎯 NEW: Better error visibility
    IkgLog.error("Deel PTO Sync Failed:", e.status ? `HTTP Status ${e.status}` : (e.message || JSON.stringify(e)));
    return null;
}
        };


        const injectScript = document.createElement('script');
        injectScript.textContent = `
            (function() {
                const originalFetch = window.fetch;
                window.fetch = async function(...args) {
                    try {
                        let url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url ? args[0].url : '');
                        let options = args[1] || {}; let headersObj = (args[0] && args[0].headers) ? args[0].headers : options.headers;
                        if (url && url.includes('9a2igbhvdb.execute-api.us-west-2.amazonaws.com/attendance')) {
                            let token = null;
                            if (headersObj) {
                                if (headersObj instanceof Headers) token = headersObj.get('authorization') || headersObj.get('Authorization');
                                else { const authKey = Object.keys(headersObj).find(k => k.toLowerCase() === 'authorization'); if (authKey) token = headersObj[authKey]; }
                            }
                            if (token) window.dispatchEvent(new CustomEvent('IKG_Token_Found', { detail: token }));
                        }
                    } catch (e) {}

                    // 🎯 INSTANT 401 DETECTION
                    const response = await originalFetch.apply(this, args);
                    if (response.status === 401) {
                        window.dispatchEvent(new CustomEvent('IKG_Session_Death'));
                    }
                    return response;
                };
            })();
        `;
        document.documentElement.appendChild(injectScript); injectScript.remove();

        window.addEventListener('IKG_Token_Found', function (e) {
            if (!authToken) {
                authToken = e.detail;
                autopilotEnabled = false;
                IkgLog.info("Token Intercepted. Handing off to Range Sync.");
            }
        });

        window.addEventListener('IKG_Session_Death', function () {
            if (authToken) {
                IkgLog.warn("API returned 401. Fast session death detected!");
                authToken = null;
                autopilotEnabled = true; // Instantly re-arms the MutationObserver
                attemptAppClick(); // Fires immediately if the UI has already rendered
            }
        });

        // ==========================================
        // 5. REACTIVE FOREGROUND AUTOMATION
        // ==========================================
        let hasClickedFetch = false;

        const attemptAppClick = () => {
            if (!autopilotEnabled) return false;
            const buttons = Array.from(document.querySelectorAll('button'));
            const loginBtn = buttons.find(b => (b.innerText || '').toUpperCase().includes('SIGN IN WITH GOOGLE'));

            if (loginBtn && loginBtn.offsetParent !== null) {
                GM_setValue('IKG_SSO_TRIGGERED', Date.now());
                loginBtn.click();
                return true;
            }

            // 🎯 CRITICAL RESTORATION: We must force the native app to fetch data ONCE so the interceptor can steal the token
            if (!authToken && !hasClickedFetch) {
                const fetchBtn = buttons.find(b => (b.innerText || '').toUpperCase().includes('FETCH'));
                if (fetchBtn && fetchBtn.offsetParent !== null) {
                    hasClickedFetch = true;
                    fetchBtn.click();
                    setTimeout(() => { hasClickedFetch = false; }, 3000);
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

        // 🎟️ Catch manual user clicks to grant the VIP Pass
        document.addEventListener('click', (e) => {
            const target = e.target.closest ? e.target : e.target.parentElement;
            if (!target) return;
            if ((target.innerText || '').toUpperCase().includes('SIGN IN WITH GOOGLE')) {
                GM_setValue('IKG_SSO_TRIGGERED', Date.now());
            }
        }, true);

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', initAppAutopilot);
        } else {
            initAppAutopilot();
        }

        // 🎯 NEW: Focus Reactivity (Zero API Hammering)
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') {
                IkgLog.debug("Tab regained focus. Validating sessions...");

                // 1. Check if Attendance session died
                attemptAppClick();

                // 2. 🎯 CRITICAL FIX: Force a micro-ping to instantly detect 401s without needing a refresh!
                if (authToken) {
                    const todayStr = toYMD(new Date());
                    window.fetch(`${API_BASE}/attendance/range?from=${todayStr}&to=${todayStr}`, {
                        headers: { "authorization": authToken }
                    }).catch(() => { });
                }

                // 3. Ensure Deel Token exists silently
                if (!GM_getValue('IKG_DEEL_TOKEN', null)) {
                    IkgLog.info("Missing Deel token on focus. Snatching silently...");
                    ensureDeelToken();
                }
            }
        });

        // 🎯 NEW: Centralized Math & Minimalist Status Logic
        const evaluateDay = (dateStr, record, note, override, useOverrides) => {
        const isFullPTO = !!(note && note.isPTO);
        const isPartialPTO = !!(note && note.isPartialPTO);
        let ptoHrs = note ? (parseFloat(note.deductedHours) || 0) : 0;
        const ptoType = note ? (note.type || 'PTO') : '';

        if (isFullPTO) ptoHrs = 9.0;

        let actualHrs = (record && record.workHours) ? parseFloat(record.workHours) : 0;
        let effStart = record ? record.startTime : null;
        let effEnd = record ? record.endTime : null;
        let isSpoofed = false;

        // 🎯 SMART SOURCE OF TRUTH OVERRIDE (Handles seconds + partial inputs)
        if (useOverrides !== false && override && (override.manualIn || override.manualOut)) {
            const [y, m, d] = dateStr.split('-');
            
            let effStartD = null;
            if (override.manualIn) {
                const s = override.manualIn.split(':');
                effStartD = new Date(y, parseInt(m, 10)-1, d, s[0]||0, s[1]||0, s[2]||0);
            } else if (record && record.startTime) {
                effStartD = new Date(record.startTime);
            }

            let effEndD = null;
            if (override.manualOut) {
                const s = override.manualOut.split(':');
                effEndD = new Date(y, parseInt(m, 10)-1, d, s[0]||0, s[1]||0, s[2]||0);
            } else if (record && record.endTime) {
                effEndD = new Date(record.endTime);
            }

            if (effStartD && effEndD) {
                // 🎯 THE MATH FIX: Removed the "- 1" lunch deduction to match the native API.
                actualHrs = Math.max(0, (effEndD - effStartD) / 3600000); 
                effStart = effStartD.getTime(); effEnd = effEndD.getTime();
                isSpoofed = true;
            } else if (effStartD) { // Pending case
                actualHrs = 0; effStart = effStartD.getTime(); effEnd = null; isSpoofed = true;
            }
        }

        const targetHrs = 9.0;
        const effectiveHrs = actualHrs + ptoHrs;
        const flexHrs = effectiveHrs - targetHrs;

        let status = 'none'; let color = 'var(--text-muted)'; let chartColor = 'transparent'; let heatmapBg = 'transparent'; let reason = '';

        if (isFullPTO) {
            status = 'full-pto'; color = 'var(--pto)'; chartColor = '#8B5CF6'; heatmapBg = '#8B5CF6'; reason = 'Full Day PTO';
        } else if (actualHrs === 0 && effStart && !effEnd) {
            status = 'pending'; color = 'var(--warn)'; chartColor = '#F59E0B'; heatmapBg = '#F59E0B'; reason = 'Pending Checkout';
        } else if (actualHrs > 0) {
            if (isPartialPTO) {
                if (effectiveHrs >= targetHrs) { status = 'partial-pto-pass'; color = 'var(--success)'; chartColor = '#10B981'; heatmapBg = 'linear-gradient(135deg, #10B981 50%, #8B5CF6 50%)'; reason = `Goal passed`; } 
                else { status = 'partial-pto-fail'; color = 'var(--danger)'; chartColor = '#EF4444'; heatmapBg = 'linear-gradient(135deg, #EF4444 50%, #8B5CF6 50%)'; reason = `Short`; }
            } else {
                if (actualHrs >= targetHrs) { status = 'pass'; color = 'var(--success)'; chartColor = '#10B981'; heatmapBg = '#10B981'; reason = 'Goal met'; } 
                else { status = 'fail'; color = 'var(--danger)'; chartColor = '#EF4444'; heatmapBg = '#EF4444'; reason = `Short`; }
            }
        }

        if ((status === 'pass' || status === 'partial-pto-pass') && actualHrs >= 10.0) {
            chartColor = '#059669'; heatmapBg = status === 'pass' ? '#059669' : 'linear-gradient(135deg, #059669 50%, #8B5CF6 50%)';
        }

        return { isFullPTO, isPartialPTO, ptoHrs, ptoType, actualHrs, effStart, effEnd, effectiveHrs, targetHrs, flexHrs, status, color, chartColor, heatmapBg, reason, isSpoofed };
    };

        let chartHoverHandler = null; // Global reference to clear old listeners
        
        const drawNativeChart = (canvasId, labels, dataItems) => {
            const canvas = document.getElementById(canvasId);
            if (!canvas) return;
            const ctx = canvas.getContext('2d');
            const parent = canvas.parentElement;

            const rect = parent.getBoundingClientRect();
            if (rect.width === 0 || rect.height === 0) return;

            const dpr = window.devicePixelRatio || 1;
            canvas.style.width = `${rect.width}px`; canvas.style.height = `${rect.height}px`;
            canvas.width = rect.width * dpr; canvas.height = rect.height * dpr;
            ctx.scale(dpr, dpr);

            const w = rect.width; const h = rect.height;
            ctx.clearRect(0, 0, w, h);
            if (dataItems.length === 0) return;

            const padTop = 30, padBottom = 50, padLeft = 40, padRight = 10;
            const chartW = w - padLeft - padRight; const chartH = h - padTop - padBottom;

            const maxVal = Math.max(12, ...dataItems.map(d => d.val + d.pto)) + 1;

            ctx.fillStyle = '#94A3B8'; ctx.font = '11px sans-serif'; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
            for (let i = 0; i <= maxVal; i += 2) {
                const y = padTop + chartH - (i / maxVal) * chartH;
                ctx.fillText(i, padLeft - 10, y);
                ctx.beginPath(); ctx.moveTo(padLeft, y); ctx.lineTo(padLeft + chartW, y);
                ctx.strokeStyle = 'rgba(255,255,255,0.05)'; ctx.stroke();
            }

            const spacing = chartW / dataItems.length;
            const barW = Math.min(spacing * 0.8, 40);
            ctx.textAlign = 'center';

            dataItems.forEach((item, i) => {
                const x = padLeft + (i * spacing) + (spacing / 2);
                const actualBarH = (item.val / maxVal) * chartH;
                const ptoBarH = (item.pto / maxVal) * chartH;
                const yBase = padTop + chartH;

                if (item.val > 0) {
                    ctx.fillStyle = item.color; ctx.beginPath();
                    if (ctx.roundRect) ctx.roundRect(x - barW / 2, yBase - actualBarH, barW, actualBarH, item.pto === 0 ? [4, 4, 0, 0] : [0, 0, 0, 0]);
                    else ctx.rect(x - barW / 2, yBase - actualBarH, barW, actualBarH);
                    ctx.fill();
                }

                if (item.pto > 0) {
                    ctx.fillStyle = '#8B5CF6'; ctx.beginPath();
                    if (ctx.roundRect) ctx.roundRect(x - barW / 2, yBase - actualBarH - ptoBarH, barW, ptoBarH, [4, 4, 0, 0]);
                    else ctx.rect(x - barW / 2, yBase - actualBarH - ptoBarH, barW, ptoBarH);
                    ctx.fill();
                }

                const totalVal = item.val + item.pto;
                if (totalVal > 0) {
                    ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.font = 'bold 10px sans-serif'; ctx.textBaseline = 'bottom';
                    ctx.fillText(totalVal.toFixed(1), x, yBase - actualBarH - ptoBarH - 4);
                }

                ctx.fillStyle = '#94A3B8'; ctx.font = '11px sans-serif'; ctx.textBaseline = 'middle'; ctx.textAlign = 'right';
                ctx.save(); ctx.translate(x, padTop + chartH + 16); ctx.rotate(-Math.PI / 4);
                ctx.fillText(labels[i], 0, 0); ctx.restore();
            });

            // 🎯 INTERACTIVE TOOLTIP INJECTION
            let tooltip = document.getElementById('ikg-chart-tooltip');
            if (!tooltip) {
                tooltip = document.createElement('div');
                tooltip.id = 'ikg-chart-tooltip';
                tooltip.style.cssText = 'position:absolute; background:var(--bg-elevated); color:var(--text-main); padding:10px 14px; border-radius:8px; font-size:12px; font-weight:500; border:1px solid var(--border); box-shadow:0 12px 28px rgba(0,0,0,0.6); pointer-events:none; opacity:0; transition:opacity 0.1s; z-index:100; white-space:nowrap; line-height:1.5; font-family:var(--font-family);';
                parent.appendChild(tooltip);
            }

            if (chartHoverHandler) canvas.removeEventListener('mousemove', chartHoverHandler);
            if (window.chartLeaveHandler) canvas.removeEventListener('mouseleave', window.chartLeaveHandler);

            chartHoverHandler = (e) => {
                const r = canvas.getBoundingClientRect();
                const mouseX = e.clientX - r.left;
                const chartX = mouseX - padLeft;
                if (chartX < 0 || chartX > chartW) { tooltip.style.opacity = 0; return; }

                const index = Math.floor(chartX / spacing);
                if (index >= 0 && index < dataItems.length) {
                    const item = dataItems[index];
                    const cleanPtoLabel = item.ptoType ? item.ptoType.split(' - ')[0] : 'PTO';
                    
                    // 📊 MINIMALIST CHART HOVER CARD (Emoji Only)
                    let text = `<div style="color:var(--text-muted); font-size:11px; margin-bottom:8px; font-weight:700; letter-spacing:0.05em; text-transform:uppercase;">${labels[index]}</div>`;
                    
                    const totalHrs = item.val + item.pto;
                    const totalColor = totalHrs >= 9.0 ? 'var(--success)' : 'var(--danger)';

                    text += `<div style="display: grid; grid-template-columns: 20px 1fr; gap: 4px 8px; align-items: center; font-size: 13px;">`;

                    if (item.val > 0) {
                        text += `
                            <div style="text-align:center; font-size:14px;" title="Worked">⏱️</div>
                            <div style="color:var(--text-main);"><b>${item.val.toFixed(2)}h</b></div>
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

                    text += `</div>`; // Close grid

                    if (item.isSpoofed) {
                        text += `<div style="color:var(--warn); font-size:10px; margin-top:8px; font-weight:600;">⚠️ Manual Override Active</div>`;
                    }

                    tooltip.innerHTML = text;
                    tooltip.style.left = `${mouseX + 20}px`;
                    tooltip.style.top = `${e.clientY - r.top - 40}px`;
                    tooltip.style.opacity = 1;
                } else { tooltip.style.opacity = 0; }
            };

            window.chartLeaveHandler = () => { tooltip.style.opacity = 0; };
            canvas.addEventListener('mousemove', chartHoverHandler);
            canvas.addEventListener('mouseleave', window.chartLeaveHandler);
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
            .ikg-title-area { display: flex; align-items: center; gap: 12px; font-size: 20px; font-weight: 600; letter-spacing: -0.02em; }
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

            /* Dynamic Custom Native Month Select Dropdowns */
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
            
            /* Custom Dual Calendar UI */
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

            /* 🎯 UPDATED: Added position: relative to anchor your new interactive popover tooltips */
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
            
            /* Instant CSS Tooltips */
            .ikg-fast-tt { position: relative; cursor: help; border-bottom: 1px dotted rgba(148, 163, 184, 0.5); }
            .ikg-fast-tt.no-dot { border-bottom: none; }
            .ikg-fast-tt::after { content: attr(data-title); position: absolute; bottom: 100%; left: 50%; transform: translateX(-50%) translateY(4px); width: max-content; max-width: 220px; background: var(--bg-elevated); color: var(--text-main); font-family: var(--font-family); font-size: 11px; font-weight: 500; padding: 6px 10px; border-radius: 6px; border: 1px solid var(--border); box-shadow: 0 8px 24px rgba(0,0,0,0.8); opacity: 0; visibility: hidden; transition: opacity 0.1s ease, transform 0.1s ease; z-index: 1000; pointer-events: none; white-space: normal; line-height: 1.4; text-align: center; margin-bottom: 6px; }
            .ikg-fast-tt:hover::after { opacity: 1; visibility: visible; transform: translateX(-50%) translateY(0); }
            .ikg-fast-tt.tt-right::after { left: auto; right: 0; transform: translateX(0) translateY(4px); }
            .ikg-fast-tt.tt-right:hover::after { transform: translateX(0) translateY(0); }
            
            span[title] { border-bottom: 1px dotted rgba(148, 163, 184, 0.5); cursor: help; }
        `);

        // --- ACTIVE SHIFT UI RENDERER ---
        const updateActiveShiftUI = () => {
            let localCache = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
            let dayNotes = JSON.parse(localStorage.getItem(DAY_NOTES_KEY) || '{}');
            const appSettings = getSettings();
            const overrides = JSON.parse(localStorage.getItem(OVERRIDES_KEY) || '{}'); // 🎯 NEW

            const todayReal = new Date();
            const todayStr = toYMD(todayReal);
            const isDismissed = localStorage.getItem(`IKG_ALARM_DISMISSED_${todayStr}`) === "true";

            let realMonthBalance = 0;
            let lockedShift = null;
            const prefixRealMonth = `${todayReal.getFullYear()}-${String(todayReal.getMonth() + 1).padStart(2, '0')}`;

            const shiftCounts = { "09:00 ~ 18:00": 0, "09:30 ~ 18:30": 0, "10:00 ~ 19:00": 0, "13:00 ~ 22:00": 0 };

            for (let i = 1; i <= 31; i++) {
                const dStr = `${prefixRealMonth}-${String(i).padStart(2, '0')}`;
                const record = localCache[dStr];
                
                // 🎯 THE FIX 1
                const evalDay = evaluateDay(dStr, record, dayNotes[dStr], overrides[dStr], appSettings.useManualOverrides);

                if (i < todayReal.getDate()) {
                    if (evalDay.status !== 'pending' && evalDay.status !== 'none' && !evalDay.isFullPTO) {
                        realMonthBalance = safeFloat(realMonthBalance + evalDay.flexHrs);
                    }
                }

                if (!evalDay.isFullPTO && record && record.startTime) {
                    const startD = new Date(record.startTime);
                    const h = startD.getHours(); const m = startD.getMinutes();
                    if (h < 9 || (h === 9 && m < 30)) shiftCounts["09:00 ~ 18:00"]++;
                    else if (h === 9 && m >= 30) shiftCounts["09:30 ~ 18:30"]++;
                    else if (h >= 10 && h < 13) shiftCounts["10:00 ~ 19:00"]++;
                    else if (h >= 13) shiftCounts["13:00 ~ 22:00"]++;
                }
            }

            if (appSettings.manualShift && appSettings.manualShift !== 'auto') {
                lockedShift = appSettings.manualShift;
            } else {
                let maxCount = 0;
                for (const [shift, count] of Object.entries(shiftCounts)) {
                    if (count > maxCount) { maxCount = count; lockedShift = shift; }
                }
            }

            if (!lockedShift) lockedShift = "Undetermined";
            let lockedShiftDisplay = lockedShift;
            let lockedShiftTitle = "Determined by your most frequent check-in this month. See Rules tab.";

            if (appSettings.manualShift && appSettings.manualShift !== 'auto') {
                lockedShiftDisplay = `${lockedShift} (Manual)`;
                lockedShiftTitle = "Manually overridden in Settings. HR Approved.";
            }

            let useFlexTodayRaw = localStorage.getItem(`IKG_TODAY_FLEX_${todayStr}`);
            if (useFlexTodayRaw === null) useFlexTodayRaw = appSettings.useFlexDef ? 'true' : 'false';
            const applyFlex = useFlexTodayRaw === 'true';

            // 🎯 THE FIX 2
            const todaysEval = evaluateDay(todayStr, localCache[todayStr], dayNotes[todayStr], overrides[todayStr], appSettings.useManualOverrides);
            let todaysFlexGoal = safeFloat(9.0 - todaysEval.ptoHrs);

            if (applyFlex) {
                todaysFlexGoal = safeFloat(todaysFlexGoal - realMonthBalance);
            }
            if (todaysFlexGoal < 0) todaysFlexGoal = 0;

            let container = document.getElementById('ikg-active-shift-container');
            if (!container) return;

            const record = localCache[todayStr];
            if (record && record.startTime) {
                const startMs = record.startTime;
                const targetMs = startMs + (todaysFlexGoal * 3600 * 1000);
                const isCompleted = record.workHours ? parseFloat(record.workHours) >= todaysFlexGoal : false;

                const gcalStart = new Date(targetMs).toISOString().replace(/[-:]|\.\d{3}/g, '');
                const gcalEnd = new Date(targetMs + 15 * 60000).toISOString().replace(/[-:]|\.\d{3}/g, '');

                if (isCompleted) {
                    container.innerHTML = `<div id="ikg-active-shift" style="border-color: var(--success); background: var(--success-bg); padding: 16px; border-radius: 12px;"><div class="ikg-active-header" style="color: var(--success); margin-bottom: 4px;">🎉 Shift Completed</div><div style="font-size:12px; color: var(--text-main);">Goal reached! Time to disconnect.</div></div>`;
                } else {
                    const alarmTime = formatTime(targetMs);
                    const flexStr = formatDurFromDec(realMonthBalance, true);
                    let flexBadge = '';

                    if (applyFlex) {
                        if (realMonthBalance > 0) flexBadge = `<span style="display:inline-block; white-space:nowrap; background:var(--success); color:#000; padding:2px 6px; border-radius:4px; font-size:10px; font-weight:700;">${flexStr} Flex</span>`;
                        else if (realMonthBalance < 0) flexBadge = `<span style="display:inline-block; white-space:nowrap; background:var(--danger); color:#fff; padding:2px 6px; border-radius:4px; font-size:10px; font-weight:700;">${flexStr} Deficit</span>`;
                    }

                    let alarmSection = '';
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
                                <div style="display: flex; align-items: center; min-width: 0;"><b style="font-family: monospace; font-size: 15px; letter-spacing: 0.5px;">${formatTime(startMs)}</b></div>
                                
                                <div class="ikg-fast-tt no-dot" data-title="Note: Calendar shows system checkout time (lags 1 day). Trust the Goal Out above." style="color: var(--text-muted); font-weight: 500; display: flex; align-items: center; gap: 6px; width: fit-content; border-bottom: 1px dotted var(--text-muted);">
                                    Goal Out <span style="display:inline-flex; align-items:center; justify-content:center; width:14px; height:14px; background:var(--border); color:var(--text-muted); border-radius:4px; font-size:10px; font-weight:bold; font-family:serif;">i</span>:
                                </div>
                                <div style="display: flex; align-items: center; flex-wrap: wrap; gap: 8px; min-width: 0;">
                                    <b style="font-family: monospace; font-size: 15px; color: var(--primary); letter-spacing: 0.5px;">${alarmTime}</b>
                                    <span style="font-size: 11px; color: var(--text-muted); font-weight: 500;">(${todaysFlexGoal.toFixed(2)}h)</span>
                                    ${flexBadge}
                                </div>
                            </div>
                            
                            <label id="ikg-flex-toggle-wrap" style="display:flex; align-items:center; gap: 8px; margin-bottom: 12px; background: var(--bg-elevated); padding: 8px 10px; border-radius: 6px; cursor:pointer; border: 1px solid var(--border); transition: border-color 0.2s;" onmouseover="this.style.borderColor='var(--primary)'" onmouseout="this.style.borderColor='var(--border)'">
                                <input type="checkbox" id="ikg-today-flex" ${applyFlex ? 'checked' : ''} style="width:14px; height:14px; cursor:pointer; accent-color: var(--primary);">
                                <span style="font-size:12px; font-weight: 500; color:var(--text-main); user-select:none;">Apply Monthly Flex (${flexStr})</span>
                            </label>
                            
                            ${alarmSection}

                            <div style="display:grid; grid-template-columns: 1fr 1fr; gap:8px; border-top:1px dashed var(--border); padding-top:12px;">
                                <a href="https://calendar.google.com/calendar/render?action=TEMPLATE&text=Clock+Out+⏰&dates=${gcalStart}/${gcalEnd}&details=Time+to+go+home!" target="_blank" class="ikg-btn-outline" style="margin:0; font-size:11px; font-weight: 600; display:flex; align-items:center; justify-content:center; text-align: center; gap:6px; padding: 8px; border-radius: 6px; text-decoration: none; line-height: 1.2; box-sizing: border-box;">🗓️ Open in GCal</a>
                                <a href="#" id="ikg-btn-mac-alarm" data-endms="${targetMs}" class="ikg-btn-outline" style="margin:0; font-size:11px; font-weight: 600; display:flex; align-items:center; justify-content:center; text-align: center; gap:6px; padding: 8px; border-radius: 6px; text-decoration: none; line-height: 1.2; box-sizing: border-box;">🍎 Download Mac OS .ics</a>
                            </div>
                        </div>
                    `;

                    const flexToggle = document.getElementById('ikg-today-flex');
                    if (flexToggle) {
                        flexToggle.addEventListener('change', (e) => {
                            localStorage.setItem(`IKG_TODAY_FLEX_${todayStr}`, e.target.checked);
                            sessionStorage.removeItem('IKG_ALARM_TARGET');
                            updateActiveShiftUI();
                        });
                    }

                    setTimeout(() => {
                        const btn = document.getElementById('ikg-btn-alarm');
                        if (!btn) return;

                        const cachedTarget = sessionStorage.getItem('IKG_ALARM_TARGET');
                        if (appSettings.autoSetAlarm && window.ikgScheduledTargetMs !== targetMs && cachedTarget !== targetMs.toString()) {
                            scheduleAlarms(targetMs, false);
                        } else if (window.ikgScheduledTargetMs === targetMs || cachedTarget === targetMs.toString()) {
                            if (window.ikgAlarmTimeouts.length === 0 && cachedTarget === targetMs.toString()) {
                                scheduleAlarms(targetMs, true);
                            } else {
                                const activeView = document.getElementById('ikg-alarm-active-view');
                                const statusText = document.getElementById('ikg-alarm-status-text');
                                if (activeView && statusText) {
                                    btn.style.display = 'none';
                                    statusText.innerText = `✅ Scheduled (${formatTime(targetMs)})`;
                                    statusText.style.color = 'var(--success)';
                                    activeView.style.background = 'var(--success-bg)';
                                    activeView.style.borderColor = 'rgba(16, 185, 129, 0.3)';
                                    activeView.style.display = 'flex';
                                }
                            }
                        }
                    }, 10);
                }
            } else { container.innerHTML = ''; }
        };

        const parseLocalDate = (dateString) => { if (!dateString) return null; const [y, m, d] = dateString.split('-'); return new Date(parseInt(y, 10), parseInt(m, 10) - 1, parseInt(d, 10)); };
        const formatDateForInput = (date) => { return date ? `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}` : ''; };

        class IkgDualCal {
            constructor(containerId, startInputId, endInputId, startClearId, endClearId, onRangeChange) {
                this.container = document.getElementById(containerId);
                this.startInput = document.getElementById(startInputId);
                this.endInput = document.getElementById(endInputId);
                this.startClear = document.getElementById(startClearId);
                this.endClear = document.getElementById(endClearId);
                this.onRangeChange = onRangeChange;

                this.popup = document.createElement('div');
                this.popup.className = 'ikg-cal-popup';
                this.container.appendChild(this.popup);

                this.currentMonth = new Date();
                this.rangeStart = null;
                this.rangeEnd = null;
                this.activeTarget = null;

                document.addEventListener('click', (e) => {
                    if (!e.composedPath().includes(this.popup) && !e.composedPath().includes(this.startInput) && !e.composedPath().includes(this.endInput) && !e.composedPath().includes(this.startClear) && !e.composedPath().includes(this.endClear)) this.closePopup();
                });

                this.startInput.addEventListener('click', (e) => { e.stopPropagation(); this.openPopup('start'); });
                this.endInput.addEventListener('click', (e) => { e.stopPropagation(); this.openPopup('end'); });

                this.startClear.addEventListener('click', (e) => { e.stopPropagation(); this.rangeStart = null; this.startInput.value = ''; this.startClear.style.display = 'none'; this.onRangeChange(); });
                this.endClear.addEventListener('click', (e) => { e.stopPropagation(); this.rangeEnd = null; this.endInput.value = ''; this.endClear.style.display = 'none'; this.onRangeChange(); });

                this.popup.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const minM = globalFirstDate !== "--" ? new Date(globalFirstDate) : new Date();
                    minM.setDate(1); minM.setHours(0, 0, 0, 0);

                    const currM = new Date(this.currentMonth.getFullYear(), this.currentMonth.getMonth(), 1);

                    if (e.target.closest('.prev')) {
                        if (currM <= minM) return;
                        this.currentMonth.setMonth(this.currentMonth.getMonth() - 1); this.render();
                    } else if (e.target.closest('.next')) {
                        const nextM = new Date(this.currentMonth.getFullYear(), this.currentMonth.getMonth() + 1, 1);
                        const today = new Date(); today.setDate(1); today.setHours(0, 0, 0, 0);
                        if (nextM > today) return;
                        this.currentMonth.setMonth(this.currentMonth.getMonth() + 1); this.render();
                    } else if (e.target.closest('.ikg-cal-day-cell:not(.empty):not(.disabled)')) {
                        const dayCell = e.target.closest('.ikg-cal-day-cell');
                        const selected = parseLocalDate(dayCell.dataset.date);

                        if (this.activeTarget === 'start') {
                            if (this.rangeEnd && selected > this.rangeEnd) return;
                            this.rangeStart = selected; this.startInput.value = formatDateForInput(selected); this.startClear.style.display = 'block';
                            if (!this.rangeEnd) this.openPopup('end'); else this.closePopup();
                        } else {
                            if (this.rangeStart && selected < this.rangeStart) return;
                            this.rangeEnd = selected; this.endInput.value = formatDateForInput(selected); this.endClear.style.display = 'block'; this.closePopup();
                        }
                        this.onRangeChange();
                    }
                });
            }
            openPopup(target) {
                this.activeTarget = target; this.startInput.classList.toggle('active', target === 'start'); this.endInput.classList.toggle('active', target === 'end');
                this.currentMonth = target === 'start' && this.rangeStart ? new Date(this.rangeStart) : (target === 'end' && this.rangeEnd ? new Date(this.rangeEnd) : new Date());
                this.render(); this.popup.classList.add('active');
            }
            closePopup() { this.popup.classList.remove('active'); this.startInput.classList.remove('active'); this.endInput.classList.remove('active'); }
            render() {
                const y = this.currentMonth.getFullYear(), m = this.currentMonth.getMonth(), next = new Date(y, m + 1, 1);
                this.popup.innerHTML = `${this.buildMonth(y, m, true)}${this.buildMonth(next.getFullYear(), next.getMonth(), false)}`;
                this.updateSelectionUI();
            }
            buildMonth(year, month, isLeft) {
                const firstDay = new Date(year, month, 1).getDay(), daysInMonth = new Date(year, month + 1, 0).getDate();
                const today = new Date(); today.setHours(23, 59, 59, 999); let daysHtml = '';
                for (let i = 0; i < firstDay; i++) daysHtml += `<div class="ikg-cal-day-cell empty"></div>`;
                for (let i = 1; i <= daysInMonth; i++) {
                    const c = new Date(year, month, i), dStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(i).padStart(2, '0')}`;
                    daysHtml += `<div class="ikg-cal-day-cell ${c > today ? 'disabled' : ''}" data-date="${dStr}">${i}</div>`;
                }
                const prevBtn = isLeft ? '<button class="ikg-cal-btn prev">❮</button>' : '<div class="ikg-cal-btn-placeholder"></div>';
                const nextBtn = !isLeft ? '<button class="ikg-cal-btn next">❯</button>' : '<div class="ikg-cal-btn-placeholder"></div>';
                return `
                <div class="ikg-cal-month">
                    <div class="ikg-cal-header-popup">${prevBtn}<span class="ikg-cal-month-title">${year} / ${String(month + 1).padStart(2, '0')}</span>${nextBtn}</div>
                    <div class="ikg-cal-weekdays"><div>Su</div><div>Mo</div><div>Tu</div><div>We</div><div>Th</div><div>Fr</div><div>Sa</div></div>
                    <div class="ikg-cal-days">${daysHtml}</div>
                </div>`;
            }
            updateSelectionUI() {
                const st = this.rangeStart ? this.rangeStart.getTime() : null, et = this.rangeEnd ? this.rangeEnd.getTime() : null;
                this.popup.querySelectorAll('.ikg-cal-day-cell:not(.empty)').forEach(el => {
                    const ct = parseLocalDate(el.dataset.date).getTime(); el.classList.remove('start-date', 'end-date', 'in-range');
                    if (st && ct === st) el.classList.add('start-date'); if (et && ct === et) el.classList.add('end-date'); if (st && et && ct > st && ct < et) el.classList.add('in-range');
                });
            }
        }

        let statsCalInstance = null;
        let auditCalInstance = null;

        // --- RENDER LOGIC ---
        function renderCalendar() {
            const grid = document.getElementById('ikg-cal-grid');
            const headerText = document.getElementById('ikg-cal-month-text');
            const prevBtn = document.getElementById('ikg-prev-month');
            const nextBtn = document.getElementById('ikg-next-month');

            grid.innerHTML = '';
            const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
            headerText.innerText = `${monthNames[currentViewMonth - 1]} ${currentViewYear}`;

            const todayReal = new Date();
            nextBtn.classList.toggle('hidden', currentViewYear === todayReal.getFullYear() && currentViewMonth === todayReal.getMonth() + 1);
            if (globalFirstDate !== "--") {
                const fd = new Date(globalFirstDate);
                prevBtn.classList.toggle('hidden', currentViewYear === fd.getFullYear() && currentViewMonth === fd.getMonth() + 1);
            }

            const firstDay = new Date(currentViewYear, currentViewMonth - 1, 1).getDay();
            const daysInMonth = new Date(currentViewYear, currentViewMonth, 0).getDate();

            let localCache = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
            let dayNotes = JSON.parse(localStorage.getItem(DAY_NOTES_KEY) || '{}');

            const monthStr = `${currentViewYear}-${String(currentViewMonth).padStart(2, '0')}`;
            const todayStr = `${todayReal.getFullYear()}-${String(todayReal.getMonth() + 1).padStart(2, '0')}-${String(todayReal.getDate()).padStart(2, '0')}`;

            for (let i = 0; i < firstDay; i++) grid.innerHTML += `<div class="ikg-day empty"></div>`;

            let monthWorkedDays = 0;
            let monthTotalHours = 0;
            let ptoDays = 0;
            
            // 🎯 NEW REQUIRED VARIABLES
            const overrides = JSON.parse(localStorage.getItem(OVERRIDES_KEY) || '{}');
            const settings = getSettings();

            for (let i = 1; i <= daysInMonth; i++) {
                const dateStr = `${monthStr}-${String(i).padStart(2, '0')}`;
                const record = localCache[dateStr];
                
                // 🎯 THE FIX: Pass all 5 arguments
                const evalDay = evaluateDay(dateStr, record, dayNotes[dateStr], overrides[dateStr], settings.useManualOverrides);

                let isToday = (dateStr === todayStr);
                let cellContent = '';
                let partialPill = ''; // 🎯 Initialized outside so it can be injected into the header

                if (isFetchingData && dateStr <= todayStr && record === undefined && !evalDay.isFullPTO) {
                    cellContent = `<div class="ikg-cell-data"><div class="skeleton skel-hrs"></div><div class="skeleton skel-box"></div></div>`;
                }
                else if (evalDay.isFullPTO) {
                    ptoDays++;
                    cellContent = `<div class="pto-pill">🏝️ ${evalDay.ptoType}</div>`;
                }
                else if (record && record.startTime) {
                    if (!isToday) monthWorkedDays++;
                    if (!isToday) monthTotalHours = safeFloat(monthTotalHours + evalDay.effectiveHrs);

                    let pendingIcon = '';
                    let timesClass = '';
                    
                    // 🎯 THE FIX: Use effStart/effEnd from evaluateDay, not the raw API record
                    const inTimeDisplay = evalDay.effStart ? formatTime(evalDay.effStart) : formatTime(record.startTime);
                    let outTimeDisplay = evalDay.effEnd ? formatTime(evalDay.effEnd) : (record.endTime ? formatTime(record.endTime) : '--:--');

                    if (evalDay.status === 'pending') {
                        timesClass = 'pending';
                        pendingIcon = ' <span style="font-size:12px; margin-bottom:2px;" title="Waiting for checkout data...">⌛</span>';
                        outTimeDisplay = "Pending";
                    }

                    // 🎯 UI FIX: Move pill to the date header.
                    const shortPtoName = evalDay.ptoType ? evalDay.ptoType.split(' - ')[0] : 'PTO';
                    if (evalDay.isPartialPTO) {
                        partialPill = `<div class="ikg-fast-tt no-dot" data-title="${evalDay.ptoType}" style="font-size:9px; background:var(--pto); color:#fff; padding:2px 5px; border-radius:4px; font-weight:700; letter-spacing:0.5px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:70px; box-shadow: 0 2px 4px rgba(139,92,246,0.3); cursor:help; margin-right:auto;">+${evalDay.ptoHrs}h ${shortPtoName}</div>`;
                    }

                    const flexTooltip = evalDay.flexHrs >= 0 ? `+${formatDurFromDec(evalDay.flexHrs, false)}` : `Short by ${formatDurFromDec(Math.abs(evalDay.flexHrs), false)}`;
                    let activeShiftStyles = (isToday && evalDay.status !== 'pass' && evalDay.status !== 'partial-pto-pass') ? 'background:var(--primary-glow); border:1px solid var(--border);' : '';

                    cellContent = `
                        <div class="ikg-cell-data">
                            <div class="ikg-total-hrs ikg-fast-tt" data-title="${flexTooltip}" style="color:${evalDay.color}; width:fit-content; cursor:help; margin-bottom:4px; min-height:22px; display:flex; align-items:center;">
                                ${evalDay.actualHrs > 0 ? evalDay.actualHrs.toFixed(2) + 'h' : (isToday ? '--.--h' : '0.00h')} ${pendingIcon}
                            </div>
                            <div class="ikg-times ${timesClass}" style="margin-top:auto; ${activeShiftStyles}">
                                <div>IN <span>${inTimeDisplay}</span></div>
                                <div>OUT <span>${outTimeDisplay}</span></div>
                            </div>
                        </div>
                    `;
                }

                // 🎯 INJECT PILL INTO HEADER
                grid.innerHTML += `
                    <div class="ikg-day ${isToday ? 'today' : ''}" data-date="${dateStr}">
                        <div class="ikg-date-header" style="align-items: center;">
                            ${partialPill}
                            <div class="ikg-date-num">${i}</div>
                        </div>
                        ${cellContent}
                    </div>`;
            }

            const totalCells = firstDay + daysInMonth;
            for (let i = 0; i < (42 - totalCells); i++) grid.innerHTML += `<div class="ikg-day empty"></div>`;

            const targetHours = safeFloat((monthWorkedDays + ptoDays) * 9.0);
            const effectiveHours = safeFloat(monthTotalHours + (ptoDays * 9.0));
            const netBalance = safeFloat(effectiveHours - targetHours);

            document.getElementById('side-val-days').innerText = monthWorkedDays + ptoDays;
            document.getElementById('side-val-actual').innerText = formatDurFromDec(effectiveHours, false);
            document.getElementById('side-val-target').innerText = formatDurFromDec(targetHours, false);

            const balanceEl = document.getElementById('side-val-net');
            if (netBalance > 0) balanceEl.innerHTML = `<span class="good">${formatDurFromDec(netBalance, true)}</span>`;
            else if (netBalance < 0) balanceEl.innerHTML = `<span class="bad">${formatDurFromDec(netBalance, true)}</span>`;
            else balanceEl.innerHTML = `<span style="color:var(--text-muted)">Perfect</span>`;

            updateActiveShiftUI();
        }

        function renderSettings() {
            const settings = getSettings();
            const soundSelect = document.getElementById('set-sound');

            if (soundSelect) {
                soundSelect.value = settings.soundType;
                if (soundSelect.selectedIndex === -1) {
                    soundSelect.value = 'pro_fkj';
                    settings.soundType = 'pro_fkj';
                    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
                }
            }

            const volSlider = document.getElementById('set-volume');
            if (volSlider) {
                volSlider.value = settings.volume !== undefined ? settings.volume : 0.8;
                document.getElementById('set-volume-val').innerText = `${Math.round(volSlider.value * 100)}%`;
            }

            // 🎯 FIXED: Load the checkbox state visually (Defaults to true via getSettings())
        const overrideCheckbox = document.getElementById('set-use-overrides');
        if (overrideCheckbox) {
            overrideCheckbox.checked = settings.useManualOverrides !== false; 
        }

        const manualShiftEl = document.getElementById('set-manual-shift');
            if (manualShiftEl) manualShiftEl.value = settings.manualShift || 'auto';

            const uploadWrap = document.getElementById('set-upload-wrap');
            const fileNameEl = document.getElementById('set-file-name');

            if (settings.soundType === 'custom') {
                uploadWrap.classList.add('visible');
                if (settings.mp3Name) fileNameEl.innerText = `Current Audio: ${settings.mp3Name}`;
            } else {
                uploadWrap.classList.remove('visible');
            }

            document.getElementById('set-use-flex').checked = settings.useFlexDef;
            document.getElementById('set-show-secs').checked = settings.showSeconds;
            document.getElementById('set-auto-alarm').checked = settings.autoSetAlarm;
            document.getElementById('set-snooze').value = settings.snoozeMins;
            document.getElementById('set-snooze-unit').value = settings.snoozeUnit || 'm';
            document.getElementById('set-trigger-unit').value = settings.triggerUnit || 'm';
            document.getElementById('set-triggers').value = settings.triggers.join(', ');

            document.getElementById('set-img-type').value = settings.alarmImgType;
            document.getElementById('set-pulse-speed').value = settings.pulseSpeed;

            const imgWrap = document.getElementById('set-img-upload-wrap');
            const imgPreview = document.getElementById('set-img-preview');

            if (settings.alarmImgType === 'custom') {
                imgWrap.classList.add('visible');
                if (settings.alarmImgName) document.getElementById('set-img-name').innerText = settings.alarmImgName;
                IKG_DB.get('custom_alarm_img').then(data => {
                    imgPreview.src = data || 'https://attendance.iki-utl.cc/favicon.png';
                });
            } else {
                imgWrap.classList.remove('visible');
                imgPreview.src = DEFAULT_GIF_URL;
            }
        }

        function renderAudit(localCache) {
            currentAuditMonth = populateMonthSelect('ikg-audit-month', localCache, currentAuditMonth);

            const allDates = Object.keys(localCache).filter(d => localCache[d] && localCache[d].workHours).sort().reverse();
            let filteredDates = [];
            const todayObj = new Date(); todayObj.setHours(0, 0, 0, 0);

            if (currentAuditRange === '7D') {
                let iterDate = new Date(todayObj);
                let wDaysCount = 1;
                if (iterDate.getDay() === 0 || iterDate.getDay() === 6) wDaysCount = 0;
                while (wDaysCount < 7) {
                    iterDate.setDate(iterDate.getDate() - 1);
                    if (iterDate.getDay() !== 0 && iterDate.getDay() !== 6) wDaysCount++;
                }
                filteredDates = allDates.filter(d => new Date(d) >= iterDate);
            } else if (currentAuditRange === '30D') {
                const cutoff = new Date(todayObj.getTime() - 29 * 86400000);
                filteredDates = allDates.filter(d => new Date(d) >= cutoff);
            } else if (currentAuditRange === 'MONTH') {
                filteredDates = allDates.filter(d => d.startsWith(currentAuditMonth));
            } else if (currentAuditRange === 'CUSTOM') {
                const rStart = auditCalInstance ? auditCalInstance.rangeStart : null;
                const rEnd = auditCalInstance ? auditCalInstance.rangeEnd : null;
                filteredDates = allDates.filter(d => {
                    const cur = parseLocalDate(d);
                    if (rStart && cur < rStart) return false;
                    if (rEnd && cur > rEnd) return false;
                    return true;
                });
            } else if (currentAuditRange === 'ALL') {
                filteredDates = allDates;
            }

            const tbody = document.getElementById('audit-table-body');
            const dayNotes = JSON.parse(localStorage.getItem(DAY_NOTES_KEY) || '{}');
            const overrides = JSON.parse(localStorage.getItem(OVERRIDES_KEY) || '{}'); // 🎯 NEW
            const settings = getSettings(); // 🎯 NEW
            
            if (!tbody) return;

            let html = '';
            filteredDates.forEach(dateStr => {
                const record = localCache[dateStr];
                if (record && record.startTime && record.endTime) {
                    // 🎯 THE FIX
                    const evalDay = evaluateDay(dateStr, record, dayNotes[dateStr], overrides[dateStr], settings.useManualOverrides);

                    // 🎯 FORCE AUDIT TO USE THE OVERRIDE MATH
                    const exactHrs = evalDay.actualHrs;
                    const exactFlexHrs = evalDay.flexHrs;
                    const flexStr = exactFlexHrs === 0 ? '-' : formatDurFromDec(exactFlexHrs, true);
                    
                    // Show spoofed times if overridden, else show raw API times
                    const startDisplay = evalDay.effStart ? formatTime(evalDay.effStart) : formatTime(record.startTime);
                    const endDisplay = evalDay.effEnd ? formatTime(evalDay.effEnd) : formatTime(record.endTime);

                    let reasonHtml = evalDay.isPartialPTO ? `<div style="font-size:11px; color:var(--pto); font-weight:600; margin-top:4px;">inc. +${evalDay.ptoHrs}h ${evalDay.ptoType}</div>` : '';
                    if (evalDay.isSpoofed) reasonHtml += `<div style="font-size:10px; color:var(--warn); margin-top:4px;">(Manual Override)</div>`;

                    html += `
                        <tr>
                            <td>${dateStr}</td>
                            <td>${startDisplay}</td>
                            <td>${endDisplay}</td>
                            <td>${formatDurFromDec(exactHrs, false)}</td>
                            <td style="color:${evalDay.color}; font-weight:bold; line-height: 1.4;">
                                ${flexStr}
                                ${reasonHtml}
                            </td>
                        </tr>
                    `;
                }
            });
            tbody.innerHTML = html;
        }

        function renderAnalytics(localCache) {
            currentStatsMonth = populateMonthSelect('ikg-stats-month', localCache, currentStatsMonth);
            const dayNotes = JSON.parse(localStorage.getItem(DAY_NOTES_KEY) || '{}');

            const allDates = [...new Set([
                ...Object.keys(localCache).filter(d => localCache[d] && localCache[d].workHours),
                ...Object.keys(dayNotes).filter(d => dayNotes[d] && (dayNotes[d].isPTO || dayNotes[d].isPartialPTO))
            ])].sort();

            let filteredDates = [];
            const todayObj = new Date(); todayObj.setHours(0, 0, 0, 0);

            if (currentStatsRange === '7D') {
                let iterDate = new Date(todayObj);
                let wDaysCount = 1;
                if (iterDate.getDay() === 0 || iterDate.getDay() === 6) wDaysCount = 0;
                while (wDaysCount < 7) {
                    iterDate.setDate(iterDate.getDate() - 1);
                    if (iterDate.getDay() !== 0 && iterDate.getDay() !== 6) wDaysCount++;
                }
                filteredDates = allDates.filter(d => new Date(d) >= iterDate);
            } else if (currentStatsRange === '30D') {
                const cutoff = new Date(todayObj.getTime() - 29 * 86400000);
                filteredDates = allDates.filter(d => new Date(d) >= cutoff);
            } else if (currentStatsRange === 'MONTH') {
                filteredDates = allDates.filter(d => d.startsWith(currentStatsMonth));
            } else if (currentStatsRange === 'CUSTOM') {
                const rStart = statsCalInstance ? statsCalInstance.rangeStart : null;
                const rEnd = statsCalInstance ? statsCalInstance.rangeEnd : null;
                filteredDates = allDates.filter(d => {
                    const cur = parseLocalDate(d);
                    if (rStart && cur < rStart) return false;
                    if (rEnd && cur > rEnd) return false;
                    return true;
                });
            } else if (currentStatsRange === 'ALL') {
                filteredDates = allDates;
            }

            // 🎯 NEW
            const overrides = JSON.parse(localStorage.getItem(OVERRIDES_KEY) || '{}');
            const settings = getSettings();

            let inMsArr = []; let outMsArr = []; let shiftHrsArr = [];
            let filterTotalDays = 0;
            let filterTotalHours = 0;

            const todayStr = `${todayObj.getFullYear()}-${String(todayObj.getMonth() + 1).padStart(2, '0')}-${String(todayObj.getDate()).padStart(2, '0')}`;

            filteredDates.forEach(dateStr => {
                const record = localCache[dateStr];
                const note = dayNotes[dateStr];
                const isFullPTO = note?.isPTO;
                
                // 🎯 THE FIX 1
                const evalDay = evaluateDay(dateStr, record, note, overrides[dateStr], settings.useManualOverrides);
                const hrs = evalDay.actualHrs; // 🎯 FORCE OVERRIDE RESPECT

                if (evalDay.status !== 'pending' && evalDay.status !== 'none') {
                    filterTotalDays++;
                    filterTotalHours = safeFloat(filterTotalHours + evalDay.effectiveHrs);
                }

                if (!isFullPTO && !isNaN(hrs) && hrs > 0) {
                    if (dateStr !== todayStr || (dateStr === todayStr && hrs >= 9.0)) {
                        if (record.startTime && record.endTime) {
                            const start = new Date(record.startTime);
                            const end = new Date(record.endTime);
                            inMsArr.push(start.getHours() * 3600000 + start.getMinutes() * 60000 + start.getSeconds() * 1000);
                            outMsArr.push(end.getHours() * 3600000 + end.getMinutes() * 60000 + end.getSeconds() * 1000);
                        }
                        shiftHrsArr.push(hrs);
                    }
                }
            });

            // Calculate statistics
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
                const counts = {}; let maxCount = 0; let modeVal = arr[0];
                arr.forEach(v => {
                    const binned = Math.round(v * 10) / 10;
                    counts[binned] = (counts[binned] || 0) + 1;
                    if (counts[binned] > maxCount) { maxCount = counts[binned]; modeVal = binned; }
                });
                return modeVal;
            };

            const meanShift = getMean(shiftHrsArr);

            // Update Routine Patterns and Insights
            document.getElementById('habit-val-in-mean').innerText = msToTimeString(getMean(inMsArr));
            document.getElementById('habit-val-in-med').innerText = msToTimeString(getMedian(inMsArr));
            document.getElementById('habit-val-out-mean').innerText = msToTimeString(getMean(outMsArr));
            document.getElementById('habit-val-out-med').innerText = msToTimeString(getMedian(outMsArr));
            document.getElementById('habit-val-hrs-mean').innerText = isNaN(meanShift) ? '--' : formatDurFromDec(meanShift, false);
            document.getElementById('habit-val-hrs-med').innerText = isNaN(getMedian(shiftHrsArr)) ? '--' : formatDurFromDec(getMedian(shiftHrsArr), false);
            document.getElementById('habit-val-hrs-mode').innerText = isNaN(getMode(shiftHrsArr)) ? '--' : `~${getMode(shiftHrsArr).toFixed(1)}h`;
            document.getElementById('habit-val-hrs-std').innerText = isNaN(getStdDev(shiftHrsArr, meanShift)) ? '--' : `±${formatDurFromDec(getStdDev(shiftHrsArr, meanShift), false)}`;
            document.getElementById('habit-val-hrs-range').innerText = isNaN(getRange(shiftHrsArr)) ? '--' : formatDurFromDec(getRange(shiftHrsArr), false);

            // 🎯 TARGET HOURS CALCULATION
            const filterTargetHours = safeFloat(filterTotalDays * 9.0);

            const titleMap = {
                '7D': 'Past 7 Working Days', '30D': 'Past 30 Days', 'MONTH': `${currentStatsMonth} Totals`, 'CUSTOM': 'Custom Range Totals', 'ALL': 'Lifetime System Stats'
            };
            const summaryTitle = document.getElementById('stats-summary-title');
            if (summaryTitle) summaryTitle.innerText = titleMap[currentStatsRange] || 'System Stats';

            document.getElementById('all-val-days').innerText = filterTotalDays;
            document.getElementById('all-val-hours').innerText = formatDurFromDec(filterTotalHours, false);
            document.getElementById('all-val-target').innerText = formatDurFromDec(filterTargetHours, false);
            document.getElementById('all-val-first').innerText = filteredDates.length > 0 ? filteredDates[0] : '--';

            // Render Chart or Heatmap
            const canvasContainer = document.querySelector('.ikg-canvas-container');
            const heatmapWrapper = document.getElementById('ikg-heatmap-wrapper');

            if (currentAnalyticsView === 'GRID') {
            canvasContainer.style.display = 'none';
            heatmapWrapper.style.display = 'flex';
            const heatmapGrid = document.getElementById('ikg-heatmap-grid');
            const monthsContainer = document.getElementById('ikg-heatmap-months');
            heatmapGrid.innerHTML = ''; monthsContainer.innerHTML = '';

            // 🎯 FIXED: Grid now strictly obeys active Time Filters instead of all-time
            if (filteredDates.length > 0) {
                let start = new Date(filteredDates[0]);
                let end = new Date(filteredDates[filteredDates.length - 1]);
                
                // Pad to full weeks (Sunday to Saturday)
                start.setHours(0, 0, 0, 0); start.setDate(start.getDate() - start.getDay());
                end.setHours(0, 0, 0, 0); end.setDate(end.getDate() + (6 - end.getDay()));

                // Cap the future grid to today's week so it doesn't draw into next month needlessly
                let maxEnd = new Date(todayObj);
                maxEnd.setDate(maxEnd.getDate() + (6 - maxEnd.getDay()));
                if (end > maxEnd) end = maxEnd;

                const totalDays = Math.round((end - start) / 86400000) + 1;
                const totalCols = totalDays / 7;
                
                // 🎯 FIXED: Capped maximum column width at 75px to prevent ugly stretching
                heatmapGrid.style.gridTemplateColumns = `repeat(${totalCols}, minmax(32px, 75px))`;
                
                // 🎯 FIXED: Apply the exact same grid layout to the months header for perfect alignment
                monthsContainer.style.display = 'grid';
                monthsContainer.style.gridTemplateColumns = `repeat(${totalCols}, minmax(32px, 75px))`;
                monthsContainer.style.gap = '4px';

                let curr = new Date(start); let currentMonth = -1;
                for (let c = 0; c < totalCols; c++) {
                    let isNewMonth = false; let monthName = "";
                    for (let r = 0; r < 7; r++) {
                        const dStr = `${curr.getFullYear()}-${String(curr.getMonth() + 1).padStart(2, '0')}-${String(curr.getDate()).padStart(2, '0')}`;
                        if (curr.getMonth() !== currentMonth && curr.getDate() <= 7) {
                            currentMonth = curr.getMonth(); isNewMonth = true;
                            monthName = curr.toLocaleString('default', { month: 'short' });
                        }
                        const rec = localCache[dStr]; const note = dayNotes[dStr];
                        const evalDay = evaluateDay(dStr, rec, note, overrides[dStr], settings.useManualOverrides);
                        
                        const shortPto = evalDay.ptoType ? evalDay.ptoType.split(' - ')[0] : 'PTO';
                        
                        let color = 'var(--bg-elevated)'; let title = dStr; let pointerEvent = ''; let innerTxt = '';

                        if (curr > todayObj) { color = 'transparent'; title = ''; pointerEvent = 'pointer-events:none;'; }
                        else if (evalDay.status === 'full-pto') { 
                            color = evalDay.heatmapBg; title = `${dStr} | ${evalDay.ptoHrs}h ${shortPto}`; innerTxt = 'PTO'; 
                        }
                        else if (evalDay.actualHrs > 0) {
                            color = evalDay.heatmapBg;
                            if (evalDay.isPartialPTO) title = `${dStr} | ${evalDay.effectiveHrs.toFixed(2)}h (${evalDay.actualHrs.toFixed(1)}h worked + ${evalDay.ptoHrs}h ${shortPto})`;
                            else title = `${dStr} | ${evalDay.actualHrs.toFixed(2)}h worked`;
                            
                            if (evalDay.isSpoofed) title += ' ⚠️(Override)';
                            innerTxt = evalDay.effectiveHrs.toFixed(1);
                        } else if (evalDay.status === 'pending') { 
                            color = evalDay.heatmapBg; title += ' | Pending'; innerTxt = '⌛'; 
                        }

                       // 🎯 FIXED: Purged static title strings so the smart multi-line card system takes over tracking
heatmapGrid.innerHTML += `
    <div class="ikg-heat-sq" style="background:${color}; ${pointerEvent}" data-date="${dStr}" data-jump="${dStr}">
        <div class="heat-date">${curr.getDate()}</div>
        <div>${innerTxt}</div>
    </div>`;
                        curr.setDate(curr.getDate() + 1);
                    }
                    
                    // 🎯 FIXED: Place the month title directly into its corresponding column cell
                    if (isNewMonth) {
                        monthsContainer.innerHTML += `<div style="font-size:11px; color:var(--text-muted); font-weight:500;">${monthName}</div>`;
                    } else {
                        monthsContainer.innerHTML += `<div></div>`; // Empty filler block to maintain alignment
                    }
                }
            }
        } else {
                canvasContainer.style.display = 'block'; 
                heatmapWrapper.style.display = 'none';
                const dataItems = []; const labels = [];
                filteredDates.forEach(dStr => {
                    const d = new Date(dStr); const isDense = filteredDates.length > 60;
                    labels.push(isDense ? `${d.getMonth() + 1}/${d.getDate()}` : `${d.toLocaleString('default', { month: 'short' })} ${d.getDate()}`);
                    
                    const evalDay = evaluateDay(dStr, localCache[dStr], dayNotes[dStr], overrides[dStr], settings.useManualOverrides);
                    
                    // 🎯 Pass full context to the native chart drawer
                    dataItems.push({ 
                        dateStr: dStr, 
                        val: evalDay.actualHrs, 
                        pto: evalDay.ptoHrs, 
                        color: evalDay.chartColor, 
                        isSpoofed: evalDay.isSpoofed,
                        ptoType: evalDay.ptoType
                    });
                });
                drawNativeChart('ikg-main-chart', labels, dataItems);
            }
        }

        function buildUI() {
            if (document.getElementById('ikg-fab')) return;

            const fab = document.createElement('button'); fab.id = 'ikg-fab'; fab.innerHTML = '📊 Dashboard'; document.body.appendChild(fab);

            const backdrop = document.createElement('div'); backdrop.id = 'ikg-modal-backdrop';
            backdrop.innerHTML = `
                <div id="ikg-modal">
                    <header id="ikg-modal-header">
                        <div class="ikg-title-area"><img src="/favicon.png" style="width:28px; border-radius:6px;"> Attendance Pro</div>
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
                                        <span>Date</span>
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

                        <div id="view-settings" class="ikg-view" style="padding: 32px 48px; background: var(--bg-surface); justify-content: center; align-items: flex-start;">
                            <div style="width: 100%; max-width: 900px; display: flex; flex-direction: column; gap: 20px;">
                                
                                <div class="set-header-wrap">
                                    <div class="set-header">⚙️ Preferences & Customization</div>
                                    <div style="font-size:14px; color:var(--text-muted);">Configure how Attendance Pro behaves. (Changes save automatically)</div>
                                </div>

                                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px;">
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
                                        <div style="font-size:12px; color:var(--text-muted); line-height:1.5;">
                                            Your attendance data syncs <b>automatically</b> in the background every 15 minutes. Use this button only to force a manual hard-refresh.
                                        </div>
                                        <button class="ikg-sync-btn" id="ikg-btn-fetch" disabled style="margin-top: auto; padding: 10px;">Manual Sync Data</button>
                                    </div>
                                </div>

                            </div>
                        </div>

                        <div id="view-rules" class="ikg-view" style="padding: 32px 48px; overflow-y: auto; background: var(--bg-surface); align-items: flex-start; justify-content: center;">
                            <div style="width: 100%; max-width: 900px; display: flex; flex-direction: column; gap: 20px;">
                                
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
            statsCalInstance = new IkgDualCal('stats-cal-container', 'stats-date-start', 'stats-date-end', 'stats-clear-start', 'stats-clear-end', () => {
                renderAnalytics(JSON.parse(localStorage.getItem(CACHE_KEY) || '{}'));
            });

            auditCalInstance = new IkgDualCal('audit-cal-container', 'audit-date-start', 'audit-date-end', 'audit-clear-start', 'audit-clear-end', () => {
                renderAudit(JSON.parse(localStorage.getItem(CACHE_KEY) || '{}'));
            });

            setTimeout(() => backdrop.classList.add('open'), 10);

            fab.addEventListener('click', () => { IkgLog.debug("Modal opened."); backdrop.classList.add('open'); renderCalendar(); });
            document.getElementById('ikg-close').addEventListener('click', () => { IkgLog.debug("Modal closed."); backdrop.classList.remove('open'); });

            backdrop.addEventListener('click', (e) => {
                if (e.target === backdrop) backdrop.classList.remove('open');
            }, true);

            const switchTab = (tabId, viewId) => {
                document.querySelectorAll('.ikg-tab').forEach(t => t.classList.remove('active'));
                document.querySelectorAll('.ikg-view').forEach(v => v.classList.remove('active'));
                document.getElementById(tabId).classList.add('active');
                document.getElementById(viewId).classList.add('active');
            };

            document.getElementById('tab-cal').addEventListener('click', () => { switchTab('tab-cal', 'view-cal'); activeTab = 'cal'; });
            document.getElementById('tab-stats').addEventListener('click', () => { switchTab('tab-stats', 'view-stats'); activeTab = 'stats'; renderAnalytics(JSON.parse(localStorage.getItem(CACHE_KEY) || '{}')); });
            document.getElementById('tab-audit').addEventListener('click', () => { switchTab('tab-audit', 'view-audit'); activeTab = 'audit'; renderAudit(JSON.parse(localStorage.getItem(CACHE_KEY) || '{}')); });
            document.getElementById('tab-rules').addEventListener('click', () => { switchTab('tab-rules', 'view-rules'); activeTab = 'rules'; });
            document.getElementById('tab-settings').addEventListener('click', () => { switchTab('tab-settings', 'view-settings'); activeTab = 'settings'; renderSettings(); });

            // Setup State Helpers
            const saveStatsState = () => {
                localStorage.setItem(STATS_STATE_KEY, JSON.stringify({
                    range: currentStatsRange, month: currentStatsMonth,
                    start: statsCalInstance ? statsCalInstance.rangeStart : null, end: statsCalInstance ? statsCalInstance.rangeEnd : null
                }));
            };
            const saveAuditState = () => {
                localStorage.setItem(AUDIT_STATE_KEY, JSON.stringify({
                    range: currentAuditRange, month: currentAuditMonth,
                    start: auditCalInstance ? auditCalInstance.rangeStart : null, end: auditCalInstance ? auditCalInstance.rangeEnd : null
                }));
            };

            // Instantiate Custom Calendars
            statsCalInstance = new IkgDualCal('stats-cal-container', 'stats-date-start', 'stats-date-end', 'stats-clear-start', 'stats-clear-end', () => {
                saveStatsState(); renderAnalytics(JSON.parse(localStorage.getItem(CACHE_KEY) || '{}'));
            });
            statsCalInstance.rangeStart = statsRangeStart; statsCalInstance.rangeEnd = statsRangeEnd;
            if (statsRangeStart) { document.getElementById('stats-date-start').value = formatDateForInput(statsRangeStart); document.getElementById('stats-clear-start').style.display = 'block'; }
            if (statsRangeEnd) { document.getElementById('stats-date-end').value = formatDateForInput(statsRangeEnd); document.getElementById('stats-clear-end').style.display = 'block'; }

            auditCalInstance = new IkgDualCal('audit-cal-container', 'audit-date-start', 'audit-date-end', 'audit-clear-start', 'audit-clear-end', () => {
                saveAuditState(); renderAudit(JSON.parse(localStorage.getItem(CACHE_KEY) || '{}'));
            });
            auditCalInstance.rangeStart = auditRangeStart; auditCalInstance.rangeEnd = auditRangeEnd;
            if (auditRangeStart) { document.getElementById('audit-date-start').value = formatDateForInput(auditRangeStart); document.getElementById('audit-clear-start').style.display = 'block'; }
            if (auditRangeEnd) { document.getElementById('audit-date-end').value = formatDateForInput(auditRangeEnd); document.getElementById('audit-clear-end').style.display = 'block'; }

            // Apply Loaded Active States to Filter Bars
            document.querySelectorAll('.stats-filter').forEach(btn => {
                btn.classList.remove('active');
                if (btn.dataset.range === currentStatsRange) btn.classList.add('active');
            });
            document.getElementById('stats-cal-container').style.display = currentStatsRange === 'CUSTOM' ? 'flex' : 'none';

            document.querySelectorAll('.audit-filter').forEach(btn => {
                btn.classList.remove('active');
                if (btn.dataset.range === currentAuditRange) btn.classList.add('active');
            });
            document.getElementById('audit-cal-container').style.display = currentAuditRange === 'CUSTOM' ? 'flex' : 'none';

            const savedAgg = localStorage.getItem(AGG_CACHE_KEY);
            if (savedAgg) {
                try {
                    const parsed = JSON.parse(savedAgg);
                    globalTotalDays = parsed.globalTotalDays || 0; globalTotalHours = parsed.globalTotalHours || 0; globalFirstDate = parsed.globalFirstDate || "--";
                    document.getElementById('all-val-days').innerText = globalTotalDays; document.getElementById('all-val-hours').innerText = formatDurFromDec(globalTotalHours, false); document.getElementById('all-val-first').innerText = globalFirstDate;
                } catch (e) { IkgLog.error("Failed to parse aggregate cache", e); }
            }

            renderCalendar();
            renderAnalytics(JSON.parse(localStorage.getItem(CACHE_KEY) || '{}'));
            renderAudit(JSON.parse(localStorage.getItem(CACHE_KEY) || '{}'));
            renderSettings();

            // --- FILTER BUTTON LISTENERS ---
            document.querySelectorAll('.stats-filter').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    if (e.target.tagName === 'SELECT' && currentStatsRange === 'MONTH') return;
                    document.querySelectorAll('.stats-filter').forEach(b => b.classList.remove('active'));
                    e.target.classList.add('active');
                    currentStatsRange = e.target.getAttribute('data-range');

                    document.getElementById('stats-cal-container').style.display = currentStatsRange === 'CUSTOM' ? 'flex' : 'none';
                    saveStatsState();
                    IkgLog.info(`Stats range changed: ${currentStatsRange}`);
                    renderAnalytics(JSON.parse(localStorage.getItem(CACHE_KEY) || '{}'));
                });
            });

            document.getElementById('ikg-stats-month').addEventListener('change', (e) => {
                document.querySelectorAll('.stats-filter').forEach(b => b.classList.remove('active'));
                e.target.classList.add('active');
                currentStatsRange = 'MONTH';
                currentStatsMonth = e.target.value;
                saveStatsState();
                IkgLog.info(`Stats month changed: ${currentStatsMonth}`);
                renderAnalytics(JSON.parse(localStorage.getItem(CACHE_KEY) || '{}'));
            });

            document.querySelectorAll('.audit-filter').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    if (e.target.tagName === 'SELECT' && currentAuditRange === 'MONTH') return;
                    document.querySelectorAll('.audit-filter').forEach(b => b.classList.remove('active'));
                    e.target.classList.add('active');
                    currentAuditRange = e.target.getAttribute('data-range');

                    document.getElementById('audit-cal-container').style.display = currentAuditRange === 'CUSTOM' ? 'flex' : 'none';
                    saveAuditState();
                    IkgLog.info(`Audit range changed: ${currentAuditRange}`);
                    renderAudit(JSON.parse(localStorage.getItem(CACHE_KEY) || '{}'));
                });
            });

            document.getElementById('ikg-audit-month').addEventListener('change', (e) => {
                document.querySelectorAll('.audit-filter').forEach(b => b.classList.remove('active'));
                e.target.classList.add('active');
                currentAuditRange = 'MONTH';
                currentAuditMonth = e.target.value;
                saveAuditState();
                IkgLog.info(`Audit month changed: ${currentAuditMonth}`);
                renderAudit(JSON.parse(localStorage.getItem(CACHE_KEY) || '{}'));
            });

            window.addEventListener('resize', () => {
                if (activeTab === 'stats' && currentStatsRange !== 'ALL') {
                    renderAnalytics(JSON.parse(localStorage.getItem(CACHE_KEY) || '{}'));
                }
            });

            const smartMonthNavigate = () => {
                renderCalendar();
                let localCache = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
                const viewPrefix = `${currentViewYear}-${String(currentViewMonth).padStart(2, '0')}`;
                const daysInViewMonth = new Date(currentViewYear, currentViewMonth, 0).getDate();
                const todayStr = toYMD(new Date());

                for (let i = 1; i <= daysInViewMonth; i++) {
                    const dateStr = `${viewPrefix}-${String(i).padStart(2, '0')}`;
                    if (dateStr <= todayStr && localCache[dateStr] === undefined) {
                        IkgLog.info(`Uncached day detected (${dateStr}). Auto-triggering background sync.`);
                        const syncBtn = document.getElementById('ikg-btn-fetch');
                        if (!syncBtn.disabled) syncBtn.click();
                        break;
                    }
                }
            };

            document.getElementById('ikg-prev-month').addEventListener('click', () => { currentViewMonth--; if (currentViewMonth === 0) { currentViewMonth = 12; currentViewYear--; } smartMonthNavigate(); });
            document.getElementById('ikg-next-month').addEventListener('click', () => { currentViewMonth++; if (currentViewMonth === 13) { currentViewMonth = 1; currentViewYear++; } smartMonthNavigate(); });

            const heatmapGridEl = document.getElementById('ikg-heatmap-grid');
            if (heatmapGridEl) {
                // Keep your existing click handler to navigate back to calendar cells
                heatmapGridEl.addEventListener('click', (e) => {
                    const heatSq = e.target.closest('.ikg-heat-sq'); 
                    if (heatSq) {
                        const jumpStr = heatSq.getAttribute('data-jump');
                        if (jumpStr) {
                            currentViewYear = new Date(jumpStr).getFullYear(); 
                            currentViewMonth = new Date(jumpStr).getMonth() + 1;
                            document.getElementById('tab-cal').click(); 
                            renderCalendar();
                        }
                    }
                });

                // 🎯 NEW: DYNAMIC MULTI-LINE HOVER CARD FOR GRID ENTRIES
                let gridTooltip = document.getElementById('ikg-grid-tooltip');

                heatmapGridEl.addEventListener('mousemove', (e) => {
                    const sq = e.target.closest('.ikg-heat-sq');
                    if (sq) {
                        const dStr = sq.getAttribute('data-jump');
                        if (!dStr) { if (gridTooltip) gridTooltip.style.opacity = '0'; return; }

                        const localCache = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
                        const notes = JSON.parse(localStorage.getItem(DAY_NOTES_KEY) || '{}');
                        const overrides = JSON.parse(localStorage.getItem(OVERRIDES_KEY) || '{}');
                        const settings = getSettings();

                        const evalDay = evaluateDay(dStr, localCache[dStr], notes[dStr], overrides[dStr], settings.useManualOverrides);
                        if (evalDay.status === 'none') { if (gridTooltip) gridTooltip.style.opacity = '0'; return; }

                        const cleanPtoLabel = evalDay.ptoType ? evalDay.ptoType.split(' - ')[0] : 'PTO';
                        const dObj = new Date(dStr);
                        const monthNames = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
                        const formattedDateLabel = `${monthNames[dObj.getMonth()]} ${dObj.getDate()}`;

                        // 🎯 MINIMALIST GRID HOVER CARD (Emoji Only)
                        let text = `<div style="color:var(--text-muted); font-size:11px; margin-bottom:8px; font-weight:700; letter-spacing:0.05em; text-transform:uppercase;">${formattedDateLabel}</div>`;

                        const totalHrs = evalDay.actualHrs + evalDay.ptoHrs;
                        const totalColor = totalHrs >= 9.0 ? 'var(--success)' : 'var(--danger)';

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

                        if (totalHrs > 0) {
                            text += `<div style="grid-column: 1 / -1; margin: 4px 0; border-top: 1px dashed var(--border);"></div>`;
                            text += `
                                <div style="text-align:center; font-size:14px;" title="Total">📊</div>
                                <div style="color:${totalColor}; font-weight:700;">${totalHrs.toFixed(2)}h</div>
                            `;
                        } else if (evalDay.isFullPTO) {
                            text += `<div style="grid-column: 1 / -1; color:var(--pto); font-weight:700; margin-top:4px;">🏝️ Full Day PTO</div>`;
                        } else if (evalDay.status === 'pending') {
                            text += `<div style="grid-column: 1 / -1; color:var(--warn); font-weight: 600; margin-top:4px;">⌛ Pending</div>`;
                        }

                        text += `</div>`; // Close grid

                        if (evalDay.isSpoofed) {
                            text += `<div style="color:var(--warn); font-size:10px; margin-top:8px; font-weight:600;">⚠️ Manual Override Active</div>`;
                        }

                        if (!gridTooltip) {
                            gridTooltip = document.createElement('div');
                            gridTooltip.id = 'ikg-grid-tooltip';
                            gridTooltip.style.cssText = 'position:absolute; background:var(--bg-elevated); color:var(--text-main); padding:10px 14px; border-radius:8px; font-size:12px; font-weight:500; border:1px solid var(--border); box-shadow:0 12px 28px rgba(0,0,0,0.6); pointer-events:none; opacity:0; transition:opacity 0.1s; z-index:100; white-space:nowrap; line-height:1.5; font-family:var(--font-family);';
                            document.getElementById('ikg-chart-pane').appendChild(gridTooltip);
                        }

                        const paneRect = document.getElementById('ikg-chart-pane').getBoundingClientRect();
                        gridTooltip.innerHTML = text;
                        gridTooltip.style.left = `${e.clientX - paneRect.left + 20}px`;
                        gridTooltip.style.top = `${e.clientY - paneRect.top - 40}px`;
                        gridTooltip.style.opacity = '1';
                    } else {
                        if (gridTooltip) gridTooltip.style.opacity = '0';
                    }
                });

                heatmapGridEl.addEventListener('mouseleave', () => {
                    if (gridTooltip) gridTooltip.style.opacity = '0';
                });
            }

            const dmOverlay = document.querySelector('.day-modal-overlay');
            const dmModal = document.getElementById('ikg-day-modal');
            let activeModalDate = null;
            let saveTimeout = null;

            const handleAutoSave = () => {
                if (!activeModalDate) return;
                const manIn = document.getElementById('dm-manual-in').value; 
                const manOut = document.getElementById('dm-manual-out').value;

                let overrides = JSON.parse(localStorage.getItem(OVERRIDES_KEY) || '{}');

                if (manIn || manOut) {
                    overrides[activeModalDate] = { 
                        manualIn: manIn || null, 
                        manualOut: manOut || null 
                    };
                } else {
                    delete overrides[activeModalDate]; 
                }
                localStorage.setItem(OVERRIDES_KEY, JSON.stringify(overrides));

                // Visual save indicator
                const statusEl = document.getElementById('dm-save-status');
                if (statusEl) {
                    statusEl.style.opacity = '1';
                    clearTimeout(saveTimeout);
                    saveTimeout = setTimeout(() => { statusEl.style.opacity = '0'; }, 1200);
                }

                const cache = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
                renderCalendar();
                if (activeTab === 'stats') renderAnalytics(cache);
                if (activeTab === 'audit') renderAudit(cache);
            };

            const inputIn = document.getElementById('dm-manual-in');
            const inputOut = document.getElementById('dm-manual-out');
            
            // Native time inputs trigger 'input' reliably and safely
            if (inputIn) inputIn.addEventListener('input', handleAutoSave);
            if (inputOut) inputOut.addEventListener('input', handleAutoSave);

            // Delegate grid clicks
            const calGrid = document.getElementById('ikg-cal-grid');
            if (calGrid) {
                calGrid.addEventListener('click', (e) => {
                    const dayEl = e.target.closest('.ikg-day:not(.empty)');
                    if (dayEl) {
                        activeModalDate = dayEl.getAttribute('data-date');
                        const titleDateSpan = document.querySelector('#dm-title-date span:first-child');
                        if (titleDateSpan) titleDateSpan.innerText = activeModalDate;

                        const overrides = JSON.parse(localStorage.getItem(OVERRIDES_KEY) || '{}');
                        const localCache = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}'); 
                        const record = localCache[activeModalDate]; 

                        const toTimeInputStr = (ms) => {
                            if (!ms) return '';
                            const d = new Date(ms);
                            const pad = n => String(n).padStart(2, '0');
                            return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
                        };

                        if (inputIn) inputIn.value = overrides[activeModalDate]?.manualIn || (record?.startTime ? toTimeInputStr(record.startTime) : '');
                        if (inputOut) inputOut.value = overrides[activeModalDate]?.manualOut || (record?.endTime ? toTimeInputStr(record.endTime) : '');

                        if (dmModal) dmModal.classList.add('open');
                    }
                });
            }

            const closeBtn = document.getElementById('dm-close-btn');
            if (closeBtn) {
                closeBtn.addEventListener('click', () => { if (dmModal) dmModal.classList.remove('open'); });
            }
            
            // Safe document boundary tracking
            document.addEventListener('click', (e) => {
                if (dmModal && dmModal.classList.contains('open')) {
                    if (!dmModal.contains(e.target) && !e.target.closest('.ikg-day') && !e.target.closest('.ikg-heat-sq')) {
                        dmModal.classList.remove('open');
                    }
                }
            });

        // Safe Heatmap-to-Calendar Day Jump Navigation
        const heatmapGrid = document.getElementById('ikg-heatmap-grid');
        if (heatmapGrid) {
            heatmapGrid.addEventListener('click', (e) => {
                const heatSq = e.target.closest('.ikg-heat-sq');
                if (heatSq) {
                    const jumpStr = heatSq.getAttribute('data-jump');
                    if (jumpStr) {
                        const targetDate = new Date(jumpStr);
                        currentViewYear = targetDate.getFullYear();
                        currentViewMonth = targetDate.getMonth() + 1;
                        
                        const calTabBtn = document.getElementById('tab-cal');
                        if (calTabBtn) calTabBtn.click();
                        renderCalendar();
                    }
                }
            });
        }

            // 📊 Hook up the Chart/Grid View Toggle
            document.querySelectorAll('.view-toggle').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    document.querySelectorAll('.view-toggle').forEach(b => b.classList.remove('active'));
                    e.target.classList.add('active');
                    currentAnalyticsView = e.target.getAttribute('data-view');
                    renderAnalytics(JSON.parse(localStorage.getItem(CACHE_KEY) || '{}'));
                });
            });

            // 2. Hook up the Settings Checkbox
            const overrideCheckbox = document.getElementById('set-use-overrides');
            if (overrideCheckbox) {
                overrideCheckbox.checked = getSettings().useManualOverrides;
                overrideCheckbox.addEventListener('change', (e) => {
                    const s = getSettings(); s.useManualOverrides = e.target.checked;
                    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
                    renderCalendar();
                });
            }
            
            dmOverlay.addEventListener('click', () => { dmOverlay.classList.remove('open'); dmModal.classList.remove('open'); });

            // 🎯 SETTINGS AUTOSAVE LOGIC
            let tempMp3Data = null; let tempMp3Name = "";
            let tempImgData = null; let tempImgName = "";

            const autoSaveSettings = async () => {
                const settings = getSettings();
                settings.soundType = document.getElementById('set-sound').value;
                settings.snoozeMins = parseFloat(document.getElementById('set-snooze').value) || 5;
                settings.snoozeUnit = document.getElementById('set-snooze-unit').value;
                settings.triggerUnit = document.getElementById('set-trigger-unit').value;
                settings.useFlexDef = document.getElementById('set-use-flex').checked;
                settings.showSeconds = document.getElementById('set-show-secs').checked;
                settings.autoSetAlarm = document.getElementById('set-auto-alarm').checked;
                settings.manualShift = document.getElementById('set-manual-shift').value;
                settings.alarmImgType = document.getElementById('set-img-type').value;
                settings.pulseSpeed = parseFloat(document.getElementById('set-pulse-speed').value) || 0;
                
                // 🎯 THE FIX: Force it to read the Manual Override checkbox!
                const overrideCheckbox = document.getElementById('set-use-overrides');
                if (overrideCheckbox) settings.useManualOverrides = overrideCheckbox.checked;

                const volVal = parseFloat(document.getElementById('set-volume').value);
                settings.volume = isNaN(volVal) ? 0.8 : volVal;

                const triggersStr = document.getElementById('set-triggers').value;
                // Sort lowest to highest so earlier warnings fire first
                settings.triggers = triggersStr.split(',').map(s => parseFloat(s.trim())).filter(n => !isNaN(n)).sort((a, b) => a - b);
                if (settings.triggers.length === 0) settings.triggers = [0];

                if (settings.soundType === 'custom' && tempMp3Data) {
                    await IKG_DB.save('custom_alarm_mp3', tempMp3Data);
                    settings.mp3Name = tempMp3Name;
                }
                if (settings.alarmImgType === 'custom' && tempImgData) {
                    await IKG_DB.save('custom_alarm_img', tempImgData);
                    settings.alarmImgName = tempImgName;
                }

                localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
                IkgLog.info("Auto-saved Settings", settings);
                renderCalendar();
                updateHeaderStatus('✅ Settings Saved', 'var(--success)');
                setTimeout(() => updateHeaderStatus('✅ Synced', 'var(--success)'), 2000);
            };

// 🎯 THE FIX: Added 'set-use-overrides' to the array so clicking it triggers autoSaveSettings
            ['set-sound', 'set-img-type', 'set-pulse-speed', 'set-snooze', 'set-snooze-unit', 'set-trigger-unit', 'set-use-flex', 'set-show-secs', 'set-auto-alarm', 'set-manual-shift', 'set-volume', 'set-use-overrides'].forEach(id => { document.getElementById(id).addEventListener('change', autoSaveSettings); });            document.getElementById('set-triggers').addEventListener('change', autoSaveSettings);

            // Live Volume Update
            document.getElementById('set-volume').addEventListener('input', (e) => {
                const val = parseFloat(e.target.value);
                document.getElementById('set-volume-val').innerText = `${Math.round(val * 100)}%`;
                if (AudioEngine.isPlaying && AudioEngine.audioEl) {
                    AudioEngine.audioEl.volume = val;
                }
            });

            // UI Toggles for Audio/Image Dropdowns
            document.getElementById('set-sound').addEventListener('change', (e) => {
                const wrap = document.getElementById('set-upload-wrap');
                if (e.target.value === 'custom') wrap.classList.add('visible'); else wrap.classList.remove('visible');
            });

            document.getElementById('set-img-type').addEventListener('change', async (e) => {
                const wrap = document.getElementById('set-img-upload-wrap');
                const preview = document.getElementById('set-img-preview');
                if (e.target.value === 'custom') {
                    wrap.classList.add('visible');
                    if (tempImgData) preview.src = tempImgData;
                    else {
                        const savedImg = await IKG_DB.get('custom_alarm_img');
                        preview.src = savedImg || 'https://attendance.iki-utl.cc/favicon.png';
                    }
                } else {
                    wrap.classList.remove('visible');
                    preview.src = DEFAULT_GIF_URL; // Native URL
                }
            });

            // The Audio File Uploader
            document.getElementById('set-file-input').addEventListener('change', (e) => {
                const file = e.target.files[0]; if (!file) return;
                const reader = new FileReader();
                reader.onload = (ev) => {
                    tempMp3Data = ev.target.result; tempMp3Name = file.name;
                    document.getElementById('set-file-name').innerText = `Selected: ${file.name}`;
                    autoSaveSettings();
                };
                reader.readAsDataURL(file);
            });

            // The Image File Uploader
            document.getElementById('set-img-input').addEventListener('change', (e) => {
                const file = e.target.files[0]; if (!file) return;
                const reader = new FileReader();
                reader.onload = (ev) => {
                    tempImgData = ev.target.result; tempImgName = file.name;
                    document.getElementById('set-img-name').innerText = `Selected: ${file.name}`;
                    document.getElementById('set-img-preview').src = tempImgData; // Live preview update
                    autoSaveSettings();
                };
                reader.readAsDataURL(file);
            });

            let isPreviewing = false;
            document.getElementById('ikg-btn-preview').addEventListener('click', async (e) => {
                const btn = e.target;
                if (isPreviewing) {
                    AudioEngine.stop(); isPreviewing = false;
                    btn.innerText = "▶️ Play"; btn.style.borderColor = "var(--primary)"; btn.style.color = "var(--primary)";
                } else {
                    const type = document.getElementById('set-sound').value;
                    if (type === 'custom' && tempMp3Data) {
                        AudioEngine.stop(); AudioEngine.isPlaying = true; AudioEngine.audioEl = new Audio(tempMp3Data);
                        AudioEngine.audioEl.play().catch(e => IkgLog.error("Preview failed", e));
                    } else { await AudioEngine.play(type); }
                    isPreviewing = true;
                    btn.innerText = "⏹️ Stop"; btn.style.borderColor = "var(--danger)"; btn.style.color = "var(--danger)";
                }
            });

            // ==========================================
            // 6. SINGLE AUTO-SYNC ON PAGE LOAD
            // ==========================================
            let hasAutoSynced = false; // Ensures it only runs once per page load

            const tokenCheck = setInterval(() => {
                if (authToken) {
                    const fetchBtn = document.getElementById('ikg-btn-fetch');
                    if (fetchBtn) {
                        fetchBtn.disabled = false;
                        clearInterval(tokenCheck); // Stop checking once we have the token

                        if (!hasAutoSynced) {
                            hasAutoSynced = true;
                            IkgLog.info("Initial Page Load detected. Auto-triggering full data sync...");
                            fetchBtn.click(); // 🎯 Triggers Attendance + Deel PTO automatically
                        }
                    }
                }
            }, 300);

            // 🎯 THE RANGE PROTOCOL IMPLEMENTATION 
            document.getElementById('ikg-btn-fetch').addEventListener('click', async () => {
                IkgLog.info("Sync Triggered via The Range Protocol.");
                const btn = document.getElementById('ikg-btn-fetch');
                btn.disabled = true; isFetchingData = true;

                let localCache = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
                const dayNotes = JSON.parse(localStorage.getItem(DAY_NOTES_KEY) || '{}');

                const todayReal = new Date();
                const todayStr = toYMD(todayReal);
                const didFullSync = localStorage.getItem(SYNC_FLAG_KEY);

                if (!didFullSync) {
                    IkgLog.info("Executing 90-day chunked Deep Sync.");
                    updateHeaderStatus("Deep Syncing History...", "var(--primary)");
                    renderCalendar();

                    let endD = new Date(todayReal);
                    while (true) {
                        let startD = new Date(endD.getTime() - 90 * 86400000);
                        const endStr = toYMD(endD);
                        const startStr = toYMD(startD);

                        updateHeaderStatus(`Syncing ${startStr}...`, "var(--primary)");
                        try {
                            const res = await window.fetch(`${API_BASE}/attendance/range?from=${startStr}&to=${endStr}`, { method: "GET", headers: { "accept": "*/*", "authorization": authToken } });
                            const data = await res.json();
                            const records = data.records || [];

                            fillCacheGaps(startStr, endStr, records, localCache);

                            if (records.length === 0) break;
                            const earliestRecordDateStr = records.reduce((min, r) => r.PK < min ? r.PK : min, "9999-99-99");
                            const gapDays = (new Date(earliestRecordDateStr) - startD) / 86400000;
                            if (gapDays >= 30) break;

                        } catch (e) { break; }
                        endD = new Date(startD.getTime() - 86400000);
                    }
                    localStorage.setItem(SYNC_FLAG_KEY, "true");
                } else {
                    updateHeaderStatus("⚡ Lightning Sync...", "var(--primary)");
                    renderCalendar();
                    const fetchTasks = [];

                    let iterDate = new Date(todayReal);
                    let wDaysCount = 1;
                    if (iterDate.getDay() === 0 || iterDate.getDay() === 6) wDaysCount = 0;
                    while (wDaysCount < 7) {
                        iterDate.setDate(iterDate.getDate() - 1);
                        if (iterDate.getDay() !== 0 && iterDate.getDay() !== 6) wDaysCount++;
                    }
                    const start7Str = toYMD(iterDate);

                    fetchTasks.push(
                        window.fetch(`${API_BASE}/attendance/range?from=${start7Str}&to=${todayStr}`, { method: "GET", headers: { "accept": "*/*", "authorization": authToken } })
                            .then(res => res.json()).then(data => { fillCacheGaps(start7Str, todayStr, data.records || [], localCache); }).catch(e => { })
                    );

                    const viewPrefix = `${currentViewYear}-${String(currentViewMonth).padStart(2, '0')}`;
                    const daysInViewMonth = new Date(currentViewYear, currentViewMonth, 0).getDate();
                    let needsViewMonth = false;
                    for (let i = 1; i <= daysInViewMonth; i++) {
                        const dateStr = `${viewPrefix}-${String(i).padStart(2, '0')}`;
                        if (dateStr <= todayStr && localCache[dateStr] === undefined) { needsViewMonth = true; break; }
                    }

                    if (needsViewMonth) {
                        const vStartStr = `${viewPrefix}-01`;
                        const vEndD = new Date(currentViewYear, currentViewMonth, 0);
                        const vEndStr = toYMD(vEndD < todayReal ? vEndD : todayReal);
                        fetchTasks.push(
                            window.fetch(`${API_BASE}/attendance/range?from=${vStartStr}&to=${vEndStr}`, { method: "GET", headers: { "accept": "*/*", "authorization": authToken } })
                                .then(res => res.json()).then(data => { fillCacheGaps(vStartStr, vEndStr, data.records || [], localCache); }).catch(e => { })
                        );
                    }
                    await Promise.all(fetchTasks);
                }

                // 1. Release the main UI instantly
                isFetchingData = false;
                localStorage.setItem(CACHE_KEY, JSON.stringify(localCache));
                
                updateHeaderStatus('Syncing Deel PTO...', 'var(--warn)');
                renderCalendar(); // Renders IKG data immediately
                if (activeTab === 'stats') renderAnalytics(localCache);
                if (activeTab === 'audit') renderAudit(localCache);

                // 2. Fetch Deel completely non-blocking
                fetchAndParseDeelPTO().then(deelPto => {
                    if (deelPto && Object.keys(deelPto.ptoCalendar).length > 0) {
                        Object.keys(deelPto.ptoCalendar).forEach(dateStr => {
                            const ptoInfo = deelPto.ptoCalendar[dateStr];
                            dayNotes[dateStr] = {
                                isPTO: ptoInfo.isFullDay,
                                isPartialPTO: !ptoInfo.isFullDay,
                                source: 'Deel', type: ptoInfo.type, deductedHours: ptoInfo.hours
                            };
                        });
                        localStorage.setItem(DAY_NOTES_KEY, JSON.stringify(dayNotes));
                        IkgLog.info(`Successfully injected ${Object.keys(deelPto.ptoCalendar).length} PTO records from Deel.`);
                        
                        // Re-render silently to show new PTO pills
                        renderCalendar();
                        if (activeTab === 'stats') renderAnalytics(localCache);
                        if (activeTab === 'audit') renderAudit(localCache);
                    }
                    
                    // Finalize Cache Aggregates
                    globalTotalDays = 0; globalTotalHours = 0; let earliestDate = "9999-99-99";
                    Object.keys(localCache).forEach(dateStr => {
                        const record = localCache[dateStr];
                        if (record && record.startTime && record.workHours) {
                            const hrs = parseFloat(record.workHours);
                            if (dateStr !== todayStr || (dateStr === todayStr && hrs >= 9.0)) {
                                globalTotalDays++; globalTotalHours = safeFloat(globalTotalHours + hrs);
                                if (dateStr < earliestDate) earliestDate = dateStr;
                            }
                        }
                    });
                    globalFirstDate = earliestDate === "9999-99-99" ? "--" : earliestDate;
                    localStorage.setItem(AGG_CACHE_KEY, JSON.stringify({ globalTotalDays, globalTotalHours, globalFirstDate }));
                    
                    document.getElementById('all-val-days').innerText = globalTotalDays;
                    document.getElementById('all-val-hours').innerText = formatDurFromDec(globalTotalHours, false);
                    document.getElementById('all-val-first').innerText = globalFirstDate;

                    updateHeaderStatus('✅ Synced', 'var(--success)');
                    btn.disabled = false;
                });
            });
        }

        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', buildUI); else buildUI();

    })();