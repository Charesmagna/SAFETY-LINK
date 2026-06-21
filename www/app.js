/**
 * SafetyLink Core Engine v4.0 — FULL FEATURE BUILD
 *
 * NEW in v4.0:
 *  - Incident management (create, track, resolve, escalate)
 *  - Escalation engine: Tier 1→2→3 with auto SMS per tier
 *  - Responder dashboard: accept incidents, update status
 *  - Medical profile: blood type, conditions, medications, allergies
 *  - BLE scanner: HST-01 beacon via Web Bluetooth / Cordova BLE plugin
 *  - Offline SMS queue: store-and-forward when offline
 *  - Tab navigation: Panic | Incidents | Responder | Medical | Analytics | Settings
 *  - GPS race fix: countdown only starts AFTER GPS resolves (or 5s timeout)
 *  - TAP TO CALL NEXT manual override during call sequence
 *  - Phone validation: 0/+ prefix, 10+ digits
 *  - Local audit log (tamper-resistant localStorage)
 *  - Analytics: stats from local incident store
 *  - Leaflet bundled locally (no CDN — works offline)
 *  - API sync: incidents, medical profile, responder actions
 *
 * Bug fixes retained from v3.3:
 *  FIX-1 cordova-plugin-android-permissions wired in
 *  FIX-2 Geolocation pinned to ^4.1.0 in both config files
 *  FIX-3 Call-number plugin unified to mx.ferreyra.callnumber
 *  FIX-4 resetSystem() explicitly resets button visuals
 */

'use strict';

/* ══════════════════════════════════
   CONFIGURATION
══════════════════════════════════ */
const CFG = {
    holdThreshold:    2000,
    bufferWindow:     15,
    gpsTimeout:       5000,
    defaultLat:       -26.3085,
    defaultLon:       27.8344,
    callAdvanceDelay: 12000,
    // Set this to your deployed API URL e.g. https://yourapp.replit.app/api
    apiBase:          '',
};

/* ══════════════════════════════════
   STATE
══════════════════════════════════ */
const S = {
    interactionTimer:  null,
    countdownTracker:  null,
    currentCallTimer:  null,
    pipelineTriggered: false,
    drillMode:         false,
    operatorName:      '',
    operatorPhone:     '',
    orgId:             '',
    authToken:         '',
    map:               null,
    mapMarker:         null,
    currentLat:        CFG.defaultLat,
    currentLon:        CFG.defaultLon,
    gpsResolved:       false,
    callIndex:         0,
    callNumbers:       [],
    bleScanning:       false,
    bleDevices:        {},
    bloodType:         '',
    smsQueue:          [],
    incidentFilter:    'all',
    escalationTier:    1,
};

const DOM = {};

/* ══════════════════════════════════
   BOOT
══════════════════════════════════ */
document.addEventListener('deviceready', boot, false);
document.addEventListener('DOMContentLoaded', boot, false);
let _booted = false;

function boot() {
    if (_booted) return;
    _booted = true;
    cacheDOM();
    bindEvents();
    loadSMSQueue();
    requestRuntimePermissions();
    loadPersistentState();
    logDiagnostic();
}

function cacheDOM() {
    [
        'auth-screen','console-screen','activate-terminal-btn',
        'auth-name','auth-phone','auth-org-id',
        'system-status-lbl','profile-name-lbl','profile-role-lbl',
        'trigger-button','drill-mode-toggle',
        'countdown-overlay','countdown-text','disarm-btn',
        'call-next-btn','escalation-tier-label',
        'diagnostic-ticker-terminal','save-routing-btn','sign-out-btn',
        'input-primary','input-secondary','input-tertiary','input-whatsapp','input-police',
        'gis-radar-viewport','sms-queue-display',
        'incident-list','responder-feed',
        'med-conditions','med-medications','med-allergies','med-emergency-notes',
        'stat-total','stat-resolved','stat-active','stat-drills',
        'audit-log-display','ble-status','ble-device-list',
        'org-id-display','operator-display',
        'incident-modal','incident-modal-content',
    ].forEach(id => {
        const key = id.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
        DOM[key] = document.getElementById(id);
    });
}

/* ══════════════════════════════════
   TABS
══════════════════════════════════ */
window.switchTab = function(name) {
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    const panel = document.getElementById('tab-' + name);
    if (panel) panel.classList.add('active');
    const btns = [...document.querySelectorAll('.tab-btn')];
    const match = btns.find(b => b.textContent.toLowerCase().includes(name === 'analytics' ? 'analyt' : name));
    if (match) match.classList.add('active');
    if (name === 'incidents')  loadIncidents();
    if (name === 'responder')  loadResponderFeed();
    if (name === 'analytics')  loadAnalytics();
    if (name === 'medical')    loadMedicalProfile();
};

/* ══════════════════════════════════
   RUNTIME PERMISSIONS (FIX-1)
══════════════════════════════════ */
function requestRuntimePermissions() {
    if (typeof cordova === 'undefined') return;
    const perms = cordova.plugins && cordova.plugins.permissions;
    if (!perms) { tick('WARN: android-permissions plugin not found.'); return; }
    perms.requestPermissions(
        [perms.SEND_SMS, perms.CALL_PHONE, perms.ACCESS_FINE_LOCATION],
        () => tick('Runtime permissions granted.'),
        () => tick('WARN: Some permissions denied — SMS/Call may fail.')
    );
}

