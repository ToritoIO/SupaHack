const MAX_REQUESTS = 50;
const INTERESTING_HEADERS = ["authorization", "apikey", "api-key", "x-client-info", "x-apikey"];

const dom = {
  status: document.getElementById("status"),
  list: document.getElementById("request-list"),
  clearBtn: document.getElementById("clear-btn"),
  template: document.getElementById("request-template"),
};

const state = {
  requests: [],
};

function generateId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `req_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
}

function setStatus(message) {
  dom.status.textContent = message;
}

function normalizeHeaders(headers) {
  const list = Array.isArray(headers) ? headers : [];
  const map = {};
  const normalized = [];
  list.forEach((header) => {
    const name = header?.name || header?.Name;
    if (!name) return;
    const value = header?.value ?? header?.Value ?? "";
    map[name.toLowerCase()] = value;
    normalized.push({ name, value });
  });
  return { list: normalized, map };
}

function createEntry(request) {
  const { list, map } = normalizeHeaders(request.request?.headers);
  return {
    id: request._requestId || request.requestId || generateId(),
    method: request.request?.method || "GET",
    url: request.request?.url || "",
    status: request.response?.status || 0,
    statusText: request.response?.statusText || "",
    startedDateTime: request.startedDateTime || new Date().toISOString(),
    time: request.time || 0,
    initiator: request.initiator?.type || "unknown",
    headers: list,
    headerMap: map,
    requestId: request._requestId || request.requestId || null,
    tabId: chrome.devtools.inspectedWindow.tabId,
  };
}

function shouldCapture(request) {
  const url = request.request?.url;
  if (!url) return false;
  try {
    const { hostname } = new URL(url);
    return hostname.includes(".supabase.co");
  } catch (error) {
    return false;
  }
}

function renderRequests() {
  dom.list.innerHTML = "";
  if (!state.requests.length) {
    setStatus("Requests will appear as the inspected page talks to Supabase.");
    return;
  }

  setStatus(`${state.requests.length} request${state.requests.length === 1 ? "" : "s"} captured for this DevTools session.`);

  state.requests.forEach((entry) => {
    const fragment = dom.template.content.cloneNode(true);
    const card = fragment.querySelector(".request-card");
    const methodEl = fragment.querySelector(".request-method");
    const urlEl = fragment.querySelector(".request-url");
    const metaEl = fragment.querySelector(".request-meta");
    const headerListEl = fragment.querySelector(".header-list");
    const sendBtn = fragment.querySelector(".send-btn");

    methodEl.textContent = entry.method;
    urlEl.textContent = entry.url;
    metaEl.textContent = [
      entry.status ? `${entry.status} ${entry.statusText}`.trim() : "No response status",
      `Initiator: ${entry.initiator}`,
    ].join(" • ");

    const interesting = entry.headers.filter((header) =>
      INTERESTING_HEADERS.includes((header.name || "").toLowerCase())
    );

    if (interesting.length) {
      interesting.forEach((header) => {
        const row = document.createElement("div");
        row.className = "header-row";
        const nameEl = document.createElement("span");
        nameEl.className = "header-name";
        nameEl.textContent = header.name;
        const valueEl = document.createElement("span");
        valueEl.className = "header-value";
        valueEl.textContent = header.value;
        row.appendChild(nameEl);
        row.appendChild(valueEl);
        headerListEl.appendChild(row);
      });
    } else {
      const empty = document.createElement("div");
      empty.className = "header-row";
      empty.textContent = "No auth headers detected.";
      headerListEl.appendChild(empty);
    }

    sendBtn.addEventListener("click", () => sendEntry(entry, card));

    dom.list.appendChild(fragment);
  });
}

function sendEntry(entry, card) {
  const payload = {
    url: entry.url,
    method: entry.method,
    status: entry.status,
    statusText: entry.statusText,
    headers: entry.headers,
    headerMap: entry.headerMap,
    initiator: entry.initiator,
    tabId: entry.tabId,
    requestId: entry.requestId,
  };

  card.classList.add("sending");
  setStatus("Sending captured request to SupaHack…");

  chrome.runtime.sendMessage({ type: "SUPAHACK_CAPTURED_REQUEST", payload }, (response) => {
    card.classList.remove("sending");
    const lastError = chrome.runtime.lastError;
    if (lastError) {
      setStatus(`Failed to send: ${lastError.message}`);
      return;
    }
    if (!response?.ok) {
      setStatus(`Extension rejected request: ${response?.reason || "Unknown error"}`);
      return;
    }
    setStatus("Request sent. Check the SupaHack side panel.");
  });
}

function handleRequestFinished(request) {
  if (!shouldCapture(request)) {
    return;
  }
  const entry = createEntry(request);
  state.requests.unshift(entry);
  if (state.requests.length > MAX_REQUESTS) {
    state.requests.length = MAX_REQUESTS;
  }
  renderRequests();
}

dom.clearBtn.addEventListener("click", () => {
  state.requests = [];
  renderRequests();
});

renderRequests();
chrome.devtools.network.onRequestFinished.addListener(handleRequestFinished);
