/**
 * Good boy keeper - Popup UI Controller (popup.js)
 * Production-Audited:
 * - Zero DOM XSS (strict textContent / DOM construction, zero unsafe innerHTML interpolation)
 * - Strict URL & Base64 image MIME allowlist + 4.5MB storage quota protection
 * - Clock-Style Dial with 5m/15m/30m/45m/60m Presets + Local Browser Cache History
 */
const ext = typeof globalThis.browser !== 'undefined' ? globalThis.browser : globalThis.chrome;

const DEFAULT_GIF_URL =
  ext.runtime && ext.runtime.getURL ? ext.runtime.getURL('alert.gif') : 'alert.gif';
const DEFAULT_HEADLINE = "Time's Up! Stop Scrolling!";
const MAX_UPLOAD_BYTES = 4.5 * 1024 * 1024; // 4.5 MB limit to protect 5MB chrome.storage.local quota
const ALLOWED_IMAGE_MIMES = ['image/gif', 'image/webp', 'image/png', 'image/jpeg'];

function resolveBundledGifUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return DEFAULT_GIF_URL;
  const trimmed = rawUrl.trim();
  if (!trimmed) return DEFAULT_GIF_URL;
  if (
    trimmed.includes('0uBL9HqP48Nu1DNr7r') ||
    trimmed === 'alert.gif' ||
    trimmed === '/alert.gif'
  ) {
    return DEFAULT_GIF_URL;
  }
  if (/^data:image\/(gif|webp|png|jpeg);base64,[a-zA-Z0-9+/=\s]+$/i.test(trimmed)) {
    return trimmed;
  }
  if (/^(\/|[a-zA-Z0-9_\-./]+\.(gif|webp|png|jpe?g))$/i.test(trimmed) && !trimmed.startsWith('//')) {
    return trimmed;
  }
  try {
    const parsed = new URL(trimmed);
    if (['https:', 'http:', 'chrome-extension:', 'moz-extension:'].includes(parsed.protocol)) {
      return parsed.href;
    }
  } catch {
    // Fall through to default
  }
  return DEFAULT_GIF_URL;
}

const WHEEL_RADIUS = 76;
const WHEEL_CENTER = 100;
const CIRCUMFERENCE = 2 * Math.PI * WHEEL_RADIUS;

let currentUnit = 'minutes'; // 'minutes' | 'hours'
let currentValue = 15;
let isDraggingWheel = false;
let activeTabDomain = '';
let activeTabDomains = new Set();

// DOM Elements
const statusBadge = document.getElementById('status-badge');
const currentDomainText = document.getElementById('current-domain-text');
const trackCurrentBtn = document.getElementById('track-current-btn');
const unitMinutesBtn = document.getElementById('unit-minutes');
const unitHoursBtn = document.getElementById('unit-hours');
const wheelSvg = document.getElementById('time-wheel-svg');
const wheelProgress = document.getElementById('wheel-progress');
const wheelHandle = document.getElementById('wheel-handle');
const manualTimeInput = document.getElementById('manual-time-input');
const wheelUnitLabel = document.getElementById('wheel-unit-label');
const presetButtonsContainer = document.getElementById('preset-buttons');
const addSiteForm = document.getElementById('add-site-form');
const domainInput = document.getElementById('domain-input');
const formFeedback = document.getElementById('form-feedback');
const trackedCount = document.getElementById('tracked-count');
const trackedSitesList = document.getElementById('tracked-sites-list');
const historyList = document.getElementById('history-list');
const clearHistoryBtn = document.getElementById('clear-history-btn');
const gifUrlInput = document.getElementById('gif-url-input');
const gifFileInput = document.getElementById('gif-file-input');
const resetGifBtn = document.getElementById('reset-gif-btn');
const alertMessageInput = document.getElementById('alert-message-input');
const gifPreviewImg = document.getElementById('gif-preview-img');
const previewHeadlineText = document.getElementById('preview-headline-text');
const saveSettingsBtn = document.getElementById('save-settings-btn');