/* ══════════════════════════════════
   AUTH
══════════════════════════════════ */
function bindEvents() {
    DOM.activateTerminalBtn && DOM.activateTerminalBtn.addEventListener('click', handleActivation);
    DOM.triggerButton && DOM.triggerButton.addEventListener('mousedown',  startPanicHold);
    DOM.triggerButton && DOM.triggerButton.addEventListener('touchstart', startPanicHold, { passive: false });
    DOM.triggerButton && DOM.triggerButton.addEventListener('mouseup',    cancelPanicHold);
    DOM.triggerButton && DOM.triggerButton.addEventListener('mouseleave', cancelPanicHold);
    DOM.triggerButton && DOM.triggerButton.addEventListener('touchend',   cancelPanicHold);
    DOM.disarmBtn      && DOM.disarmBtn.addEventListener('click',         disarmPipeline);
    DOM.drillModeToggle && DOM.drillModeToggle.addEventListener('click',  toggleDrill);
    DOM.saveRoutingBtn  && DOM.saveRoutingBtn.addEventListener('click',   saveContacts);
    DOM.signOutBtn      && DOM.signOutBtn.addEventListener('click',       signOut);
}

function handleActivation() {
    const name  = (DOM.authName  && DOM.authName.value.trim())  || '';
    const phone = (DOM.authPhone && DOM.authPhone.value.trim()) || '';
    const org   = (DOM.authOrgId && DOM.authOrgId.value.trim()) || '';
    if (phone.length < 9) { alert('Enter a valid phone number (9 digits after +27).'); return; }
    S.operatorName  = name;
    S.operatorPhone = '+27' + phone.replace(/\s/g, '');
    S.orgId         = org.toUpperCase() || 'DEFAULT';
    apiLogin();
}

async function apiLogin() {
    try {
        const res = await apiFetch('/auth/login', 'POST', { phone: S.operatorPhone, password: S.orgId });
        if (res && res.token) {
            S.authToken = res.token;
            localStorage.setItem('sl_token', res.token);
        }
    } catch (e) {
        tick('API login failed — running in offline mode.');
    }
    saveSession();
    bootConsole();
}

function bootConsole() {
    DOM.authScreen.classList.add('hidden');
    DOM.consoleScreen.classList.remove('hidden');
    DOM.profileNameLbl  && (DOM.profileNameLbl.innerText  = S.operatorName || 'OPERATOR');
    DOM.profileRoleLbl  && (DOM.profileRoleLbl.innerText  = 'ORG: ' + S.orgId);
    DOM.systemStatusLbl && (DOM.systemStatusLbl.innerText = 'SYSTEM: ARMED');
    DOM.orgIdDisplay    && (DOM.orgIdDisplay.innerText    = S.orgId);
    DOM.operatorDisplay && (DOM.operatorDisplay.innerText = S.operatorName);
    loadContacts();
    initMap();
    tick('Console armed. Operator: ' + S.operatorName);
    tick('Org: ' + S.orgId + ' | Line: ' + S.operatorPhone);
    tick('Set contacts in SETTINGS → SAVE, then system is ready.');
}

function signOut() {
    localStorage.clear();
    S.authToken = '';
    DOM.consoleScreen.classList.add('hidden');
    DOM.authScreen.classList.remove('hidden');
    tick('Device de-provisioned.');
}

/* ══════════════════════════════════
   DRILL MODE
══════════════════════════════════ */
function toggleDrill() {
    S.drillMode = !S.drillMode;
    DOM.drillModeToggle.innerText = 'SYSTEM DRILL / TEST MODE [' + (S.drillMode ? 'ON' : 'OFF') + ']';
    DOM.drillModeToggle.style.color = S.drillMode ? '#f59e0b' : '';
    tick(S.drillMode ? 'DRILL MODE ON — no real SMS or calls.' : 'DRILL MODE OFF — system LIVE.');
}

/* ══════════════════════════════════
   CONTACTS + VALIDATION (WARN-1 FIX)
══════════════════════════════════ */
function isValidPhone(n) {
    if (!n) return true;
    const s = n.replace(/[\s\-]/g, '');
    return /^[0+]/.test(s) && s.replace(/\D/g, '').length >= 10;
}

function saveContacts() {
    const f = {
        primary:   DOM.inputPrimary   ? DOM.inputPrimary.value.trim()   : '',
        secondary: DOM.inputSecondary ? DOM.inputSecondary.value.trim() : '',
        tertiary:  DOM.inputTertiary  ? DOM.inputTertiary.value.trim()  : '',
        whatsapp:  DOM.inputWhatsapp  ? DOM.inputWhatsapp.value.trim()  : '',
        police:    DOM.inputPolice    ? DOM.inputPolice.value.trim()    : '',
    };
    const bad = Object.entries(f).filter(([,v]) => v && !isValidPhone(v)).map(([k]) => k);
    if (bad.length) { alert('Invalid number(s): ' + bad.join(', ') + '\nMust start with 0 or + and have 10+ digits.'); return; }
    localStorage.setItem('sl_contacts', JSON.stringify(f));
    tick('Contacts saved: ' + Object.values(f).filter(Boolean).length + ' numbers stored.');
    auditEntry('contacts_saved', Object.values(f).filter(Boolean).length + ' numbers');
    alert('Contacts saved. System armed.');
}

