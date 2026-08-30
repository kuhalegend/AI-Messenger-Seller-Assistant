const DEFAULT_STATE = {
  enabled: true,
  detectionOnly: true,
  autoReplyEnabled: false,
  lastEventAt: null
};

async function getState() {
  const { aiMessengerState } = await chrome.storage.local.get('aiMessengerState');
  return { ...DEFAULT_STATE, ...(aiMessengerState || {}) };
}

async function setState(patch) {
  const next = { ...(await getState()), ...patch };
  await chrome.storage.local.set({ aiMessengerState: next });
  return next;
}

chrome.runtime.onInstalled.addListener(async () => {
  const current = await getState();
  await chrome.storage.local.set({ aiMessengerState: current });
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    if (message.type === 'AI_MESSENGER_GET_STATE') {
      return { ok: true, data: await getState() };
    }

    if (message.type === 'AI_MESSENGER_GET_EVENTS') {
      const { aiMessengerEventBuffer = [] } = await chrome.storage.local.get('aiMessengerEventBuffer');
      const limit = Math.max(1, Math.min(Number(message.limit || 8), 25));
      return { ok: true, data: aiMessengerEventBuffer.slice(-limit).reverse() };
    }

    if (message.type === 'AI_MESSENGER_CLEAR_EVENTS') {
      await chrome.storage.local.set({ aiMessengerEventBuffer: [] });
      return { ok: true };
    }

    if (message.type === 'AI_MESSENGER_SET_STATE') {
      const allowed = {};
      if (typeof message.patch?.enabled === 'boolean') allowed.enabled = message.patch.enabled;
      if (typeof message.patch?.detectionOnly === 'boolean') allowed.detectionOnly = message.patch.detectionOnly;

      if (message.patch?.autoReplyEnabled === true) {
        throw new Error('Auto reply is locked during the detection-only MVP.');
      }
      if (typeof message.patch?.autoReplyEnabled === 'boolean') allowed.autoReplyEnabled = false;

      return { ok: true, data: await setState(allowed) };
    }

    if (message.type === 'AI_MESSENGER_DETECTED_EVENT') {
      const state = await getState();
      if (!state.enabled) return { ok: true, ignored: true };

      const event = {
        id: crypto.randomUUID(),
        receivedAt: new Date().toISOString(),
        source: 'facebook-messenger',
        payload: message.payload || {}
      };

      const { aiMessengerEventBuffer = [] } = await chrome.storage.local.get('aiMessengerEventBuffer');
      const nextBuffer = [...aiMessengerEventBuffer, event].slice(-100);
      await chrome.storage.local.set({
        aiMessengerEventBuffer: nextBuffer,
        aiMessengerState: { ...state, lastEventAt: event.receivedAt }
      });

      return { ok: true, eventId: event.id, detectionOnly: true };
    }

    return { ok: false, error: 'Unknown message type' };
  })()
    .then((data) => sendResponse(data))
    .catch((err) => sendResponse({ ok: false, error: err?.message || 'Background error' }));

  return true;
});
