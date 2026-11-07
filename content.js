/**
 * Good boy keeper - In-Page Creative Alert & Real-Time Heartbeat (content.js)
 * Production-Audited:
 * 1. Idempotent initialization guard prevents duplicate intervals if dynamically injected by Chrome fallback.
 * 2. Zero DOM XSS: all dynamic strings (domain, headline, GIF URLs) are rendered via safe DOM APIs and URL protocol validation.
 * 3. Displays "What a good boy" (goodboy.gif) reward screen for 3.5s (3500ms) with clean timer cancellation before closing the tab.
 */
(() => {
  if (window.__GOOD_BOY_KEEPER_INITIALIZED__) return;
  window.__GOOD_BOY_KEEPER_INITIALIZED__ = true;

  const ext = typeof globalThis.browser !== 'undefined' ? globalThis.browser : globalThis.chrome;
  const HOST_ID = 'good-boy-keeper-shadow-host';
  const GOOD_BOY_REWARD_DURATION_MS = 3500; // 3.5 seconds reward display before closing tab

  const DEFAULT_ALERT_GIF_URL =
    ext.runtime && ext.runtime.getURL ? ext.runtime.getURL('alert.gif') : 'alert.gif';
  const GOOD_BOY_REWARD_GIF_URL =
    ext.runtime && ext.runtime.getURL ? ext.runtime.getURL('goodboy.gif') : 'goodboy.gif';
  const SNOOZE_CONFIRM_GIF_URL =
    ext.runtime && ext.runtime.getURL ? ext.runtime.getURL('snooze.gif') : 'snooze.gif';

  const GOOD_BOY_REWARD_HEADLINE = 'What a good boy';
  const SNOOZE_CONFIRM_HEADLINE = 'Wait... Snooze for 5 Mins?';

  let rewardCloseTimer = null;

  function normalizeDomain(rawInput) {
    if (!rawInput || typeof rawInput !== 'string') return '';
    let trimmed = rawInput.trim().toLowerCase();
    if (!trimmed || trimmed.length > 2048) return '';
    if (!/^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(trimmed)) {
      trimmed = 'https://' + trimmed;
    }
    try {
      const parsed = new URL(trimmed);
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

  function resolveBundledAlertGif(rawUrl) {
    if (!rawUrl || typeof rawUrl !== 'string') return DEFAULT_ALERT_GIF_URL;
    const trimmed = rawUrl.trim();
    if (!trimmed) return DEFAULT_ALERT_GIF_URL;
    if (
      trimmed.includes('0uBL9HqP48Nu1DNr7r') ||
      trimmed === 'alert.gif' ||
      trimmed === '/alert.gif'
    ) {
      return DEFAULT_ALERT_GIF_URL;
    }
    if (/^data:image\/(gif|webp|png|jpeg);base64,[a-zA-Z0-9+/=\s]+$/i.test(trimmed)) {
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
    return DEFAULT_ALERT_GIF_URL;
  }

  // Checks for a fresh one-time pending Time's Up alert for this exact normalized domain and consumes it immediately
  function checkStorageForTimeUp() {
    try {
      if (!ext.storage || !ext.storage.local) return;
      ext.storage.local.get(['pendingTimeUpAlerts'], (res) => {
        if (!res || !res.pendingTimeUpAlerts) return;
        const pageDomain = normalizeDomain(window.location.href);
        if (!pageDomain) return;

        const pending = res.pendingTimeUpAlerts[pageDomain];
        if (pending && Date.now() <= pending.expiresAt) {
          delete res.pendingTimeUpAlerts[pageDomain];
          ext.storage.local.set({ pendingTimeUpAlerts: res.pendingTimeUpAlerts });
          showTimeUpModal({
            domain: pageDomain,
            gifUrl: resolveBundledAlertGif(pending.gifUrl),
            headline: pending.headline || "Time's Up! Stop Scrolling!",
          });
        }
      });
    } catch {
      // Ignore if extension context invalidated
    }
  }

  function sendVisibleHeartbeat() {
    checkStorageForTimeUp();
    // Only send active counting heartbeat when page is visible AND the browser window is focused
    if (document.visibilityState === 'visible' && document.hasFocus()) {
      try {
        ext.runtime.sendMessage(
          { type: 'GOOD_BOY_HEARTBEAT_TICK', activeDomain: window.location.href },
          () => {
            void ext.runtime.lastError;
          }
        );
      } catch {
        // Ignore if extension context invalidated
      }
    }
  }

  // Keep MV3 Service Worker awake and active status updated in real time while tab is focused
  setInterval(sendVisibleHeartbeat, 1000);
  document.addEventListener('visibilitychange', sendVisibleHeartbeat);
  window.addEventListener('focus', sendVisibleHeartbeat);
  window.addEventListener('blur', () => {
    try {
      ext.runtime.sendMessage({ type: 'GOOD_BOY_WINDOW_BLUR' }, () => {
        void ext.runtime.lastError;
      });
    } catch {
      // Ignore
    }
  });

  if (ext.storage && ext.storage.onChanged) {
    ext.storage.onChanged.addListener(() => {
      checkStorageForTimeUp();
    });
  }

  checkStorageForTimeUp();

  function clearRewardCloseTimer() {
    if (rewardCloseTimer !== null) {
      clearTimeout(rewardCloseTimer);
      rewardCloseTimer = null;
    }
  }

  function removeExistingModal() {
    clearRewardCloseTimer();
    const existing = document.getElementById(HOST_ID);
    if (existing) {
      existing.remove();
    }
  }

  function setSubtextWithStrongDomain(container, prefixText, domainText, suffixText) {
    if (!container) return;
    container.textContent = '';
    container.appendChild(document.createTextNode(prefixText));
    const strong = document.createElement('strong');
    strong.textContent = domainText;
    container.appendChild(strong);
    container.appendChild(document.createTextNode(suffixText));
  }

  function showTimeUpModal({ domain, gifUrl, headline }) {
    if (document.getElementById(HOST_ID)) return;

    const safeDomain = normalizeDomain(domain || window.location.href) || window.location.hostname || 'this site';

    // Immediately consume any pending alert in background.js so it never re-triggers on future visits
    try {
      ext.runtime.sendMessage({ type: 'GOOD_BOY_CONSUME_TIME_UP', domain: safeDomain }, () => {
        void ext.runtime.lastError;
      });
    } catch {
      // Ignore
    }

    const logoUrl = ext.runtime && ext.runtime.getURL ? ext.runtime.getURL('logo.png') : '';
    const initialGifSrc = resolveBundledAlertGif(gifUrl);
    const initialHeadline =
      typeof headline === 'string' && headline.trim()
        ? headline.trim().slice(0, 140)
        : "Time's Up! Stop Scrolling!";

    const host = document.createElement('div');
    host.id = HOST_ID;
    const shadow = host.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = `
      :host {
        all: initial;
      }
      .gbk-backdrop {
        position: fixed;
        inset: 0;
        width: 100vw;
        height: 100vh;
        background: rgba(11, 13, 19, 0.82);
        backdrop-filter: blur(16px);
        -webkit-backdrop-filter: blur(16px);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 2147483647;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Inter, sans-serif;
        animation: gbkFadeIn 0.28s ease-out forwards;
      }
      .gbk-modal {
        width: min(92vw, 460px);
        background: linear-gradient(160deg, rgba(30, 35, 54, 0.96), rgba(17, 20, 32, 0.99));
        border: 1px solid rgba(255, 255, 255, 0.14);
        border-radius: 24px;
        padding: 28px 24px;
        text-align: center;
        color: #f8fafc;
        box-shadow: 0 25px 60px -15px rgba(0, 0, 0, 0.75);
        animation: gbkBounceIn 0.45s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
        user-select: none;
      }
      .gbk-badge {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 5px 13px;
        border-radius: 999px;
        background: rgba(99, 102, 241, 0.18);
        border: 1px solid rgba(6, 182, 212, 0.4);
        color: #67e8f9;
        font-size: 12px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        margin-bottom: 14px;
      }
      .gbk-badge-logo {
        width: 18px;
        height: 18px;
        border-radius: 50%;
        object-fit: cover;
        border: 1px solid rgba(103, 232, 249, 0.6);
      }
      .gbk-gif-wrap {
        width: 100%;
        min-height: 200px;
        max-height: 280px;
        padding: 8px;
        border-radius: 16px;
        overflow: hidden;
        background: #090b10;
        border: 1px solid rgba(255, 255, 255, 0.1);
        margin-bottom: 18px;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .gbk-gif {
        max-width: 100%;
        max-height: 260px;
        width: auto;
        height: auto;
        object-fit: contain;
        border-radius: 12px;
        display: block;
        margin: 0 auto;
      }
      .gbk-headline {
        font-size: 26px;
        font-weight: 800;
        line-height: 1.2;
        margin: 0 0 10px;
        background: linear-gradient(135deg, #ffffff 0%, #a5f3fc 100%);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
      }
      .gbk-headline.reward {
        background: linear-gradient(135deg, #6ee7b7 0%, #67e8f9 60%, #ffffff 100%);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
      }
      .gbk-subtext {
        font-size: 14px;
        color: #94a3b8;
        margin: 0 0 22px;
        line-height: 1.5;
      }
      .gbk-actions {
        display: flex;
        gap: 12px;
        justify-content: center;
      }
      .gbk-btn {
        flex: 1;
        padding: 13px 16px;
        border-radius: 12px;
        font-size: 14px;
        font-weight: 700;
        cursor: pointer;
        border: none;
        user-select: none;
        transition: transform 0.18s ease, filter 0.18s ease;
      }
      .gbk-btn:hover {
        transform: translateY(-2px);
        filter: brightness(1.08);
      }
      .gbk-btn-leave {
        background: linear-gradient(135deg, #6366f1, #8b5cf6, #06b6d4);
        color: #ffffff;
        box-shadow: 0 8px 20px -6px rgba(99, 102, 241, 0.6);
      }
      .gbk-btn-reward {
        background: linear-gradient(135deg, #10b981, #06b6d4);
        color: #061311;
        box-shadow: 0 8px 20px -6px rgba(16, 185, 129, 0.55);
      }
      .gbk-btn-snooze {
        background: rgba(255, 255, 255, 0.08);
        color: #e2e8f0;
        border: 1px solid rgba(255, 255, 255, 0.15);
      }
      @keyframes gbkFadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
      }
      @keyframes gbkBounceIn {
        0% { opacity: 0; transform: scale(0.82) translateY(24px); }
        100% { opacity: 1; transform: scale(1) translateY(0); }
      }
    `;

    // Safe DOM construction (zero innerHTML interpolation)
    const backdrop = document.createElement('div');
    backdrop.className = 'gbk-backdrop';

    const modalCard = document.createElement('div');
    modalCard.className = 'gbk-modal';
    modalCard.id = 'gbk-modal-card';
    modalCard.setAttribute('role', 'dialog');
    modalCard.setAttribute('aria-modal', 'true');
    modalCard.setAttribute('aria-labelledby', 'gbk-title');

    const badge = document.createElement('span');
    badge.className = 'gbk-badge';
    if (logoUrl) {
      const badgeImg = document.createElement('img');
      badgeImg.src = logoUrl;
      badgeImg.alt = '';
      badgeImg.className = 'gbk-badge-logo';
      badge.appendChild(badgeImg);
    } else {
      badge.appendChild(document.createTextNode('🐶 '));
    }
    const badgeLabel = document.createElement('span');
    badgeLabel.textContent = `Good boy keeper • ${safeDomain}`;
    badge.appendChild(badgeLabel);

    const gifWrap = document.createElement('div');
    gifWrap.className = 'gbk-gif-wrap';
    const modalGif = document.createElement('img');
    modalGif.id = 'gbk-modal-gif';
    modalGif.className = 'gbk-gif';
    modalGif.src = initialGifSrc;
    modalGif.alt = 'Time is up funny alert GIF';
    gifWrap.appendChild(modalGif);

    const modalTitle = document.createElement('h1');
    modalTitle.id = 'gbk-title';
    modalTitle.className = 'gbk-headline';
    modalTitle.textContent = initialHeadline;

    const modalSubtext = document.createElement('p');
    modalSubtext.id = 'gbk-subtext';
    modalSubtext.className = 'gbk-subtext';

    const actionsRow = document.createElement('div');
    actionsRow.id = 'gbk-actions-row';
    actionsRow.className = 'gbk-actions';

    modalCard.appendChild(badge);
    modalCard.appendChild(gifWrap);
    modalCard.appendChild(modalTitle);
    modalCard.appendChild(modalSubtext);
    modalCard.appendChild(actionsRow);
    backdrop.appendChild(modalCard);

    shadow.appendChild(style);
    shadow.appendChild(backdrop);
    (document.documentElement || document.body).appendChild(host);

    modalGif.addEventListener('error', () => {
      if (modalGif.src !== DEFAULT_ALERT_GIF_URL) {
        modalGif.src = DEFAULT_ALERT_GIF_URL;
      }
    });

    function triggerLeaveTabNow() {
      clearRewardCloseTimer();
      try {
        ext.runtime.sendMessage({ type: 'GOOD_BOY_LEAVE_TAB', domain: safeDomain }, () => {
          void ext.runtime.lastError;
        });
      } catch {
        // Ignore
      }
      removeExistingModal();
    }

    function renderInitialAlertView() {
      clearRewardCloseTimer();
      modalGif.src = initialGifSrc;
      modalGif.alt = 'Time is up funny alert GIF';
      modalTitle.textContent = initialHeadline;
      modalTitle.classList.remove('reward');

      setSubtextWithStrongDomain(
        modalSubtext,
        'Your scheduled active time on ',
        safeDomain,
        ' has finished. Be a good boy and step away!'
      );

      actionsRow.textContent = '';
      const leaveBtn = document.createElement('button');
      leaveBtn.type = 'button';
      leaveBtn.id = 'gbk-leave-btn';
      leaveBtn.className = 'gbk-btn gbk-btn-leave';
      leaveBtn.textContent = "Close Tab (I'm Leaving)";
      leaveBtn.addEventListener('click', renderGoodBoyRewardView);

      const snoozeBtn = document.createElement('button');
      snoozeBtn.type = 'button';
      snoozeBtn.id = 'gbk-snooze-btn';
      snoozeBtn.className = 'gbk-btn gbk-btn-snooze';
      snoozeBtn.textContent = 'Snooze for 5 mins';
      snoozeBtn.addEventListener('click', renderSnoozeConfirmView);

      actionsRow.appendChild(leaveBtn);
      actionsRow.appendChild(snoozeBtn);
    }

    function renderGoodBoyRewardView() {
      clearRewardCloseTimer();
      modalGif.src = GOOD_BOY_REWARD_GIF_URL;
      modalGif.alt = GOOD_BOY_REWARD_HEADLINE;
      modalTitle.textContent = GOOD_BOY_REWARD_HEADLINE;
      modalTitle.classList.add('reward');

      setSubtextWithStrongDomain(
        modalSubtext,
        'Closing ',
        safeDomain,
        ' tab now... Proud of you!'
      );

      actionsRow.textContent = '';
      const closeNowBtn = document.createElement('button');
      closeNowBtn.type = 'button';
      closeNowBtn.id = 'gbk-close-now-btn';
      closeNowBtn.className = 'gbk-btn gbk-btn-reward';
      closeNowBtn.textContent = 'Close Tab Now';
      closeNowBtn.addEventListener('click', triggerLeaveTabNow);
      actionsRow.appendChild(closeNowBtn);

      // Display "What a good boy" reward screen for 3.5s (3500ms) before closing the tab
      rewardCloseTimer = setTimeout(triggerLeaveTabNow, GOOD_BOY_REWARD_DURATION_MS);
    }

    function renderSnoozeConfirmView() {
      clearRewardCloseTimer();
      modalGif.src = SNOOZE_CONFIRM_GIF_URL;
      modalGif.alt = 'Snooze confirmation GIF';
      modalTitle.textContent = SNOOZE_CONFIRM_HEADLINE;
      modalTitle.classList.remove('reward');

      setSubtextWithStrongDomain(
        modalSubtext,
        'Are you sure you want to snooze ',
        safeDomain,
        ' for 5 more minutes? Choose to go back or continue:'
      );

      actionsRow.textContent = '';
      const backBtn = document.createElement('button');
      backBtn.type = 'button';
      backBtn.id = 'gbk-snooze-back-btn';
      backBtn.className = 'gbk-btn gbk-btn-leave';
      backBtn.textContent = 'Go Back';
      backBtn.addEventListener('click', renderInitialAlertView);

      const confirmBtn = document.createElement('button');
      confirmBtn.type = 'button';
      confirmBtn.id = 'gbk-snooze-confirm-btn';
      confirmBtn.className = 'gbk-btn gbk-btn-snooze';
      confirmBtn.textContent = 'Continue';
      confirmBtn.addEventListener('click', () => {
        try {
          ext.runtime.sendMessage({ type: 'GOOD_BOY_SNOOZE_5_MINS', domain: safeDomain }, () => {
            void ext.runtime.lastError;
          });
        } catch {
          // Ignore
        }
        removeExistingModal();
      });

      actionsRow.appendChild(backBtn);
      actionsRow.appendChild(confirmBtn);
    }

    renderInitialAlertView();
  }

  ext.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message && message.type === 'GOOD_BOY_TIME_UP') {
      showTimeUpModal({
        domain: normalizeDomain(message.domain || window.location.href) || window.location.hostname,
        gifUrl: message.gifUrl,
        headline: message.headline || "Time's Up! Stop Scrolling!",
      });
      if (typeof sendResponse === 'function') {
        sendResponse({ ok: true });
      }
    }
    return false;
  });
})();