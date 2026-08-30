const $ = (id) => document.getElementById(id);

function runtime(type, payload = {}) {
  return chrome.runtime.sendMessage({ type, ...payload });
}

function setMessage(text, error = false) {
  $('message').textContent = text;
  $('message').style.color = error ? '#b91c1c' : '#374151';
}

function isFacebookUrl(url = '') {
  return /^https:\/\/(www\.)?facebook\.com\//.test(url);
}

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

async function refreshEvents() {
  const r = await runtime('AI_MESSENGER_GET_EVENTS', { limit: 12 });
  const list = $('eventList');
  if (!r?.ok || !Array.isArray(r.data) || !r.data.length) {
    list.innerHTML = '<p>No candidates yet.</p>';
    return;
  }

  list.innerHTML = r.data.map((event) => {
    const p = event.payload || {};
    const direction = p.direction || p.directionCandidate || 'unknown';
    const evidence = p.directionEvidence || 'legacy';
    const sender = p.sender ? ` • ${p.sender}` : '';
    const body = String(p.body || '').slice(0, 260);
    return `<div class="event-item">
      <div class="event-meta"><span>${escapeHtml(direction)}</span><span>${escapeHtml(evidence)}</span></div>
      <div class="event-body"><b>${escapeHtml(sender ? sender.slice(3) : '')}</b>${sender ? '<br>' : ''}${escapeHtml(body)}</div>
    </div>`;
  }).join('');
}

async function refresh() {
  const r = await runtime('AI_MESSENGER_GET_STATE');
  if (!r?.ok) {
    $('status').textContent = 'Error';
    return setMessage(r?.error || 'Could not read extension state.', true);
  }

  $('status').textContent = r.data.enabled ? 'Enabled' : 'Paused';
  $('lastEvent').textContent = r.data.lastEventAt
    ? new Date(r.data.lastEventAt).toLocaleString()
    : 'None yet.';
  await refreshEvents();
}

async function ensureBridge(tabId) {
  let ping = await chrome.tabs.sendMessage(tabId, { type: 'AI_MESSENGER_PING' }).catch(() => null);
  if (ping?.ok && ping.bridgeVersion === '0.4.0') return { ok: true, injected: false, ping };

  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content-messenger.js']
    });
  } catch (err) {
    return { ok: false, error: err?.message || 'Could not inject Messenger bridge.' };
  }

  ping = await chrome.tabs.sendMessage(tabId, { type: 'AI_MESSENGER_PING' }).catch(() => null);
  if (!ping?.ok) return { ok: false, error: 'Messenger bridge did not respond after injection.' };
  return { ok: true, injected: true, ping };
}

$('scanBtn').onclick = async () => {
  setMessage('Connecting to Facebook Messenger…');
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!tab?.id || !isFacebookUrl(tab.url || '')) {
    return setMessage('Open Facebook or a Facebook Messenger conversation first.', true);
  }

  const bridge = await ensureBridge(tab.id);
  if (!bridge.ok) {
    return setMessage(`Bridge error: ${bridge.error}`, true);
  }

  const r = await chrome.tabs.sendMessage(tab.id, { type: 'AI_MESSENGER_SCAN_NOW' }).catch(() => null);
  if (!r?.ok) return setMessage('Bridge connected but scan failed. Reload Facebook and try again.', true);

  const modes = (r.diagnostics || []).map((d) => d.mode).join(', ') || 'none';
  const s = r.summary || {};
  setMessage(`Bridge ${r.bridgeVersion} connected. ${r.surfaceCount} chat surface(s), ${r.count} candidates. Confirmed: ${s.inbound || 0} inbound / ${s.outbound || 0} outbound. Heuristic-only: ${s.inbound_candidate || 0} inbound / ${s.outbound_candidate || 0} outbound. Mode: ${modes}.`);
  await refresh();
};

$('clearBtn').onclick = async () => {
  await runtime('AI_MESSENGER_CLEAR_EVENTS');
  await refreshEvents();
  setMessage('Detection list cleared. Scan again for a clean test.');
};

refresh();
