const storageKeys = {
  connection: "supahack_connection",
  selectedTable: "supahack_currentTable",
  theme: "supahack_theme",
  connectionMeta: "supahack_connection_meta",
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
  connectionWriteSource: null,
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
  tablesList: document.getElementById("tables-list"),
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

function applyConnectionToForm(connection, { announce = false } = {}) {
  const normalized = connection
    ? {
        projectId: sanitize(connection.projectId),
        schema: sanitize(connection.schema) || "public",
        apiKey: sanitize(connection.apiKey),
        bearer: sanitize(connection.bearer) || sanitize(connection.apiKey),
      }
    : {
        projectId: "",
        schema: "public",
        apiKey: "",
        bearer: "",
      };

  state.connection = normalized;
  state.baseUrl = normalized.projectId ? buildBaseUrl(normalized.projectId) : "";

  if (dom.projectId) dom.projectId.value = normalized.projectId;
  if (dom.schema) dom.schema.value = normalized.schema || "public";
  if (dom.apiKey) dom.apiKey.value = normalized.apiKey;
  if (dom.bearer) dom.bearer.value = normalized.bearer;

  if (announce) {
    if (normalized.projectId || normalized.apiKey || normalized.bearer) {
      setStatus("Connection details received from DevTools.", "success");
    } else {
      setStatus("Connection details cleared.", "idle");
    }
  }
}

function markConnectionWriteSource(source) {
  state.connectionWriteSource = source;
  if (source) {
    setTimeout(() => {
      if (state.connectionWriteSource === source) {
        state.connectionWriteSource = null;
      }
    }, 500);
  }
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
  url.searchParams.set("select", "*");
  url.searchParams.set("limit", "1");

  const response = await fetch(url.toString(), { headers });
  if (!response.ok) {
    let detail = "";
    try {
      detail = await response.text();
    } catch (readError) {
      // Ignore read errors and fall back to basic message.
    }
    const trimmed = detail ? detail.trim().slice(0, 200) : "";
    const message = trimmed ? `Count failed (${response.status}): ${trimmed}` : `Count failed (${response.status})`;
    throw new Error(message);
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
  if (!dom.tablesList) return;

  dom.tablesList.innerHTML = "";

  if (!state.tables.length) {
    const emptyRow = document.createElement("tr");
    emptyRow.className = "tables-empty";
    const cell = document.createElement("td");
    cell.colSpan = 2;
    cell.textContent = state.baseUrl ? "No tables found for this schema." : "Connect to populate tables.";
    emptyRow.appendChild(cell);
    dom.tablesList.appendChild(emptyRow);
    updateActiveRowHighlight();
    return;
  }

  state.tables.forEach((table) => {
    const row = document.createElement("tr");
    row.dataset.table = table;

    const nameCell = document.createElement("td");
    nameCell.textContent = table;

    const countCell = document.createElement("td");
    const count = state.tableCounts?.[table];
    if (typeof count === "number") {
      countCell.textContent = count.toLocaleString();
    } else if (count === null) {
      countCell.textContent = "—";
    } else {
      countCell.textContent = "…";
    }

    row.appendChild(nameCell);
    row.appendChild(countCell);
    if (state.currentTable === table) {
      row.classList.add("active");
    }
    dom.tablesList.appendChild(row);
  });

  updateActiveRowHighlight();
}

function handleTableClick(event) {
  const row = event.target.closest("tr[data-table]");
  if (!row) return;
  const table = row.dataset.table;
  if (!table) return;
  setActiveTable(table, { persist: true, announce: false });
}

function handleTableDoubleClick(event) {
  const row = event.target.closest("tr[data-table]");
  if (!row) return;
  const table = row.dataset.table;
  if (!table) return;
  setActiveTable(table, { persist: true, announce: false });
  openTableExplorer(table);
}

async function handleConnect(event) {
  event?.preventDefault();
  const connection = {
    projectId: sanitize(dom.projectId.value),
    schema: sanitize(dom.schema.value) || "public",
    apiKey: sanitize(dom.apiKey.value),
    bearer: sanitize(dom.bearer.value),
  };
  await connectWithConnection(connection, { triggeredBy: "user" });
}

async function connectWithConnection(connection, { triggeredBy = "user" } = {}) {
  const normalized = {
    projectId: sanitize(connection.projectId),
    schema: sanitize(connection.schema) || "public",
    apiKey: sanitize(connection.apiKey),
    bearer: sanitize(connection.bearer || connection.apiKey),
  };

  if (!normalized.projectId || !normalized.apiKey) {
    setStatus("Project ID and apiKey required.", "error");
    return;
  }

  applyConnectionToForm(normalized, { announce: false });

  const previousTable = state.currentTable;
  state.tables = [];
  state.tableCounts = {};
  state.currentTable = null;
  renderTablesList();

  const statusPrefix = triggeredBy === "devtools"
    ? "DevTools connection"
    : triggeredBy === "restore"
      ? "Restoring connection"
      : "Connecting";
  setStatus(`${statusPrefix}…`, "progress");
  dom.connectBtn.disabled = true;
  dom.reloadBtn.disabled = true;

  try {
    state.openApi = await fetchOpenApi();
    state.tables = parseTablesFromOpenApi(state.openApi);
    state.tableCounts = {};
    renderTablesList();

    if (state.tables.length) {
      const initialTable = previousTable && state.tables.includes(previousTable)
        ? previousTable
        : state.tables[0];
      if (initialTable) {
        setActiveTable(initialTable, { persist: true });
      }
    } else {
      setActiveTable(null);
    }

    markConnectionWriteSource("sidepanel");
    const metaSource = triggeredBy === "devtools" || triggeredBy === "restore"
      ? "sidepanel"
      : triggeredBy;
    await storageSet({
      [storageKeys.connection]: state.connection,
      [storageKeys.connectionMeta]: { source: metaSource, updatedAt: Date.now() },
    });

    if (state.tables.length) {
      await refreshTableCounts();
    }

    const suffix = state.tables.length
      ? `Connected (${state.tables.length} table${state.tables.length === 1 ? "" : "s"}).`
      : "Connected, but no tables were found.";
    setStatus(suffix, "success");
  } catch (error) {
    console.error(error);
    setStatus(error.message, "error");
  } finally {
    dom.connectBtn.disabled = false;
    dom.reloadBtn.disabled = false;
  }
}

async function refreshTableCounts() {
  if (!state.tables.length) return;
  setStatus("Counting rows…", "progress");

  for (const table of state.tables) {
    try {
      const count = await getTableRowCount(table);
      state.tableCounts[table] = typeof count === "number" ? count : null;
    } catch (error) {
      console.warn(`Failed to count rows for ${table}`, error);
      state.tableCounts[table] = null;
    }
    renderTablesList();
  }

  setStatus("Row counts updated.", "success");
}

async function openTableExplorer(table) {
  const targetTable = table || state.currentTable;
  if (!targetTable) {
    setStatus("Select a table first.", "error");
    return;
  }

  setActiveTable(targetTable, { persist: true });
  setStatus(`Opening ${targetTable}…`, "progress");

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

    setStatus(`Explorer opened for ${targetTable}.`, "success");
    setTimeout(() => {
      const message = state.tables.length
        ? `Connected (${state.tables.length} table${state.tables.length === 1 ? "" : "s"})`
        : "Ready";
      setStatus(message, "idle");
    }, 3000);
  });
}