function normalizeDomain(rawInput) {
  if (!rawInput || typeof rawInput !== 'string') return '';
  let trimmed = rawInput.trim().toLowerCase();
  if (!trimmed || trimmed.length > 2048) return '';
  if (!/^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(trimmed)) {
    trimmed = 'https://' + trimmed;
  }
  try {
    const parsed = new URL(trimmed);
    if (
      [
        'chrome:',
        'edge:',
        'about:',
        'moz-extension:',
        'chrome-extension:',
        'javascript:',
        'data:',
        'file:',
        'blob:',
      ].includes(parsed.protocol)
    ) {
      return '';
    }
    // Strip only generic web/mobile prefixes (www., m., mobile.) so distinct app subdomains
    // like drive.google.com, aistudio.google.com, and docs.google.com remain separate
    let host = parsed.hostname
      .toLowerCase()
      .replace(/\.+$/, '')
      .replace(/^(www\d*\.|m\.|mobile\.)/i, '');
    if (!host || host.length > 253 || !host.includes('.')) return '';
    if (!/^[a-z0-9.-]+$/.test(host) || host.startsWith('.') || host.includes('..')) return '';
    return host;
  } catch {
    return '';
  }
}

function getMaxForUnit(unit) {
  return unit === 'minutes' ? 120 : 12;
}

function getPresetsForUnit(unit) {
  return unit === 'minutes' ? [5, 15, 30, 45, 60] : [1, 2, 4, 6, 8];
}

function renderPresetButtons() {
  if (!presetButtonsContainer) return;
  const presets = getPresetsForUnit(currentUnit);
  const suffix = currentUnit === 'minutes' ? 'm' : 'h';
  presetButtonsContainer.textContent = '';
  presets.forEach((presetVal) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'preset-btn' + (currentValue === presetVal ? ' active' : '');
    btn.textContent = `${presetVal}${suffix}`;
    btn.addEventListener('click', () => {
      updateWheelVisuals(presetVal, currentUnit);
    });
    presetButtonsContainer.appendChild(btn);
  });
}

function updateWheelVisuals(value, unit) {
  const maxVal = getMaxForUnit(unit);
  const clamped = Math.max(1, Math.min(maxVal, Math.round(value)));
  currentValue = clamped;

  const fraction = clamped / maxVal;
  const angleDeg = fraction * 360;
  const offset = CIRCUMFERENCE * (1 - fraction);

  wheelProgress.style.strokeDasharray = String(CIRCUMFERENCE);
  wheelProgress.style.strokeDashoffset = String(offset);

  const rad = ((angleDeg - 90) * Math.PI) / 180;
  const hx = WHEEL_CENTER + WHEEL_RADIUS * Math.cos(rad);
  const hy = WHEEL_CENTER + WHEEL_RADIUS * Math.sin(rad);
  wheelHandle.setAttribute('cx', hx.toFixed(2));
  wheelHandle.setAttribute('cy', hy.toFixed(2));

  manualTimeInput.value = String(clamped);
  wheelUnitLabel.textContent = unit.toUpperCase();
  renderPresetButtons();
}

function pointerEventToAngle(e) {
  const rect = wheelSvg.getBoundingClientRect();
  if (!rect.width || !rect.height) return 0;
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const dx = e.clientX - cx;
  const dy = e.clientY - cy;
  let deg = Math.atan2(dx, -dy) * (180 / Math.PI);
  if (deg < 0) deg += 360;
  return deg;
}

function handleWheelPointer(e) {
  const angle = pointerEventToAngle(e);
  const maxVal = getMaxForUnit(currentUnit);
  const nextValue = Math.max(1, Math.min(maxVal, Math.round((angle / 360) * maxVal)));
  updateWheelVisuals(nextValue, currentUnit);
}

function stopWheelDrag(e) {
  if (!isDraggingWheel) return;
  isDraggingWheel = false;
  try {
    if (wheelSvg.hasPointerCapture && wheelSvg.hasPointerCapture(e.pointerId)) {
      wheelSvg.releasePointerCapture(e.pointerId);
    }
  } catch {
    // Ignore if pointer capture was already released
  }
}

wheelSvg.addEventListener('pointerdown', (e) => {
  isDraggingWheel = true;
  try {
    wheelSvg.setPointerCapture(e.pointerId);
  } catch {
    // Ignore
  }
  handleWheelPointer(e);
});

wheelSvg.addEventListener('pointermove', (e) => {
  if (!isDraggingWheel) return;
  handleWheelPointer(e);
});

