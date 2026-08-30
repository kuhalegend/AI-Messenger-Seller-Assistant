const $ = (id) => document.getElementById(id);

function runtime(type, payload = {}) {
  return chrome.runtime.sendMessage({ type, ...payload });
}

function setMessage(text, error = false) {
  $('message').textContent = text;
  $('message').style.color = error ? '#b91c1c' : '#374151';
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

$('scanBtn').onclick = async () => {
  setMessage('Scanning current Messenger tab…');
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!tab?.id || !/^https:\/\/(www\.)?facebook\.com\/messages\//.test(tab.url || '')) {
    return setMessage('Open a Facebook Messenger conversation first.', true);
  }

  const r = await chrome.tabs.sendMessage(tab.id, { type: 'AI_MESSENGER_SCAN_NOW' }).catch(() => null);
  if (!r?.ok) return setMessage('Could not scan. Reload Messenger and try again.', true);

  setMessage(`Detection scan complete. ${r.count} candidate message element(s) found.`);
  await refresh();
};

refresh();