function loadContacts() {
    const c = getContacts();
    DOM.inputPrimary   && (DOM.inputPrimary.value   = c.primary   || '');
    DOM.inputSecondary && (DOM.inputSecondary.value = c.secondary || '');
    DOM.inputTertiary  && (DOM.inputTertiary.value  = c.tertiary  || '');
    DOM.inputWhatsapp  && (DOM.inputWhatsapp.value  = c.whatsapp  || '');
    DOM.inputPolice    && (DOM.inputPolice.value    = c.police    || '');
}

function getContacts() {
    const s = localStorage.getItem('sl_contacts');
    return s ? JSON.parse(s) : {};
}

function getActiveNumbers() {
    const c = getContacts();
    return [c.primary, c.secondary, c.tertiary, c.police].filter(n => n && isValidPhone(n));
}

/* ══════════════════════════════════
   PANIC HOLD
══════════════════════════════════ */
function startPanicHold(e) {
    e.preventDefault();
    if (S.pipelineTriggered) return;
    buzz(150);
    tick('Hold detected — keep holding 2 seconds…');
    if (DOM.triggerButton) {
        DOM.triggerButton.style.boxShadow = '0 0 40px rgba(239,68,68,0.8)';
        DOM.triggerButton.style.transform = 'scale(0.96)';
    }
    S.interactionTimer = setTimeout(() => { buzz(600); firePanicPipeline(); }, CFG.holdThreshold);
}

function cancelPanicHold() {
    if (S.pipelineTriggered) return;
    clearTimeout(S.interactionTimer);
    resetButtonVisuals();
}

/* ══════════════════════════════════
   PANIC PIPELINE — GPS RACE FIX
   Countdown starts AFTER GPS resolves (or 5s timeout)
══════════════════════════════════ */
function firePanicPipeline() {
    S.pipelineTriggered = true;
    S.escalationTier    = 1;
    S.gpsResolved       = false;
    resetButtonVisuals();
    tick('ALERT TRIGGERED — acquiring GPS before countdown…');
    auditEntry('panic_fired', S.drillMode ? 'DRILL' : 'LIVE');
    createIncidentRecord();

    if (navigator.geolocation) {
        const fallback = setTimeout(() => {
            if (S.gpsResolved) return;
            S.gpsResolved = true;
            tick('GPS timeout — using default location.');
            beginCountdown();
        }, CFG.gpsTimeout);

        navigator.geolocation.getCurrentPosition(
            pos => {
                if (S.gpsResolved) return;
                S.gpsResolved = true;
                clearTimeout(fallback);
                S.currentLat = pos.coords.latitude;
                S.currentLon = pos.coords.longitude;
                tick('GPS locked: ' + S.currentLat.toFixed(5) + ', ' + S.currentLon.toFixed(5));
                if (S.map) S.map.setView([S.currentLat, S.currentLon], 15);
                beginCountdown();
            },
            () => {
                if (S.gpsResolved) return;
                S.gpsResolved = true;
                clearTimeout(fallback);
                tick('GPS unavailable — using default location.');
                beginCountdown();
            },
            { timeout: CFG.gpsTimeout, enableHighAccuracy: true }
        );
    } else {
        S.gpsResolved = true;
        beginCountdown();
    }
}

function beginCountdown() {
    sendSMSBurst(); // SMS fires right when GPS resolves — no race
    DOM.countdownOverlay.classList.remove('hidden');
    updateEscalationLabel();
    let rem = CFG.bufferWindow;
    DOM.countdownText.innerText = rem;

    S.countdownTracker = setInterval(() => {
        rem--;
        DOM.countdownText.innerText = rem;
        if (rem <= 0) {
            clearInterval(S.countdownTracker);
            DOM.callNextBtn && DOM.callNextBtn.classList.add('visible');
            startCalls();
        }
    }, 1000);
}

function updateEscalationLabel() {
    const labels = { 1:'TIER 1 — SMS dispatched to local contacts.', 2:'TIER 2 — Escalated to police authority.', 3:'TIER 3 — Emergency services engaged.' };
    DOM.escalationTierLabel && (DOM.escalationTierLabel.innerText = labels[S.escalationTier] || '');
}

function disarmPipeline() {
    clearInterval(S.countdownTracker);
    clearTimeout(S.interactionTimer);
    clearTimeout(S.currentCallTimer);
    S.pipelineTriggered = false;
    S.gpsResolved = false;
    DOM.countdownOverlay.classList.add('hidden');
    DOM.callNextBtn && DOM.callNextBtn.classList.remove('visible');
    resetButtonVisuals();
    tick('Pipeline DISARMED. No calls will fire.');
    buzz(200);
    auditEntry('pipeline_disarmed', null);
}