wheelSvg.addEventListener('pointerup', stopWheelDrag);
wheelSvg.addEventListener('pointercancel', stopWheelDrag);

manualTimeInput.addEventListener('input', () => {
  const cleaned = manualTimeInput.value.replace(/[^\d]/g, '');
  if (!cleaned) return;
  const parsed = parseInt(cleaned, 10);
  if (!Number.isNaN(parsed)) {
    updateWheelVisuals(parsed, currentUnit);
  }
});

function setUnit(unit) {
  currentUnit = unit;
  unitMinutesBtn.classList.toggle('active', unit === 'minutes');
  unitHoursBtn.classList.toggle('active', unit === 'hours');
  const maxVal = getMaxForUnit(unit);
  if (currentValue > maxVal) {
    currentValue = unit === 'hours' ? 1 : 15;
  }
  updateWheelVisuals(currentValue, currentUnit);
}

unitMinutesBtn.addEventListener('click', () => setUnit('minutes'));
unitHoursBtn.addEventListener('click', () => setUnit('hours'));

function formatRemaining(seconds) {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  const hrs = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return hrs > 0 ? `${pad(hrs)}:${pad(mins)}:${pad(secs)}` : `${pad(mins)}:${pad(secs)}`;
}

function formatDurationLabel(seconds) {
  const s = Math.max(0, Math.round(Number(seconds) || 0));
  if (s >= 3600 && s % 3600 === 0) {
    const hrs = s / 3600;
    return `${hrs} ${hrs === 1 ? 'hour' : 'hours'}`;
  }
  const mins = Math.max(1, Math.round(s / 60));
  return `${mins} ${mins === 1 ? 'minute' : 'minutes'}`;
}

async function getStorageData() {
  return new Promise((resolve) => {
    ext.storage.local.get(
      ['trackedSites', 'siteHistory', 'alertSettings', 'activeCountingDomains', 'windowUnfocused'],
      (res) => {
        const safeRes = res || {};
        const savedSettings = safeRes.alertSettings || {};
        const rawSites = safeRes.trackedSites || {};
        const activeSites = {};
        let hadExpired = false;
        Object.keys(rawSites).forEach((k) => {
          const site = rawSites[k];
          const normKey = normalizeDomain(k);
          if (site && normKey && site.remainingSeconds > 0) {
            activeSites[normKey] = {
              ...site,
              domain: normKey,
            };
          } else {
            hadExpired = true;
          }
        });
        if (hadExpired) {
          ext.storage.local.set({ trackedSites: activeSites });
        }
        resolve({
          trackedSites: activeSites,
          siteHistory: Array.isArray(safeRes.siteHistory) ? safeRes.siteHistory : [],
          activeCountingDomains: Array.isArray(safeRes.activeCountingDomains)
            ? safeRes.activeCountingDomains
            : [],
          windowUnfocused: Boolean(safeRes.windowUnfocused),
          alertSettings: {
            gifUrl: resolveBundledGifUrl(savedSettings.gifUrl),
            headline:
              typeof savedSettings.headline === 'string' && savedSettings.headline.trim()
                ? savedSettings.headline.trim().slice(0, 140)
                : DEFAULT_HEADLINE,
          },
        });
      }
    );
  });
}

async function saveStorageData(payload) {
  return new Promise((resolve) => {
    ext.storage.local.set(payload, resolve);
  });
}

function doesDomainMatch(candidateDomain, targetDomain) {
  const cand = normalizeDomain(candidateDomain);
  const targ = normalizeDomain(targetDomain);
  if (!cand || !targ) return false;
  return cand === targ;
}

