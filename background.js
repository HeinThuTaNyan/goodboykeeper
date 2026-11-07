/**
 * Good boy keeper - Background Service Worker (background.js)
 * Production-Audited Cross-Browser Countdown Engine:
 * - O(1) Set-based domain matching and zero redundant storage writes when idle.
 * - Preserves distinct app subdomains (e.g., drive.google.com, aistudio.google.com, docs.google.com) while stripping only www/m/mobile prefixes.
 * - Automatically deletes completed sites from Tracked Websites as soon as time is up (keeping them only in Tracked History) so revisiting a domain later never triggers a stale alert.
 * - Pauses countdown immediately when the user switches to another application/window outside the browser.
 * - Guarantees Time's Up pop-up delivery in Chrome, Brave, Firefox, and Edge.
 */
const ext = typeof globalThis.browser !== 'undefined' ? globalThis.browser : globalThis.chrome;

const TICK_ALARM_NAME = 'good-boy-keeper-tick';
const DEFAULT_GIF_URL =
  ext.runtime && ext.runtime.getURL ? ext.runtime.getURL('alert.gif') : 'alert.gif';
const DEFAULT_HEADLINE = "Time's Up! Stop Scrolling!";

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

let lastTickTimestamp = Date.now();
let lastPopupHeartbeatAt = 0;
let isTickRunning = false;

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

function doesDomainMatch(candidateDomain, targetDomain) {
  const cand = normalizeDomain(candidateDomain);
  const targ = normalizeDomain(targetDomain);
  if (!cand || !targ) return false;
  return cand === targ;
}