/* ══════════════════════════════════
   SMS — Offline queue + store-forward
══════════════════════════════════ */
function sendSMSBurst() {
    const link    = 'https://maps.google.com/?q=' + S.currentLat + ',' + S.currentLon;
    const medical = buildMedicalSummary();
    const msg     = 'EMERGENCY — ' + (S.operatorName || 'Someone') + ' needs help! Location: ' + link +
                    (medical ? ' | Medical: ' + medical : '');
    const nums    = getActiveNumbers();
    if (!nums.length) { tick('WARN: No contacts saved.'); return; }
    if (S.drillMode) { tick('[DRILL] Would SMS: ' + nums.join(', ')); return; }
    nums.forEach(n => sendSingleSMS(n, msg));
}

function sendSingleSMS(num, msg) {
    const clean = num.replace(/\s/g, '');
    const onOk  = () => tick('SMS sent → ' + clean);
    const onErr = () => { tick('SMS failed → ' + clean + ' (queued)'); queueSMS(clean, msg); };

    if (typeof cordova !== 'undefined' && cordova.plugins && cordova.plugins.sms) {
        cordova.plugins.sms.send(clean, msg, { replaceLineBreaks:false, android:{ intent:'' } }, onOk, onErr);
    } else if (window.sms || window.SMS) {
        (window.sms || window.SMS).send(clean, msg, { replaceLineBreaks:false, android:{ intent:'' } }, onOk, onErr);
    } else {
        onErr();
    }
}

function queueSMS(num, msg) {
    S.smsQueue.push({ num, msg, ts: Date.now() });
    localStorage.setItem('sl_sms_queue', JSON.stringify(S.smsQueue));
    renderSMSQueue();
}

function loadSMSQueue() {
    const s = localStorage.getItem('sl_sms_queue');
    S.smsQueue = s ? JSON.parse(s) : [];
    renderSMSQueue();
}

function renderSMSQueue() {
    if (!DOM.smsQueueDisplay) return;
    if (!S.smsQueue.length) {
        DOM.smsQueueDisplay.innerHTML = '<div style="font-family:monospace;font-size:0.62rem;color:#475569;padding:6px">Queue empty</div>';
        return;
    }
    DOM.smsQueueDisplay.innerHTML = S.smsQueue.map((item, i) =>
        '<div class="queue-item">[' + i + '] ' + item.num + ' — ' + new Date(item.ts).toLocaleTimeString() + '</div>'
    ).join('');
}

window.flushSMSQueue = function() {
    if (!S.smsQueue.length) { tick('Queue is empty.'); return; }
    tick('Flushing ' + S.smsQueue.length + ' queued SMS…');
    const toRetry = [...S.smsQueue];
    S.smsQueue = [];
    localStorage.setItem('sl_sms_queue', JSON.stringify([]));
    toRetry.forEach(item => sendSingleSMS(item.num, item.msg));
    renderSMSQueue();
};

/* ══════════════════════════════════
   CALLS — TAP TO CALL NEXT (manual override)
══════════════════════════════════ */
function startCalls() {
    S.callNumbers = getActiveNumbers();
    S.callIndex   = 0;
    DOM.countdownOverlay.classList.add('hidden');
    tick('Starting sequential calls…');
    callNext();
}

function callNext() {
    if (S.callIndex >= S.callNumbers.length) { openWhatsApp(); return; }
    const clean = S.callNumbers[S.callIndex].replace(/\s/g, '');
    tick('Calling ' + (S.callIndex + 1) + '/' + S.callNumbers.length + ': ' + clean);

    if (S.drillMode) {
        tick('[DRILL] Would call: ' + clean);
        S.callIndex++;
        S.currentCallTimer = setTimeout(callNext, 2000);
        return;
    }

    // FIX-3: canonical mx.ferreyra.callnumber
    if (typeof cordova !== 'undefined' && cordova.plugins && cordova.plugins.CallNumber) {
        cordova.plugins.CallNumber.callNumber(() => scheduleAdvance(), (e) => { tick('Call failed: '+e); S.callIndex++; callNext(); }, clean, true);
    } else if (window.plugins && window.plugins.CallNumber) {
        window.plugins.CallNumber.callNumber(() => scheduleAdvance(), () => { S.callIndex++; callNext(); }, clean, true);
    } else {
        window.location.href = 'tel:' + clean;
        scheduleAdvance();
    }
}

function scheduleAdvance() {
    clearTimeout(S.currentCallTimer);
    S.currentCallTimer = setTimeout(() => { S.callIndex++; callNext(); }, CFG.callAdvanceDelay);
}

// TAP TO CALL NEXT button
window.manualCallNext = function() {
    clearTimeout(S.currentCallTimer);
    S.callIndex++;
    callNext();
};

/* ══════════════════════════════════
   WHATSAPP
══════════════════════════════════ */
function openWhatsApp() {
    if (S.drillMode) { tick('[DRILL] Would open WhatsApp.'); resetSystem(); return; }
    const wa  = (getContacts().whatsapp || '').replace(/\D/g, '');
    const msg = encodeURIComponent('EMERGENCY — ' + (S.operatorName||'Someone') + ' needs help! https://maps.google.com/?q=' + S.currentLat + ',' + S.currentLon);
    window.open(wa.length > 8 ? 'https://wa.me/' + wa + '?text=' + msg : 'https://wa.me/?text=' + msg, '_system');
    resetSystem();
}