async function addOrUpdateSite(rawDomain, customLimitSeconds) {
  const domain = normalizeDomain(rawDomain);
  if (!domain) {
    formFeedback.textContent = 'Please enter a valid domain (e.g., tiktok.com, drive.google.com).';
    return;
  }
  const rawLimit =
    typeof customLimitSeconds === 'number'
      ? customLimitSeconds
      : currentUnit === 'minutes'
      ? currentValue * 60
      : currentValue * 3600;
  const limitSeconds = Math.max(5, Math.min(12 * 3600, Math.round(rawLimit)));

  await detectCurrentTab();
  const { trackedSites, siteHistory } = await getStorageData();
  const now = Date.now();
  const isCurrentlyActive =
    activeTabDomain === domain || activeTabDomains.has(domain);

  trackedSites[domain] = {
    domain,
    limitSeconds,
    remainingSeconds: limitSeconds,
    paused: false,
    alertTriggered: false,
    addedAt: now,
    lastUpdatedAt: now,
    isActivelyCounting: isCurrentlyActive,
  };

  // Prepend to local browser cache history (zero external network transfer)
  const newHistoryEntry = {
    id: `${domain}-${now}`,
    domain,
    durationSeconds: limitSeconds,
    action: 'Tracked',
    timestamp: now,
  };
  const updatedHistory = [
    newHistoryEntry,
    ...siteHistory.filter((h) => !(h && h.domain === domain && h.durationSeconds === limitSeconds)),
  ].slice(0, 30);

  await saveStorageData({ trackedSites, siteHistory: updatedHistory });
  formFeedback.textContent = `Tracking ${domain} for ${formatDurationLabel(limitSeconds)}!`;
  domainInput.value = '';
  await renderAllLists();
}

