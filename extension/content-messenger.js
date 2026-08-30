(() => {
  if (globalThis.__AI_MESSENGER_BRIDGE_V04__) return;
  globalThis.__AI_MESSENGER_BRIDGE_V04__ = true;

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
    const candidates = ['h2', 'h1', '[role="heading"]'];
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

  function accessibilityStrings(el) {
    const values = [
      textOf(el),
      String(el.getAttribute('aria-label') || '').trim()
    ];

    for (const child of el.querySelectorAll('[aria-label]')) {
      const value = String(child.getAttribute('aria-label') || '').trim();
      if (value && value.length <= 5000) values.push(value);
    }

    return [...new Set(values.filter(Boolean))];
  }

  function parseExplicitMessageLabel(value) {
    const normalized = String(value || '').replace(/\s+/g, ' ').trim();
    const match = normalized.match(/(?:^|\b)Message sent\b.*?\bby\s+([^:]{1,120}):\s*(.+)$/i);
    if (!match) return null;

    const sender = match[1].trim();
    const body = match[2].trim();
    if (!body) return null;

    return {
      sender,
      body,
      direction: /^you$/i.test(sender) ? 'outbound' : 'inbound',
      evidence: 'facebook_accessibility_sender'
    };
  }

  function analyzeCandidate(el, surface) {
    const rawText = textOf(el);

    for (const value of accessibilityStrings(el)) {
      const explicit = parseExplicitMessageLabel(value);
      if (explicit) {
        return {
          ...explicit,
          rawText,
          participantName: getParticipantName(surface.root)
        };
      }
    }

    const rect = el.getBoundingClientRect();
    const parentRect = (surface?.root || document.body).getBoundingClientRect();
    const center = rect.left + rect.width / 2;
    const parentCenter = parentRect.left + parentRect.width / 2;

    return {
      sender: null,
      body: rawText,
      direction: center > parentCenter ? 'outbound_candidate' : 'inbound_candidate',
      evidence: 'layout_heuristic_only',
      rawText,
      participantName: getParticipantName(surface.root)
    };
  }

  function fingerprint(surface, el, analysis) {
    const rect = el.getBoundingClientRect();
    return [
      getThreadKey(surface),
      analysis.direction,
      analysis.sender || '',
      analysis.body,
      Math.round(rect.top),
      Math.round(rect.left)
    ].join('|');
  }

  async function emitCandidate(surface, el) {
    const analysis = analyzeCandidate(el, surface);
    if (!analysis.body) return null;

    const fp = fingerprint(surface, el, analysis);
    if (SEEN.has(fp)) return analysis;

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
        participantName: analysis.participantName,
        sender: analysis.sender,
        body: analysis.body,
        rawText: analysis.rawText,
        direction: analysis.direction,
        directionEvidence: analysis.evidence,
        pageUrl: location.href,
        detectedAt: new Date().toISOString()
      }
    }).catch(() => null);

    return analysis;
  }

  async function scanNow() {
    const surfaces = getSurfaces();
    let total = 0;
    const diagnostics = [];
    const summary = { outbound: 0, inbound: 0, outbound_candidate: 0, inbound_candidate: 0, unknown: 0 };

    for (const surface of surfaces) {
      const { elements, selectorCounts } = candidatesForSurface(surface);
      total += elements.length;
      const analyses = await Promise.all(elements.map((el) => emitCandidate(surface, el)));

      for (const analysis of analyses) {
        if (!analysis) continue;
        if (Object.prototype.hasOwnProperty.call(summary, analysis.direction)) summary[analysis.direction] += 1;
        else summary.unknown += 1;
      }

      diagnostics.push({ mode: surface.mode, candidateCount: elements.length, selectorCounts });
    }

    return {
      ok: true,
      bridgeVersion: '0.4.0',
      pageUrl: location.href,
      surfaceCount: surfaces.length,
      count: total,
      summary,
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
      sendResponse({ ok: true, bridgeVersion: '0.4.0', pageUrl: location.href });
      return;
    }

    if (message.type === 'AI_MESSENGER_SCAN_NOW') {
      scanNow().then(sendResponse).catch((err) => sendResponse({ ok: false, error: err?.message || 'Scan failed' }));
      return true;
    }
  });
})();