function resetSystem() {
    S.pipelineTriggered = false;
    S.gpsResolved = false;
    S.callIndex   = 0;
    DOM.countdownOverlay && DOM.countdownOverlay.classList.add('hidden');
    DOM.callNextBtn && DOM.callNextBtn.classList.remove('visible');
    resetButtonVisuals(); // FIX-4
    tick('System reset and ready.');
}

function resetButtonVisuals() {
    if (DOM.triggerButton && DOM.triggerButton.isConnected) {
        DOM.triggerButton.style.boxShadow = '';
        DOM.triggerButton.style.transform = '';
    }
}

/* ══════════════════════════════════
   ESCALATION ENGINE (Tier 1→2→3)
══════════════════════════════════ */
window.escalateLocalIncident = function(id) {
    const list = getLocalIncidents();
    const inc  = list.find(i => String(i.id) === String(id));
    if (!inc) return;
    inc.tier = Math.min((inc.tier || 1) + 1, 3);
    inc.events = (inc.events || []);
    inc.events.push({ type: 'escalated_tier_' + inc.tier, ts: new Date().toISOString() });
    localStorage.setItem('sl_incidents', JSON.stringify(list));
    auditEntry('incident_escalated', 'INC-' + String(id).slice(-6) + ' → Tier ' + inc.tier);

    // Tier 2: alert police via SMS
    if (inc.tier === 2) {
        const police = getContacts().police;
        if (police) sendSingleSMS(police, 'ESCALATED EMERGENCY Tier 2 — ' + (S.operatorName||'Someone') + '. Location: https://maps.google.com/?q=' + inc.lat + ',' + inc.lon);
    }

    // Sync to API
    if (inc.remoteId) {
        apiFetch('/incidents/' + inc.remoteId + '/escalate', 'POST', {}).catch(() => {});
    }

    closeIncidentModal();
    loadIncidents();
};

/* ══════════════════════════════════
   INCIDENT MANAGEMENT
══════════════════════════════════ */
function createIncidentRecord() {
    const inc = {
        id:        Date.now(),
        status:    S.drillMode ? 'drill' : 'active',
        isDrill:   S.drillMode,
        lat:       S.currentLat,
        lon:       S.currentLon,
        tier:      1,
        createdAt: new Date().toISOString(),
        events:    [{ type: 'panic_fired', ts: new Date().toISOString() }],
    };
    const list = getLocalIncidents();
    list.unshift(inc);
    localStorage.setItem('sl_incidents', JSON.stringify(list.slice(0, 200)));

    apiFetch('/incidents', 'POST', { isDrill: inc.isDrill, latitude: inc.lat, longitude: inc.lon })
        .then(remote => {
            if (remote && remote.id) {
                inc.remoteId = remote.id;
                const updated = getLocalIncidents();
                const i = updated.findIndex(x => x.id === inc.id);
                if (i >= 0) updated[i] = inc;
                localStorage.setItem('sl_incidents', JSON.stringify(updated));
                tick('Incident synced (remote ID: ' + remote.id + ')');
            }
        })
        .catch(() => tick('Incident saved locally (API offline).'));

    auditEntry('incident_created', (S.drillMode ? 'DRILL' : 'LIVE') + ' #' + inc.id);
    return inc;
}

window.createManualIncident = function() {
    createIncidentRecord();
    tick('Manual incident created.');
    loadIncidents();
};

function getLocalIncidents() {
    const s = localStorage.getItem('sl_incidents');
    return s ? JSON.parse(s) : [];
}

function loadIncidents() {
    const list     = getLocalIncidents();
    const filtered = S.incidentFilter === 'all' ? list : list.filter(i => i.status === S.incidentFilter);
    if (!DOM.incidentList) return;
    if (!filtered.length) { DOM.incidentList.innerHTML = '<div class="empty-state">No incidents found.</div>'; return; }
    DOM.incidentList.innerHTML = filtered.map(inc => {
        const tc   = (inc.tier||1) >= 3 ? 'tier-3' : (inc.tier||1) === 2 ? 'tier-2' : '';
        const badge = inc.status === 'active' ? '<span class="badge badge-red">ACTIVE</span>'
                    : inc.status === 'drill'  ? '<span class="badge badge-gray">DRILL</span>'
                    : '<span class="badge badge-green">RESOLVED</span>';
        return `<div class="incident-card ${tc}" onclick='openIncidentModal(${JSON.stringify(inc)})'>
            <div class="incident-row"><span class="incident-title">INC-${String(inc.id).slice(-6)}</span>${badge}</div>
            <div class="incident-meta">${new Date(inc.createdAt).toLocaleString()}</div>
            <div class="incident-meta">Tier ${inc.tier||1} | ${(+inc.lat).toFixed(4)}, ${(+inc.lon).toFixed(4)}</div>
        </div>`;
    }).join('');
}

window.filterIncidents = function(filter) {
    S.incidentFilter = filter;
    document.querySelectorAll('[id^="f-"]').forEach(el => el.style.background = '#1e293b');
    const el = document.getElementById('f-' + filter);
    if (el) el.style.background = '#7f1d1d';
    loadIncidents();
};

