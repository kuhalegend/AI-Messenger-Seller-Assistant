(() => {
  if (globalThis.__AI_MESSENGER_BRIDGE_V02__) return;
  globalThis.__AI_MESSENGER_BRIDGE_V02__ = true;

  const SEEN = new Set();
  const MAX_SEEN = 1000;

  function textOf(el) {
    return String(el?.innerText || el?.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function isVisible(el) {
    if (!el || !(el instanceof Element)) return false;
    const r = el.getBoundingClientRect();
    const st = getComputedStyle(el);
    return r.width > 1 && r.height > 1 && st.display !== 'none' && st.visibility !== 'hidden';
  }

  function getParticipantName(root = document) {
    const candidates = [
      'h2',
      'h1',
      '[role="heading"]'
    ];
    for (const sel of candidates) {
      const el = [...root.querySelectorAll(sel)].find(isVisible);
      const t = textOf(el);
      if (t && t.length < 120) return t;
    }
    return null;
  }

  function getSurfaces() {
    const surfaces = [];
    const path = location.pathname;

    if (path.startsWith('/messages/')) {
      const root = document.querySelector('[role="main"]') || document.querySelector('main') || document.body;
      surfaces.push({ root, mode: 'full_messenger' });
    }

    for (const dialog of document.querySelectorAll('[role="dialog"]')) {
      if (!isVisible(dialog)) continue;
      const hasComposer = dialog.querySelector('[contenteditable="true"], textarea, input[type="text"]');
      if (hasComposer) surfaces.push({ root: dialog, mode: 'floating_chat' });
    }

    const unique = [];
    const seenRoots = new Set();
    for (const surface of surfaces) {
      if (!surface.root || seenRoots.has(surface.root)) continue;
      seenRoots.add(surface.root);
      unique.push(surface);
    }
    return unique;
  }

  function getThreadKey(surface) {
    const url = new URL(location.href);
    const parts = url.pathname.split('/').filter(Boolean);
    const idx = parts.indexOf('t');
    if (idx >= 0 && parts[idx + 1]) return `thread:${parts[idx + 1]}`;

    const name = getParticipantName(surface?.root || document);
    return name ? `floating:${name}` : `page:${url.pathname}`;
  }

  const MESSAGE_SELECTORS = [
    '[data-scope="messages_table"] [role="row"]',
    '[role="row"]',
    '[aria-label*="message" i]',
    '[data-testid*="message" i]'
  ];

  function candidatesForSurface(surface) {
    const found = [];
    const selectorCounts = {};

    for (const sel of MESSAGE_SELECTORS) {
      let count = 0;
      for (const el of surface.root.querySelectorAll(sel)) {
        if (!isVisible(el)) continue;
        const body = textOf(el);
        if (!body || body.length > 5000) continue;
        found.push(el);
        count += 1;
      }
      selectorCounts[sel] = count;
    }

    return { elements: [...new Set(found)], selectorCounts };
  }

  function inferDirection(el, surface) {
    const aria = String(el.getAttribute('aria-label') || '').toLowerCase();
    if (/you sent|sent by you|your message/.test(aria)) return 'outbound';

    const rect = el.getBoundingClientRect();
    const parentRect = (surface?.root || document.body).getBoundingClientRect();
    const center = rect.left + rect.width / 2;
    const parentCenter = parentRect.left + parentRect.width / 2;
    return center > parentCenter ? 'outbound_candidate' : 'inbound_candidate';
  }

  function fingerprint(surface, el, body) {
    const rect = el.getBoundingClientRect();
    return [getThreadKey(surface), body, Math.round(rect.top), Math.round(rect.left)].join('|');
  }

  async function emitCandidate(surface, el) {
    const body = textOf(el);
    if (!body) return;

    const fp = fingerprint(surface, el, body);
    if (SEEN.has(fp)) return;

    SEEN.add(fp);
    if (SEEN.size > MAX_SEEN) {
      const first = SEEN.values().next().value;
      SEEN.delete(first);
    }

    await chrome.runtime.sendMessage({
      type: 'AI_MESSENGER_DETECTED_EVENT',
      payload: {
        eventType: 'message_candidate',
        surfaceMode: surface.mode,
        threadKey: getThreadKey(surface),
        participantName: getParticipantName(surface.root),
        body,
        directionCandidate: inferDirection(el, surface),
        pageUrl: location.href,
        detectedAt: new Date().toISOString()
      }
    }).catch(() => null);
  }

  async function scanNow() {
    const surfaces = getSurfaces();
    let total = 0;
    const diagnostics = [];

    for (const surface of surfaces) {
      const { elements, selectorCounts } = candidatesForSurface(surface);
      total += elements.length;
      diagnostics.push({ mode: surface.mode, candidateCount: elements.length, selectorCounts });
      await Promise.all(elements.map((el) => emitCandidate(surface, el)));
    }

    return {
      ok: true,
      bridgeVersion: '0.2.0',
      pageUrl: location.href,
      surfaceCount: surfaces.length,
      count: total,
      diagnostics
    };
  }

  let scanTimer = null;
  function scheduleScan() {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(() => scanNow(), 300);
  }

  const observer = new MutationObserver(scheduleScan);
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  scheduleScan();

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === 'AI_MESSENGER_PING') {
      sendResponse({ ok: true, bridgeVersion: '0.2.0', pageUrl: location.href });
      return;
    }

    if (message.type === 'AI_MESSENGER_SCAN_NOW') {
      scanNow().then(sendResponse).catch((err) => sendResponse({ ok: false, error: err?.message || 'Scan failed' }));
      return true;
    }
  });
})();
