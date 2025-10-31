const storageKeys = {
  connection: "supahack_connection",
  selectedTable: "supahack_currentTable",
  theme: "supahack_theme",
};

const state = {
  connection: {
    projectId: "",
    schema: "public",
    apiKey: "",
    bearer: "",
  },
  baseUrl: "",
  openApi: null,
  tables: [],
  tableCounts: {},
  currentTable: null,
  theme: "dark",
};

const dom = {
  connectionForm: document.getElementById("connection-form"),
  projectId: document.getElementById("project-id"),
  schema: document.getElementById("schema"),
  apiKey: document.getElementById("api-key"),
  bearer: document.getElementById("bearer"),
  connectBtn: document.getElementById("connect-btn"),
  clearStorageBtn: document.getElementById("clear-storage-btn"),
  reloadBtn: document.getElementById("reload-btn"),
  exploreBtn: document.getElementById("explore-btn"),
  tablesList: document.getElementById("tables-list"),
  loadCountBtn: document.getElementById("load-count-btn"),
  tableCountLabel: document.getElementById("table-count-label"),
  connectionStatus: document.getElementById("connection-status"),
  themeToggle: document.getElementById("theme-toggle"),
  themeIcon: document.querySelector(".theme-icon"),
};

function sanitize(value) {
  return (value || "").trim();
}

function setStatus(message, type = "idle") {
  const el = dom.connectionStatus;
  el.textContent = message;
  el.classList.remove("status-idle", "status-success", "status-error", "status-progress");
  if (type === "success") el.classList.add("status-success");
  else if (type === "error") el.classList.add("status-error");
  else if (type === "progress") el.classList.add("status-progress");
  else el.classList.add("status-idle");
}

function buildBaseUrl(projectId) {
  const cleanId = sanitize(projectId);
  if (!cleanId) return "";
  return `https://${cleanId}.supabase.co/rest/v1`;
}

function buildHeaders(connection, accept = "application/json") {
  const apiKey = sanitize(connection.apiKey);
  const bearer = sanitize(connection.bearer || connection.apiKey);
  const schema = sanitize(connection.schema || "public");

  return {
    apikey: apiKey,
    authorization: `Bearer ${bearer}`,
    "Accept-Profile": schema,
    accept,
    "cache-control": "no-cache",
  };
}

async function storageGet(key) {
  return new Promise((resolve) => {
    chrome.storage.local.get(key, resolve);
  });
}

async function storageSet(values) {
  return new Promise((resolve) => {
    chrome.storage.local.set(values, resolve);
  });
}

async function storageRemove(key) {
  return new Promise((resolve) => {
    chrome.storage.local.remove(key, resolve);
  });
}