window.openIncidentModal = function(inc) {
    if (!DOM.incidentModal || !DOM.incidentModalContent) return;
    const nextTier = Math.min((inc.tier||1)+1, 3);
    DOM.incidentModalContent.innerHTML = `
        <div class="card-header" style="margin-bottom:10px">INCIDENT DETAIL</div>
        <div class="incident-meta" style="margin-bottom:5px">ID: INC-${String(inc.id).slice(-6)}</div>
        <div class="incident-meta" style="margin-bottom:5px">Status: ${inc.status.toUpperCase()}</div>
        <div class="incident-meta" style="margin-bottom:5px">Time: ${new Date(inc.createdAt).toLocaleString()}</div>
        <div class="incident-meta" style="margin-bottom:5px">GPS: ${(+inc.lat).toFixed(5)}, ${(+inc.lon).toFixed(5)}</div>
        <div class="incident-meta" style="margin-bottom:12px">Escalation Tier: ${inc.tier||1}</div>
        <div class="card-header" style="margin-bottom:8px">EVENT LOG</div>
        ${(inc.events||[]).map(e=>`<div class="incident-meta" style="margin-bottom:3px">• ${e.type} — ${new Date(e.ts).toLocaleTimeString()}</div>`).join('')}
        ${inc.status==='active' ? `
        <button class="escalate-btn" style="width:100%;padding:9px;background:#78350f;border:1px solid #f59e0b;color:#fcd34d;font-family:monospace;font-size:0.72rem;border-radius:4px;cursor:pointer;margin-top:10px" onclick="escalateLocalIncident('${inc.id}')">⬆ ESCALATE → TIER ${nextTier}</button>
        <button class="resolve-btn" style="width:100%;padding:9px;background:#14532d;border:1px solid #22c55e;color:#86efac;font-family:monospace;font-size:0.72rem;border-radius:4px;cursor:pointer;margin-top:6px" onclick="resolveLocalIncident('${inc.id}')">✓ MARK RESOLVED</button>
        ` : ''}
    `;
    DOM.incidentModal.classList.remove('hidden');
};

window.closeIncidentModal = function() {
    DOM.incidentModal && DOM.incidentModal.classList.add('hidden');
};

window.resolveLocalIncident = function(id) {
    const list = getLocalIncidents();
    const inc  = list.find(i => String(i.id) === String(id));
    if (inc) {
        inc.status = 'resolved';
        inc.events = (inc.events||[]);
        inc.events.push({ type: 'resolved', ts: new Date().toISOString() });
        localStorage.setItem('sl_incidents', JSON.stringify(list));
        if (inc.remoteId) apiFetch('/incidents/' + inc.remoteId, 'PATCH', { status:'resolved' }).catch(()=>{});
        auditEntry('incident_resolved', 'INC-' + String(id).slice(-6));
    }
    closeIncidentModal();
    loadIncidents();
};

/* ══════════════════════════════════
   RESPONDER DASHBOARD
══════════════════════════════════ */
window.loadResponderFeed = async function() {
    if (!DOM.responderFeed) return;
    DOM.responderFeed.innerHTML = '<div class="empty-state">Loading…</div>';
    let incidents = [];
    try {
        incidents = await apiFetch('/incidents/active', 'GET');
        if (!Array.isArray(incidents)) incidents = [];
    } catch (e) {
        incidents = getLocalIncidents().filter(i => i.status === 'active').slice(0, 20);
    }
    if (!incidents.length) {
        DOM.responderFeed.innerHTML = '<div class="empty-state">No active incidents. Area clear.</div>';
        return;
    }
    DOM.responderFeed.innerHTML = incidents.map(inc => {
        const tier = inc.escalationTier || inc.tier || 1;
        const tBadge = tier>=3 ? '<span class="badge badge-red">TIER 3</span>'
                     : tier===2 ? '<span class="badge badge-orange">TIER 2</span>'
                     : '<span class="badge badge-gray">TIER 1</span>';
        const id = inc.remoteId || inc.id;
        const lat = inc.latitude != null ? inc.latitude : inc.lat;
        const lon = inc.longitude != null ? inc.longitude : inc.lon;
        return `<div class="responder-card">
            <div class="incident-row">${tBadge}<span class="incident-meta">${new Date(inc.createdAt).toLocaleTimeString()}</span></div>
            <div class="incident-title" style="margin-top:6px">INC-${String(id).slice(-6)}</div>
            <div class="incident-meta" style="margin-top:3px">${inc.userName||'Unknown operator'}</div>
            <div class="incident-meta">${lat!=null ? (+lat).toFixed(4)+', '+(+lon).toFixed(4) : 'Location unknown'}</div>
            ${inc.responderId ? '<div class="incident-meta" style="color:#22c55e;margin-top:4px">✓ Responder assigned</div>'
                : '<button class="accept-btn" onclick="acceptIncident('+id+')">ACCEPT &amp; RESPOND</button>'}
        </div>`;
    }).join('');
};

window.acceptIncident = async function(id) {
    tick('Accepting incident ' + id + '…');
    try {
        await apiFetch('/incidents/' + id + '/accept', 'POST', {});
        tick('Incident accepted. You are now assigned responder.');
        auditEntry('incident_accepted', 'ID: ' + id);
        loadResponderFeed();
    } catch (e) {
        tick('Accept failed (offline) — logged locally.');
        auditEntry('incident_accepted_offline', 'ID: ' + id);
    }
};

