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
    await chrome.sidePanel.setOptions({
      tabId: tab.id,
      path: "sidepanel.html",
    });
    await chrome.sidePanel.open({ tabId: tab.id });
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
  }
});
