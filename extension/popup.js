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
}

async function ensureBridge(tabId) {
  let ping = await chrome.tabs.sendMessage(tabId, { type: 'AI_MESSENGER_PING' }).catch(() => null);
  if (ping?.ok) return { ok: true, injected: false, ping };

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
  setMessage(`Bridge ${r.bridgeVersion} connected. ${r.surfaceCount} chat surface(s), ${r.count} candidate message element(s). Mode: ${modes}.`);
  await refresh();
};

refresh();