async function renderAllLists() {
  const { trackedSites, siteHistory, activeCountingDomains, windowUnfocused } = await getStorageData();
  const entries = Object.values(trackedSites).filter((s) => s && s.remainingSeconds > 0);
  trackedCount.textContent = `${entries.length} ${entries.length === 1 ? 'site' : 'sites'}`;
  trackedSitesList.textContent = '';

  const backgroundActiveSet = new Set(
    Array.isArray(activeCountingDomains)
      ? activeCountingDomains.map((d) => normalizeDomain(d)).filter(Boolean)
      : []
  );

  let anySiteActivelyCounting = false;
  const now = Date.now();

  if (entries.length === 0) {
    const emptyLi = document.createElement('li');
    emptyLi.className = 'site-item';
    const emptySpan = document.createElement('span');
    emptySpan.className = 'site-timer';
    emptySpan.textContent = 'No websites tracked yet. Add one above!';
    emptyLi.appendChild(emptySpan);
    trackedSitesList.appendChild(emptyLi);
  } else {
    entries.forEach((site) => {
      const li = document.createElement('li');
      li.className = 'site-item';

      const matchesPopupDetectedTab =
        activeTabDomain === site.domain || activeTabDomains.has(site.domain);
      const matchesBackgroundActiveList = backgroundActiveSet.has(site.domain);
      const recentlyTicked = Boolean(
        site.lastUpdatedAt && now - site.lastUpdatedAt < 2500 && site.isActivelyCounting
      );

      const isActiveSite =
        !windowUnfocused &&
        (matchesPopupDetectedTab ||
          matchesBackgroundActiveList ||
          Boolean(site.isActivelyCounting) ||
          recentlyTicked);

      const isCountingNow = isActiveSite && !site.paused && site.remainingSeconds > 0;
      if (isCountingNow) {
        anySiteActivelyCounting = true;
      }

      let statusClass = 'idle';
      let statusLabel = 'Inactive Tab • Idle';
      if (site.paused) {
        statusClass = 'paused';
        statusLabel = 'Paused';
      } else if (windowUnfocused && matchesPopupDetectedTab) {
        statusClass = 'paused';
        statusLabel = 'Paused • Window Unfocused';
      } else if (isCountingNow) {
        statusClass = 'counting';
        statusLabel = 'Active • Counting';
      }

      // Build DOM safely without innerHTML to prevent any XSS
      const meta = document.createElement('div');
      meta.className = 'site-meta';

      const domainRow = document.createElement('div');
      domainRow.className = 'site-domain-row';

      const domainSpan = document.createElement('span');
      domainSpan.className = 'site-domain';
      domainSpan.textContent = site.domain;

      const statusPill = document.createElement('span');
      statusPill.className = `status-pill ${statusClass}`;
      const statusDot = document.createElement('span');
      statusDot.className = 'status-dot';
      statusPill.appendChild(statusDot);
      statusPill.appendChild(document.createTextNode(' ' + statusLabel));

      domainRow.appendChild(domainSpan);
      domainRow.appendChild(statusPill);

      const timerSpan = document.createElement('span');
      timerSpan.className = 'site-timer' + (isCountingNow ? ' live' : '');
      timerSpan.textContent = site.paused
        ? `Paused (${formatRemaining(site.remainingSeconds)} saved)`
        : `${formatRemaining(site.remainingSeconds)} left`;

      meta.appendChild(domainRow);
      meta.appendChild(timerSpan);

      const actions = document.createElement('div');
      actions.className = 'site-actions';

      const pauseBtn = document.createElement('button');
      pauseBtn.type = 'button';
      pauseBtn.className = 'icon-btn';
      pauseBtn.textContent = site.paused ? 'Resume' : 'Pause';
      pauseBtn.addEventListener('click', async () => {
        const data = await getStorageData();
        if (data.trackedSites[site.domain]) {
          data.trackedSites[site.domain].paused = !data.trackedSites[site.domain].paused;
          data.trackedSites[site.domain].lastUpdatedAt = Date.now();
          await saveStorageData({ trackedSites: data.trackedSites });
          await renderAllLists();
        }
      });

      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'icon-btn danger';
      delBtn.textContent = 'Delete';
      delBtn.addEventListener('click', async () => {
        const data = await getStorageData();
        delete data.trackedSites[site.domain];
        await saveStorageData({ trackedSites: data.trackedSites });
        await renderAllLists();
      });

      actions.appendChild(pauseBtn);
      actions.appendChild(delBtn);
      li.appendChild(meta);
      li.appendChild(actions);
      trackedSitesList.appendChild(li);
    });
  }

  if (statusBadge) {
    statusBadge.textContent = anySiteActivelyCounting ? 'Live Counting' : 'Active';
  }

  // Render Local Browser Cache History safely without innerHTML
  historyList.textContent = '';
  if (siteHistory.length === 0) {
    const emptyHist = document.createElement('li');
    emptyHist.className = 'site-item';
    const emptySpan = document.createElement('span');
    emptySpan.className = 'site-timer';
    emptySpan.textContent = 'No history saved in browser cache yet.';
    emptyHist.appendChild(emptySpan);
    historyList.appendChild(emptyHist);
  } else {
    siteHistory.forEach((item) => {
      if (!item || !item.domain) return;
      const safeDomain = normalizeDomain(item.domain);
      if (!safeDomain) return;

      const li = document.createElement('li');
      li.className = 'site-item';

      const meta = document.createElement('div');
      meta.className = 'site-meta';

      const domainSpan = document.createElement('span');
      domainSpan.className = 'site-domain';
      domainSpan.textContent = `${safeDomain} for ${formatDurationLabel(item.durationSeconds)}`;

      const timerSpan = document.createElement('span');
      timerSpan.className = 'site-timer';
      const safeAction =
        typeof item.action === 'string' && ['Tracked', 'Completed', 'Snoozed'].includes(item.action)
          ? item.action
          : 'Tracked';
      timerSpan.textContent = `${safeAction} • Saved in local cache`;

      meta.appendChild(domainSpan);
      meta.appendChild(timerSpan);

      const retrackBtn = document.createElement('button');
      retrackBtn.type = 'button';
      retrackBtn.className = 'icon-btn';
      retrackBtn.textContent = 'Track Again';
      retrackBtn.addEventListener('click', () => {
        addOrUpdateSite(safeDomain, item.durationSeconds);
      });

      li.appendChild(meta);
      li.appendChild(retrackBtn);
      historyList.appendChild(li);
    });
  }
}

async function detectCurrentTab() {
  return new Promise((resolve) => {
    ext.tabs.query({ active: true }, (allActiveTabs) => {
      const nextDomains = new Set();
      let primaryDomain = '';

      if (Array.isArray(allActiveTabs)) {
        allActiveTabs.forEach((t) => {
          const rawUrl = (t && (t.url || t.pendingUrl)) || '';
          const d = normalizeDomain(rawUrl);
          if (d) {
            nextDomains.add(d);
            if (!primaryDomain) {
              primaryDomain = d;
            }
          }
        });
      }

      ext.tabs.query({ active: true, currentWindow: true }, (currentWinTabs) => {
        const currentTab = currentWinTabs && currentWinTabs[0];
        const currentUrl = (currentTab && (currentTab.url || currentTab.pendingUrl)) || '';
        const currentDomain = normalizeDomain(currentUrl) || primaryDomain;

        if (currentDomain) {
          nextDomains.add(currentDomain);
          activeTabDomain = currentDomain;
          currentDomainText.textContent = currentDomain;
          trackCurrentBtn.disabled = false;
        } else {
          activeTabDomain = '';
          currentDomainText.textContent = 'System / New Tab';
          trackCurrentBtn.disabled = true;
        }

        activeTabDomains = nextDomains;
        resolve(activeTabDomain);
      });
    });
  });
}