function areStringArraysEqual(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function getStorage(keys) {
  return new Promise((resolve) => {
    ext.storage.local.get(keys, (res) => resolve(res || {}));
  });
}

function setStorage(items) {
  return new Promise((resolve) => {
    ext.storage.local.set(items, resolve);
  });
}

function queryTabsAsync(queryInfo) {
  return new Promise((resolve) => {
    ext.tabs.query(queryInfo, (tabs) => {
      void ext.runtime.lastError;
      resolve(Array.isArray(tabs) ? tabs : []);
    });
  });
}

function checkIsBrowserWindowFocused() {
  return new Promise((resolve) => {
    if (!ext.windows || !ext.windows.getLastFocused) {
      resolve(true);
      return;
    }
    ext.windows.getLastFocused({ populate: false }, (win) => {
      if (ext.runtime && ext.runtime.lastError) {
        resolve(true);
        return;
      }
      resolve(Boolean(win && win.focused));
    });
  });
}

/**
 * Sends GOOD_BOY_TIME_UP to a tab. In Chrome, if the tab was opened before the extension was installed/reloaded,
 * content.js may not be injected yet—so if sendMessage fails, we dynamically inject content.css + content.js and retry!
 */
function deliverTimeUpAlertToTab(tabId, payload) {
  if (!tabId) return;
  ext.tabs.sendMessage(tabId, payload, () => {
    const sendErr = ext.runtime && ext.runtime.lastError;
    if (sendErr && ext.scripting && ext.scripting.executeScript) {
      if (ext.scripting.insertCSS) {
        ext.scripting.insertCSS({ target: { tabId }, files: ['content.css'] }, () => {
          void ext.runtime.lastError;
        });
      }
      ext.scripting.executeScript({ target: { tabId }, files: ['content.js'] }, () => {
        if (ext.runtime && ext.runtime.lastError) return;
        setTimeout(() => {
          ext.tabs.sendMessage(tabId, payload, () => {
            void ext.runtime.lastError;
          });
        }, 120);
      });
    }
  });
}

function ensureHeartbeatAlarm() {
  ext.alarms.create(TICK_ALARM_NAME, { periodInMinutes: 0.5 });
}

ext.runtime.onInstalled.addListener(async () => {
  const data = await getStorage(['trackedSites', 'siteHistory', 'alertSettings']);
  if (!data.trackedSites) {
    await setStorage({ trackedSites: {}, pendingTimeUpAlerts: {} });
  } else {
    const cleaned = {};
    Object.keys(data.trackedSites).forEach((k) => {
      const normKey = normalizeDomain(k);
      if (normKey && data.trackedSites[k] && data.trackedSites[k].remainingSeconds > 0) {
        cleaned[normKey] = {
          ...data.trackedSites[k],
          domain: normKey,
        };
      }
    });
    await setStorage({ trackedSites: cleaned, pendingTimeUpAlerts: {} });
  }
  if (!Array.isArray(data.siteHistory)) {
    await setStorage({ siteHistory: [] });
  }
  if (!data.alertSettings) {
    await setStorage({
      alertSettings: {
        gifUrl: DEFAULT_GIF_URL,
        headline: DEFAULT_HEADLINE,
      },
    });
  }
  ensureHeartbeatAlarm();
});

ext.runtime.onStartup.addListener(() => {
  lastTickTimestamp = Date.now();
  ensureHeartbeatAlarm();
});

async function pauseAllCountingOnWindowBlur() {
  const {
    trackedSites = {},
    activeCountingDomains = [],
    windowUnfocused = false,
  } = await getStorage(['trackedSites', 'activeCountingDomains', 'windowUnfocused']);
  let modified = false;
  for (const key of Object.keys(trackedSites)) {
    if (trackedSites[key] && trackedSites[key].isActivelyCounting) {
      trackedSites[key].isActivelyCounting = false;
      modified = true;
    }
  }
  const needsMetaUpdate = !windowUnfocused || activeCountingDomains.length > 0;
  if (modified) {
    await setStorage({ trackedSites, activeCountingDomains: [], windowUnfocused: true });
  } else if (needsMetaUpdate) {
    await setStorage({ activeCountingDomains: [], windowUnfocused: true });
  }
}

if (ext.windows && ext.windows.onFocusChanged) {
  ext.windows.onFocusChanged.addListener((windowId) => {
    const now = Date.now();
    const isPopupOpen = now - lastPopupHeartbeatAt < 1800;
    if (windowId === ext.windows.WINDOW_ID_NONE && !isPopupOpen) {
      pauseAllCountingOnWindowBlur();
    } else {
      lastTickTimestamp = Date.now();
      evaluateActiveTabTick();
    }
  });
}

async function evaluateActiveTabTick(fallbackDomainFromHeartbeat, extraActiveDomains) {
  if (isTickRunning) return;
  isTickRunning = true;

  try {
    const now = Date.now();
    const isPopupOpen = now - lastPopupHeartbeatAt < 1800;
    const isBrowserFocused = (await checkIsBrowserWindowFocused()) || isPopupOpen;

    // If the user is in another OS window outside the browser, pause counting and reset tick timestamp
    if (!isBrowserFocused) {
      lastTickTimestamp = now;
      await pauseAllCountingOnWindowBlur();
      return;
    }

    const shouldDecrementTime = now - lastTickTimestamp >= 850;
    const elapsedSeconds = shouldDecrementTime
      ? Math.max(1, Math.min(5, Math.round((now - lastTickTimestamp) / 1000)))
      : 0;
    if (shouldDecrementTime) {
      lastTickTimestamp = now;
    }

    const {
      trackedSites = {},
      siteHistory = [],
      alertSettings = {},
      pendingTimeUpAlerts = {},
      activeCountingDomains: prevCountingDomains = [],
      windowUnfocused: prevWindowUnfocused = false,
    } = await getStorage([
      'trackedSites',
      'siteHistory',
      'alertSettings',
      'pendingTimeUpAlerts',
      'activeCountingDomains',
      'windowUnfocused',
    ]);

    // Clean up any expired ephemeral pending alerts
    let pendingAlertsModified = false;
    Object.keys(pendingTimeUpAlerts).forEach((k) => {
      if (!pendingTimeUpAlerts[k] || now > pendingTimeUpAlerts[k].expiresAt) {
        delete pendingTimeUpAlerts[k];
        pendingAlertsModified = true;
      }
    });

    const domains = Object.keys(trackedSites);
    if (domains.length === 0) {
      const metaChanged =
        prevWindowUnfocused !== false ||
        !areStringArraysEqual(prevCountingDomains, []) ||
        pendingAlertsModified;
      if (metaChanged) {
        const updates = { activeCountingDomains: [], windowUnfocused: false };
        if (pendingAlertsModified) {
          updates.pendingTimeUpAlerts = pendingTimeUpAlerts;
        }
        await setStorage(updates);
      }
      return;
    }

    const tabs = await queryTabsAsync({ active: true });
    const activeDomainsSet = new Set();

    tabs.forEach((t) => {
      const rawUrl = (t && (t.url || t.pendingUrl)) || '';
      const d = normalizeDomain(rawUrl);
      if (d) {
        activeDomainsSet.add(d);
      }
    });

    const fallbackNorm = normalizeDomain(fallbackDomainFromHeartbeat || '');
    if (fallbackNorm) {
      activeDomainsSet.add(fallbackNorm);
    }

    if (Array.isArray(extraActiveDomains)) {
      extraActiveDomains.forEach((raw) => {
        const d = normalizeDomain(raw);
        if (d) activeDomainsSet.add(d);
      });
    }

    const currentlyCountingDomains = [];
    let storageModified = pendingAlertsModified;
    let updatedHistory = Array.isArray(siteHistory) ? [...siteHistory] : [];

    for (const domainKey of domains) {
      const siteEntry = trackedSites[domainKey];
      const normKey = normalizeDomain(domainKey);
      if (!siteEntry || !normKey || siteEntry.remainingSeconds <= 0) {
        delete trackedSites[domainKey];
        storageModified = true;
        continue;
      }

      // O(1) normalized domain lookup
      const isTabActiveForSite = activeDomainsSet.has(normKey);
      const nextIsCounting = Boolean(
        isTabActiveForSite && !siteEntry.paused && siteEntry.remainingSeconds > 0
      );

      if (siteEntry.isActivelyCounting !== nextIsCounting) {
        siteEntry.isActivelyCounting = nextIsCounting;
        storageModified = true;
      }

      if (nextIsCounting && shouldDecrementTime && siteEntry.remainingSeconds > 0) {
        siteEntry.remainingSeconds = Math.max(0, siteEntry.remainingSeconds - elapsedSeconds);
        siteEntry.lastUpdatedAt = now;
        storageModified = true;
      }

      if (siteEntry.remainingSeconds === 0) {
        const completedEntry = {
          id: `${normKey}-done-${now}`,
          domain: normKey,
          durationSeconds: siteEntry.limitSeconds,
          action: 'Completed',
          timestamp: now,
        };
        updatedHistory = [completedEntry, ...updatedHistory].slice(0, 30);

        // Automatically delete the site from Tracked Websites so revisiting the tab later won't re-trigger the alert
        delete trackedSites[domainKey];
        storageModified = true;

        const resolvedGif = resolveBundledGifUrl(alertSettings.gifUrl);
        const resolvedHeadline =
          typeof alertSettings.headline === 'string' && alertSettings.headline.trim()
            ? alertSettings.headline.trim().slice(0, 140)
            : DEFAULT_HEADLINE;

        // Store a short-lived 4.5s one-time pending alert in case Chrome content.js wakes via storage.onChanged
        pendingTimeUpAlerts[normKey] = {
          domain: normKey,
          gifUrl: resolvedGif,
          headline: resolvedHeadline,
          expiresAt: now + 4500,
        };

        const alertPayload = {
          type: 'GOOD_BOY_TIME_UP',
          domain: normKey,
          gifUrl: resolvedGif,
          headline: resolvedHeadline,
        };

        queryTabsAsync({}).then((allTabs) => {
          allTabs.forEach((t) => {
            const td = normalizeDomain((t && (t.url || t.pendingUrl)) || '');
            if (t && t.id && td === normKey) {
              deliverTimeUpAlertToTab(t.id, alertPayload);
            }
          });
        });
      } else if (nextIsCounting) {
        currentlyCountingDomains.push(normKey);
      }
    }

    if (storageModified) {
      await setStorage({
        trackedSites,
        siteHistory: updatedHistory,
        pendingTimeUpAlerts,
        activeCountingDomains: currentlyCountingDomains,
        windowUnfocused: false,
      });
    } else if (
      prevWindowUnfocused !== false ||
      !areStringArraysEqual(prevCountingDomains, currentlyCountingDomains)
    ) {
      await setStorage({
        activeCountingDomains: currentlyCountingDomains,
        windowUnfocused: false,
      });
    }
  } finally {
    isTickRunning = false;
  }
}

setInterval(() => evaluateActiveTabTick(), 1000);

ext.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === TICK_ALARM_NAME) {
    evaluateActiveTabTick();
  }
});