async function restoreFromStorage() {
  try {
    chrome.storage.local.remove("supahack_capturedRequest");

    const stored = await storageGet(storageKeys.connection);
    const saved = stored?.[storageKeys.connection];
    applyConnectionToForm(saved || null, { announce: false });

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

    const metaStored = await storageGet(storageKeys.connectionMeta);
    const meta = metaStored?.[storageKeys.connectionMeta];
    const autoConnect = Boolean(
      saved?.projectId &&
      saved?.apiKey &&
      meta?.source === "devtools" &&
      typeof meta?.updatedAt === "number" &&
      Date.now() - meta.updatedAt < 30000
    );

    if (autoConnect) {
      await connectWithConnection(saved, { triggeredBy: "devtools" });
    } else if (saved?.projectId && saved?.apiKey) {
      setStatus("Restored credentials. Click Connect to refresh tables.", "idle");
    } else {
      setStatus("Idle", "idle");
    }
  } catch (error) {
    console.error("Storage restore failed", error);
  }
}

async function clearSavedConnection() {
  markConnectionWriteSource("sidepanel");
  await storageRemove(storageKeys.connection);
  await storageRemove(storageKeys.selectedTable);
  await storageRemove(storageKeys.connectionMeta);

  applyConnectionToForm(null, { announce: false });
  state.tables = [];
  state.tableCounts = {};
  state.currentTable = null;

  renderTablesList();
  setActiveTable(null);
  setStatus("Cleared saved credentials.", "success");
}

function initEventListeners() {
  dom.connectionForm.addEventListener("submit", handleConnect);
  dom.reloadBtn.addEventListener("click", handleConnect);
  dom.tablesList.addEventListener("click", handleTableClick);
  dom.tablesList.addEventListener("dblclick", handleTableDoubleClick);
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
    if (area !== "local") {
      return;
    }
    if (changes[storageKeys.theme]) {
      setTheme(changes[storageKeys.theme].newValue, { persist: false });
    }
    if (changes[storageKeys.connection]) {
      const change = changes[storageKeys.connection];
      const announce = state.connectionWriteSource !== "sidepanel";
      const newConnection = change.newValue || null;
      applyConnectionToForm(newConnection, { announce });
      if (announce) {
        state.tables = [];
        state.tableCounts = {};
        state.currentTable = null;
        renderTablesList();
        if (newConnection?.projectId && newConnection?.apiKey) {
          connectWithConnection(newConnection, { triggeredBy: "devtools" });
        }
      }
      state.connectionWriteSource = null;
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
function updateActiveRowHighlight() {
  if (!dom.tablesList) return;
  const rows = dom.tablesList.querySelectorAll("tr[data-table]");
  rows.forEach((row) => {
    row.classList.toggle("active", row.dataset.table === state.currentTable);
  });
}

function setActiveTable(table, { persist = true, announce = false } = {}) {
  if (!table || !state.tables.includes(table)) {
    state.currentTable = null;
    updateActiveRowHighlight();
    if (persist) {
      storageRemove(storageKeys.selectedTable);
    }
    return;
  }

  if (state.currentTable !== table) {
    state.currentTable = table;
    updateActiveRowHighlight();
    if (persist) {
      storageSet({ [storageKeys.selectedTable]: table });
    }
    if (announce) {
      setStatus(`Selected table: ${table}`, "idle");
    }
  }
}