async function fetchOpenApi() {
  const url = `${state.baseUrl.replace(/\/$/, "")}/`;
  const headers = buildHeaders(state.connection, "application/openapi+json;version=3.0");
  const response = await fetch(url, { headers });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenAPI request failed (${response.status}): ${text}`);
  }
  return response.json();
}

function parseTablesFromOpenApi(openApi) {
  const paths = openApi?.paths || {};
  const names = new Set();

  Object.keys(paths).forEach((path) => {
    if (!path.startsWith("/") || path.startsWith("/rpc/")) return;
    const seg = path.split("?")[0].replace(/^\//, "");
    if (!seg || seg.includes("/")) return;
    names.add(seg);
  });

  return Array.from(names).sort();
}

async function getTableRowCount(table) {
  const url = new URL(`${state.baseUrl.replace(/\/$/, "")}/${table}`);
  const headers = buildHeaders(state.connection);
  headers.Prefer = "count=exact";
  url.searchParams.set("select", "id");
  url.searchParams.set("limit", "1");

  const response = await fetch(url.toString(), { headers });
  if (!response.ok) {
    throw new Error(`Count failed (${response.status})`);
  }
  const contentRange = response.headers.get("Content-Range");
  if (contentRange && contentRange.includes("/")) {
    const total = contentRange.split("/").pop();
    if (total && total !== "*") {
      return Number(total);
    }
  }
  return null;
}

function renderTablesList() {
  dom.tablesList.innerHTML = "";
  state.tables.forEach((table) => {
    const option = document.createElement("option");
    option.value = table;
    option.textContent = table;
    dom.tablesList.appendChild(option);
  });

  if (state.currentTable && state.tables.includes(state.currentTable)) {
    dom.tablesList.value = state.currentTable;
  } else if (state.tables.length) {
    state.currentTable = state.tables[0];
    dom.tablesList.value = state.currentTable;
    storageSet({ [storageKeys.selectedTable]: state.currentTable });
  } else {
    state.currentTable = null;
  }

  dom.tablesList.disabled = !state.tables.length;
  dom.exploreBtn.disabled = !state.currentTable;
  dom.loadCountBtn.disabled = !state.currentTable;
  dom.tableCountLabel.textContent = state.currentTable
    ? `Selected: ${state.currentTable}`
    : state.tables.length
      ? "Select a table to load row count."
      : "Connect to populate tables.";
}

async function handleConnect(event) {
  event?.preventDefault();
  const connection = {
    projectId: sanitize(dom.projectId.value),
    schema: sanitize(dom.schema.value) || "public",
    apiKey: sanitize(dom.apiKey.value),
    bearer: sanitize(dom.bearer.value),
  };

  if (!connection.projectId || !connection.apiKey) {
    setStatus("Project ID and apiKey required.", "error");
    return;
  }

  connection.bearer = connection.bearer || connection.apiKey;
  state.connection = connection;
  state.baseUrl = buildBaseUrl(connection.projectId);

  setStatus("Connecting…", "progress");
  dom.connectBtn.disabled = true;
  dom.reloadBtn.disabled = true;

  try {
    state.openApi = await fetchOpenApi();
    state.tables = parseTablesFromOpenApi(state.openApi);
    state.tableCounts = {};
    await storageSet({ [storageKeys.connection]: state.connection });
    renderTablesList();
    setStatus(`Connected (${state.tables.length} tables)`, "success");
  } catch (error) {
    console.error(error);
    setStatus(error.message, "error");
  } finally {
    dom.connectBtn.disabled = false;
    dom.reloadBtn.disabled = false;
  }
}

function handleTableSelection() {
  const option = dom.tablesList.value;
  state.currentTable = option || null;
  dom.exploreBtn.disabled = !state.currentTable;
  dom.loadCountBtn.disabled = !state.currentTable;
  dom.tableCountLabel.textContent = state.currentTable
    ? `Selected: ${state.currentTable}`
    : "Select a table to load row count.";

  if (state.currentTable) {
    storageSet({ [storageKeys.selectedTable]: state.currentTable });
  }
}

async function handleLoadCount() {
  if (!state.currentTable) return;
  dom.loadCountBtn.disabled = true;
  setStatus("Loading row count…", "progress");

  try {
    const count = await getTableRowCount(state.currentTable);
    state.tableCounts[state.currentTable] = count;
    dom.tableCountLabel.textContent = count !== null
      ? `${state.currentTable}: ${count.toLocaleString()} rows`
      : `${state.currentTable}: count unavailable`;
    setStatus("Row count loaded.", "success");
  } catch (error) {
    console.error(error);
    dom.tableCountLabel.textContent = `Count failed: ${error.message}`;
    setStatus(error.message, "error");
  } finally {
    dom.loadCountBtn.disabled = false;
  }
}

async function handleExplore() {
  if (!state.currentTable) {
    setStatus("Select a table first.", "error");
    return;
  }
  await storageSet({ [storageKeys.selectedTable]: state.currentTable });
  setStatus("Opening explorer…", "progress");
  chrome.runtime.sendMessage({ type: "SUPAHACK_OPEN_EXPLORER" }, (response) => {
    const lastErrorMessage = chrome.runtime.lastError?.message || "";
    const isPortClosed = lastErrorMessage.includes("The message port closed before a response was received");

    if (lastErrorMessage && !isPortClosed) {
      setStatus(lastErrorMessage || "Failed to open explorer.", "error");
      return;
    }

    if (!isPortClosed && response && !response.ok) {
      const reason = response.reason || "Unable to open explorer on this page.";
      setStatus(reason, "error");
      return;
    }

    setStatus("Explorer opened in page.", "success");
    setTimeout(() => {
      const message = state.tables.length
        ? `Connected (${state.tables.length} tables)`
        : "Ready";
      setStatus(message, "idle");
    }, 3000);
  });
}

async function restoreFromStorage() {
  try {
    const stored = await storageGet(storageKeys.connection);
    const saved = stored?.[storageKeys.connection];
    if (!saved) {
      setStatus("Idle", "idle");
      return;
    }

    state.connection = {
      projectId: saved.projectId || "",
      schema: saved.schema || "public",
      apiKey: saved.apiKey || "",
      bearer: saved.bearer || saved.apiKey || "",
    };
    dom.projectId.value = state.connection.projectId;
    dom.schema.value = state.connection.schema;
    dom.apiKey.value = state.connection.apiKey;
    dom.bearer.value = state.connection.bearer;

    if (state.connection.projectId && state.connection.apiKey) {
      state.baseUrl = buildBaseUrl(state.connection.projectId);
      setStatus("Restored credentials. Click Connect to refresh tables.", "idle");
    }

    const tableStored = await storageGet(storageKeys.selectedTable);
    state.currentTable = tableStored?.[storageKeys.selectedTable] || null;
    renderTablesList();

    const themeStored = await storageGet(storageKeys.theme);
    const savedTheme = themeStored?.[storageKeys.theme];
    if (savedTheme) {
      setTheme(savedTheme, { persist: false });
    } else {
      setTheme("dark", { persist: false });
    }
  } catch (error) {
    console.error("Storage restore failed", error);
  }
}

async function clearSavedConnection() {
  await storageRemove(storageKeys.connection);
  await storageRemove(storageKeys.selectedTable);

  state.connection = {
    projectId: "",
    schema: "public",
    apiKey: "",
    bearer: "",
  };
  state.baseUrl = "";
  state.tables = [];
  state.tableCounts = {};
  state.currentTable = null;

  dom.projectId.value = "";
  dom.schema.value = "public";
  dom.apiKey.value = "";
  dom.bearer.value = "";
  renderTablesList();
  setStatus("Cleared saved credentials.", "success");
}

function initEventListeners() {
  dom.connectionForm.addEventListener("submit", handleConnect);
  dom.reloadBtn.addEventListener("click", handleConnect);
  dom.tablesList.addEventListener("change", handleTableSelection);
  dom.loadCountBtn.addEventListener("click", handleLoadCount);
  dom.exploreBtn.addEventListener("click", handleExplore);
  dom.clearStorageBtn.addEventListener("click", clearSavedConnection);
  if (dom.themeToggle) {
    dom.themeToggle.addEventListener("click", () => {
      const next = state.theme === "dark" ? "light" : "dark";
      setTheme(next);
    });
  }
}

async function init() {
  setTheme(state.theme, { persist: false });
  renderTablesList();
  await restoreFromStorage();
  initEventListeners();

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes[storageKeys.theme]) {
      setTheme(changes[storageKeys.theme].newValue, { persist: false });
    }
  });
}

init();
function setTheme(theme, { persist = true } = {}) {
  const nextTheme = theme === "light" ? "light" : "dark";
  state.theme = nextTheme;
  document.body.dataset.theme = nextTheme;
  if (dom.themeIcon) {
    dom.themeIcon.dataset.theme = nextTheme;
  }
  if (persist) {
    storageSet({ [storageKeys.theme]: nextTheme });
  }
}