if (ext.tabs && ext.tabs.onActivated) {
  ext.tabs.onActivated.addListener(() => {
    evaluateActiveTabTick();
  });
}

if (ext.tabs && ext.tabs.onUpdated) {
  ext.tabs.onUpdated.addListener((_tabId, changeInfo) => {
    if (changeInfo.status === 'complete' || changeInfo.url) {
      evaluateActiveTabTick();
    }
  });
}

ext.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.type) return false;

  if (message.type === 'GOOD_BOY_CONSUME_TIME_UP') {
    const domain = normalizeDomain(message.domain || '');
    if (domain) {
      getStorage(['pendingTimeUpAlerts']).then(async ({ pendingTimeUpAlerts = {} }) => {
        if (pendingTimeUpAlerts[domain]) {
          delete pendingTimeUpAlerts[domain];
          await setStorage({ pendingTimeUpAlerts });
        }
        sendResponse({ ok: true });
      });
      return true;
    }
    sendResponse({ ok: true });
    return false;
  }

  if (message.type === 'GOOD_BOY_WINDOW_BLUR') {
    const now = Date.now();
    if (now - lastPopupHeartbeatAt >= 1800) {
      checkIsBrowserWindowFocused().then((focused) => {
        if (!focused) {
          pauseAllCountingOnWindowBlur();
        }
      });
    }
    sendResponse({ ok: true });
    return false;
  }

  if (message.type === 'GOOD_BOY_HEARTBEAT_TICK') {
    if (message.fromPopup) {
      lastPopupHeartbeatAt = Date.now();
    }
    const senderUrl = sender.tab && sender.tab.url ? sender.tab.url : message.activeDomain;
    evaluateActiveTabTick(senderUrl, message.activeDomains).then(() => {
      sendResponse({ ok: true });
    });
    return true;
  }

  if (message.type === 'GOOD_BOY_LEAVE_TAB') {
    const domain = normalizeDomain(message.domain || '');
    getStorage(['trackedSites', 'pendingTimeUpAlerts']).then(
      async ({ trackedSites = {}, pendingTimeUpAlerts = {} }) => {
        let changed = false;
        if (domain && trackedSites[domain]) {
          delete trackedSites[domain];
          changed = true;
        }
        if (domain && pendingTimeUpAlerts[domain]) {
          delete pendingTimeUpAlerts[domain];
          changed = true;
        }
        if (changed) {
          await setStorage({ trackedSites, pendingTimeUpAlerts });
        }
      }
    );

    if (sender.tab && sender.tab.id) {
      ext.tabs.remove(sender.tab.id, () => {
        void ext.runtime.lastError;
      });
    } else if (domain) {
      ext.tabs.query({ active: true }, (tabs) => {
        if (!Array.isArray(tabs)) return;
        tabs.forEach((t) => {
          const td = normalizeDomain((t && (t.url || t.pendingUrl)) || '');
          if (t && t.id && doesDomainMatch(td, domain)) {
            ext.tabs.remove(t.id, () => {
              void ext.runtime.lastError;
            });
          }
        });
      });
    }
    sendResponse({ ok: true });
    return true;
  }

  if (message.type === 'GOOD_BOY_SNOOZE_5_MINS') {
    const domain = normalizeDomain(message.domain || '');
    getStorage(['trackedSites', 'siteHistory', 'pendingTimeUpAlerts']).then(
      async ({ trackedSites = {}, siteHistory = [], pendingTimeUpAlerts = {} }) => {
        const now = Date.now();
        if (domain) {
          if (pendingTimeUpAlerts[domain]) {
            delete pendingTimeUpAlerts[domain];
          }
          trackedSites[domain] = {
            domain,
            limitSeconds: 5 * 60,
            remainingSeconds: 5 * 60,
            alertTriggered: false,
            paused: false,
            addedAt: now,
            lastUpdatedAt: now,
            isActivelyCounting: true,
          };

          const snoozeHistory = [
            {
              id: `${domain}-snooze-${now}`,
              domain,
              durationSeconds: 5 * 60,
              action: 'Snoozed',
              timestamp: now,
            },
            ...siteHistory,
          ].slice(0, 30);

          await setStorage({
            trackedSites,
            siteHistory: snoozeHistory,
            pendingTimeUpAlerts,
          });
        }
        sendResponse({ ok: true });
      }
    );
    return true;
  }

  return false;
});