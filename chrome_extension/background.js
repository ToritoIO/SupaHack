const CONNECTION_STORAGE_KEY = "supahack_connection";
const CONNECTION_META_KEY = "supahack_connection_meta";
const DETECTOR_SOURCE = "detector";
const PANEL_OPEN_COOLDOWN_MS = 5000;

const tabDetectionCache = new Map();
const panelOpenTimestamps = new Map();
const SHOW_BUBBLE_MESSAGE = "SUPAEXPLORER_SHOW_BUBBLE";
const HIDE_BUBBLE_MESSAGE = "SUPAEXPLORER_HIDE_BUBBLE";

const cleanApiKey = (raw) => {
  if (!raw || typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  return trimmed.startsWith("Bearer ") ? trimmed.slice(7).trim() : trimmed;
};

const extractProjectIdFromUrl = (url) => {
  if (!url) return null;
  try {
    const { hostname } = new URL(url);
    const match = hostname.match(/^([^.]+)\.supabase\.co$/i);
    return match ? match[1] : null;
  } catch (error) {
    return null;
  }
};

const decodeProjectRefFromKey = (apiKey) => {
  if (!apiKey || typeof apiKey !== "string") return null;
  const parts = apiKey.split(".");
  if (parts.length < 2) return null;
  try {
    let payloadPart = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const pad = payloadPart.length % 4;
    if (pad) {
      payloadPart += "=".repeat(4 - pad);
    }
    const payloadRaw = atob(payloadPart);
    const payload = JSON.parse(payloadRaw);
    return (
      payload?.ref ||
      (typeof payload?.sub === "string" ? payload.sub.split(":")[0] : null) ||
      (typeof payload?.iss === "string" ? payload.iss.split("/")[3] : null)
    );
  } catch (error) {
    return null;
  }
};

const determineProjectId = (url, apiKey) => {
  return extractProjectIdFromUrl(url) || decodeProjectRefFromKey(apiKey);
};

const normalizeSchema = (schema) => {
  if (!schema || typeof schema !== "string") return "public";
  const trimmed = schema.trim();
  return trimmed || "public";
};

const detectionCacheKey = (tabId) => (tabId !== undefined && tabId >= 0 ? `tab:${tabId}` : "global");

const isSupabaseUrl = (url) => {
  if (!url || typeof url !== "string") return false;
  try {
    const { hostname } = new URL(url);
    return hostname.includes(".supabase.co");
  } catch (error) {
    return url.includes(".supabase.co");
  }
};

async function handleSupabaseDetection({ tabId, url, apiKey, schema }) {
  const cleanKey = cleanApiKey(apiKey);
  if (!cleanKey) return;

  const projectId = determineProjectId(url, cleanKey);
  if (!projectId) return;

  const normalizedSchema = normalizeSchema(schema);
  const cacheKey = detectionCacheKey(tabId);
  const previous = tabDetectionCache.get(cacheKey);
  if (
    previous &&
    previous.projectId === projectId &&
    previous.apiKey === cleanKey &&
    previous.schema === normalizedSchema
  ) {
    return;
  }

  tabDetectionCache.set(cacheKey, {
    projectId,
    apiKey: cleanKey,
    schema: normalizedSchema,
    timestamp: Date.now(),
  });

  const stored = await chrome.storage.local.get([CONNECTION_STORAGE_KEY]);
  const current = stored?.[CONNECTION_STORAGE_KEY];

  const connection = {
    projectId,
    schema: normalizedSchema,
    apiKey: cleanKey,
    bearer: cleanKey,
  };

  const isSameConnection =
    current &&
    current.projectId === connection.projectId &&
    current.apiKey === connection.apiKey &&
    normalizeSchema(current.schema) === connection.schema;

  const metaPayload = {
    source: DETECTOR_SOURCE,
    updatedAt: Date.now(),
    tabId: tabId !== undefined && tabId >= 0 ? tabId : undefined,
  };

  notifyBubble(tabId, true);

  if (isSameConnection) {
    await chrome.storage.local.set({ [CONNECTION_META_KEY]: metaPayload });
    return;
  }

  await chrome.storage.local.set({
    [CONNECTION_STORAGE_KEY]: connection,
    [CONNECTION_META_KEY]: metaPayload,
  });

  if (tabId !== undefined && tabId >= 0) {
    openSidePanelForTab(tabId).catch(() => {});
  }
}

async function clearTabDetection(tabId) {
  if (tabId === undefined || tabId < 0) return;
  const cacheKey = detectionCacheKey(tabId);
  tabDetectionCache.delete(cacheKey);

  notifyBubble(tabId, false);

  const stored = await chrome.storage.local.get([CONNECTION_STORAGE_KEY, CONNECTION_META_KEY]);
  const meta = stored?.[CONNECTION_META_KEY];
  const connection = stored?.[CONNECTION_STORAGE_KEY];

  if (!meta || meta.source !== DETECTOR_SOURCE || meta.tabId !== tabId) {
    return;
  }

  if (!connection) {
    await chrome.storage.local.set({
      [CONNECTION_META_KEY]: { source: DETECTOR_SOURCE, updatedAt: Date.now(), tabId, cleared: true },
    });
    return;
  }

  await chrome.storage.local.set({
    [CONNECTION_STORAGE_KEY]: null,
    [CONNECTION_META_KEY]: { source: DETECTOR_SOURCE, updatedAt: Date.now(), tabId, cleared: true },
  });
}

async function openSidePanelForTab(tabId, { force = false } = {}) {
  const now = Date.now();
  const lastOpened = panelOpenTimestamps.get(tabId) || 0;
  if (!force && now - lastOpened < PANEL_OPEN_COOLDOWN_MS) {
    return;
  }
  panelOpenTimestamps.set(tabId, now);
  try {
    await chrome.sidePanel.setOptions({ tabId, path: "sidepanel.html" });
    await chrome.sidePanel.open({ tabId });
  } catch (error) {
    if (error?.message?.toLowerCase().includes("user gesture")) {
      panelOpenTimestamps.delete(tabId);
    }
  }
}

chrome.runtime.onInstalled.addListener(async () => {
  try {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  } catch (error) {
    console.error("Failed to configure side panel behavior:", error);
  }
});

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id) return;

  try {
    await openSidePanelForTab(tab.id, { force: true });
  } catch (error) {
    console.error("Failed to open side panel:", error);
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "SUPAHACK_OPEN_EXPLORER") {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];

      if (!tab?.id) {
        sendResponse({ ok: false, reason: "No active tab found." });
        return;
      }

      if (tab.url?.startsWith("chrome://") || tab.url?.startsWith("edge://") || tab.url?.startsWith("about:")) {
        sendResponse({ ok: false, reason: "Cannot open overlay on browser chrome pages." });
        return;
      }

      const trySendOverlay = () => new Promise((resolve, reject) => {
        chrome.tabs.sendMessage(tab.id, { type: "SUPAHACK_OPEN_OVERLAY" }, () => {
          if (chrome.runtime.lastError) {
            reject(chrome.runtime.lastError);
          } else {
            resolve(true);
          }
        });
      });

      trySendOverlay()
        .then(() => sendResponse({ ok: true }))
        .catch((error) => {
          chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] })
            .then(() => trySendOverlay()
              .then(() => sendResponse({ ok: true }))
              .catch((err) => sendResponse({ ok: false, reason: err?.message || "Failed to open overlay." })))
            .catch((injectErr) => sendResponse({ ok: false, reason: injectErr?.message || "Failed to inject overlay script." }));
        });
    });
    return true;
  }

  if (message?.type === "SUPAHACK_CLOSE_OVERLAY") {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      if (tab?.id) {
        chrome.tabs.sendMessage(tab.id, { type: "SUPAHACK_CLOSE_OVERLAY" }, () => {
          if (chrome.runtime.lastError) {
            // Ignore missing content script
          }
        });
      }
    });
    return;
  }

  if (message?.type === "SUPAHACK_SUPABASE_REQUEST") {
    const tabId = sender?.tab?.id;
    handleSupabaseDetection({
      tabId,
      url: message.url,
      apiKey: message.apiKey,
      schema: message.schema,
    })
      .then(() => sendResponse?.({ ok: true }))
      .catch((error) => sendResponse?.({ ok: false, reason: error?.message || "Detection failed." }));
    return true;
  }

  if (message?.type === "SUPAHACK_APPLY_CONNECTION" && message?.payload) {
    const payload = {
      projectId: message.payload.projectId || "",
      schema: message.payload.schema || "public",
      apiKey: message.payload.apiKey || "",
      bearer: message.payload.bearer || message.payload.apiKey || "",
    };

    chrome.storage.local.set({
      [CONNECTION_STORAGE_KEY]: payload,
      [CONNECTION_META_KEY]: { source: "devtools", updatedAt: Date.now() },
    }, () => {
      if (chrome.runtime.lastError) {
        sendResponse?.({ ok: false, reason: chrome.runtime.lastError.message });
        return;
      }
      sendResponse?.({ ok: true });
    });
    return true;
  }

  if (message?.type === "SUPAEXPLORER_OPEN_SIDE_PANEL") {
    const targetTabId = message.tabId ?? sender?.tab?.id;
    if (!targetTabId) {
      sendResponse?.({ ok: false, reason: "No tabId provided for side panel request." });
      return;
    }

    openSidePanelForTab(targetTabId, { force: true })
      .then(() => sendResponse?.({ ok: true }))
      .catch((error) => sendResponse?.({ ok: false, reason: error?.message || "Failed to open side panel." }));
    return true;
  }
});

