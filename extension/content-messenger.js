(() => {
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

  function getThreadKey() {
    const url = new URL(location.href);
    const parts = url.pathname.split('/').filter(Boolean);
    const idx = parts.indexOf('t');
    if (idx >= 0 && parts[idx + 1]) return `thread:${parts[idx + 1]}`;
    return `url:${url.pathname}${url.search}`;
  }

  function getParticipantName() {
    const candidates = [
      'main h2',
      'main h1',
      '[role="main"] h2',
      '[role="main"] h1'
    ];
    for (const sel of candidates) {
      const el = [...document.querySelectorAll(sel)].find(isVisible);
      const t = textOf(el);
      if (t && t.length < 120) return t;
    }
    return null;
  }

  function messageCandidates() {
    const main = document.querySelector('[role="main"]') || document.querySelector('main') || document;
    const selectors = [
      '[role="row"]',
      '[data-scope="messages_table"] [role="row"]',
      '[aria-label*="message" i]',
      '[data-testid*="message" i]'
    ];
    const found = [];
    for (const sel of selectors) {
      for (const el of main.querySelectorAll(sel)) {
        if (!isVisible(el)) continue;
        const body = textOf(el);
        if (!body || body.length > 5000) continue;
        found.push(el);
      }
    }
    return [...new Set(found)];
  }

  function inferDirection(el) {
    const aria = String(el.getAttribute('aria-label') || '').toLowerCase();
    if (/you sent|sent by you|your message/.test(aria)) return 'outbound';

    const style = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    const parentRect = (document.querySelector('[role="main"]') || document.body).getBoundingClientRect();
    const center = rect.left + rect.width / 2;
    const parentCenter = parentRect.left + parentRect.width / 2;

    // Heuristic only. We do not send or classify yet; direction must be proven in live tests.
    if (style.direction === 'rtl') return 'unknown';
    return center > parentCenter ? 'outbound_candidate' : 'inbound_candidate';
  }

  function fingerprint(el, body) {
    const rect = el.getBoundingClientRect();
    return [getThreadKey(), body, Math.round(rect.top), Math.round(rect.left)].join('|');
  }

  async function emitCandidate(el) {
    const body = textOf(el);
    if (!body) return;
    const fp = fingerprint(el, body);
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
        threadKey: getThreadKey(),
        participantName: getParticipantName(),
        body,
        directionCandidate: inferDirection(el),
        pageUrl: location.href,
        detectedAt: new Date().toISOString()
      }
    }).catch(() => null);
  }

  let scanTimer = null;
  function scheduleScan() {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(() => {
      for (const el of messageCandidates()) emitCandidate(el);
    }, 250);
  }

  const observer = new MutationObserver(scheduleScan);
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  scheduleScan();

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === 'AI_MESSENGER_SCAN_NOW') {
      const els = messageCandidates();
      Promise.all(els.map(emitCandidate)).then(() => sendResponse({ ok: true, count: els.length }));
      return true;
    }
  });
})();