trackCurrentBtn.addEventListener('click', () => {
  if (activeTabDomain) {
    addOrUpdateSite(activeTabDomain);
  }
});

addSiteForm.addEventListener('submit', (e) => {
  e.preventDefault();
  addOrUpdateSite(domainInput.value);
});

clearHistoryBtn.addEventListener('click', async () => {
  await saveStorageData({ siteHistory: [] });
  await renderAllLists();
});

gifFileInput.addEventListener('change', (e) => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  if (!ALLOWED_IMAGE_MIMES.includes(file.type)) {
    formFeedback.textContent = 'Only GIF, WebP, PNG, or JPEG images are allowed.';
    e.target.value = '';
    return;
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    formFeedback.textContent = 'Image exceeds 4.5MB storage limit. Please choose a smaller file.';
    e.target.value = '';
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    if (typeof reader.result === 'string') {
      const safeDataUrl = resolveBundledGifUrl(reader.result);
      gifUrlInput.value = safeDataUrl;
      gifPreviewImg.src = safeDataUrl;
      formFeedback.textContent = 'Local image loaded! Click Save Alert Config to apply.';
    }
  };
  reader.readAsDataURL(file);
});

resetGifBtn.addEventListener('click', () => {
  gifUrlInput.value = DEFAULT_GIF_URL;
  gifPreviewImg.src = DEFAULT_GIF_URL;
});

saveSettingsBtn.addEventListener('click', () => {
  const gifUrl = resolveBundledGifUrl(gifUrlInput.value);
  const headline = (alertMessageInput.value || '').trim().slice(0, 140) || DEFAULT_HEADLINE;
  ext.storage.local.set({ alertSettings: { gifUrl, headline } }, () => {
    gifUrlInput.value = gifUrl;
    gifPreviewImg.src = gifUrl;
    previewHeadlineText.textContent = headline;
    formFeedback.textContent = 'Custom alert GIF & headline saved!';
  });
});

// Listen for real-time storage updates from background.js
if (ext.storage && ext.storage.onChanged) {
  ext.storage.onChanged.addListener(() => {
    renderAllLists();
  });
}

// Listen for tab switches or URL changes in real time while popup is open
if (ext.tabs && ext.tabs.onActivated) {
  ext.tabs.onActivated.addListener(async () => {
    await detectCurrentTab();
    await renderAllLists();
  });
}
if (ext.tabs && ext.tabs.onUpdated) {
  ext.tabs.onUpdated.addListener(async () => {
    await detectCurrentTab();
    await renderAllLists();
  });
}

// Initialize Popup and trigger live 1-second sync with background worker
(async function init() {
  updateWheelVisuals(currentValue, currentUnit);
  await detectCurrentTab();
  const { alertSettings } = await getStorageData();
  gifUrlInput.value = alertSettings.gifUrl || DEFAULT_GIF_URL;
  alertMessageInput.value = alertSettings.headline || DEFAULT_HEADLINE;
  gifPreviewImg.src = alertSettings.gifUrl || DEFAULT_GIF_URL;
  previewHeadlineText.textContent = alertSettings.headline || DEFAULT_HEADLINE;
  await renderAllLists();

  // Re-detect active tab + request background tick + re-render every second for real-time status & timer sync
  setInterval(async () => {
    await detectCurrentTab();
    ext.runtime.sendMessage(
      {
        type: 'GOOD_BOY_HEARTBEAT_TICK',
        fromPopup: true,
        activeDomain: activeTabDomain,
        activeDomains: Array.from(activeTabDomains),
      },
      () => {
        void ext.runtime.lastError;
        renderAllLists();
      }
    );
  }, 1000);
})();