chrome.webRequest.onBeforeSendHeaders.addListener(
  (details) => {
    const headers = details.requestHeaders || [];
    let apiKey;
    let schema;
    for (const header of headers) {
      const name = header?.name?.toLowerCase();
      if (!name) continue;
      if (name === "apikey" || name === "authorization") {
        apiKey = header?.value;
      } else if (name === "accept-profile") {
        schema = header?.value;
      }
    }
    if (apiKey) {
      handleSupabaseDetection({
        tabId: details.tabId,
        url: details.url,
        apiKey,
        schema,
      }).catch(() => {});
    }
  },
  { urls: ["https://*.supabase.co/*"] },
  ["requestHeaders", "extraHeaders"]
);

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  const url = changeInfo?.url || tab?.url;
  if (!url) return;
  if (isSupabaseUrl(url)) {
    return;
  }
  clearTabDetection(tabId).catch(() => {});
});

chrome.tabs.onRemoved.addListener((tabId) => {
  panelOpenTimestamps.delete(tabId);
  clearTabDetection(tabId).catch(() => {});
});

function notifyBubble(tabId, shouldShow) {
  if (tabId === undefined || tabId < 0) return;
  chrome.tabs.sendMessage(tabId, { type: shouldShow ? SHOW_BUBBLE_MESSAGE : HIDE_BUBBLE_MESSAGE }, () => {
    const err = chrome.runtime.lastError;
    if (err) {
      // Ignore missing content scripts; they may not be injected yet.
    }
  });
}