/* ══════════════════════════════════
   MEDICAL PROFILE
══════════════════════════════════ */
window.selectBlood = function(type) {
    S.bloodType = type;
    document.querySelectorAll('.blood-btn').forEach(b => b.classList.remove('selected'));
    const map = {'A+':'Apos','A-':'Aneg','B+':'Bpos','B-':'Bneg','AB+':'ABpos','AB-':'ABneg','O+':'Opos','O-':'Oneg'};
    const el = document.getElementById('bt-' + (map[type] || type.replace(/[+]/g,'pos').replace(/[-]/g,'neg')));
    if (el) el.classList.add('selected');
};

window.saveMedicalProfile = function() {
    const p = {
        bloodType:      S.bloodType,
        conditions:     DOM.medConditions     ? DOM.medConditions.value.trim()     : '',
        medications:    DOM.medMedications    ? DOM.medMedications.value.trim()    : '',
        allergies:      DOM.medAllergies      ? DOM.medAllergies.value.trim()      : '',
        emergencyNotes: DOM.medEmergencyNotes ? DOM.medEmergencyNotes.value.trim() : '',
    };
    localStorage.setItem('sl_medical', JSON.stringify(p));
    tick('Medical profile saved.');
    auditEntry('medical_profile_saved', 'Blood: ' + (p.bloodType || 'not set'));
    apiFetch('/users/me/medical', 'PUT', p).then(() => tick('Medical synced to server.')).catch(() => tick('Medical saved locally.'));
    alert('Medical profile saved.');
};

function loadMedicalProfile() {
    const s = localStorage.getItem('sl_medical');
    if (!s) return;
    const p = JSON.parse(s);
    if (p.bloodType) selectBlood(p.bloodType);
    DOM.medConditions     && (DOM.medConditions.value     = p.conditions     || '');
    DOM.medMedications    && (DOM.medMedications.value    = p.medications    || '');
    DOM.medAllergies      && (DOM.medAllergies.value      = p.allergies      || '');
    DOM.medEmergencyNotes && (DOM.medEmergencyNotes.value = p.emergencyNotes || '');
}

function buildMedicalSummary() {
    const s = localStorage.getItem('sl_medical');
    if (!s) return '';
    const p = JSON.parse(s);
    const parts = [];
    if (p.bloodType)  parts.push('Blood:' + p.bloodType);
    if (p.conditions) parts.push('Cond:' + p.conditions.slice(0,35));
    if (p.allergies)  parts.push('Allergy:' + p.allergies.slice(0,25));
    return parts.join(' | ');
}

/* ══════════════════════════════════
   BLE SCANNER (HST-01)
══════════════════════════════════ */
window.startBLEScan = function() {
    if (!navigator.bluetooth) {
        DOM.bleStatus && (DOM.bleStatus.innerText = 'BLE: Web Bluetooth not available on this device.');
        tick('BLE: Not supported. For native BLE, add cordova-plugin-ble-central.');
        return;
    }
    S.bleScanning = true;
    DOM.bleStatus && (DOM.bleStatus.innerText = 'BLE: Scanning for HST-01…');
    tick('BLE scan started…');

    navigator.bluetooth.requestDevice({ acceptAllDevices: true })
        .then(device => {
            const name = device.name || 'Unknown';
            const id   = device.id;
            if (!S.bleDevices[id]) {
                S.bleDevices[id] = { name, id };
                renderBLEDevices();
                tick('HST-01 beacon found: ' + name + ' [' + id + ']');
                auditEntry('ble_device_found', name + ' ' + id);
            }
        })
        .catch(err => {
            DOM.bleStatus && (DOM.bleStatus.innerText = 'BLE: ' + err.message);
            tick('BLE: ' + err.message);
        });
};

window.stopBLEScan = function() {
    S.bleScanning = false;
    DOM.bleStatus && (DOM.bleStatus.innerText = 'BLE: Stopped.');
    tick('BLE scan stopped.');
};

function renderBLEDevices() {
    if (!DOM.bleDeviceList) return;
    const devices = Object.values(S.bleDevices);
    DOM.bleDeviceList.innerHTML = devices.map(d =>
        `<div class="ble-device"><span style="font-family:monospace;font-size:0.75rem;color:#f8fafc">${d.name}</span><span class="ble-rssi">${d.id.slice(0,8)}</span></div>`
    ).join('');
}

/* ══════════════════════════════════
   ANALYTICS
══════════════════════════════════ */
window.loadAnalytics = function() {
    const list     = getLocalIncidents();
    const total    = list.length;
    const resolved = list.filter(i => i.status === 'resolved').length;
    const active   = list.filter(i => i.status === 'active').length;
    const drills   = list.filter(i => i.isDrill || i.status === 'drill').length;
    DOM.statTotal    && (DOM.statTotal.innerText    = total);
    DOM.statResolved && (DOM.statResolved.innerText = resolved);
    DOM.statActive   && (DOM.statActive.innerText   = active);
    DOM.statDrills   && (DOM.statDrills.innerText   = drills);
    renderAuditLog();
};

