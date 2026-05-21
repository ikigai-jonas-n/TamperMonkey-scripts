// ==UserScript==
// @name         [19.22] EnvDashboard Matrix History & Overview (Ultimate Live Engine)
// @namespace    http://tampermonkey.net/
// @version      19.22
// @description  Pipeline Tooltips, Dashboard Timeline FAB, Auto-Highlight Notifications, Smart Toast Stacking
// @author       JonasNg
// @match        https://lab.iki-utl.cc/dashboard/env-dashboard/
// @grant        GM_addStyle
// @updateURL    https://gist.githubusercontent.com/ikigai-jonas-n/f532c3a6c1b3cdeb7d6bbbfba3ecfd0e/raw/QA-env-dashboard.user.js
// @downloadURL  https://gist.githubusercontent.com/ikigai-jonas-n/f532c3a6c1b3cdeb7d6bbbfba3ecfd0e/raw/QA-env-dashboard.user.js
// ==/UserScript==

(function () {
    'use strict';

    // --- State & Settings Management ---
    const SETTINGS_KEY = 'env_dash_rgs_settings';

    const DEFAULT_SETTINGS = {
        fontSize: 10, maxWidth: 180, maxHeight: 60, maxItems: 50, flowFontSize: 9, flowLineLen: 50,
        hideYear: true, hideTime: true, isExpanded: true,
        saveFilters: false,
        repoMode: 'pinned',
        colOrder: [
            "id", "date", "creator", "repo", "version", "env", "region", "title", "flow", "status", "action"
        ],
        colWidths: {
            id: 55, date: 115, creator: 80, repo: 159, env: 63, region: 130, version: 109, title: 234, flow: 320, status: 81, action: 85
        },
        matrixStatuses: { APPROVED: true, REJECTED: true, INPROGRESS: true },
        repoToggles: {}
    };

    let settings = { ...DEFAULT_SETTINGS, ...(JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}) };
    if (settings.saveFilters === undefined) settings.saveFilters = DEFAULT_SETTINGS.saveFilters;
    if (!settings.colWidths) settings.colWidths = DEFAULT_SETTINGS.colWidths;
    if (!settings.colOrder) settings.colOrder = DEFAULT_SETTINGS.colOrder;
    if (!settings.flowFontSize) settings.flowFontSize = 9;
    if (!settings.flowLineLen) settings.flowLineLen = 50;
    if (!settings.matrixStatuses) settings.matrixStatuses = DEFAULT_SETTINGS.matrixStatuses;
    if (!settings.repoMode) settings.repoMode = DEFAULT_SETTINGS.repoMode;
    if (!settings.repoToggles) settings.repoToggles = {};

    Object.keys(DEFAULT_SETTINGS.colWidths).forEach(k => {
        if (!settings.colWidths[k]) settings.colWidths[k] = DEFAULT_SETTINGS.colWidths[k];
    });

    let globalWorkflows = [];
    let globalWfIds = new Set();
    let activeCacheMap = {};
    let globalGroups = {};
    let engineStarted = false;
    let notificationsActive = false;
    let renderTimeout = null;
    let saveTimeout = null;
    let currentUser = null;
    let myPendingApprovals = new Set();
    let isTooltipLocked = false;

    // --- Core Utils ---
    function log(msg, ...args) { console.log('%c [EnvDash Streamer] ', 'background: #10b981; color: #fff; font-weight: bold; border-radius: 3px;', msg, ...args); }
    function escapeRegExp(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
    function escapeQuotes(str) { return String(str || '').replace(/"/g, '&quot;'); }
    function highlightHTML(text, highlightSet) {
        if (!highlightSet || highlightSet.size === 0 || !text) return text || '';
        let safeText = String(text).replace(/</g, "&lt;").replace(/>/g, "&gt;");
        const terms = Array.from(highlightSet).filter(Boolean).sort((a, b) => b.length - a.length);
        if (terms.length === 0) return safeText;
        return safeText.replace(new RegExp(`(${terms.map(escapeRegExp).join('|')})`, 'gi'), '<mark class="rgs-mark">$1</mark>');
    }
    function debounce(func, wait) {
        let timeout;
        return function (...args) {
            clearTimeout(timeout);
            timeout = setTimeout(() => func.apply(this, args), wait);
        };
    }
    function formatLocalTime(utcString) {
        if (!utcString) return null;
        const safeUtc = utcString.endsWith('Z') ? utcString : utcString + 'Z';
        const d = new Date(safeUtc);
        if (isNaN(d.getTime())) return null;
        const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
        const h = String(d.getHours()).padStart(2, '0'), min = String(d.getMinutes()).padStart(2, '0'), s = String(d.getSeconds()).padStart(2, '0');
        return { dateObj: d, full: `${y}-${m}-${day} ${h}:${min}:${s}`, year: `${y}`, date: `${m}-${day}`, time: `${h}:${min}`, dayIndex: d.getDay() };
    }
    function formatDateForInput(date) { return date ? `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}` : ''; }
    function parseLocalDate(dateString) { if (!dateString) return null; const [y, m, d] = dateString.split('-'); return new Date(parseInt(y, 10), parseInt(m, 10) - 1, parseInt(d, 10)); }
    function levenshtein(a, b) {
        if (a.length === 0) return b.length;
        if (b.length === 0) return a.length;
        const matrix = Array.from({ length: b.length + 1 }, (_, i) => [i]);
        for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
        for (let i = 1; i <= b.length; i++) {
            for (let j = 1; j <= a.length; j++) {
                if (b.charAt(i - 1) === a.charAt(j - 1)) matrix[i][j] = matrix[i - 1][j - 1];
                else matrix[i][j] = Math.min(matrix[i - 1][j - 1] + 1, Math.min(matrix[i][j - 1] + 1, matrix[i - 1][j] + 1));
            }
        }
        return matrix[b.length][a.length];
    }
    function truncateMiddle(str, maxLen = 20) {
        if (!str) return '';
        const s = String(str);
        if (s.length <= maxLen) return s;
        const front = Math.ceil((maxLen - 3) / 2);
        const back = Math.floor((maxLen - 3) / 2);
        return s.substring(0, front) + '...' + s.substring(s.length - back);
    }

    // --- Identity Engine ---
    async function fetchCurrentUser() {
        try {
            const res = await fetch('https://lab.iki-utl.cc/dashboard/api/user');
            if (res.ok) {
                currentUser = await res.json();
                log("Current User Authenticated:", currentUser.username);
            }
        } catch (e) {
            log("Failed to fetch current user.");
        }
    }

    async function fetchGroups() {
        try {
            const res = await fetch('https://lab.iki-utl.cc/dashboard/workflow-api/groups', { cache: 'no-store' });
            if (res.ok) {
                globalGroups = await res.json();
                log("Dynamic User Groups fetched successfully.");
            }
        } catch (e) {
            log("Failed to fetch user groups.");
        }
    }

    function updateActionFab() {
        const fab = document.getElementById('rgs-action-fab');
        const badge = document.getElementById('rgs-action-badge');
        if (fab && badge) {
            if (myPendingApprovals.size > 0) {
                fab.style.display = 'flex';
                badge.textContent = myPendingApprovals.size;
            } else {
                fab.style.display = 'none';
                if (typeof OverviewManager !== 'undefined' && OverviewManager.myApprovalsOnly) {
                    OverviewManager.myApprovalsOnly = false;
                    const clrBtn = document.getElementById('ov-clear-approvals');
                    if (clrBtn) clrBtn.style.display = 'none';
                    if (OverviewManager.isLoaded) OverviewManager.triggerCrossFilter();
                }
            }
        }
    }

    // --- Global Color Engine ---
    function getStatusDotColor(status) {
        const s = (status || '').toUpperCase();
        if (s === 'APPROVED' || s === 'SUCCESS') return '#10b981';
        if (s === 'REJECTED' || s === 'FAILED' || s === 'FAILURE' || s === 'CANCELED' || s === 'CANCELLED') return '#ef4444';
        if (s === 'INPROGRESS' || s === 'RUNNING') return '#f59e0b';
        return '#94a3b8';
    }

    function getStatusStyle(status) {
        const s = (status || '').toUpperCase();
        if (s === 'APPROVED' || s === 'SUCCESS') return 'background: #dcfce7; color: #166534; border: 1px solid #86efac;';
        if (s === 'REJECTED' || s === 'FAILED' || s === 'FAILURE' || s === 'CANCELED' || s === 'CANCELLED') return 'background: #fee2e2; color: #991b1b; border: 1px solid #fca5a5;';
        if (s === 'INPROGRESS' || s === 'RUNNING') return 'background: #fef9c3; color: #9a3412; border: 1px solid #fde047;';
        return 'background: #f1f5f9; color: #475569; border: 1px solid #cbd5e1;';
    }

    // --- Notification & Inbox System ---
    const NotificationManager = {
        inbox: JSON.parse(localStorage.getItem('env_dash_inbox') || '[]'),
        unreadCount: 0,
        init() {
            if (document.getElementById('rgs-inbox-fab')) return;
            if (!settings.notifFilter) settings.notifFilter = 'all';

            document.body.insertAdjacentHTML('beforeend', `
                <div id="rgs-toast-container"></div>
                <div id="rgs-action-fab" class="rgs-action-fab" style="display:none;" title="Action Required: You have pending approvals!">
                    🚨<span id="rgs-action-badge">0</span>
                </div>
                <div id="rgs-inbox-fab" class="rgs-inbox-fab">
                    🔔<span id="rgs-inbox-badge">0</span>
                </div>
                <div id="rgs-inbox-panel" class="rgs-inbox-panel">
                    <div class="rgs-inbox-header">
                        <div style="display:flex; align-items:center; gap:8px;">
                            <span style="font-weight: bold; color: #0f172a;">Notifications</span>
                            <select id="rgs-inbox-filter" style="font-size:10px; border:1px solid #cbd5e1; border-radius:4px; padding:2px; outline:none; cursor:pointer;">
                                <option value="pinned" ${settings.notifFilter === 'pinned' ? 'selected' : ''}>📌 Pinned</option>
                                <option value="all" ${settings.notifFilter === 'all' ? 'selected' : ''}>🌐 All Repos</option>
                            </select>
                        </div>
                        <div>
                            <button id="rgs-inbox-clear" style="font-size: 14px; margin-right: 8px; color: #ef4444;" title="Clear All Notifications">🗑️</button>
                            <button id="rgs-inbox-close">×</button>
                        </div>
                    </div>
                    <div id="rgs-inbox-list" class="rgs-inbox-list"></div>
                </div>
            `);

            // --- ALL EVENT LISTENERS ---
            document.getElementById('rgs-inbox-fab').addEventListener('click', () => {
                document.getElementById('rgs-inbox-panel').classList.toggle('active');
                this.renderInbox();
            });

            document.getElementById('rgs-inbox-close').addEventListener('click', () => {
                document.getElementById('rgs-inbox-panel').classList.remove('active');
            });

            // NEW: Clear Button Event Listener
            document.getElementById('rgs-inbox-clear').addEventListener('click', () => {
                if (confirm('Are you sure you want to clear all notifications?')) {
                    this.inbox = [];
                    localStorage.removeItem('env_dash_inbox');
                    this.updateBadge();
                    this.renderInbox();
                }
            });

            document.getElementById('rgs-inbox-filter').addEventListener('change', (e) => {
                settings.notifFilter = e.target.value;
                saveSettings();
                this.updateBadge();
                this.renderInbox();
            });

            document.getElementById('rgs-action-fab').addEventListener('click', () => {
                if (typeof OverviewManager !== 'undefined') {
                    OverviewManager.myApprovalsOnly = true;
                    OverviewManager.open();
                }
            });

            this.updateBadge();
            this.renderInbox();
            updateActionFab();
        },
        add(title, message, wfId, repoNames, status) {
            const id = Date.now();
            const notif = { id, title, message, wfId, repoNames: repoNames || [], status: status || 'UNKNOWN', read: false, time: new Date().toLocaleTimeString() };
            this.inbox.unshift(notif);
            if (this.inbox.length > 50) this.inbox.length = 50;
            localStorage.setItem('env_dash_inbox', JSON.stringify(this.inbox));

            this.updateBadge();

            const isPinnedOnly = settings.notifFilter === 'pinned';
            const pinnedList = getPinnedRepos();
            const isRelevant = !isPinnedOnly || notif.repoNames.some(r => pinnedList.includes(r.replace('Tolgee: ', '')));

            if (isRelevant) this.showToast(notif);
            if (document.getElementById('rgs-inbox-panel').classList.contains('active')) this.renderInbox();
        },
        updateStatus(wfId, newStatus) {
            let updated = false;
            this.inbox.forEach(i => {
                if (String(i.wfId) === String(wfId) && i.status !== newStatus) {
                    i.status = newStatus;
                    updated = true;
                }
            });
            if (updated) {
                localStorage.setItem('env_dash_inbox', JSON.stringify(this.inbox));
                if (document.getElementById('rgs-inbox-panel').classList.contains('active')) {
                    this.renderInbox();
                }
                // Live sync active toasts on screen
                document.querySelectorAll(`.rgs-toast[data-wfid="${wfId}"] .rgs-toast-status`).forEach(el => {
                    el.textContent = newStatus;
                    el.style.cssText = `position: absolute; top: 10px; right: 28px; padding: 2px 6px; border-radius: 4px; font-size: 9px; font-weight: bold; line-height: 1; box-shadow: 0 2px 4px rgba(0,0,0,0.05); ${getStatusStyle(newStatus)}`;
                });
            }
        },
        updateBadge() {
            const badge = document.getElementById('rgs-inbox-badge');
            if (badge) {
                const isPinnedOnly = settings.notifFilter === 'pinned';
                const pinnedList = getPinnedRepos();
                const visibleNotifs = this.inbox.filter(i => {
                    if (!isPinnedOnly) return true;
                    return (i.repoNames || []).some(r => pinnedList.includes(r.replace('Tolgee: ', '')));
                });

                this.unreadCount = visibleNotifs.filter(i => !i.read).length;
                badge.textContent = this.unreadCount;
                badge.classList.toggle('active', this.unreadCount > 0);
            }
        },
        markAsRead(id) {
            const item = this.inbox.find(i => i.id === id);
            if (item && !item.read) {
                item.read = true;
                localStorage.setItem('env_dash_inbox', JSON.stringify(this.inbox));
                this.updateBadge();
                const node = document.querySelector(`.rgs-inbox-item[data-nid="${id}"]`);
                if (node) node.classList.remove('unread');
            }
        },
        manageToastStack() {
            const container = document.getElementById('rgs-toast-container');
            if (!container) return;
            const toasts = container.querySelectorAll('.rgs-toast');
            let clearBtn = document.getElementById('rgs-toast-clear-btn');

            // Apple Style Stack feature: inject "Clear All" if 3 or more toasts stack up
            if (toasts.length >= 3) {
                if (!clearBtn) {
                    clearBtn = document.createElement('button');
                    clearBtn.id = 'rgs-toast-clear-btn';
                    clearBtn.textContent = 'Clear All Notifications ×';
                    clearBtn.className = 'rgs-toast-clear-btn rgs-fade-in';
                    clearBtn.onclick = () => {
                        container.querySelectorAll('.rgs-toast').forEach(t => {
                            t.style.transform = 'translateX(120%)';
                            t.style.opacity = '0';
                            setTimeout(() => t.remove(), 400);
                        });
                        clearBtn.remove();
                    };
                    container.insertBefore(clearBtn, container.firstChild);
                }
            } else if (clearBtn) {
                clearBtn.remove();
            }
        },
        showToast(notif) {
            const container = document.getElementById('rgs-toast-container');
            if (!container) return;

            const toast = document.createElement('div');
            toast.className = 'rgs-toast';
            toast.dataset.wfid = notif.wfId;
            toast.innerHTML = `
                <div class="rgs-toast-icon">✨</div>
                <div class="rgs-toast-content">
                    <div class="rgs-toast-title">${notif.title}</div>
                    <div class="rgs-toast-msg">${notif.message}</div>
                </div>
                <span class="rgs-toast-status" style="position: absolute; top: 10px; right: 28px; padding: 2px 6px; border-radius: 4px; font-size: 9px; font-weight: bold; line-height: 1; box-shadow: 0 2px 4px rgba(0,0,0,0.05); ${getStatusStyle(notif.status)}">${notif.status}</span>
                <button class="rgs-toast-close" style="position: absolute; top: 8px; right: 8px; background: none; border: none; font-size: 16px; color: #94a3b8; cursor: pointer; line-height: 1; padding: 0 4px; transition: color 0.2s;">×</button>
            `;

            toast.querySelector('.rgs-toast-close').addEventListener('click', (e) => {
                e.stopPropagation();
                toast.style.transform = 'translateX(120%)';
                toast.style.opacity = '0';
                setTimeout(() => { toast.remove(); this.manageToastStack(); }, 400);
            });

            toast.addEventListener('click', (e) => {
                if (e.target.closest('.rgs-toast-close')) return;
                if (typeof OverviewManager !== 'undefined') OverviewManager.openAndHighlight(notif.wfId);
                toast.querySelector('.rgs-toast-close').click();
            });

            container.appendChild(toast);
            requestAnimationFrame(() => toast.classList.add('show'));
            this.manageToastStack();

            // Smart Visibility & Hover Timing Engine
            let remaining = 6000;
            let lastTime = performance.now();
            let isHovered = false;
            let rafId;

            toast.addEventListener('mouseenter', () => isHovered = true);
            toast.addEventListener('mouseleave', () => {
                isHovered = false;
                if (remaining < 2000) remaining = 2000; // Give buffer after mouse leave
            });

            const animate = (time) => {
                const delta = time - lastTime;
                lastTime = time;

                // Only tick down if document is fully visible and user isn't hovering
                if (!document.hidden && !isHovered) {
                    remaining -= delta;
                }

                if (remaining <= 0) {
                    toast.style.transform = 'translateX(120%)';
                    toast.style.opacity = '0';
                    setTimeout(() => { toast.remove(); this.manageToastStack(); }, 400);
                } else {
                    rafId = requestAnimationFrame(animate);
                }
            };
            rafId = requestAnimationFrame(animate);
        },
        renderInbox() {
            const list = document.getElementById('rgs-inbox-list');
            if (!list) return;

            const isPinnedOnly = settings.notifFilter === 'pinned';
            const pinnedList = getPinnedRepos();
            const visibleNotifs = this.inbox.filter(i => {
                if (!isPinnedOnly) return true;
                return (i.repoNames || []).some(r => pinnedList.includes(r.replace('Tolgee: ', '')));
            });

            if (visibleNotifs.length === 0) {
                list.innerHTML = `<div style="padding: 20px; text-align: center; color: #94a3b8;">No notifications match filter.</div>`;
                return;
            }
            list.innerHTML = visibleNotifs.map(i => `
                <div class="rgs-inbox-item ${i.read ? '' : 'unread'}" data-nid="${i.id}" data-wfid="${i.wfId}">
                    <span class="rgs-inbox-status" style="position: absolute; top: 10px; right: 10px; padding: 2px 6px; border-radius: 4px; font-size: 9px; font-weight: bold; line-height: 1; ${getStatusStyle(i.status)}">${i.status || 'UNKNOWN'}</span>
                    <div class="rgs-inbox-item-title">${i.title} <span class="rgs-inbox-time">${i.time}</span></div>
                    <div class="rgs-inbox-item-msg">${i.message}</div>
                </div>
            `).join('');

            list.querySelectorAll('.rgs-inbox-item').forEach(el => {
                el.addEventListener('mouseenter', () => this.markAsRead(parseInt(el.dataset.nid, 10)));
                el.addEventListener('click', () => {
                    if (typeof OverviewManager !== 'undefined') OverviewManager.openAndHighlight(el.dataset.wfid);
                });
            });
        }
    };

    // --- Enterprise IndexedDB Engine ---
    const IDB = {
        db: null,
        init() {
            return new Promise((resolve, reject) => {
                if (this.db) return resolve();
                const req = indexedDB.open('EnvDashboard_Uncapped', 3);
                req.onupgradeneeded = e => {
                    const db = e.target.result;
                    if (e.oldVersion < 3 && db.objectStoreNames.contains('workflows')) {
                        db.deleteObjectStore('workflows');
                    }
                    if (!db.objectStoreNames.contains('workflows')) {
                        db.createObjectStore('workflows', { keyPath: 'id' });
                    }
                };
                req.onsuccess = e => { this.db = e.target.result; resolve(); };
                req.onerror = e => reject(e);
            });
        },
        async putBatch(items) {
            await this.init();
            return new Promise((resolve) => {
                if (items.length === 0) return resolve();
                const tx = this.db.transaction('workflows', 'readwrite');
                const store = tx.objectStore('workflows');
                items.forEach(item => store.put(item));
                tx.oncomplete = () => resolve();
                tx.onerror = () => resolve();
            });
        },
        async deleteBatch(ids) {
            await this.init();
            return new Promise((resolve) => {
                if (ids.length === 0) return resolve();
                const tx = this.db.transaction('workflows', 'readwrite');
                const store = tx.objectStore('workflows');
                ids.forEach(id => store.delete(id));
                tx.oncomplete = () => resolve();
                tx.onerror = () => resolve();
            });
        },
        async getAllMap() {
            await this.init();
            return new Promise((resolve) => {
                const tx = this.db.transaction('workflows', 'readonly');
                const req = tx.objectStore('workflows').getAll();
                req.onsuccess = () => {
                    const map = {}; (req.result || []).forEach(item => map[item.id] = item); resolve(map);
                };
                req.onerror = () => resolve({});
            });
        }
    };

    async function pruneOldWorkflows() {
        try {
            const dbMap = await IDB.getAllMap();
            const now = Date.now();
            const FIFTEEN_DAYS = 15 * 24 * 60 * 60 * 1000;
            const toDelete = [];

            Object.values(dbMap).forEach(wf => {
                if (wf.created_at) {
                    const age = now - new Date(wf.created_at).getTime();
                    if (age > FIFTEEN_DAYS) {
                        toDelete.push(wf.id);
                    }
                }
            });

            if (toDelete.length > 0) {
                await IDB.deleteBatch(toDelete);
                log(`Pruned ${toDelete.length} expired workflows from IDB cache.`);
            }
        } catch (e) {
            log("Failed to prune old workflows.", e);
        }
    }

    // --- Fail-Safe Repo Scraper ---
    function getPinnedRepos() {
        let repos = [];
        try {
            const raw = localStorage.getItem('env_dashboard_pinned_repos');
            if (raw) {
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed)) repos = parsed;
            }
        } catch (e) { }

        if (repos.length === 0) {
            document.querySelectorAll('tbody tr').forEach(row => {
                const pNode = row.querySelector('th p');
                if (pNode) repos.push(pNode.textContent.replace(/[()]/g, '').trim());
            });
        }
        return [...new Set(repos)].filter(Boolean).sort();
    }

    // --- Settings & UI Utils ---
    function updateSettingsCheckboxes() {
        const statusContainer = document.getElementById('rgs-status-filters');
        if (statusContainer) {
            const baseStatuses = ['APPROVED', 'REJECTED', 'INPROGRESS'];
            const fetchedStatuses = globalWorkflows.map(w => w.status || 'UNKNOWN');
            const allStatuses = [...new Set([...baseStatuses, ...fetchedStatuses])].sort();

            let settingsChanged = false;
            allStatuses.forEach(st => {
                if (settings.matrixStatuses[st] === undefined) {
                    settings.matrixStatuses[st] = baseStatuses.includes(st);
                    settingsChanged = true;
                }
            });
            if (settingsChanged) saveSettings();

            const statusHash = allStatuses.map(s => s + ':' + !!settings.matrixStatuses[s]).join('|');
            if (statusContainer.dataset.hash !== statusHash) {
                statusContainer.dataset.hash = statusHash;
                statusContainer.innerHTML = allStatuses.map(st => `
                    <label style="font-weight: normal; cursor: pointer; display: flex; align-items: center; gap: 3px; min-height: 20px;">
                        <input type="checkbox" class="rgs-cb-status" value="${st}" ${settings.matrixStatuses[st] ? 'checked' : ''}> 
                        ${st}
                    </label>
                `).join('');

                statusContainer.querySelectorAll('.rgs-cb-status').forEach(cb => {
                    cb.addEventListener('change', (e) => {
                        settings.matrixStatuses[e.target.value] = e.target.checked;
                        saveSettings();
                        updateVisuals();
                    });
                });
            }
        }

        const repoContainer = document.getElementById('rgs-repo-filters');
        if (repoContainer) {
            const pinnedRepos = getPinnedRepos();
            let allRepos = new Set();

            document.querySelectorAll('tbody tr th p').forEach(p => {
                allRepos.add(p.textContent.replace(/[()]/g, '').trim());
            });

            globalWorkflows.forEach(w => {
                const d = activeCacheMap[w.id];
                if (d && d.repos_data) d.repos_data.forEach(r => {
                    const cleanName = r.name.replace('Tolgee: ', '');
                    allRepos.add(cleanName);
                });
            });
            allRepos = [...allRepos].sort();

            if (allRepos.length === 0 && Object.keys(settings.repoToggles).length > 0) {
                allRepos = Object.keys(settings.repoToggles);
            }

            pinnedRepos.forEach(r => { if (!allRepos.includes(r)) allRepos.push(r); });
            allRepos.sort();

            let repoSettingsChanged = false;
            if (settings.repoMode === 'pinned') {
                allRepos.forEach(repo => {
                    const isPinned = pinnedRepos.includes(repo);
                    if (settings.repoToggles[repo] !== isPinned) {
                        settings.repoToggles[repo] = isPinned;
                        repoSettingsChanged = true;
                    }
                });
            } else if (settings.repoMode === 'all') {
                allRepos.forEach(repo => {
                    if (!settings.repoToggles[repo]) {
                        settings.repoToggles[repo] = true;
                        repoSettingsChanged = true;
                    }
                });
            } else if (settings.repoMode === 'none') {
                allRepos.forEach(repo => {
                    if (settings.repoToggles[repo]) {
                        settings.repoToggles[repo] = false;
                        repoSettingsChanged = true;
                    }
                });
            } else {
                allRepos.forEach(repo => {
                    if (settings.repoToggles[repo] === undefined) {
                        settings.repoToggles[repo] = pinnedRepos.includes(repo);
                        repoSettingsChanged = true;
                    }
                });
            }

            if (repoSettingsChanged) saveSettings();

            const repoBtnsContainer = document.querySelector('.rgs-repo-actions');
            if (repoBtnsContainer) {
                repoBtnsContainer.querySelectorAll('.rgs-repo-btn').forEach(b => b.classList.remove('active'));
                if (settings.repoMode === 'all') document.getElementById('rgs-btn-sel-all').classList.add('active');
                if (settings.repoMode === 'none') document.getElementById('rgs-btn-sel-none').classList.add('active');
                if (settings.repoMode === 'pinned') document.getElementById('rgs-btn-sel-pinned').classList.add('active');
            }

            if (allRepos.length === 0) {
                repoContainer.innerHTML = `<div style="color:#94a3b8; font-style:italic; text-align:center; padding: 10px;">No repos detected yet.</div>`;
            } else {
                repoContainer.innerHTML = allRepos.map(repo => `
                    <label style="font-weight: normal; cursor: pointer; display: flex; align-items: center; gap: 8px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: #334155; margin-bottom: 4px; min-height: 20px;" title="${repo}">
                        <input type="checkbox" class="rgs-cb-repo" value="${repo}" ${settings.repoToggles[repo] ? 'checked' : ''}> 
                        ${pinnedRepos.includes(repo) ? '📌 ' : ''}${repo}
                    </label>
                `).join('');

                repoContainer.querySelectorAll('.rgs-cb-repo').forEach(cb => {
                    cb.addEventListener('change', (e) => {
                        settings.repoMode = 'custom';
                        settings.repoToggles[e.target.value] = e.target.checked;
                        saveSettings();
                        updateSettingsCheckboxes();
                        updateVisuals();
                    });
                });
            }
        }
    }

    function updateVisuals() {
        const root = document.documentElement;
        root.style.setProperty('--rgs-font-size', `${settings.fontSize}px`); root.style.setProperty('--rgs-max-width', `${settings.maxWidth}px`); root.style.setProperty('--rgs-max-height', `${settings.maxHeight}px`);
        document.body.classList.toggle('rgs-hide-year-active', settings.hideYear); document.body.classList.toggle('rgs-hide-time-active', settings.hideTime);
        if (typeof window.rgsObserver !== 'undefined') window.rgsObserver.disconnect();
        if (typeof renderMatrixUI !== 'undefined') renderMatrixUI();
        if (typeof window.rgsObserver !== 'undefined') window.rgsObserver.observe(document.body, { childList: true, subtree: true });
    }

    function saveSettings() { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); }

    function initGlobalTooltip() {
        if (!document.getElementById('rgs-global-tooltip')) {
            const t = document.createElement('div');
            t.id = 'rgs-global-tooltip';
            document.body.appendChild(t);
        }
    }

    // --- Inject Dynamic CSS ---
    GM_addStyle(`
        :root { --rgs-font-size: ${settings.fontSize}px; --rgs-max-width: ${settings.maxWidth}px; --rgs-max-height: ${settings.maxHeight}px; }
        .rgs-matrix-history { margin-top: 8px; padding: 6px; background-color: #fffbeb; border: 1px dashed #fcd34d; border-radius: 4px; font-weight: normal; }
        .rgs-matrix-history-title { font-weight: 800; margin-bottom: 4px; color: #b45309; border-bottom: 1px solid #fde68a; padding-bottom: 2px; text-transform: uppercase; font-size: 9px; cursor: pointer; display: flex; justify-content: space-between; align-items: center; user-select: none; transition: color 0.2s; }
        .rgs-matrix-history-title:hover { color: #92400e; }
        .rgs-matrix-list { list-style-type: none; padding: 0; margin: 0; max-height: var(--rgs-max-height); overflow-y: auto; overflow-x: hidden; }
        .rgs-matrix-list.rgs-collapsed { display: none; }
        .rgs-matrix-list::-webkit-scrollbar { width: 4px; }
        .rgs-matrix-list::-webkit-scrollbar-track { background: transparent; }
        .rgs-matrix-list::-webkit-scrollbar-thumb { background-color: #b45309; border-radius: 4px; }
        .rgs-matrix-item { margin-bottom: 4px; width: 100%; font-size: var(--rgs-font-size); }
        .rgs-history-link-wrapper { position: relative; display: flex; align-items: center; width: 100%; max-width: var(--rgs-max-width); cursor: pointer; line-height: 1.3; }
        .rgs-history-date { color: #94a3b8; font-family: monospace; margin-right: 4px; flex-shrink: 0; transition: color 0.2s; cursor: default; }
        .rgs-history-day { font-weight: 600; color: #64748b; } 
        .rgs-history-version { color: #2563eb; font-family: monospace; margin-right: 4px; font-weight: 600; flex-shrink: 0; transition: color 0.2s; text-decoration: none; }
        .rgs-history-link { color: #d97706; text-decoration: none; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex-grow: 1; min-width: 0; display: block; transition: color 0.2s; }
        .rgs-history-link-wrapper:hover .rgs-history-link { color: #f59e0b; text-decoration: underline; }
        body.rgs-hide-year-active .rgs-history-year { display: none; }
        body.rgs-hide-time-active .rgs-history-time { display: none; }

        /* INSTANT PIPELINE TOOLTIP */
#rgs-fast-tooltip { position: fixed; background: #334155; color: #f8fafc; padding: 8px 12px; border-radius: 6px; font-size: 11.5px; font-weight: bold; font-family: monospace; white-space: pre-wrap; pointer-events: none; z-index: 2147483647; box-shadow: 0 10px 15px -3px rgba(0,0,0,0.3); opacity: 0; visibility: hidden; transition: opacity 0.05s ease-out; transform: translate(-50%, -100%); margin-top: -5px; line-height: 1.4; border: 1px solid #475569;}
#rgs-fast-tooltip.show { opacity: 1; visibility: visible; }
        
        /* UNIFIED SMART TOOLTIP */
        #rgs-smart-tooltip { display: none; background-color: #1e293b; color: #f8fafc; text-align: left; border-radius: 6px; padding: 12px; position: fixed; z-index: 2147483647 !important; transform: translateX(-50%); width: max-content; max-width: 450px; box-shadow: 0px 15px 25px -5px rgba(0,0,0,0.4); font-size: 12px; line-height: 1.6; border: 1px solid #334155; pointer-events: none; opacity: 0; transition: opacity 0.15s; }
        #rgs-smart-tooltip.visible { display: block; opacity: 1; }
        #rgs-smart-tooltip.locked { pointer-events: auto; border: 1px solid #f59e0b; }
        #rgs-smart-tooltip.locked .rgs-tooltip-close { display: block; }
        #rgs-smart-tooltip .rgs-tooltip-close { display: none; background: none; border: none; color: #94a3b8; font-size: 18px; cursor: pointer; line-height: 1; padding: 0 4px; margin: 0; transition: color 0.2s; font-weight: bold; }
        #rgs-smart-tooltip .rgs-tooltip-close:hover { color: #ef4444; }
        #rgs-smart-tooltip::after { content: " "; position: absolute; bottom: 100%; left: 50%; margin-left: -5px; border-width: 5px; border-style: solid; border-color: transparent transparent #1e293b transparent; }
        #rgs-smart-tooltip.flip-top::after { top: 100%; bottom: auto; border-color: #1e293b transparent transparent transparent; }
        #rgs-smart-tooltip.flip-bottom::after { bottom: 100%; top: auto; border-color: transparent transparent #1e293b transparent; }
        .rgs-tooltip-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px; border-bottom: 1px solid #334155; padding-bottom: 6px; }
        .rgs-tooltip-title { color: #f59e0b; font-weight: bold; font-size: 14px; padding-right: 12px;}
        .rgs-tooltip-body { max-height: 40vh; overflow-y: auto; overflow-x: hidden; padding-right: 6px; }
        .rgs-tooltip-body::-webkit-scrollbar { width: 4px; }
        .rgs-tooltip-body::-webkit-scrollbar-thumb { background-color: #64748b; border-radius: 4px; }
        .rgs-tooltip-date { color: #94a3b8; font-family: monospace; font-size: 11px; margin-bottom: 4px; }
        .rgs-tooltip-version { color: #60a5fa; font-family: monospace; font-size: 12px; font-weight: 600; padding-bottom: 8px; margin-bottom: 8px; border-bottom: 1px dotted #334155; }
        .rgs-tooltip-summary { white-space: pre-wrap; color: #cbd5e1; user-select: text; }

        .rgs-settings-container { position: relative; display: inline-block; margin-left: 8px; }
        .rgs-settings-panel { display: none; position: absolute; top: 110%; right: 0; width: 300px; background: white; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px; box-shadow: 0 10px 15px -3px rgba(0,0,0,0.1); z-index: 1000; font-size: 12px; color: #334155; max-height: 85vh; overflow-y: auto; }
        .rgs-settings-panel.active { display: block; }
        .rgs-settings-panel::-webkit-scrollbar { width: 4px; }
        .rgs-settings-panel::-webkit-scrollbar-thumb { background-color: #cbd5e1; border-radius: 4px; }
        .rgs-setting-row { display: flex; flex-direction: column; margin-bottom: 10px; }
        .rgs-setting-row label { font-weight: 600; margin-bottom: 4px; display: flex; justify-content: space-between; }
        .rgs-setting-row input[type="range"] { width: 100%; cursor: pointer; }
        .rgs-setting-row-inline { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; font-weight: 600; }
        .rgs-global-action-btn { width: 100%; padding: 6px; background-color: #f1f5f9; border: 1px solid #cbd5e1; border-radius: 4px; font-weight: 600; cursor: pointer; text-align: center; margin-bottom: 10px; transition: background 0.2s;}
        .rgs-global-action-btn:hover { background-color: #e2e8f0; }
        
        .rgs-repo-actions { display: flex; gap: 8px; margin-bottom: 4px; }
        .rgs-repo-btn { flex: 1; padding: 4px; font-size: 10px; border-radius: 4px; border: 1px solid #cbd5e1; background: #fff; cursor: pointer; color:#0f172a; }
        .rgs-repo-btn:hover { background: #f1f5f9; }
        .rgs-repo-btn.active { background: #e2e8f0; font-weight: bold; border-color: #94a3b8; }

        #rgs-ov-modal { display: none; position: fixed; inset: 0; z-index: 999999; }
        #rgs-ov-modal.active { display: flex; align-items: center; justify-content: center; }
        .rgs-ov-backdrop { position: absolute; inset: 0; background: rgba(15, 23, 42, 0.7); backdrop-filter: blur(4px); }
        .rgs-ov-content { position: relative; background: #ffffff; width: 98vw; max-width: 98vw; height: 90vh; border-radius: 12px; display: flex; flex-direction: column; box-shadow: 0 25px 50px -12px rgba(0,0,0,0.25); overflow: hidden; }
        
        .rgs-ov-header { background: #f8fafc; padding: 12px 24px; border-bottom: 1px solid #e2e8f0; display: flex; align-items: center; gap: 24px; }
        .rgs-ov-header h2 { margin: 0; font-size: 18px; color: #0f172a; display: flex; align-items: center; gap: 8px; flex-shrink: 0;}
        .rgs-header-controls { display: flex; gap: 16px; align-items: center; flex-grow: 1; justify-content: flex-start; }
        .rgs-ov-close { margin-left: auto; background: none; border: none; font-size: 24px; color: #64748b; cursor: pointer; transition: color 0.2s; flex-shrink: 0;}
        
        .rgs-stream-indicator { font-size: 11px; color: #2563eb; font-weight: 600; display: none; align-items: center; gap: 6px; background: #eff6ff; padding: 4px 8px; border-radius: 4px; border: 1px solid #bfdbfe; margin-left: auto;}
        .rgs-stream-indicator.active { display: flex; }
        
        .rgs-ov-toolbar { padding: 12px 24px; background: #fff; border-bottom: 1px solid #e2e8f0; display: flex; gap: 12px; flex-wrap: wrap; align-items: center; }
        
        /* MULTI SELECT CSS */
        .rgs-ms-container { position: relative; display: inline-block; width: 155px; }
        .rgs-ms-display { padding: 6px 10px; border: 1px solid #cbd5e1; border-radius: 6px; background: #f8fafc; font-size: 13px; color: #334155; cursor: pointer; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: flex; justify-content: space-between; align-items: center; }
        .rgs-ms-display:hover { background: #e2e8f0; }
        .rgs-ms-panel { display: none; position: absolute; top: 110%; left: 0; width: 260px; background: #fff; border: 1px solid #cbd5e1; border-radius: 6px; box-shadow: 0 10px 15px -3px rgba(0,0,0,0.1); z-index: 1000; flex-direction: column; max-height: 300px; }
        .rgs-ms-container.open .rgs-ms-panel { display: flex; }
        .rgs-ms-search { margin: 8px; padding: 6px 10px; border: 1px solid #cbd5e1; border-radius: 4px; font-size: 13px; outline: none; background: #f8fafc;}
        .rgs-ms-list { overflow-y: auto; flex-grow: 1; padding: 0 8px 8px 8px; display: flex; flex-direction: column; gap: 2px; }
        .rgs-ms-list::-webkit-scrollbar { width: 4px; }
        .rgs-ms-list::-webkit-scrollbar-thumb { background-color: #cbd5e1; border-radius: 4px; }
        .rgs-ms-label { display: flex; align-items: center; gap: 8px; font-size: 13px; color: #334155; cursor: pointer; padding: 6px; border-radius: 4px; }
        .rgs-ms-label:hover { background: #f1f5f9; }

        .rgs-ov-search { padding: 8px 12px; border: 1px solid #cbd5e1; border-radius: 6px; background: #fff; color: #334155; font-size: 13px; outline: none; width: 280px; }
        
        .rgs-ov-table-container { flex-grow: 1; overflow: auto; background: #f1f5f9; padding: 0; }
        .rgs-ov-table { width: 100%; border-collapse: collapse; font-size: 13px; text-align: left; table-layout: fixed; }
        
        /* Draggable Headers */
        .rgs-draggable-th { cursor: grab; transition: background 0.2s; user-select: none; position: relative; }
        .rgs-draggable-th:active { cursor: grabbing; }
        .rgs-draggable-th:hover { background: #cbd5e1 !important; }
        .rgs-drag-over { border-left: 3px solid #3b82f6; }

        .rgs-ov-table th { position: sticky; top: 0; background: #e2e8f0; color: #475569; font-weight: 700; padding: 12px 16px; text-transform: uppercase; font-size: 11px; z-index: 10; border-bottom: 2px solid #cbd5e1; white-space: nowrap; }
        .rgs-sort-icon { display: inline-block; width: 12px; margin-left: 4px; color: #94a3b8; font-size: 10px; cursor: pointer;}
        .rgs-sort-icon:hover { color: #0f172a; }
        
        .rgs-ov-table td { padding: 12px 16px; border-bottom: 1px solid #cbd5e1; overflow-x: auto; white-space: nowrap; vertical-align: middle; scrollbar-width: thin; scrollbar-color: #cbd5e1 transparent; color: #0f172a;}
        .rgs-ov-table td::-webkit-scrollbar { height: 6px; }
        .rgs-ov-table td::-webkit-scrollbar-track { background: transparent; }
        .rgs-ov-table td::-webkit-scrollbar-thumb { background-color: #cbd5e1; border-radius: 4px; }
        .rgs-ov-table td.ov-title-cell, .rgs-ov-table td.ov-region-cell { white-space: normal; word-break: break-word; line-height: 1.6; }
        .rgs-ov-table td.ov-flow-cell { padding: 0; white-space: nowrap; vertical-align: middle; }
        .rgs-flow-scroll { padding: 4px 16px; overflow-x: auto; width: 100%; height: 100%; display: flex; align-items: center; box-sizing: border-box; }
        .rgs-flow-scroll::-webkit-scrollbar { height: 6px; }
        .rgs-flow-scroll::-webkit-scrollbar-track { background: transparent; }
        .rgs-flow-scroll::-webkit-scrollbar-thumb { background-color: #cbd5e1; border-radius: 4px; }
        
        .rgs-resizer { position: absolute; top: 0; right: 0; width: 6px; bottom: 0; cursor: col-resize; z-index: 11; }
        .rgs-tt-trigger { cursor: pointer; position: relative; transition: color 0.2s; }
        .rgs-tt-trigger:hover { color: #d97706; }
        .rgs-badge { padding: 4px 8px; border-radius: 4px; font-size: 11px; font-weight: bold; }
        .rgs-mark { background-color: #fef08a; color: #854d0e; padding: 0 2px; border-radius: 2px; font-weight: bold; }

        /* Highlight Animation for Notification Click */
        @keyframes rgs-highlight { 0% { background-color: #fef08a; } 100% { background-color: inherit; } }
        .rgs-highlight-row { animation: rgs-highlight 3s ease-out; }

        /* Tolgee Highlight */
        .rgs-tolgee-tag { color: #d946ef !important; font-weight: bold !important; }

        /* --- DUAL CALENDAR CSS --- */
        .rgs-cal-group { display: flex; gap: 8px; align-items: center; background: #fff; padding: 4px 8px; border-radius: 6px; border: 1px solid #cbd5e1; position: relative; }
        .rgs-cal-input-wrapper { position: relative; display: flex; align-items: center; }
        .rgs-ov-dateinput { padding: 6px 26px 6px 10px; border: none; background: transparent; color: #334155; font-size: 13px; outline: none; width: 110px; cursor: pointer; text-align: center; border-radius: 4px; transition: background 0.2s;}
        .rgs-ov-dateinput:hover, .rgs-ov-dateinput.active { background: #e2e8f0; }
        .rgs-cal-clear-btn { position: absolute; right: 4px; top: 50%; transform: translateY(-50%); background: none; border: none; font-size: 14px; color: #94a3b8; cursor: pointer; padding: 2px; border-radius: 50%; display: none; line-height: 1;}
        .rgs-cal-clear-btn:hover { color: #dc2626; background: #fee2e2; }
        .rgs-cal-popup { display: none; position: absolute; top: 115%; right: 0; background: #1f1f1f; color: #f3f4f6; border-radius: 8px; padding: 20px; box-shadow: 0 10px 30px rgba(0,0,0,0.5); z-index: 1000000; flex-direction: row; gap: 30px; user-select: none;}
        .rgs-cal-popup.active { display: flex; }
        .rgs-cal-month { width: 230px; }
        .rgs-cal-header { display: flex; justify-content: space-between; align-items: center; font-size: 15px; font-weight: bold; margin-bottom: 16px; padding: 0 4px; }
        .rgs-cal-month-title { flex-grow: 1; text-align: center; letter-spacing: 0.5px; color: #f8fafc; }
        .rgs-cal-btn { background: #334155; border: 1px solid #475569; color: #cbd5e1; font-size: 14px; cursor: pointer; width: 28px; height: 28px; border-radius: 6px; transition: all 0.2s ease; display: flex; align-items: center; justify-content: center; padding: 0; }
        .rgs-cal-btn:hover { color: #fff; background: #3b82f6; border-color: #60a5fa; transform: scale(1.1); }
        .rgs-cal-btn-placeholder { width: 28px; }
        .rgs-cal-btn.prev { left: -5px; }
        .rgs-cal-btn.next { right: -5px; }
        .rgs-cal-weekdays { display: grid; grid-template-columns: repeat(7, 1fr); text-align: center; color: #3b82f6; font-size: 11px; margin-bottom: 8px; font-weight: 600; }
        .rgs-cal-days { display: grid; grid-template-columns: repeat(7, 1fr); gap: 2px 0; }
        
        .rgs-cal-day { padding: 14px 0 4px 0; text-align: center; cursor: pointer; font-size: 13px; color: #d1d5db; font-weight: 500; position: relative; }
        .rgs-cal-day.disabled { opacity: 0.2; cursor: not-allowed; }
        .rgs-cal-day:not(.empty):not(.disabled):hover { background: #374151; border-radius: 4px; color: #fff; }
        .rgs-cal-day.in-range { background: rgba(59, 130, 246, 0.2); }
        .rgs-cal-day.start-date, .rgs-cal-day.end-date { background: #2563eb; color: #fff; border-radius: 4px; }
        
        .rgs-cal-meta { position: absolute; top: 2px; right: 4px; display: flex; gap: 4px; flex-wrap: wrap; justify-content: flex-end; width: 100%; }
        .rgs-cal-meta span { font-size: 10px; font-weight: 900; line-height: 1; }

        /* --- ACTION COLUMN & ALERTS --- */
        @keyframes rgs-shake { 0%, 100% {transform: translateX(0);} 25% {transform: translateX(-4px);} 75% {transform: translateX(4px);} }
        .rgs-shake { animation: rgs-shake 0.3s; }
        .rgs-cal-tooltip { position: absolute; background: #ef4444; color: white; padding: 4px 8px; font-size: 11px; border-radius: 4px; top: -28px; left: 50%; transform: translateX(-50%); white-space: nowrap; pointer-events: none; opacity: 0; transition: opacity 0.2s; z-index: 100;}
        .rgs-cal-tooltip.show { opacity: 1; }

        .rgs-action-col { display: flex; justify-content: center; gap: 8px; align-items: center; }
        .rgs-bm-btn { cursor: pointer; background: none; border: none; font-size: 15px; padding: 2px; transition: transform 0.1s, filter 0.2s; filter: grayscale(1) opacity(0.5); user-select: none; }
        .rgs-bm-btn:hover { transform: scale(1.2); }
        .rgs-bm-btn.active { filter: none; }
        .rgs-link-btn { display: inline-flex; align-items: center; justify-content: center; padding: 4px 8px; background: #e2e8f0; border-radius: 4px; border: 1px solid #cbd5e1; text-decoration: none; color: #334155; font-size: 13px; font-weight: 600; cursor: pointer; transition: background 0.15s; }
        .rgs-link-btn:hover { background: #cbd5e1; }
        
        .rgs-btn-urgent { background: #fee2e2 !important; border-color: #f87171 !important; color: #991b1b !important; animation: rgs-pulse 2s infinite; }
        .rgs-btn-urgent:hover { background: #fecaca !important; }
        @keyframes rgs-pulse { 0% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.4); } 70% { box-shadow: 0 0 0 6px rgba(239, 68, 68, 0); } 100% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0); } }

        /* --- HORIZONTAL FAB DOCK & PANELS --- */
        .rgs-inbox-fab { position: fixed; bottom: 30px; right: 30px; width: 50px; height: 50px; background: #fff; border-radius: 50%; box-shadow: 0 4px 12px rgba(0,0,0,0.15); display: flex; justify-content: center; align-items: center; font-size: 24px; cursor: pointer; z-index: 9999998; transition: transform 0.2s; border: 1px solid #e2e8f0; }
        .rgs-inbox-fab:hover { transform: scale(1.05); }
        #rgs-inbox-badge { position: absolute; top: -5px; right: -5px; background: #ef4444; color: white; font-size: 10px; font-weight: bold; border-radius: 10px; padding: 2px 6px; display: none; }
        #rgs-inbox-badge.active { display: block; }
        .rgs-inbox-panel { position: fixed; bottom: 90px; right: 30px; width: 340px; max-height: 500px; background: #fff; border-radius: 12px; box-shadow: 0 10px 40px rgba(0,0,0,0.2); z-index: 9999998; display: flex; flex-direction: column; overflow: hidden; opacity: 0; visibility: hidden; transform: translateY(20px); transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1); border: 1px solid #e2e8f0; }
        
        .rgs-timeline-fab { position: fixed; bottom: 30px; right: 90px; width: 50px; height: 50px; background: #fff; border-radius: 50%; box-shadow: 0 4px 12px rgba(0,0,0,0.15); display: flex; justify-content: center; align-items: center; font-size: 24px; cursor: pointer; z-index: 9999998; transition: transform 0.2s; border: 1px solid #e2e8f0; }
        .rgs-timeline-fab:hover { transform: scale(1.05); }
        #rgs-timeline-panel { position: fixed; bottom: 90px; right: 90px; width: auto; max-width: 560px; max-height: 600px; background: #1f1f1f; border-radius: 12px; box-shadow: 0 10px 40px rgba(0,0,0,0.5); z-index: 9999998; display: flex; flex-direction: column; overflow: hidden; opacity: 0; visibility: hidden; transform: translateY(20px); transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1); border: 1px solid #334155; }
        
        .rgs-action-fab { position: fixed; bottom: 30px; right: 210px !important; width: 50px; height: 50px; background: #fee2e2; border-radius: 50%; box-shadow: 0 4px 12px rgba(239, 68, 68, 0.3); justify-content: center; align-items: center; font-size: 24px; cursor: pointer; z-index: 9999998; transition: transform 0.2s; border: 1px solid #f87171; animation: rgs-pulse 2s infinite; display: flex; }
        .rgs-action-fab:hover { transform: scale(1.05); }
        #rgs-action-badge { position: absolute; top: -5px; right: -5px; background: #b91c1c; color: white; font-size: 10px; font-weight: bold; border-radius: 10px; padding: 2px 6px; }
        /* SHIFT ACTION FAB FOR NOTES FAB */

        /* --- CREATE WORKFLOW BUTTON --- */
        .rgs-create-wf-btn { background: #2563eb; color: #ffffff; border: 1px solid #1d4ed8; padding: 6px 12px; margin-left: 8px; display: flex; align-items: center; gap: 4px; text-decoration: none; border-radius: 4px; font-weight: bold; font-size: 13px; transition: background 0.2s; }
        .rgs-create-wf-btn:hover { background: #1d4ed8; color: #ffffff; }

        /* --- NOTES APP --- */
        .rgs-notes-fab { position: fixed; bottom: 30px; right: 150px; width: 50px; height: 50px; background: #fff; border-radius: 50%; box-shadow: 0 4px 12px rgba(0,0,0,0.15); display: flex; justify-content: center; align-items: center; font-size: 24px; cursor: pointer; z-index: 9999998; transition: transform 0.2s; border: 1px solid #e2e8f0; }
        .rgs-notes-fab:hover { transform: scale(1.05); }
        
        #rgs-notes-panel { position: fixed; bottom: 90px; right: 150px; width: 380px; height: 450px; background: #fff; border-radius: 12px; box-shadow: 0 10px 40px rgba(0,0,0,0.2); z-index: 9999998; display: flex; flex-direction: column; overflow: hidden; opacity: 0; visibility: hidden; transform: translateY(20px); transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1); border: 1px solid #e2e8f0; }
        #rgs-notes-panel.active { opacity: 1; visibility: visible; transform: translateY(0); }
        #rgs-notes-panel.expanded { bottom: 5vh; right: 5vw; width: 90vw; height: 90vh; max-width: none; max-height: none; z-index: 9999999; }
        
        .rgs-notes-header { padding: 12px 16px; background: #f8fafc; border-bottom: 1px solid #e2e8f0; display: flex; justify-content: space-between; align-items: center; }
        .rgs-notes-controls { display: flex; gap: 8px; align-items: center; }
        .rgs-notes-btn { background: #e2e8f0; border: 1px solid #cbd5e1; padding: 4px 8px; border-radius: 4px; font-size: 11px; cursor: pointer; font-weight: bold; color: #334155; transition: background 0.2s; }
        .rgs-notes-btn:hover { background: #cbd5e1; }
        
        #rgs-notes-raw { flex-grow: 1; width: 100%; resize: none; border: none; padding: 16px; font-size: 13px; font-family: monospace; outline: none; background: #f8fafc; color: #0f172a; white-space: pre-wrap; line-height: 1.5; }
        #rgs-notes-md { flex-grow: 1; width: 100%; overflow-y: auto; padding: 16px; font-size: 13px; background: #fff; color: #334155; line-height: 1.6; display: none; word-wrap: break-word; }
        #rgs-notes-md p { margin-bottom: 8px; }
        
        /* UPDATED: Familiar Blue Links in Markdown View */
        #rgs-notes-md a { color: #2563eb; text-decoration: none; font-weight: 600; transition: color 0.2s; }
        #rgs-notes-md a:hover { color: #1e40af; text-decoration: underline; }
        
        #rgs-notes-md pre { background: #f1f5f9; padding: 10px; border-radius: 6px; overflow-x: auto; font-family: monospace; font-size: 12px; margin-bottom: 12px; border: 1px solid #e2e8f0;}

        /* MAC OS NOTIFICATION & INBOX UI INTERNALS */
        #rgs-toast-container { position: fixed; top: 20px; right: 20px; z-index: 9999999; display: flex; flex-direction: column; gap: 10px; pointer-events: none; align-items: flex-end; }
        .rgs-toast { width: 320px; background: rgba(255, 255, 255, 0.90); backdrop-filter: blur(12px); border-radius: 12px; box-shadow: 0 8px 32px rgba(0, 0, 0, 0.15); border: 1px solid rgba(255,255,255,0.4); padding: 14px 16px 14px 16px; display: flex; gap: 12px; align-items: flex-start; transform: translateX(120%); transition: transform 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275), opacity 0.3s; pointer-events: auto; text-decoration: none; color: inherit; cursor: pointer; position: relative; overflow: hidden; }
        .rgs-toast.show { transform: translateX(0); opacity: 1;}
        .rgs-toast-icon { font-size: 20px; flex-shrink: 0; margin-top: 2px;}
        .rgs-toast-content { display: flex; flex-direction: column; gap: 6px; padding-right: 14px;}
        .rgs-toast-title { font-weight: 700; font-size: 13px; color: #1e293b; padding-right: 40px; }
        .rgs-toast-msg { font-size: 12px; color: #475569; line-height: 1.4; }
        
        .rgs-toast-clear-btn { background: rgba(255,255,255,0.85); border: 1px solid #cbd5e1; border-radius: 12px; padding: 6px 14px; font-size: 12px; font-weight: bold; cursor: pointer; backdrop-filter: blur(8px); box-shadow: 0 4px 12px rgba(0,0,0,0.1); margin-bottom: 4px; transition: all 0.2s; align-self: flex-end; color: #334155; pointer-events: auto;}
        .rgs-toast-clear-btn:hover { background: #fff; color: #0f172a; transform: scale(1.02); }
        @keyframes rgs-fade-in { from { opacity: 0; transform: translateY(-10px); } to { opacity: 1; transform: translateY(0); } }
        .rgs-fade-in { animation: rgs-fade-in 0.3s ease-out; }

        .rgs-inbox-panel.active { opacity: 1; visibility: visible; transform: translateY(0); }
        .rgs-inbox-header { padding: 14px 16px; background: #f8fafc; border-bottom: 1px solid #e2e8f0; display: flex; justify-content: space-between; align-items: center; }
        .rgs-inbox-header button { background: none; border: none; font-size: 20px; cursor: pointer; color: #64748b; }
        .rgs-inbox-header button:hover { color: #0f172a; }
        .rgs-inbox-list { flex-grow: 1; overflow-y: auto; display: flex; flex-direction: column; }
        .rgs-inbox-item { padding: 12px 85px 12px 16px; border-bottom: 1px solid #f1f5f9; text-decoration: none; color: inherit; display: flex; flex-direction: column; gap: 4px; transition: background 0.2s; position: relative; }
        .rgs-inbox-item:hover { background: #f8fafc; }
        .rgs-inbox-item.unread { background: #eff6ff; }
        .rgs-inbox-item.unread::before { content: ''; position: absolute; left: 6px; top: 20px; width: 6px; height: 6px; background: #3b82f6; border-radius: 50%; }
        .rgs-inbox-item-title { font-weight: 600; font-size: 13px; color: #1e293b; display: flex; justify-content: space-between; }
        .rgs-inbox-time { font-weight: normal; font-size: 10px; color: #94a3b8; }
        .rgs-inbox-item-msg { font-size: 12px; color: #475569; line-height: 1.4; }

        #rgs-timeline-panel.active { opacity: 1; visibility: visible; transform: translateY(0); }
        #rgs-timeline-header { padding: 14px 16px; background: #0f172a; border-bottom: 1px solid #334155; display: flex; justify-content: space-between; align-items: center; }
        #rgs-timeline-header button { background: none; border: none; font-size: 20px; cursor: pointer; color: #94a3b8; }
        #rgs-timeline-header button:hover { color: #f8fafc; }
        #rgs-timeline-content { padding: 16px; display: flex; justify-content: center; overflow: auto; }
    `);

    // --- FAST TOOLTIP ENGINE ---
    function initFastTooltip() {
        if (!document.getElementById('rgs-fast-tooltip')) {
            const ft = document.createElement('div');
            ft.id = 'rgs-fast-tooltip';
            document.body.appendChild(ft);

            document.addEventListener('mouseover', (e) => {
                const trigger = e.target.closest('.rgs-fast-tt-trigger');
                if (trigger) {
                    const tt = document.getElementById('rgs-fast-tooltip');
                    tt.textContent = trigger.dataset.fastTt;
                    const rect = trigger.getBoundingClientRect();
                    // Position above the circle
                    tt.style.left = (rect.left + rect.width / 2) + 'px';
                    tt.style.top = (rect.top + 10) + 'px';
                    tt.classList.add('show');
                }
            });

            document.addEventListener('mouseout', (e) => {
                if (e.target.closest('.rgs-fast-tt-trigger')) {
                    document.getElementById('rgs-fast-tooltip').classList.remove('show');
                }
            });
        }
    }

    // --- SMART UNIFIED TOOLTIP ENGINE ---
    function initSmartTooltip() {
        if (document.getElementById('rgs-smart-tooltip')) return;
        document.body.insertAdjacentHTML('beforeend', `
            <div id="rgs-smart-tooltip">
                <div class="rgs-tooltip-header">
                    <div class="rgs-tooltip-title">Title</div>
                    <button class="rgs-tooltip-close">&times;</button>
                </div>
                <div class="rgs-tooltip-body">
                    <div class="rgs-tooltip-date">Date</div>
                    <div class="rgs-tooltip-version">Version</div>
                    <div class="rgs-tooltip-summary">Summary</div>
                </div>
            </div>
        `);

        document.querySelector('#rgs-smart-tooltip .rgs-tooltip-close').addEventListener('click', (e) => {
            e.stopPropagation();
            closeSmartTooltip(true);
        });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && isTooltipLocked) closeSmartTooltip(true);
        });

        document.addEventListener('click', (e) => {
            if (isTooltipLocked && !e.target.closest('#rgs-smart-tooltip') && !e.target.closest('.rgs-tt-trigger')) {
                closeSmartTooltip(true);
            }
        });
    }

    function openSmartTooltip(data, targetEl, isClick) {
        if (isTooltipLocked && !isClick) return;

        const tt = document.getElementById('rgs-smart-tooltip');
        if (!tt) return;

        tt.querySelector('.rgs-tooltip-title').innerHTML = highlightHTML(data.title, data.hlSet);
        tt.querySelector('.rgs-tooltip-date').textContent = 'Date: ' + data.date;

        const versionEl = tt.querySelector('.rgs-tooltip-version');
        if (targetEl.closest('#rgs-ov-modal')) {
            versionEl.style.display = 'none';
        } else {
            versionEl.style.display = 'block';
            versionEl.innerHTML = 'Version:<br>' + data.versionHTML;
        }

        tt.querySelector('.rgs-tooltip-summary').innerHTML = highlightHTML((data.summary || '').replace(/\\n/g, '\n'), data.hlSet);

        if (isClick) {
            isTooltipLocked = true;
            tt.classList.add('locked');
        } else {
            tt.classList.remove('locked');
        }

        tt.classList.add('visible');

        const rect = targetEl.getBoundingClientRect();
        let topPos = rect.bottom + 8;
        tt.classList.remove('flip-top', 'flip-bottom');

        const minTop = 60;
        if (topPos + tt.offsetHeight > window.innerHeight - 20) {
            topPos = rect.top - tt.offsetHeight - 8;
            if (topPos < minTop) topPos = minTop;
            tt.classList.add('flip-top');
        } else {
            tt.classList.add('flip-bottom');
        }

        let leftPos = rect.left + (rect.width / 2);
        const halfWidth = tt.offsetWidth / 2;

        if (leftPos - halfWidth < 10) {
            leftPos = halfWidth + 10;
        } else if (leftPos + halfWidth > window.innerWidth - 10) {
            leftPos = window.innerWidth - halfWidth - 10;
        }

        tt.style.left = leftPos + 'px';
        tt.style.top = topPos + 'px';
    }

    function closeSmartTooltip(force) {
        if (isTooltipLocked && !force) return;
        isTooltipLocked = false;
        const tt = document.getElementById('rgs-smart-tooltip');
        if (tt) {
            tt.classList.remove('visible', 'locked');
        }
    }

    // --- TIMELINE WIDGET ---
    const TimelineWidget = {
        currentMonth: new Date(),
        init() {
            if (document.getElementById('rgs-timeline-fab')) return;
            document.body.insertAdjacentHTML('beforeend', `
                <div id="rgs-timeline-fab" class="rgs-timeline-fab" title="Timeline Overview">🗓️</div>
                <div id="rgs-timeline-panel">
                     <div id="rgs-timeline-header">
                         <span style="font-weight: bold; color: #f8fafc;">Timeline Overview</span>
                         <button id="rgs-timeline-close">×</button>
                     </div>
                     <div id="rgs-timeline-content"></div>
                </div>
            `);

            document.getElementById('rgs-timeline-fab').addEventListener('click', () => {
                this.currentMonth = new Date();
                document.getElementById('rgs-timeline-panel').classList.toggle('active');
                if (document.getElementById('rgs-timeline-panel').classList.contains('active')) {
                    this.render();
                }
            });

            document.getElementById('rgs-timeline-close').addEventListener('click', () => {
                document.getElementById('rgs-timeline-panel').classList.remove('active');
            });

            document.getElementById('rgs-timeline-content').addEventListener('click', (e) => {
                const bounds = CalendarManager.getBounds();
                const currM = new Date(this.currentMonth.getFullYear(), this.currentMonth.getMonth(), 1);

                if (e.target.closest('.prev')) {
                    const minM = new Date(bounds.min.getFullYear(), bounds.min.getMonth(), 1);
                    if (currM <= minM) CalendarManager.shakeEl(e.target.closest('.prev'), "No older logs!");
                    else { this.currentMonth.setMonth(this.currentMonth.getMonth() - 1); this.render(); }
                }
                else if (e.target.closest('.next')) {
                    const nextM = new Date(this.currentMonth.getFullYear(), this.currentMonth.getMonth() + 1, 1);
                    const maxM = new Date(bounds.max.getFullYear(), bounds.max.getMonth(), 1);
                    if (nextM >= maxM) CalendarManager.shakeEl(e.target.closest('.next'), "No newer logs!");
                    else { this.currentMonth.setMonth(this.currentMonth.getMonth() + 1); this.render(); }
                }
                else if (e.target.closest('.rgs-cal-day:not(.empty):not(.disabled)')) {
                    const el = e.target.closest('.rgs-cal-day');
                    const dateStr = el.dataset.date;
                    const d = parseLocalDate(dateStr);
                    document.getElementById('rgs-timeline-panel').classList.remove('active');

                    OverviewManager.open();

                    CalendarManager.rangeStart = d;
                    CalendarManager.rangeEnd = d;
                    document.getElementById('ov-date-start').value = formatDateForInput(d);
                    document.getElementById('ov-date-end').value = formatDateForInput(d);
                    document.getElementById('ov-clear-start').style.display = 'block';
                    document.getElementById('ov-clear-end').style.display = 'block';

                    OverviewManager.triggerCrossFilter();
                }
            });
        },
        render() {
            if (typeof OverviewManager !== 'undefined') {
                if (!OverviewManager.isLoaded) {
                    OverviewManager.syncMemoryData();
                    OverviewManager.loadState();
                }
                const state = OverviewManager.getState();
                const bms = JSON.parse(localStorage.getItem('env_dash_bms') || '[]');
                const pinnedList = getPinnedRepos();

                const dataForStats = OverviewManager.masterData.filter(d => OverviewManager.checkMatch(d, state, pinnedList, bms, 'dates'));
                CalendarManager.calculateMetadataStats(dataForStats);
            }

            const y = this.currentMonth.getFullYear();
            const m = this.currentMonth.getMonth();
            const nextM = new Date(y, m + 1, 1);

            const html = CalendarManager.buildMonth(y, m, true) +
                CalendarManager.buildMonth(nextM.getFullYear(), nextM.getMonth(), false);

            const content = document.getElementById('rgs-timeline-content');
            content.innerHTML = `<div class="rgs-cal-popup active" style="position:static; display:flex; box-shadow:none; padding:0; background:transparent;">${html}</div>`;

            const st = CalendarManager.rangeStart ? CalendarManager.rangeStart.getTime() : null;
            const et = CalendarManager.rangeEnd ? CalendarManager.rangeEnd.getTime() : null;
            content.querySelectorAll('.rgs-cal-day:not(.empty)').forEach(el => {
                const ct = parseLocalDate(el.dataset.date).getTime();
                el.classList.remove('start-date', 'end-date', 'in-range');
                if (st && ct === st) el.classList.add('start-date');
                if (et && ct === et) el.classList.add('end-date');
                if (st && et && ct > st && ct < et) el.classList.add('in-range');
            });
        }
    };

    // --- DUAL-INPUT CALENDAR SYSTEM ---
    const CalendarManager = {
        popup: null, startInput: null, endInput: null, startClear: null, endClear: null, currentMonth: new Date(), rangeStart: null, rangeEnd: null, activeTarget: null, currentStats: {},
        init() {
            this.startInput = document.getElementById('ov-date-start'); this.endInput = document.getElementById('ov-date-end');
            this.startClear = document.getElementById('ov-clear-start'); this.endClear = document.getElementById('ov-clear-end');
            this.popup = document.createElement('div'); this.popup.className = 'rgs-cal-popup';
            this.startInput.closest('.rgs-cal-group').appendChild(this.popup);

            document.addEventListener('click', (e) => {
                if (!e.composedPath().includes(this.popup) && !e.composedPath().includes(this.startInput) && !e.composedPath().includes(this.endInput) && !e.composedPath().includes(this.startClear) && !e.composedPath().includes(this.endClear)) this.closePopup();
            });

            this.startInput.addEventListener('click', (e) => { e.stopPropagation(); this.openPopup('start'); });
            this.endInput.addEventListener('click', (e) => { e.stopPropagation(); this.openPopup('end'); });

            this.startClear.addEventListener('click', (e) => { e.stopPropagation(); this.rangeStart = null; this.startInput.value = ''; this.startClear.style.display = 'none'; if (typeof OverviewManager !== 'undefined') OverviewManager.triggerCrossFilter(); });
            this.endClear.addEventListener('click', (e) => { e.stopPropagation(); this.rangeEnd = null; this.endInput.value = ''; this.endClear.style.display = 'none'; if (typeof OverviewManager !== 'undefined') OverviewManager.triggerCrossFilter(); });

            this.popup.addEventListener('click', (e) => {
                e.stopPropagation();
                const bounds = this.getBounds();
                const currM = new Date(this.currentMonth.getFullYear(), this.currentMonth.getMonth(), 1);

                if (e.target.closest('.prev')) {
                    const minM = new Date(bounds.min.getFullYear(), bounds.min.getMonth(), 1);
                    if (currM <= minM) this.shakeEl(e.target.closest('.prev'), "No older logs!");
                    else { this.currentMonth.setMonth(this.currentMonth.getMonth() - 1); this.render(); }
                }
                else if (e.target.closest('.next')) {
                    const nextM = new Date(this.currentMonth.getFullYear(), this.currentMonth.getMonth() + 1, 1);
                    const maxM = new Date(bounds.max.getFullYear(), bounds.max.getMonth(), 1);
                    if (nextM >= maxM) this.shakeEl(e.target.closest('.next'), "No newer logs!");
                    else { this.currentMonth.setMonth(this.currentMonth.getMonth() + 1); this.render(); }
                }
                else if (e.target.closest('.rgs-cal-day:not(.empty):not(.disabled)')) {
                    const dayCell = e.target.closest('.rgs-cal-day');
                    const selected = parseLocalDate(dayCell.dataset.date);

                    if (this.activeTarget === 'start') {
                        if (this.rangeEnd && selected > this.rangeEnd) {
                            this.shakeEl(dayCell, "Start date cannot be after end date!"); return;
                        }
                        this.rangeStart = selected; this.startInput.value = formatDateForInput(selected); this.startClear.style.display = 'block';
                        if (!this.rangeEnd) this.openPopup('end'); else this.closePopup();
                    } else {
                        if (this.rangeStart && selected < this.rangeStart) {
                            this.shakeEl(dayCell, "End date cannot be before start date!"); return;
                        }
                        this.rangeEnd = selected; this.endInput.value = formatDateForInput(selected); this.endClear.style.display = 'block'; this.closePopup();
                    }
                    if (typeof OverviewManager !== 'undefined') OverviewManager.triggerCrossFilter();
                }
            });
        },
        getBounds() {
            if (typeof OverviewManager === 'undefined' || !OverviewManager.masterData || OverviewManager.masterData.length === 0) return { min: new Date(), max: new Date() };
            const times = OverviewManager.masterData.map(d => d.created_dateObj ? d.created_dateObj.getTime() : null).filter(Boolean);
            if (!times.length) return { min: new Date(), max: new Date() };
            return { min: new Date(Math.min(...times)), max: new Date(Math.max(...times)) };
        },
        shakeEl(el, msg) {
            el.classList.add('rgs-shake');
            let t = el.querySelector('.rgs-cal-tooltip');
            if (!t) { t = document.createElement('div'); t.className = 'rgs-cal-tooltip'; el.appendChild(t); }
            t.textContent = msg; t.classList.add('show');
            setTimeout(() => { el.classList.remove('rgs-shake'); t.classList.remove('show'); }, 1500);
        },
        openPopup(target) {
            this.activeTarget = target; this.startInput.classList.toggle('active', target === 'start'); this.endInput.classList.toggle('active', target === 'end');
            this.currentMonth = target === 'start' && this.rangeStart ? new Date(this.rangeStart) : (target === 'end' && this.rangeEnd ? new Date(this.rangeEnd) : new Date());
            this.render(); this.popup.classList.add('active');
        },
        closePopup() { this.popup.classList.remove('active'); this.startInput.classList.remove('active'); this.endInput.classList.remove('active'); },
        calculateMetadataStats(dataContext) {
            const stats = {};
            if (dataContext) {
                dataContext.forEach(d => {
                    if (!d.created_dateObj) return;
                    const y = d.created_dateObj.getFullYear(), m = String(d.created_dateObj.getMonth() + 1).padStart(2, '0'), day = String(d.created_dateObj.getDate()).padStart(2, '0');
                    const key = `${y}-${m}-${day}`;
                    if (!stats[key]) stats[key] = {};
                    const st = d.status || 'UNKNOWN';
                    if (!stats[key][st]) stats[key][st] = 0;
                    stats[key][st]++;
                });
            }
            this.currentStats = stats;
        },
        render() {
            const y = this.currentMonth.getFullYear(), m = this.currentMonth.getMonth(), next = new Date(y, m + 1, 1);
            this.popup.innerHTML = `${this.buildMonth(y, m, true)}${this.buildMonth(next.getFullYear(), next.getMonth(), false)}`;
            this.updateSelectionUI();
        },
        buildMonth(year, month, isLeft) {
            const firstDay = new Date(year, month, 1).getDay(), daysInMonth = new Date(year, month + 1, 0).getDate();
            const today = new Date(); today.setHours(23, 59, 59, 999); let daysHtml = '';

            for (let i = 0; i < firstDay; i++) daysHtml += `<div class="rgs-cal-day empty"></div>`;
            for (let i = 1; i <= daysInMonth; i++) {
                const c = new Date(year, month, i), dStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(i).padStart(2, '0')}`;

                let metaHtml = '';
                if (this.currentStats && this.currentStats[dStr]) {
                    const s = this.currentStats[dStr]; let pills = '';
                    Object.entries(s).forEach(([stName, count]) => {
                        if (count > 0) {
                            const textColor = getStatusDotColor(stName);
                            pills += `<span style="color:${textColor};" title="${stName}">${count}</span>`;
                        }
                    });
                    if (pills) metaHtml = `<div class="rgs-cal-meta">${pills}</div>`;
                }

                daysHtml += `<div class="rgs-cal-day ${c > today ? 'disabled' : ''}" data-date="${dStr}">${metaHtml}${i}</div>`;
            }

            const prevBtn = isLeft ? '<button class="rgs-cal-btn prev">❮</button>' : '<div class="rgs-cal-btn-placeholder"></div>';
            const nextBtn = !isLeft ? '<button class="rgs-cal-btn next">❯</button>' : '<div class="rgs-cal-btn-placeholder"></div>';

            return `
            <div class="rgs-cal-month">
                <div class="rgs-cal-header">
                    ${prevBtn}
                    <span class="rgs-cal-month-title">${year} / ${String(month + 1).padStart(2, '0')}</span>
                    ${nextBtn}
                </div>
                <div class="rgs-cal-weekdays"><div>Su</div><div>Mo</div><div>Tu</div><div>We</div><div>Th</div><div>Fr</div><div>Sa</div></div>
                <div class="rgs-cal-days">${daysHtml}</div>
            </div>`;
        },
        updateSelectionUI() {
            const st = this.rangeStart ? this.rangeStart.getTime() : null, et = this.rangeEnd ? this.rangeEnd.getTime() : null;
            this.popup.querySelectorAll('.rgs-cal-day:not(.empty)').forEach(el => {
                const ct = parseLocalDate(el.dataset.date).getTime(); el.classList.remove('start-date', 'end-date', 'in-range');
                if (st && ct === st) el.classList.add('start-date'); if (et && ct === et) el.classList.add('end-date'); if (st && et && ct > st && ct < et) el.classList.add('in-range');
            });
        },
        getRange() { return { start: this.rangeStart, end: this.rangeEnd }; }
    };

    // --- MULTI-SELECT BUILDER ---
    function buildMultiSelectHTML(id, label) {
        const plural = label === 'Status' ? 'Statuses' : label + 's';
        return `
        <div class="rgs-ms-container" id="ms-${id}" data-id="${id}" data-label="${label}">
            <div class="rgs-ms-display">All ${plural} <span style="font-size: 10px; color: #94a3b8;">▼</span></div>
            <div class="rgs-ms-panel">
                <input type="text" class="rgs-ms-search" placeholder="Search ${label}..." list="ms-hist-${id}">
                <datalist id="ms-hist-${id}"></datalist>
                <div class="rgs-ms-list" id="list-${id}"></div>
            </div>
        </div>`;
    }

    // --- Dynamic Size, Spaced SVG Progress Graph Generator ---
    function generateFlowSVG(flow, history, currentStep) {
        if (!flow || flow.length === 0) return { html: `<div style="color:#94a3b8; font-size:11px; font-style:italic;">No flow data</div>`, scrollX: 0 };
        const histMap = {};
        (history || []).forEach(h => { histMap[h.step] = h; });

        // Calculate dynamic height based on the maximum number of groups stacking vertically
        let maxStackCount = 1;
        flow.forEach(step => {
            if (!histMap[step.step] && step.groups && step.groups.length > maxStackCount) {
                maxStackCount = step.groups.length;
            }
        });

        const r = 12;
        const lineLen = settings.flowLineLen || 50;
        const dx = (r * 2) + lineLen;
        const startX = 35;
        const width = Math.max(300, (startX * 2) + ((flow.length - 1) * dx));

        // Dynamically adjust canvas height so it centers perfectly in the table row
        const height = 75 + (maxStackCount * 12);
        const fSize = settings.flowFontSize;

        // Forced exact height to prevent the SVG from shrinking the circles
        let svg = `<svg viewBox="0 0 ${width} ${height}" style="width:${width}px; min-width: ${width}px; height:${height}px; display:block;" xmlns="http://www.w3.org/2000/svg">`;

        let currentIndex = 0;

        for (let i = 0; i < flow.length - 1; i++) {
            const step = flow[i];
            const h1 = histMap[step.step];
            const lineCol = (h1 && h1.approve) ? '#10b981' : '#cbd5e1';
            const x1 = startX + i * dx + r + 4;
            const x2 = startX + (i + 1) * dx - r - 4;
            svg += `<line x1="${x1}" y1="20" x2="${x2}" y2="20" stroke="${lineCol}" stroke-width="3" stroke-linecap="round"/>`;
        }

        for (let i = 0; i < flow.length; i++) {
            const step = flow[i];
            if (step.step === currentStep) currentIndex = i;
            const h = histMap[step.step];
            const cx = startX + i * dx;

            let col = '#cbd5e1';
            let icon = '';
            let appNames = []; // We now use an array to stack text vertically
            let groupTooltip = '';

            // LOGIC: If history exists, it is DONE.
            if (h) {
                appNames = [h.approver];
                col = h.approve ? '#10b981' : '#ef4444';
                icon = h.approve
                    ? `<path d="M -4 1 L -1.5 4 L 4 -3" stroke="${col}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`
                    : `<path d="M -3 -3 L 3 3 M 3 -3 L -3 3" stroke="${col}" stroke-width="2.5" stroke-linecap="round" fill="none"/>`;
            }
            // LOGIC: If NO history exists, it is PENDING or CURRENT.
            else {
                if (step.groups && step.groups.length > 0) {
                    // Map groups to individual vertical rows. Clean up redundancy so they fit cleanly.
                    appNames = step.groups.map(g => {
                        let clean = g.replace('_APPROVAL', '').replace('_LEAD', '');
                        if (clean.length > 12) clean = clean.substring(0, 10) + '..';
                        return `[${clean}]`;
                    });

                    // Keep the horizontal tooltip improvement so it doesn't run off the top of the screen
                    groupTooltip = step.groups.map(g => {
                        const members = globalGroups[g];
                        return members ? `${g}:\n${members.join(', ')}` : g;
                    }).join('\n\n');
                }

                if (step.step === currentStep) {
                    col = '#f59e0b';
                    icon = `<circle cx="0" cy="0" r="4" fill="${col}" />`;
                }
            }

            const words = step.step.replace(/_APPROVAL/g, '').replace(/_/g, ' ').split(' ');
            let line1 = words[0] || '';
            let line2 = words.slice(1).join(' ') || '';
            if (line1.length > 15) line1 = line1.substring(0, 13) + '..';
            if (line2.length > 15) line2 = line2.substring(0, 13) + '..';

            const textCol = (h && h.approve) ? '#16a34a' : '#64748b';
            const appCol = (h && h.approve) ? '#0f172a' : (step.step === currentStep ? '#b45309' : '#94a3b8');

            const safeTooltip = groupTooltip ? escapeQuotes(groupTooltip) : '';
            const hoverClass = groupTooltip ? 'rgs-fast-tt-trigger' : '';
            const cursorStyle = groupTooltip ? 'cursor: help;' : '';

            // Generate multi-line stacked SVG text elements
            let appNameHtml = '';
            appNames.forEach((name, idx) => {
                const yPos = 58 + (idx * 12); // Stack them 12px apart
                appNameHtml += `<text x="0" y="${yPos}" font-size="10" font-weight="700" fill="${appCol}" text-anchor="middle">${name}</text>`;
            });

            svg += `
            <g transform="translate(${cx}, 20)" class="${hoverClass}" data-fast-tt="${safeTooltip}" style="${cursorStyle}">
                <rect x="-30" y="-15" width="60" height="${height - 10}" fill="transparent" />
                
                <circle cx="0" cy="0" r="${r}" fill="#ffffff" stroke="${col}" stroke-width="3" />
                ${icon}
                <text x="0" y="26" font-size="${fSize}" font-weight="800" fill="${textCol}" text-anchor="middle">${line1}</text>
                ${line2 ? `<text x="0" y="40" font-size="${fSize}" font-weight="800" fill="${textCol}" text-anchor="middle">${line2}</text>` : ''}
                ${appNameHtml}
            </g>`;
        }

        svg += `</svg>`;

        let scrollX = 0;
        if (currentIndex > 0) {
            scrollX = Math.max(0, startX + (currentIndex - 1) * dx - 40);
        }

        return {
            html: `<div class="rgs-flow-scroll" style="display:flex; align-items:center; width:100%; height: 100%; overflow-x: auto;">${svg}</div>`,
            scrollX: scrollX
        };
    }

    // --- OVERVIEW SYSTEM ---
    const OverviewManager = {
        modal: null, tbody: null, streamInd: null, masterData: [], isLoaded: false,
        myApprovalsOnly: false,
        sortCol: 'date', sortDir: 'desc', lastBms: null, lastPinnedList: null, lastState: null,

        init() {
            if (document.getElementById('rgs-ov-modal')) return;
            document.body.insertAdjacentHTML('beforeend', `
                <div id="rgs-ov-modal">
                    <div class="rgs-ov-backdrop"></div>
                    <div class="rgs-ov-content">
                        
                        <div class="rgs-ov-header">
                            <h2>📊 Overview <span id="rgs-ov-count" style="font-size:13px; color:#64748b; font-weight:normal; margin-left:4px;">(0 results)</span></h2>
                            <div class="rgs-header-controls">
                                <div id="rgs-ov-stream-ind" class="rgs-stream-indicator">🔄 Streaming history...</div>
                                
                                <form onsubmit="event.preventDefault();" style="margin:0; padding:0;">
                                    <input type="text" id="ov-search" name="env-dash-search" class="rgs-ov-search" placeholder="🔍 Smart Search (Repo, Env, Title, etc)..." list="rgs-search-list" autocomplete="on">
                                </form>
                                <datalist id="rgs-search-list"></datalist>
                                
                                <div class="rgs-cal-group">
                                    🗓️
                                    <div class="rgs-cal-input-wrapper"><input type="text" id="ov-date-start" class="rgs-ov-dateinput" placeholder="Start Date" readonly><button id="ov-clear-start" class="rgs-cal-clear-btn">×</button></div>
                                    <span style="color:#94a3b8; font-weight:bold;">→</span>
                                    <div class="rgs-cal-input-wrapper"><input type="text" id="ov-date-end" class="rgs-ov-dateinput" placeholder="End Date" readonly><button id="ov-clear-end" class="rgs-cal-clear-btn">×</button></div>
                                </div>
                                <a href="https://lab.iki-utl.cc/dashboard/workflow" target="_blank" class="rgs-create-wf-btn">
                                    <span style="font-size:14px; line-height:1;">+</span> Create Workflow
                                </a>
                            </div>
                            <button class="rgs-ov-close">×</button>
                        </div>
                        
                        <div class="rgs-ov-toolbar">
                            <button id="ov-pinned-toggle" class="rgs-link-btn" title="Toggle Pinned Repos Only" data-mode="all">🌐 All Repos</button>
                            <button id="ov-clear-approvals" class="rgs-link-btn rgs-btn-urgent" style="display:none;" title="Clear Action Required filter">🚨 Action Required ✖</button>
                            
                            ${buildMultiSelectHTML('repo', 'Repo')}
                            ${buildMultiSelectHTML('version', 'Version')}
                            ${buildMultiSelectHTML('env', 'Environment')}
                            ${buildMultiSelectHTML('region', 'Region')}
                            ${buildMultiSelectHTML('creator', 'Creator')}
                            ${buildMultiSelectHTML('status', 'Status')}
                            
                            <select id="ov-bookmark" class="rgs-ov-search" style="width:140px; padding: 6px 10px; background:#f8fafc;"><option value="">All Logs</option><option value="true">⭐ Bookmarked</option></select>
                        </div>
                        
                        <div class="rgs-ov-table-container">
                            <table class="rgs-ov-table">
                                <thead id="ov-table-head"></thead>
                                <tbody id="ov-table-body"><tr><td colspan="10" style="text-align:center; padding: 40px;">Loading Data... ⏳</td></tr></tbody>
                            </table>
                        </div>
                    </div>
                </div>
            `);

            this.modal = document.getElementById('rgs-ov-modal'); this.tbody = document.getElementById('ov-table-body'); this.streamInd = document.getElementById('rgs-ov-stream-ind');
            this.modal.querySelector('.rgs-ov-close').onclick = () => this.close(); this.modal.querySelector('.rgs-ov-backdrop').onclick = () => this.close();

            ['repo', 'version', 'env', 'region', 'creator', 'status'].forEach(id => {
                const el = document.getElementById(`ms-${id}`);
                const list = document.getElementById(`list-${id}`);
                const display = el.querySelector('.rgs-ms-display');
                const searchInput = el.querySelector('.rgs-ms-search');

                display.addEventListener('click', (e) => {
                    document.querySelectorAll('.rgs-ms-container').forEach(c => { if (c !== el) c.classList.remove('open') });
                    el.classList.toggle('open');
                });

                searchInput.addEventListener('input', (e) => {
                    const term = e.target.value.toLowerCase();
                    el.querySelectorAll('.rgs-ms-label').forEach(lbl => {
                        lbl.style.display = lbl.textContent.toLowerCase().includes(term) ? 'flex' : 'none';
                    });
                });

                searchInput.addEventListener('change', (e) => {
                    const val = e.target.value.trim();
                    if (val) {
                        let hist = JSON.parse(localStorage.getItem(`env_dash_mshist_${id}`) || '[]');
                        hist = hist.filter(x => x !== val); hist.unshift(val); if (hist.length > 5) hist.length = 5;
                        localStorage.setItem(`env_dash_mshist_${id}`, JSON.stringify(hist));
                        this.updateMultiSearchDatalist(id);
                    }
                });

                list.addEventListener('change', (e) => {
                    if (e.target.type === 'checkbox') {
                        this.updateMultiSelectDisplay(id);
                        this.triggerCrossFilter(id);
                    }
                });

                this.updateMultiSearchDatalist(id);
            });

            document.addEventListener('click', e => {
                if (!e.target.closest('.rgs-ms-container')) {
                    document.querySelectorAll('.rgs-ms-container').forEach(c => c.classList.remove('open'));
                }
            });

            const pTog = document.getElementById('ov-pinned-toggle');
            pTog.addEventListener('click', () => {
                const isPinnedMode = pTog.dataset.mode === 'pinned';
                const repoList = document.getElementById('list-repo');
                const pinnedList = getPinnedRepos();

                if (isPinnedMode) {
                    pTog.dataset.mode = 'all';
                    pTog.style.background = '#f8fafc';
                    pTog.style.fontWeight = 'normal';
                    pTog.textContent = '🌐 All Repos';
                    repoList.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = false);
                } else {
                    pTog.dataset.mode = 'pinned';
                    pTog.style.background = '#e2e8f0';
                    pTog.style.fontWeight = 'bold';
                    pTog.textContent = '📌 Pinned';
                    repoList.querySelectorAll('input[type="checkbox"]').forEach(cb => {
                        const cleanVal = cb.value.replace('Tolgee: ', '');
                        cb.checked = pinnedList.includes(cleanVal);
                    });
                }
                this.updateMultiSelectDisplay('repo');
                this.triggerCrossFilter('repo');
            });

            document.getElementById('ov-clear-approvals').addEventListener('click', (e) => {
                this.myApprovalsOnly = false;
                e.target.style.display = 'none';
                this.triggerCrossFilter();
            });

            document.getElementById('ov-bookmark').addEventListener('change', () => this.triggerCrossFilter());

            const searchInput = document.getElementById('ov-search');
            searchInput.addEventListener('input', debounce(() => this.triggerCrossFilter(), 300));
            searchInput.addEventListener('change', (e) => {
                const val = e.target.value.trim();
                if (val) {
                    let hist = JSON.parse(localStorage.getItem('env_dash_search_hist') || '[]');
                    hist = hist.filter(x => x !== val); hist.unshift(val); if (hist.length > 10) hist.length = 10;
                    localStorage.setItem('env_dash_search_hist', JSON.stringify(hist));
                    this.updateSearchDatalist();
                }
            });

            this.tbody.addEventListener('mouseover', (e) => {
                const target = e.target.closest('.rgs-tt-trigger');
                if (!target) return;
                const d = this.masterData.find(w => String(w.id) === String(target.dataset.wfId));
                if (!d) return;
                const vLinks = d.repos_data.map(r => r.version ? `${r.name}: ${r.version}` : `${r.name}: -`).join('<br>');

                openSmartTooltip({
                    title: d.title,
                    date: d.created_at_local || 'Unknown Date',
                    versionHTML: vLinks,
                    summary: d.summary,
                    hlSet: d.hl
                }, target, false);
            });

            this.tbody.addEventListener('mouseout', (e) => {
                if (!e.target.closest('.rgs-tt-trigger')) return;
                closeSmartTooltip(false);
            });

            this.tbody.addEventListener('click', (e) => {
                const bmBtn = e.target.closest('.rgs-bm-btn');
                if (bmBtn) {
                    const id = bmBtn.dataset.id;
                    let bms = JSON.parse(localStorage.getItem('env_dash_bms') || '[]');
                    if (bms.includes(id)) bms = bms.filter(x => x !== id); else bms.push(id);
                    localStorage.setItem('env_dash_bms', JSON.stringify(bms));

                    bmBtn.classList.toggle('active');
                    bmBtn.textContent = bms.includes(id) ? '⭐' : '☆';
                    if (document.getElementById('ov-bookmark').value === 'true') this.triggerCrossFilter();
                    return;
                }

                const target = e.target.closest('.rgs-tt-trigger');
                if (target) {
                    e.stopPropagation();
                    const d = this.masterData.find(w => String(w.id) === String(target.dataset.wfId));
                    if (!d) return;
                    const vLinks = d.repos_data.map(r => {
                        const rNameClean = r.name.replace('Tolgee: ', '');
                        return r.version ? `${r.name}: <a href="https://github.com/Ikigaians/${rNameClean}/releases/tag/${r.version}" target="_blank" style="color:#60a5fa;">${r.version}</a>` : `${r.name}: -`;
                    }).join('<br>');

                    openSmartTooltip({
                        title: d.title,
                        date: d.created_at_local || 'Unknown Date',
                        versionHTML: vLinks,
                        summary: d.summary,
                        hlSet: d.hl
                    }, target, true);
                }
            });

            CalendarManager.init();
            this.updateSearchDatalist();
        },

        resetFilters() {
            document.getElementById('ov-search').value = '';
            document.getElementById('ov-pinned-toggle').dataset.mode = 'all';
            document.querySelectorAll('.rgs-ms-list input').forEach(cb => cb.checked = false);
            document.getElementById('ov-bookmark').value = '';
            CalendarManager.rangeStart = null;
            CalendarManager.rangeEnd = null;
            document.getElementById('ov-clear-start').style.display = 'none';
            document.getElementById('ov-clear-end').style.display = 'none';
            document.getElementById('ov-date-start').value = '';
            document.getElementById('ov-date-end').value = '';
        },

        openAndHighlight(wfId) {
            this.open();
            this.resetFilters();
            this.triggerCrossFilter();

            setTimeout(() => {
                const trigger = this.tbody.querySelector(`.rgs-tt-trigger[data-wf-id="${wfId}"]`);
                if (trigger) {
                    const row = trigger.closest('tr');
                    row.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    row.classList.add('rgs-highlight-row');
                    setTimeout(() => row.classList.remove('rgs-highlight-row'), 3000);
                }
            }, 100);
        },

        renderHeaders() {
            const head = document.getElementById('ov-table-head');
            if (!head) return;

            const thDefs = {
                id: { label: 'ID', sort: true, resizer: true },
                date: { label: 'Date & Time', sort: true, resizer: true },
                creator: { label: 'Creator', sort: true, resizer: true },
                repo: { label: 'Repository', sort: true, resizer: true },
                version: { label: 'Version', sort: true, resizer: true },
                env: { label: 'Env', sort: true, resizer: true },
                region: { label: 'Region', sort: true, resizer: true },
                title: { label: 'Summary / Title', sort: true, resizer: true, class: 'ov-title-col' },
                flow: { label: 'Progress Pipeline', sort: false, resizer: true },
                status: { label: 'Status', sort: true, resizer: true },
                action: { label: 'Actions', sort: false, resizer: true }
            };

            let html = `<tr>`;
            settings.colOrder.forEach(col => {
                const def = thDefs[col];
                if (!def) return;
                const widthStyle = settings.colWidths[col] ? `style="width:${settings.colWidths[col]}px"` : '';
                const cls = def.class ? `class="rgs-draggable-th ${def.class}"` : `class="rgs-draggable-th"`;
                const sortIcon = def.sort ? `<span class="rgs-sort-icon">${this.sortCol === col ? (this.sortDir === 'asc' ? '▲' : '▼') : '↕'}</span>` : '';
                const resizer = def.resizer ? `<div class="rgs-resizer"></div>` : '';
                html += `<th data-col="${col}" draggable="true" ${cls} ${widthStyle}>${def.label}${sortIcon}${resizer}</th>`;
            });
            html += `</tr>`;
            head.innerHTML = html;

            this.bindHeaderEvents();
        },

        bindHeaderEvents() {
            const head = document.getElementById('ov-table-head');
            if (!head) return;

            head.querySelectorAll('th[data-col]').forEach(th => {
                th.addEventListener('click', (e) => {
                    if (e.target.classList.contains('rgs-resizer')) return;
                    const col = th.dataset.col;
                    const thDefs = { flow: false, action: false };
                    if (thDefs[col] === false) return;

                    if (this.sortCol === col) {
                        this.sortDir = this.sortDir === 'asc' ? 'desc' : 'asc';
                    } else {
                        this.sortCol = col;
                        this.sortDir = 'asc';
                    }
                    this.renderHeaders();
                    if (this.lastState) this.renderTable(this.lastState, this.lastBms, this.lastPinnedList);
                });
            });

            let currentTh, startX, startW, colName;
            const onMove = e => { if (currentTh) currentTh.style.width = currentTh.style.minWidth = currentTh.style.maxWidth = `${Math.max(50, startW + (e.pageX - startX))}px`; };
            const onUp = () => { if (!currentTh) return; document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); settings.colWidths[colName] = parseInt(currentTh.style.width, 10); saveSettings(); currentTh = null; };
            head.querySelectorAll('.rgs-resizer').forEach(r => r.addEventListener('mousedown', e => { currentTh = e.target.parentNode; colName = currentTh.dataset.col; startX = e.pageX; startW = currentTh.offsetWidth; document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onUp); e.preventDefault(); e.stopPropagation(); }));

            let draggedCol = null;
            head.addEventListener('dragstart', (e) => {
                if (e.target.tagName === 'TH') {
                    draggedCol = e.target.dataset.col;
                    e.target.classList.add('rgs-dragging');
                }
            });
            head.addEventListener('dragover', (e) => {
                e.preventDefault();
                const th = e.target.closest('th');
                if (th && th.dataset.col !== draggedCol) {
                    th.classList.add('rgs-drag-over');
                }
            });
            head.addEventListener('dragleave', (e) => {
                const th = e.target.closest('th');
                if (th) th.classList.remove('rgs-drag-over');
            });
            head.addEventListener('drop', (e) => {
                e.preventDefault();
                const th = e.target.closest('th');
                if (th && draggedCol) {
                    th.classList.remove('rgs-drag-over');
                    const targetCol = th.dataset.col;
                    if (draggedCol !== targetCol) {
                        const fromIdx = settings.colOrder.indexOf(draggedCol);
                        const toIdx = settings.colOrder.indexOf(targetCol);
                        settings.colOrder.splice(fromIdx, 1);
                        settings.colOrder.splice(toIdx, 0, draggedCol);
                        saveSettings();
                        this.renderHeaders();
                        if (this.lastState) this.renderTable(this.lastState, this.lastBms, this.lastPinnedList);
                    }
                }
                draggedCol = null;
                head.querySelectorAll('th').forEach(t => t.classList.remove('rgs-dragging'));
            });
        },

        getMultiSelectValues(id) {
            return Array.from(document.querySelectorAll(`#list-${id} input:checked`)).map(cb => cb.value);
        },

        updateMultiSelectDisplay(id) {
            const el = document.getElementById(`ms-${id}`);
            if (!el) return;
            const label = el.dataset.label;
            const checkedBoxes = Array.from(document.querySelectorAll(`#list-${id} input:checked`));
            const display = el.querySelector('.rgs-ms-display');

            const plural = label === 'Status' ? 'Statuses' : label + 's';

            if (checkedBoxes.length === 0) {
                display.innerHTML = `All ${plural} <span style="font-size: 10px; color: #94a3b8;">▼</span>`;
            } else if (checkedBoxes.length === 1) {
                display.innerHTML = `${checkedBoxes[0].value} <span style="font-size: 10px; color: #94a3b8;">▼</span>`;
            } else {
                display.innerHTML = `${checkedBoxes.length} selected <span style="font-size: 10px; color: #94a3b8;">▼</span>`;
            }
        },

        updateSearchDatalist() {
            const hist = JSON.parse(localStorage.getItem('env_dash_search_hist') || '[]');
            const dl = document.getElementById('rgs-search-list');
            if (dl) dl.innerHTML = hist.map(h => `<option value="${h}">`).join('');
        },

        updateMultiSearchDatalist(id) {
            const hist = JSON.parse(localStorage.getItem(`env_dash_mshist_${id}`) || '[]');
            const dl = document.getElementById(`ms-hist-${id}`);
            if (dl) dl.innerHTML = hist.map(h => `<option value="${h}">`).join('');
        },

        syncMemoryData() {
            this.masterData = globalWorkflows.map(wf => {
                const d = activeCacheMap[wf.id] || {}; const lt = formatLocalTime(wf.created_at);
                return {
                    id: wf.id, created_at: wf.created_at, created_at_local: lt ? lt.full : '', created_dateObj: lt ? lt.dateObj : null,
                    environment: wf.environment || '', status: wf.status || '', regions: d.regions || [],
                    title: d.title || wf.name, summary: d.summary || '', creator: d.creator || 'Unknown',
                    flow: d.flow || [], history: d.history || [], current_step: d.current_step || '',
                    repos_data: d.repos_data || [], repo_names: d.repo_names || []
                };
            });
            this.isLoaded = true;
        },

        rebuildLists(sourceId) {
            const msDropdowns = [
                { id: 'repo', dk: 'repo_names', arr: true },
                { id: 'version', dk: 'version', arr: false },
                { id: 'env', dk: 'environment', arr: false },
                { id: 'region', dk: 'regions', arr: true },
                { id: 'creator', dk: 'creator', arr: false },
                { id: 'status', dk: 'status', arr: false }
            ];

            const state = this.getState();

            msDropdowns.forEach(dd => {
                if (dd.id === sourceId) return;
                const list = document.getElementById(`list-${dd.id}`);
                if (!list) return;

                const validData = this.masterData.filter(d => this.checkMatch(d, state, getPinnedRepos(), JSON.parse(localStorage.getItem('env_dash_bms') || '[]'), dd.id));

                let vals = new Set();
                validData.forEach(d => {
                    if (dd.id === 'version') {
                        d.repos_data.forEach(r => { if (r.version) vals.add(r.version); });
                    } else if (dd.arr) {
                        d[dd.dk].forEach(v => vals.add(v));
                    } else {
                        vals.add(d[dd.dk]);
                    }
                });

                const checked = this.getMultiSelectValues(dd.id);
                checked.forEach(c => vals.add(c));

                let valArr = [...vals].filter(Boolean);

                valArr.sort((a, b) => {
                    const aC = checked.includes(a);
                    const bC = checked.includes(b);
                    if (aC && !bC) return -1;
                    if (!aC && bC) return 1;
                    return a.localeCompare(b);
                });

                list.innerHTML = valArr.map(v => `
                    <label class="rgs-ms-label">
                        <input type="checkbox" value="${v}" ${checked.includes(v) ? 'checked' : ''}>
                        ${v}
                    </label>
                `).join('');

                this.updateMultiSelectDisplay(dd.id);
            });
        },

        getState() {
            return {
                repo: this.getMultiSelectValues('repo'),
                env: this.getMultiSelectValues('env'),
                region: this.getMultiSelectValues('region'),
                creator: this.getMultiSelectValues('creator'),
                version: this.getMultiSelectValues('version'),
                status: this.getMultiSelectValues('status'),
                bookmark: document.getElementById('ov-bookmark').value,
                dates: CalendarManager.getRange(),
                search: document.getElementById('ov-search').value.trim().toLowerCase().split(/\s+/).filter(Boolean),
                ovRepoMode: document.getElementById('ov-pinned-toggle').dataset.mode
            };
        },

        loadState() {
            if (!settings.saveFilters) return;

            try {
                const s = JSON.parse(localStorage.getItem('env_dash_filters'));
                if (s) {
                    if (s.search && s.search.length) document.getElementById('ov-search').value = s.search.join(' ');
                    if (s.bookmark) document.getElementById('ov-bookmark').value = s.bookmark;

                    if (s.dates) {
                        CalendarManager.rangeStart = s.dates.start ? new Date(s.dates.start) : null;
                        CalendarManager.rangeEnd = s.dates.end ? new Date(s.dates.end) : null;
                        if (CalendarManager.rangeStart) { document.getElementById('ov-date-start').value = formatDateForInput(CalendarManager.rangeStart); document.getElementById('ov-clear-start').style.display = 'block'; }
                        if (CalendarManager.rangeEnd) { document.getElementById('ov-date-end').value = formatDateForInput(CalendarManager.rangeEnd); document.getElementById('ov-clear-end').style.display = 'block'; }
                    }

                    if (s.ovRepoMode) {
                        const pTog = document.getElementById('ov-pinned-toggle');
                        pTog.dataset.mode = s.ovRepoMode;
                        if (s.ovRepoMode === 'pinned') {
                            pTog.style.background = '#e2e8f0';
                            pTog.style.fontWeight = 'bold';
                            pTog.textContent = '📌 Pinned';
                        } else {
                            pTog.style.background = '#f8fafc';
                            pTog.style.fontWeight = 'normal';
                            pTog.textContent = '🌐 All Repos';
                        }
                    }

                    ['repo', 'version', 'env', 'region', 'creator', 'status'].forEach(id => {
                        if (s[id] && s[id].length > 0) {
                            const list = document.getElementById(`list-${id}`);
                            list.innerHTML = s[id].map(v => `<label class="rgs-ms-label"><input type="checkbox" value="${v}" checked>${v}</label>`).join('');
                            this.updateMultiSelectDisplay(id);
                        }
                    });
                }
            } catch (e) { }
        },

        checkMatch(d, state, pinnedList, bms, ignoreKey) {
            if (this.myApprovalsOnly && !myPendingApprovals.has(d.id)) return false;

            if (ignoreKey !== 'repo' && state.repo.length > 0 && !d.repo_names.some(r => state.repo.includes(r))) return false;

            const pTog = document.getElementById('ov-pinned-toggle');
            if (pTog && pTog.dataset.mode === 'pinned') {
                const hasMatch = d.repo_names.some(r => {
                    return pinnedList.includes(r.replace('Tolgee: ', ''));
                });
                if (!hasMatch) return false;
            }

            if (ignoreKey !== 'version' && state.version.length > 0 && !d.repos_data.some(r => state.version.includes(r.version))) return false;
            if (ignoreKey !== 'env' && state.env.length > 0 && !state.env.includes(d.environment)) return false;
            if (ignoreKey !== 'region' && state.region.length > 0 && !d.regions.some(r => state.region.includes(r))) return false;
            if (ignoreKey !== 'creator' && state.creator.length > 0 && !state.creator.includes(d.creator)) return false;
            if (ignoreKey !== 'status' && state.status.length > 0 && !state.status.includes(d.status)) return false;
            if (ignoreKey !== 'bookmark' && state.bookmark === 'true' && !bms.includes(String(d.id))) return false;

            if (ignoreKey !== 'dates' && (state.dates.start || state.dates.end)) {
                if (!d.created_dateObj) return false;
                if (state.dates.start && d.created_dateObj < state.dates.start) return false;
                if (state.dates.end) { const eb = new Date(state.dates.end); eb.setDate(eb.getDate() + 1); if (d.created_dateObj >= eb) return false; }
            }
            if (ignoreKey !== 'search' && state.search.length > 0) {
                const text = `${d.creator} ${d.repo_names.join(' ')} ${d.environment} ${d.regions.join(' ')} ${d.repos_data.map(x => x.version).join(' ')} ${d.title} ${d.summary} ${d.status}`.toLowerCase();
                const words = text.split(/[^a-z0-9.-]/).filter(Boolean);
                for (const term of state.search) {
                    let matched = false;
                    if (/\d/.test(term) && text.includes(term)) matched = true;
                    else if (text.includes(term)) matched = true;
                    else { const tol = term.length <= 3 ? 0 : (term.length <= 5 ? 1 : 2); if (tol > 0) for (const w of words) if (Math.abs(w.length - term.length) <= tol && levenshtein(term, w) <= tol) { matched = true; break; } }
                    if (!matched) return false;
                }
            }
            return true;
        },

        async open() {
            this.init(); this.modal.classList.add('active'); this.syncMemoryData();

            this.loadState();
            this.renderHeaders();

            const clrBtn = document.getElementById('ov-clear-approvals');
            if (this.myApprovalsOnly && clrBtn) {
                clrBtn.style.display = 'inline-flex';
                clrBtn.textContent = `🚨 Action Required (${myPendingApprovals.size}) ✖`;
            } else if (clrBtn) {
                clrBtn.style.display = 'none';
            }

            const pTog = document.getElementById('ov-pinned-toggle');
            if (pTog.dataset.mode === 'pinned') {
                const repoList = document.getElementById('list-repo');
                const pinnedList = getPinnedRepos();
                repoList.querySelectorAll('input[type="checkbox"]').forEach(cb => {
                    const cleanVal = cb.value.replace('Tolgee: ', '');
                    cb.checked = pinnedList.includes(cleanVal);
                });
                this.updateMultiSelectDisplay('repo');
            }

            this.triggerCrossFilter();
        },
        close() { if (this.modal) this.modal.classList.remove('active'); },

        triggerCrossFilter(sourceId) {
            if (!this.isLoaded) return;
            const state = this.getState();

            if (settings.saveFilters) {
                localStorage.setItem('env_dash_filters', JSON.stringify(state));
            }

            const bms = JSON.parse(localStorage.getItem('env_dash_bms') || '[]');
            const pinnedList = getPinnedRepos();

            const pTog = document.getElementById('ov-pinned-toggle');
            if (pTog && pTog.dataset.mode === 'pinned') {
                const rVals = state.repo.map(r => r.replace('Tolgee: ', ''));
                let fullyMatched = rVals.length === pinnedList.length && rVals.every(r => pinnedList.includes(r));
                if (!fullyMatched && state.repo.length > 0) {
                    pTog.dataset.mode = 'all';
                    pTog.style.background = '#f8fafc';
                    pTog.style.fontWeight = 'normal';
                    pTog.textContent = '🌐 All Repos';
                }
            }

            this.rebuildLists(sourceId);

            const dataForCalendar = this.masterData.filter(d => this.checkMatch(d, state, pinnedList, bms, 'dates'));
            CalendarManager.calculateMetadataStats(dataForCalendar);
            if (CalendarManager.popup && CalendarManager.popup.classList.contains('active')) {
                CalendarManager.render();
            }

            this.lastState = state;
            this.lastBms = bms;
            this.lastPinnedList = pinnedList;
            this.renderTable(state, bms, pinnedList);
        },

        renderTable(state, bms, pinnedList) {
            const filtered = this.masterData.filter(d => this.checkMatch(d, state, pinnedList, bms, null));

            const countEl = document.getElementById('rgs-ov-count');
            if (countEl) countEl.textContent = `(${filtered.length} results)`;

            filtered.sort((a, b) => {
                let vA, vB;
                if (this.sortCol === 'id') { vA = a.id; vB = b.id; }
                else if (this.sortCol === 'date') { vA = a.created_at; vB = b.created_at; }
                else if (this.sortCol === 'repo') { vA = a.repo_names; vB = b.repo_names; }
                else if (this.sortCol === 'version') { vA = a.repos_data.map(x => x.version); vB = b.repos_data.map(x => x.version); }
                else if (this.sortCol === 'env') { vA = a.environment; vB = b.environment; }
                else if (this.sortCol === 'region') { vA = a.regions; vB = b.regions; }
                else { vA = a[this.sortCol]; vB = b[this.sortCol]; }

                if (Array.isArray(vA)) vA = vA.join(',');
                if (Array.isArray(vB)) vB = vB.join(',');

                vA = String(vA || '').toLowerCase();
                vB = String(vB || '').toLowerCase();

                if (this.sortCol === 'id') {
                    return this.sortDir === 'asc' ? (a.id - b.id) : (b.id - a.id);
                }

                if (vA < vB) return this.sortDir === 'asc' ? -1 : 1;
                if (vA > vB) return this.sortDir === 'asc' ? 1 : -1;
                return 0;
            });

            if (filtered.length === 0) { this.tbody.innerHTML = `<tr><td colspan="${settings.colOrder.length}" style="text-align:center; padding: 40px; color:#ef4444; font-weight:600;">No deployments match the current filters.</td></tr>`; return; }

            let htmlStr = '';
            const bgColors = ['#ffffff', '#eef2f6'];
            let bgIndex = 0;
            let lastRepoStr = null;

            const searchTerms = new Set(state.search);

            filtered.forEach(d => {
                const currentRepoStr = d.repo_names.join(',');
                if (currentRepoStr !== lastRepoStr) {
                    if (lastRepoStr !== null) bgIndex = 1 - bgIndex;
                    lastRepoStr = currentRepoStr;
                }
                const rowBg = bgColors[bgIndex];
                const bStyle = getStatusStyle(d.status);
                const isBm = bms.includes(String(d.id));

                d.hl = searchTerms;

                const regionHtml = d.regions.length > 0 ? d.regions.map(r => `<span style="white-space:nowrap;">${highlightHTML(r, d.hl)}</span>`).join(', ') : highlightHTML('All', d.hl);

                const repoHtml = `<div style="display:flex; flex-direction:column; gap:6px;">${d.repos_data.map(r => {
                    const isTolgee = r.name.startsWith('Tolgee: ');
                    return isTolgee ? `<span style="color:#d946ef; font-weight:bold;">${highlightHTML(r.name, d.hl)}</span>` : `<span>${highlightHTML(r.name, d.hl)}</span>`;
                }).join('')}</div>`;

                const verHtml = `<div style="display:flex; flex-direction:column; gap:6px; font-family:monospace; font-weight:600; color:#2563eb;">${d.repos_data.map(r => {
                    const isTolgee = r.name.startsWith('Tolgee: ');
                    const rNameClean = r.name.replace('Tolgee: ', '');
                    return r.version ? `<a href="https://github.com/Ikigaians/${rNameClean}/releases/tag/${r.version}" target="_blank" ${isTolgee ? 'style="color:#d946ef;"' : ''}>${highlightHTML(r.version, d.hl)}</a>` : '-';
                }).join('')}</div>`;

                const flowData = generateFlowSVG(d.flow, d.history, d.current_step);

                const colDefs = {
                    id: `<td style="font-family:monospace; font-weight:bold;"><a href="https://lab.iki-utl.cc/dashboard/workflow/${d.id}" target="_blank" style="color:#64748b; text-decoration:none;">#${d.id}</a></td>`,
                    date: `<td style="font-family:monospace; color:#64748b;">${d.created_at_local ? d.created_at_local.substring(0, 16) : ''}</td>`,
                    creator: `<td style="font-weight:600; color:#3b82f6;">${highlightHTML(d.creator, d.hl)}</td>`,
                    repo: `<td style="font-weight:600;">${repoHtml}</td>`,
                    version: `<td>${verHtml}</td>`,
                    env: `<td>${highlightHTML(d.environment, d.hl)}</td>`,
                    region: `<td class="ov-region-cell">${regionHtml}</td>`,
                    title: `<td class="rgs-tt-trigger ov-title-cell" data-wf-id="${d.id}">${highlightHTML(d.title, d.hl)}</td>`,
                    flow: `<td class="ov-flow-cell" data-scroll-x="${flowData.scrollX}">${flowData.html}</td>`,
                    status: `<td class="ov-status-cell"><span class="rgs-badge" style="${bStyle}">${d.status || 'UNKNOWN'}</span></td>`,
                    action: `<td style="text-align:center;"><div class="rgs-action-col"><button class="rgs-bm-btn ${isBm ? 'active' : ''}" data-id="${d.id}" title="Bookmark this deployment">${isBm ? '⭐' : '☆'}</button><a class="rgs-link-btn" href="https://lab.iki-utl.cc/dashboard/workflow/${d.id}" target="_blank" title="View Details">↗️</a></div></td>`
                };

                let rowHtml = '';
                settings.colOrder.forEach(col => {
                    if (colDefs[col]) rowHtml += colDefs[col];
                });

                htmlStr += `<tr style="background: ${rowBg}">${rowHtml}</tr>`;
            });
            this.tbody.innerHTML = htmlStr;

            setTimeout(() => {
                this.tbody.querySelectorAll('.ov-flow-cell').forEach(cell => {
                    const sx = parseFloat(cell.dataset.scrollX);
                    if (sx > 0) {
                        const scrollDiv = cell.querySelector('.rgs-flow-scroll');
                        if (scrollDiv) scrollDiv.scrollLeft = sx;
                    }
                });
            }, 50);
        }
    };

    // --- MATRIX INJECTION ---
    function injectUIButtons() {
        if (document.getElementById('rgs-settings-wrapper')) return;
        const displayBtn = Array.from(document.querySelectorAll('header button')).find(b => b.textContent.includes('Display'));

        if (displayBtn) {
            const wrapper = document.createElement('div'); wrapper.id = 'rgs-settings-wrapper'; wrapper.className = 'rgs-settings-container';
            const toggleBtn = document.createElement('button'); toggleBtn.className = displayBtn.className; toggleBtn.innerHTML = `⚙️ Settings`;

            const panel = document.createElement('div'); panel.className = 'rgs-settings-panel';
            panel.innerHTML = `
                <button class="rgs-global-action-btn" id="rgs-btn-expand-collapse" style="margin-bottom: 8px;">${settings.isExpanded ? 'Collapse Matrix' : 'Expand Matrix'}</button>
                <div style="display: flex; gap: 8px; margin-bottom: 10px;">
                    <button class="rgs-global-action-btn" id="rgs-btn-reset-settings" style="margin: 0; flex: 1; font-size: 11px; background: #fee2e2; border-color: #f87171; color: #991b1b;" title="Reset Sliders & UI">↺ Settings</button>
                    <button class="rgs-global-action-btn" id="rgs-btn-reset-db" style="margin: 0; flex: 1; font-size: 11px; background: #fee2e2; border-color: #f87171; color: #991b1b;" title="Clear Cache Data">↺ DB Cache</button>
                </div>
                <div class="rgs-setting-row-inline"><label for="rgs-hide-year">Hide Year</label><input type="checkbox" id="rgs-hide-year" ${settings.hideYear ? 'checked' : ''}></div>
                <div class="rgs-setting-row-inline" style="margin-bottom: 12px;"><label for="rgs-hide-time">Hide Time</label><input type="checkbox" id="rgs-hide-time" ${settings.hideTime ? 'checked' : ''}></div>
                <div class="rgs-setting-row-inline" style="margin-bottom: 12px;"><label for="rgs-save-filters" title="Save Overview window filters between sessions">Save Filters</label><input type="checkbox" id="rgs-save-filters" ${settings.saveFilters ? 'checked' : ''}></div>
                <hr style="margin: 0 0 10px 0; border-color: #e2e8f0;">
                
                <div class="rgs-setting-row" style="margin-bottom: 10px;">
                    <label style="margin-bottom: 2px;">Enable Matrix on Repos</label>
                    <div class="rgs-repo-actions">
                        <button id="rgs-btn-sel-all" class="rgs-repo-btn">Select All</button>
                        <button id="rgs-btn-sel-none" class="rgs-repo-btn">Unselect All</button>
                        <button id="rgs-btn-sel-pinned" class="rgs-repo-btn">Select Pinned</button>
                    </div>
                    <div id="rgs-repo-filters" style="display: block; margin-top: 4px; font-size: 11px; max-height: 140px; overflow-y: auto; background: #f8fafc; padding: 6px; border-radius: 4px; border: 1px solid #e2e8f0;">
                        </div>
                </div>

                <div class="rgs-setting-row" style="margin-bottom: 10px;">
                    <label>Visible Matrix Statuses</label>
                    <div id="rgs-status-filters" style="display: flex; flex-wrap: wrap; gap: 6px; margin-top: 4px; font-size: 10px;">
                        </div>
                </div>

                <div class="rgs-setting-row"><label>DOM Items per cell <span id="rgs-lbl-items">${settings.maxItems}</span></label><input type="range" id="rgs-rng-items" min="1" max="50" step="1" value="${settings.maxItems}"></div>
                <div class="rgs-setting-row"><label>Matrix Font Size <span id="rgs-lbl-font">${settings.fontSize}px</span></label><input type="range" id="rgs-rng-font" min="8" max="16" value="${settings.fontSize}"></div>
                <div class="rgs-setting-row"><label>Pipeline Font Size <span id="rgs-lbl-flowFontSize">${settings.flowFontSize}px</span></label><input type="range" id="rgs-rng-flowFontSize" min="7" max="16" value="${settings.flowFontSize}"></div>
                <div class="rgs-setting-row"><label>Pipeline Line Length <span id="rgs-lbl-flowLineLen">${settings.flowLineLen}px</span></label><input type="range" id="rgs-rng-flowLineLen" min="15" max="100" step="5" value="${settings.flowLineLen}"></div>
                <div class="rgs-setting-row"><label>Max Width <span id="rgs-lbl-width">${settings.maxWidth}px</span></label><input type="range" id="rgs-rng-width" min="80" max="400" step="10" value="${settings.maxWidth}"></div>
                <div class="rgs-setting-row"><label>Max Height <span id="rgs-lbl-height">${settings.maxHeight}px</span></label><input type="range" id="rgs-rng-height" min="60" max="300" step="10" value="${settings.maxHeight}"></div>
            `;

            wrapper.appendChild(toggleBtn); wrapper.appendChild(panel); displayBtn.parentNode.insertBefore(wrapper, displayBtn.nextSibling);
            const ovBtn = document.createElement('button'); ovBtn.className = displayBtn.className; ovBtn.innerHTML = `📊 Overview`; ovBtn.style.marginLeft = '8px';
            wrapper.parentNode.insertBefore(ovBtn, wrapper.nextSibling);

            ovBtn.addEventListener('click', () => OverviewManager.open());

            toggleBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                updateSettingsCheckboxes();
                panel.classList.toggle('active');
            });

            document.addEventListener('click', (e) => { if (!wrapper.contains(e.target)) panel.classList.remove('active'); });

            const actionBtn = panel.querySelector('#rgs-btn-expand-collapse');
            actionBtn.addEventListener('click', () => {
                settings.isExpanded = !settings.isExpanded;
                actionBtn.textContent = settings.isExpanded ? 'Collapse Matrix' : 'Expand Matrix';
                saveSettings();
                document.querySelectorAll('.rgs-matrix-list').forEach(list => {
                    const caret = list.previousElementSibling.querySelector('.rgs-caret');
                    if (settings.isExpanded) { list.classList.remove('rgs-collapsed'); if (caret) caret.textContent = '▲'; }
                    else { list.classList.add('rgs-collapsed'); if (caret) caret.textContent = '▼'; }
                });
            });

            panel.querySelector('#rgs-btn-reset-settings').addEventListener('click', () => {
                if (confirm('Are you sure you want to reset all display settings and column widths to default?')) {
                    localStorage.removeItem(SETTINGS_KEY);
                    location.reload();
                }
            });
            panel.querySelector('#rgs-btn-reset-db').addEventListener('click', () => {
                if (confirm('Clear local database cache? This forces a fresh fetch of all history.')) {
                    indexedDB.deleteDatabase('EnvDashboard_Uncapped');
                    location.reload();
                }
            });

            panel.querySelector('#rgs-hide-year').addEventListener('change', (e) => { settings.hideYear = e.target.checked; updateVisuals(); saveSettings(); });
            panel.querySelector('#rgs-hide-time').addEventListener('change', (e) => { settings.hideTime = e.target.checked; updateVisuals(); saveSettings(); });

            panel.querySelector('#rgs-save-filters').addEventListener('change', (e) => {
                settings.saveFilters = e.target.checked;
                saveSettings();
                if (!settings.saveFilters) localStorage.removeItem('env_dash_filters');
            });

            panel.querySelector('#rgs-btn-sel-all').addEventListener('click', () => {
                settings.repoMode = 'all';
                saveSettings(); updateSettingsCheckboxes(); updateVisuals();
            });
            panel.querySelector('#rgs-btn-sel-none').addEventListener('click', () => {
                settings.repoMode = 'none';
                saveSettings(); updateSettingsCheckboxes(); updateVisuals();
            });
            panel.querySelector('#rgs-btn-sel-pinned').addEventListener('click', () => {
                settings.repoMode = 'pinned';
                saveSettings(); updateSettingsCheckboxes(); updateVisuals();
            });

            ['items', 'font', 'flowFontSize', 'flowLineLen', 'width', 'height'].forEach(type => {
                const input = panel.querySelector(`#rgs-rng-${type}`); const label = panel.querySelector(`#rgs-lbl-${type}`);
                input.addEventListener('input', (e) => {
                    const val = e.target.value; label.textContent = type === 'items' ? val : `${val}px`;
                    if (type === 'font') settings.fontSize = parseInt(val, 10);
                    if (type === 'flowFontSize') settings.flowFontSize = parseInt(val, 10);
                    if (type === 'flowLineLen') settings.flowLineLen = parseInt(val, 10);
                    if (type === 'items') settings.maxItems = parseInt(val, 10);
                    if (type === 'width') settings.maxWidth = parseInt(val, 10);
                    if (type === 'height') settings.maxHeight = parseInt(val, 10);
                    updateVisuals(); clearTimeout(saveTimeout); saveTimeout = setTimeout(saveSettings, 300);
                });
            });
            updateSettingsCheckboxes();
            updateVisuals();
        }
    }

    // --- PROGRESSIVE STREAMING ENGINE (WITH RETRY & DIFF) ---
    async function safeFetchJSON(url, opts = {}) {
        const res = await fetch(url, opts);
        if (!res.ok) throw new Error(`HTTP Error: ${res.status}`);
        const text = await res.text();
        try {
            return JSON.parse(text);
        } catch (e) {
            throw new Error(`Invalid JSON format.`);
        }
    }

    async function processAndRenderChunk(workflowsChunk) {
        let reqQ = [];
        const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;

        workflowsChunk.forEach(wf => {
            const cached = activeCacheMap[wf.id];
            const sStatus = (wf.status || '').toUpperCase().replace('STATUS.', '');

            if (!globalWfIds.has(wf.id)) {
                globalWorkflows.push(wf);
                globalWfIds.add(wf.id);
            } else {
                const idx = globalWorkflows.findIndex(w => w.id === wf.id);
                if (idx > -1) globalWorkflows[idx] = wf;
            }

            const isTerminal = ['APPROVED', 'SUCCESS', 'REJECTED', 'FAILED', 'FAILURE', 'CANCELED', 'CANCELLED'].includes(sStatus);
            const isRecent = wf.created_at ? (Date.now() - new Date(wf.created_at).getTime()) < TWENTY_FOUR_HOURS : false;

            if (!cached || !cached.flow || cached.status !== wf.status || !isTerminal || isRecent) {
                reqQ.push(wf);
            } else if (currentUser && cached) {
                let needsAction = false;
                const curStepObj = cached.flow?.find(s => s.step === cached.current_step);
                if (curStepObj && curStepObj.groups) {
                    needsAction = curStepObj.groups.some(g => (globalGroups[g] || []).includes(currentUser.username));
                }

                if (needsAction) myPendingApprovals.add(wf.id);
                else myPendingApprovals.delete(wf.id);
            } else {
                myPendingApprovals.delete(wf.id);
            }
        });

        let newItemsForIDB = [];

        if (reqQ.length > 0) {
            const BATCH_LIMIT = 20;
            for (let i = 0; i < reqQ.length; i += BATCH_LIMIT) {
                const b = reqQ.slice(i, i + BATCH_LIMIT);
                await Promise.all(b.map(async (wf) => {
                    try {
                        const dData = await safeFetchJSON(`https://lab.iki-utl.cc/dashboard/workflow-api/workflow/${wf.id}`);

                        let reposParsed = [];
                        if (dData.content?.normal_version && dData.content.normal_version.length > 0) {
                            reposParsed = dData.content.normal_version.map(r => ({ name: r.repo_name, version: r.git_tag }));
                        } else if (dData.checked_version && Object.keys(dData.checked_version).length > 0) {
                            const firstRepo = Object.keys(dData.checked_version)[0].split('(')[0];
                            reposParsed = [{ name: firstRepo, version: dData.checked_version[Object.keys(dData.checked_version)[0]]?.expected_version || '' }];
                        }

                        if (dData.content?.tolgee_version && dData.content.tolgee_version.length > 0) {
                            dData.content.tolgee_version.forEach(tv => {
                                reposParsed.push({ name: 'Tolgee: ' + tv.repo_name, version: tv.version });
                            });
                        }

                        if (reposParsed.length === 0) {
                            reposParsed = [{ name: 'unknown', version: '-' }];
                        }

                        const repoNames = reposParsed.map(r => r.name);

                        let regs = dData.content?.regions || [];
                        if (regs.length === 0 && dData.checked_version && Object.keys(dData.checked_version).length > 0) {
                            regs = Object.keys(dData.checked_version).map(k => { const m = k.match(/\((.+)\)/); return m ? m[1] : null; }).filter(Boolean);
                        }

                        const itemObj = {
                            id: wf.id, repos_data: reposParsed, repo_names: repoNames, regions: [...new Set(regs)],
                            summary: dData.content?.summary || 'No details.', title: dData.content?.title || wf.name,
                            creator: dData.creator || 'Unknown', flow: dData.flow || [], history: dData.history || [],
                            current_step: dData.current_step || ''
                        };

                        const finalObj = { ...itemObj, status: wf.status };
                        newItemsForIDB.push(finalObj);

                        const cached = activeCacheMap[wf.id];
                        activeCacheMap[wf.id] = finalObj;

                        // Ensure globally synced status updates for existing active notifications
                        if (cached && cached.status !== wf.status) {
                            NotificationManager.updateStatus(wf.id, wf.status);
                        }

                        if (notificationsActive) {
                            let notify = false, title = '', msg = '';

                            const rawSum = dData.content?.summary || dData.content?.title || wf.name || '';
                            const truncSum = truncateMiddle(rawSum, 20);
                            const envStr = wf.environment || 'UNKNOWN';
                            const creatorStr = dData.creator || 'Unknown';

                            const baseMsg = `[${envStr}] #${wf.id}: ${truncSum} by ${creatorStr}`;

                            if (!cached) {
                                notify = true;
                                title = 'New Deployment';
                                msg = `${baseMsg} started.`;
                            } else if (cached.status !== wf.status) {
                                notify = true;
                                title = 'Status Update';
                                msg = `${baseMsg} is now ${wf.status.replace('Status.', '')}.`;
                            } else if (cached.current_step !== dData.current_step && dData.current_step) {
                                notify = true;
                                title = 'Pipeline Progress';
                                msg = `${baseMsg} moved to ${dData.current_step}.`;
                            }

                            if (notify) NotificationManager.add(title, msg, wf.id, repoNames, wf.status);
                        }

                        const sStatus = (wf.status || '').toUpperCase().replace('STATUS.', '');
                        if (currentUser && !['APPROVED', 'SUCCESS', 'REJECTED', 'FAILED', 'FAILURE', 'CANCELED', 'CANCELLED'].includes(sStatus)) {
                            let needsAction = false;
                            const curStepObj = dData.flow?.find(s => s.step === dData.current_step);
                            if (curStepObj && curStepObj.groups) {
                                needsAction = curStepObj.groups.some(g => (globalGroups[g] || []).includes(currentUser.username));
                            }

                            if (needsAction) {
                                myPendingApprovals.add(wf.id);
                            } else {
                                myPendingApprovals.delete(wf.id);
                            }
                        } else {
                            myPendingApprovals.delete(wf.id);
                        }

                    } catch (err) {
                        log(`Failed processing workflow ${wf.id}: `, err);
                    }
                }));
            }
            if (newItemsForIDB.length > 0) IDB.putBatch(newItemsForIDB);
        }

        updateActionFab();

        if (typeof window.rgsObserver !== 'undefined') window.rgsObserver.disconnect();
        updateSettingsCheckboxes();
        renderMatrixUI();
        if (typeof window.rgsObserver !== 'undefined') window.rgsObserver.observe(document.body, { childList: true, subtree: true });

        if (typeof OverviewManager !== 'undefined' && OverviewManager.modal && OverviewManager.modal.classList.contains('active')) {
            OverviewManager.syncMemoryData(); OverviewManager.triggerCrossFilter();
        }
    }

    // --- INFINITE NOTES DATABASE ---
    const NotesDB = {
        db: null,
        init() {
            return new Promise((resolve, reject) => {
                if (this.db) return resolve();
                const req = indexedDB.open('EnvDashboard_Notes', 1);
                req.onupgradeneeded = e => {
                    e.target.result.createObjectStore('data');
                };
                req.onsuccess = e => { this.db = e.target.result; resolve(); };
                req.onerror = e => reject(e);
            });
        },
        async save(text) {
            await this.init();
            const tx = this.db.transaction('data', 'readwrite');
            tx.objectStore('data').put(text, 'user_notes');
        },
        async load() {
            await this.init();
            return new Promise((resolve) => {
                const tx = this.db.transaction('data', 'readonly');
                const req = tx.objectStore('data').get('user_notes');
                req.onsuccess = () => resolve(req.result || '');
                req.onerror = () => resolve('');
            });
        }
    };

    // --- NOTES SYSTEM ---
    const NotesManager = {
        init() {
            if (document.getElementById('rgs-notes-fab')) return;
            document.body.insertAdjacentHTML('beforeend', `
                <div id="rgs-notes-fab" class="rgs-notes-fab" title="Quick Notes">📝</div>
                <div id="rgs-notes-panel">
                     <div class="rgs-notes-header">
                         <span style="font-weight: bold; color: #0f172a;">Notes</span>
                         <div class="rgs-notes-controls">
                             <button id="rgs-notes-mode-btn" class="rgs-notes-btn">👁️ Preview</button>
                             <button id="rgs-notes-expand-btn" class="rgs-notes-btn">⛶</button>
                             <button id="rgs-notes-close" style="background:none; border:none; font-size:20px; cursor:pointer; color:#64748b; margin-left:4px;">×</button>
                         </div>
                     </div>
                     <textarea id="rgs-notes-raw" placeholder="Type here... \nSupports **bold**, *italic*, [Link](url), \`\`\`code blocks\`\`\`. \n\nPRO TIP: Double-click any URL in this raw text view to open it instantly!"></textarea>
                     <div id="rgs-notes-md"></div>
                </div>
            `);

            const panel = document.getElementById('rgs-notes-panel');
            const rawEl = document.getElementById('rgs-notes-raw');
            const mdEl = document.getElementById('rgs-notes-md');
            const modeBtn = document.getElementById('rgs-notes-mode-btn');

            // Load saved notes from IndexedDB (Handles 10MB+ easily)
            NotesDB.load().then(text => {
                // Also pull from localStorage once just in case you already wrote notes there!
                const legacyNotes = localStorage.getItem('env_dash_notes');
                if (legacyNotes && !text) {
                    text = legacyNotes;
                    NotesDB.save(text);
                    localStorage.removeItem('env_dash_notes'); // Clean up old storage
                }
                rawEl.value = text;
            });

            // Auto-Save to IndexedDB
            rawEl.addEventListener('input', debounce(() => {
                NotesDB.save(rawEl.value);
            }, 500));

            // Clever trick: Double-click to open raw URLs inside the textarea without switching to Markdown
            rawEl.addEventListener('dblclick', (e) => {
                const val = e.target.value;
                const pos = e.target.selectionStart;
                const urlRegex = /https?:\/\/[^\s)\]"']+/g;
                let match;
                while ((match = urlRegex.exec(val)) !== null) {
                    if (pos >= match.index && pos <= match.index + match[0].length) {
                        window.open(match[0], '_blank');
                        break;
                    }
                }
            });

            document.getElementById('rgs-notes-fab').addEventListener('click', () => {
                panel.classList.toggle('active');
            });

            document.getElementById('rgs-notes-close').addEventListener('click', () => {
                panel.classList.remove('active');
            });

            document.getElementById('rgs-notes-expand-btn').addEventListener('click', () => {
                panel.classList.toggle('expanded');
            });

            // Toggle Raw vs Markdown
            modeBtn.addEventListener('click', () => {
                if (rawEl.style.display === 'none') {
                    rawEl.style.display = 'block';
                    mdEl.style.display = 'none';
                    modeBtn.textContent = '👁️ Preview';
                } else {
                    rawEl.style.display = 'none';
                    mdEl.style.display = 'block';
                    modeBtn.textContent = '✏️ Edit Notes';
                    mdEl.innerHTML = this.parseMD(rawEl.value);
                }
            });
        },

        parseMD(text) {
            let t = text.replace(/</g, "&lt;").replace(/>/g, "&gt;"); // Escape HTML

            // Basic Markdown Parsing
            t = t.replace(/```([\s\S]*?)```/g, '<pre>$1</pre>'); // Code blocks
            t = t.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>'); // Bold
            t = t.replace(/\*(.*?)\*/g, '<em>$1</em>'); // Italic

            // Named Links: [Google](https://google.com)
            t = t.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank">$1</a>');
            // Raw floating URLs
            t = t.replace(/(^|\s)(https?:\/\/[^\s<)]+)/g, '$1<a href="$2" target="_blank">$2</a>');

            // Linebreaks outside of code blocks
            const parts = t.split(/(<pre>[\s\S]*?<\/pre>)/);
            for (let i = 0; i < parts.length; i++) {
                if (!parts[i].startsWith('<pre>')) {
                    parts[i] = parts[i].replace(/\n/g, '<br>');
                }
            }
            return parts.join('');
        }
    };

    async function startStreamingEngine() {
        log("Engine Start: Loading IDB to RAM...");

        await Promise.all([fetchCurrentUser(), fetchGroups()]);

        activeCacheMap = await IDB.getAllMap();
        await pruneOldWorkflows();

        TimelineWidget.init();
        NotificationManager.init();
        initGlobalTooltip();
        initSmartTooltip();
        initFastTooltip(); // <--- ADD THIS LINE HERE
        NotesManager.init(); // <--- ADD THIS HERE

        if (typeof OverviewManager !== 'undefined' && OverviewManager.streamInd) OverviewManager.streamInd.classList.add('active');

        let initData;
        try {
            initData = await safeFetchJSON(`https://lab.iki-utl.cc/dashboard/workflow-api/workflows?page=1&per_page=100`);
        } catch (e) {
            log("Engine paused (Waiting for App Auth)... Retrying next DOM update.", e.message);
            engineStarted = false;
            return;
        }

        const totalPages = initData.pages || 1;
        log(`Found ${totalPages} pages. Streaming Page 1...`);
        await processAndRenderChunk(initData.workflows || []);

        notificationsActive = true;

        if (totalPages > 1) {
            const fetchQ = []; for (let p = 2; p <= totalPages; p++) fetchQ.push(`https://lab.iki-utl.cc/dashboard/workflow-api/workflows?page=${p}&per_page=100`);
            const chunkSize = 5;
            for (let i = 0; i < fetchQ.length; i += chunkSize) {
                const chunk = fetchQ.slice(i, i + chunkSize);
                log(`Streaming chunk pages ${i + 2} to ${Math.min(i + 1 + chunkSize, totalPages)}...`);
                const results = await Promise.all(chunk.map(url => safeFetchJSON(url).catch(() => ({}))));

                let aggregatedWorkflows = [];
                results.forEach(d => { if (d.workflows) aggregatedWorkflows = aggregatedWorkflows.concat(d.workflows); });
                await processAndRenderChunk(aggregatedWorkflows);
            }
        }
        log("Engine Stream Complete.");
        if (typeof OverviewManager !== 'undefined' && OverviewManager.streamInd) OverviewManager.streamInd.classList.remove('active');

        setInterval(pollForUpdates, 30000);
    }

    function getGridColumnName(env, region) {
        const map = { "us-east-1": "BILL", "us-east-2": "GS1", "us-west-2": "GS0", "eu-central-1": "GS2", "ap-northeast-1": "GS3", "sa-east-1": "GS4", "ap-northeast-2": "GS5" }; return map[region] && env ? `${env.split('-')[0]}-${map[region]}`.toUpperCase() : null;
    }

    // --- Smart DOM Limiter Render Engine ---
    function renderMatrixUI() {
        if (!activeCacheMap || Object.keys(activeCacheMap).length === 0) return;

        const thead = document.querySelector('thead tr'); if (!thead) return;
        const headers = Array.from(thead.querySelectorAll('th')).map(th => th.textContent.trim()); if (headers.length === 0) return;

        const pinnedRepos = getPinnedRepos();
        const rows = document.querySelectorAll('tbody tr'); const rowMap = {};

        rows.forEach(row => {
            const pNode = row.querySelector('th p');
            if (pNode) {
                const repoName = pNode.textContent.replace(/[()]/g, '').trim();
                rowMap[repoName] = row;

                const isToggled = settings.repoToggles[repoName] !== undefined ? settings.repoToggles[repoName] : pinnedRepos.includes(repoName);
                if (!isToggled) {
                    row.querySelectorAll('.rgs-matrix-history').forEach(el => el.remove());
                } else {
                    row.querySelectorAll('.rgs-matrix-history').forEach(el => el.innerHTML = '');
                }
            }
        });

        const renderQueue = {};

        globalWorkflows.forEach(wf => {
            const detail = activeCacheMap[wf.id];
            if (!detail || !detail.repos_data) return;

            detail.repos_data.forEach(repoObj => {
                const rNameClean = repoObj.name.replace('Tolgee: ', '');
                const isToggled = settings.repoToggles[rNameClean] !== undefined ? settings.repoToggles[rNameClean] : pinnedRepos.includes(rNameClean);
                if (!isToggled) return;

                const row = rowMap[rNameClean]; if (!row) return;

                detail.regions.forEach(region => {
                    const colName = getGridColumnName(wf.environment, region); if (!colName) return;
                    const colIndex = headers.findIndex(h => h && h.toUpperCase() === colName); if (colIndex === -1) return;

                    const key = `${rNameClean}||${colIndex}`;
                    if (!renderQueue[key]) renderQueue[key] = { td: row.children[colIndex], items: [] };
                    renderQueue[key].items.push({ ...detail, context_repo: repoObj.name, context_version: repoObj.version, id: wf.id, created_at: wf.created_at, status: wf.status });
                });
            });
        });

        const renderLimit = settings.maxItems;
        const dayChars = ['日', '一', '二', '三', '四', '五', '六'];

        Object.values(renderQueue).forEach(queue => {
            const { td, items } = queue;
            const flex = td.querySelector('.flex.gap-3 > .flex-1') || td;

            // Extract the original cell text (ignoring our injected matrix div)
            let baseText = '';
            Array.from(flex.childNodes).forEach(n => {
                if (n.nodeType === Node.TEXT_NODE) {
                    baseText += n.textContent;
                } else if (n.nodeType === Node.ELEMENT_NODE && !n.classList.contains('rgs-matrix-history')) {
                    baseText += n.textContent;
                }
            });

            // Strip ALL whitespace and newlines to guarantee a perfect match
            const cleanText = baseText.replace(/\s+/g, '').toUpperCase();

            // Check if the cell indicates N/A or a dash
            const isUnavailable = ['N/A', '-', '—', '–'].includes(cleanText);

            let container = td.querySelector('.rgs-matrix-history');

            // If unavailable, clear the matrix (if it exists) and skip rendering
            if (isUnavailable) {
                if (container) container.remove();
                return;
            }

            let savedScroll = 0;

            if (!container) {
                container = document.createElement('div'); container.className = 'rgs-matrix-history'; flex.appendChild(container);
            } else {
                const list = container.querySelector('.rgs-matrix-list');
                if (list) savedScroll = list.scrollTop;
            }

            let filteredItems = items.filter(wf => settings.matrixStatuses[wf.status || 'UNKNOWN']);
            filteredItems.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

            let listHtml = '';
            const slicedItems = filteredItems.slice(0, renderLimit);

            slicedItems.forEach(wf => {
                let yHtml = '', dHtml = 'Unknown', dyHtml = '', tHtml = '', fDate = 'Unknown Date';
                const lt = formatLocalTime(wf.created_at);
                if (lt) { fDate = lt.full; yHtml = lt.year; dHtml = lt.date; tHtml = ' ' + lt.time; dyHtml = ` <span class="rgs-history-day">${dayChars[lt.dayIndex]}</span>`; }

                const isTolgee = wf.context_repo.startsWith('Tolgee: ');
                const cleanRepoName = wf.context_repo.replace('Tolgee: ', '');

                const vText = wf.context_version ? `<a class="rgs-history-version" href="https://github.com/Ikigaians/${cleanRepoName}/releases/tag/${wf.context_version}" target="_blank" onclick="event.stopPropagation();" ${isTolgee ? 'style="color:#d946ef;"' : ''}>[${wf.context_version}]</a>` : '';

                const titleHtml = isTolgee ? `<span class="rgs-tolgee-tag">${wf.title}</span>` : wf.title;
                const sColor = getStatusDotColor(wf.status);
                const sDot = `<span style="color:${sColor}; margin-right:4px; font-size:12px; display:inline-block;" title="${wf.status || 'Unknown'}">●</span>`;

                listHtml += `
                    <li class="rgs-matrix-item rgs-tt-trigger" data-wf-id="${wf.id}" data-title="${escapeQuotes(wf.title)}" data-sum="${escapeQuotes(wf.summary)}" data-ver="${escapeQuotes(wf.context_version)}" data-fdate="${fDate}">
                        <div class="rgs-history-link-wrapper">${sDot}<span class="rgs-history-date">[<span class="rgs-history-year">${yHtml}</span>${dHtml}${dyHtml}<span class="rgs-history-time">${tHtml}</span>]</span>${vText}<a class="rgs-history-link" href="https://lab.iki-utl.cc/dashboard/workflow/${wf.id}" target="_blank">${titleHtml}</a></div>
                    </li>
                `;
            });

            container.innerHTML = `<div class="rgs-matrix-history-title"><span>Deployments (${filteredItems.length})</span><span class="rgs-caret">${settings.isExpanded ? '▲' : '▼'}</span></div><ul class="rgs-matrix-list ${settings.isExpanded ? '' : 'rgs-collapsed'}">${listHtml}</ul>`;

            const newList = container.querySelector('.rgs-matrix-list');
            if (savedScroll > 0 && newList) newList.scrollTop = savedScroll;

            container.querySelector('.rgs-matrix-history-title').onclick = (e) => {
                const list = container.querySelector('.rgs-matrix-list');
                const isC = list.classList.toggle('rgs-collapsed');
                e.currentTarget.querySelector('.rgs-caret').textContent = isC ? '▼' : '▲';
            };

            if (newList) {
                newList.onmouseover = (e) => {
                    const li = e.target.closest('.rgs-tt-trigger');
                    if (!li) return;
                    openSmartTooltip({
                        title: li.dataset.title,
                        date: li.dataset.fdate,
                        versionHTML: li.dataset.ver || '-',
                        summary: li.dataset.sum
                    }, li, false);
                };
                newList.onmouseout = (e) => {
                    if (!e.target.closest('.rgs-tt-trigger')) return;
                    closeSmartTooltip(false);
                };
                newList.onclick = (e) => {
                    if (e.target.closest('a') || e.target.closest('button')) return;
                    const li = e.target.closest('.rgs-tt-trigger');
                    if (!li) return;
                    e.stopPropagation();
                    e.preventDefault();
                    openSmartTooltip({
                        title: li.dataset.title,
                        date: li.dataset.fdate,
                        versionHTML: li.dataset.ver || '-',
                        summary: li.dataset.sum
                    }, li, true);
                };
            }
        });
    }

    // --- BACKGROUND POLLING ENGINE ---
    async function pollForUpdates() {
        if (!engineStarted || !notificationsActive) return;

        try {
            const initData = await safeFetchJSON(`https://lab.iki-utl.cc/dashboard/workflow-api/workflows?page=1&per_page=100`);
            if (initData && initData.workflows) {
                await processAndRenderChunk(initData.workflows);
            }
        } catch (e) {
            log("Polling Error:", e);
        }
    }
    // ---------------------------------

    const observer = new MutationObserver((mutations) => {
        let isExternalMutation = false;
        for (let m of mutations) {
            const target = m.target.nodeType === Node.TEXT_NODE ? m.target.parentNode : m.target;
            if (target && target.closest) {
                if (target.closest('#rgs-smart-tooltip') ||
                    target.closest('#rgs-ov-modal') ||
                    target.closest('#rgs-settings-wrapper') ||
                    target.closest('.rgs-matrix-history') ||
                    target.closest('.rgs-cal-popup') ||
                    target.closest('#rgs-timeline-fab') ||
                    target.closest('#rgs-timeline-panel') ||
                    target.closest('#rgs-inbox-fab') ||
                    target.closest('#rgs-action-fab') ||
                    target.closest('#rgs-toast-container') ||
                    target.closest('#rgs-inbox-panel')) {
                    continue;
                }
            }
            isExternalMutation = true;
            break;
        }

        if (!isExternalMutation) return;

        if (typeof initGlobalTooltip !== 'undefined') initGlobalTooltip();
        if (typeof initSmartTooltip !== 'undefined') initSmartTooltip();
        if (typeof initFastTooltip !== 'undefined') initFastTooltip(); // <--- ADD THIS LINE HERE
        if (typeof NotesManager !== 'undefined') NotesManager.init(); // <--- ADD THIS HERE
        if (typeof injectUIButtons !== 'undefined') injectUIButtons();

        clearTimeout(renderTimeout);
        renderTimeout = setTimeout(() => {
            if (typeof window.rgsObserver !== 'undefined') window.rgsObserver.disconnect();

            if (!engineStarted) {
                engineStarted = true;
                if (typeof startStreamingEngine !== 'undefined') startStreamingEngine();
            }
            if (typeof updateSettingsCheckboxes !== 'undefined') updateSettingsCheckboxes();
            if (typeof renderMatrixUI !== 'undefined') renderMatrixUI();

            if (typeof OverviewManager !== 'undefined') OverviewManager.init();

            if (typeof window.rgsObserver !== 'undefined') window.rgsObserver.observe(document.body, { childList: true, subtree: true });
        }, 250);
    });

    window.rgsObserver = observer;
    window.rgsObserver.observe(document.body, { childList: true, subtree: true });
})();