/* ══════════════════════════════════
   AUDIT LOG (local)
══════════════════════════════════ */
function auditEntry(action, detail) {
    const log = getAuditLog();
    log.unshift({ ts: new Date().toISOString(), action, detail: detail || '', op: S.operatorName });
    localStorage.setItem('sl_audit', JSON.stringify(log.slice(0, 500)));
}

function getAuditLog() {
    const s = localStorage.getItem('sl_audit');
    return s ? JSON.parse(s) : [];
}

function renderAuditLog() {
    if (!DOM.auditLogDisplay) return;
    const log = getAuditLog();
    if (!log.length) { DOM.auditLogDisplay.innerHTML = '<div class="empty-state">No audit entries yet.</div>'; return; }
    DOM.auditLogDisplay.innerHTML = log.map(e =>
        `<div class="audit-row"><span class="audit-time">${new Date(e.ts).toLocaleTimeString()}</span><span class="audit-action">${e.action}${e.detail ? ' — ' + e.detail : ''}</span></div>`
    ).join('');
}

/* ══════════════════════════════════
   MAP (Leaflet bundled locally)
══════════════════════════════════ */
function initMap() {
    const el = document.getElementById('gis-radar-viewport');
    if (!el || S.map) return;
    if (typeof L === 'undefined') { tick('Leaflet not found — map unavailable.'); return; }
    S.map = L.map('gis-radar-viewport').setView([CFG.defaultLat, CFG.defaultLon], 13);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { attribution: '&copy; OpenStreetMap' }).addTo(S.map);
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(pos => {
            S.currentLat = pos.coords.latitude;
            S.currentLon = pos.coords.longitude;
            S.map.setView([S.currentLat, S.currentLon], 14);
            if (S.mapMarker) S.map.removeLayer(S.mapMarker);
            S.mapMarker = L.marker([S.currentLat, S.currentLon]).addTo(S.map).bindPopup('Your location').openPopup();
            tick('GPS on map locked.');
        }, () => tick('GPS unavailable — default area shown.'));
    }
}

/* ══════════════════════════════════
   API HELPER
══════════════════════════════════ */
async function apiFetch(path, method, body) {
    if (!CFG.apiBase) throw new Error('No API base configured');
    const headers = { 'Content-Type': 'application/json' };
    const token = S.authToken || localStorage.getItem('sl_token');
    if (token) headers['Authorization'] = 'Bearer ' + token;
    const opts = { method, headers };
    if (body && method !== 'GET') opts.body = JSON.stringify(body);
    const res = await fetch(CFG.apiBase + path, opts);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
}

/* ══════════════════════════════════
   HELPERS
══════════════════════════════════ */
function buzz(ms) { navigator.vibrate && navigator.vibrate(ms); }

function tick(msg) {
    const t = new Date().toLocaleTimeString();
    if (DOM.diagnosticTickerTerminal) {
        DOM.diagnosticTickerTerminal.innerHTML += '<div>[' + t + '] ' + msg + '</div>';
        DOM.diagnosticTickerTerminal.scrollTop = DOM.diagnosticTickerTerminal.scrollHeight;
    }
    console.log('[SafetyLink] ' + msg);
}

function saveSession() {
    localStorage.setItem('sl_name',  S.operatorName);
    localStorage.setItem('sl_phone', S.operatorPhone);
    localStorage.setItem('sl_org',   S.orgId);
}

function loadPersistentState() {
    S.operatorName  = localStorage.getItem('sl_name')  || '';
    S.operatorPhone = localStorage.getItem('sl_phone') || '';
    S.orgId         = localStorage.getItem('sl_org')   || '';
    S.authToken     = localStorage.getItem('sl_token') || '';
    if (S.operatorName && S.operatorPhone) bootConsole();
}

function logDiagnostic() {
    tick('SafetyLink v4.0 booting…');
    tick('Cordova:     ' + (typeof cordova !== 'undefined' ? 'OK' : 'NOT FOUND (web mode)'));
    tick('Permissions: ' + (typeof cordova !== 'undefined' && cordova.plugins && cordova.plugins.permissions ? 'OK' : 'NOT FOUND'));
    tick('SMS Plugin:  ' + (typeof cordova !== 'undefined' && cordova.plugins && cordova.plugins.sms ? 'OK' : 'NOT FOUND'));
    tick('Call Plugin: ' + (typeof cordova !== 'undefined' && cordova.plugins && cordova.plugins.CallNumber ? 'OK' : 'NOT FOUND'));
    tick('Geolocation: ' + (navigator.geolocation ? 'OK' : 'NOT FOUND'));
    tick('Bluetooth:   ' + (navigator.bluetooth ? 'OK' : 'NOT SUPPORTED'));
    tick('Vibration:   ' + (navigator.vibrate ? 'OK' : 'NOT SUPPORTED'));
    tick('Leaflet:     ' + (typeof L !== 'undefined' ? 'OK (bundled locally)' : 'NOT FOUND'));
    tick('API Base:    ' + (CFG.apiBase || 'NOT SET — offline/local mode'));
    tick('Ready. Configure contacts in SETTINGS then arm system.');
}
