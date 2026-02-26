const dropZoneEl = document.getElementById("drop-zone");
const headerDateEl = document.getElementById("header-date");
const latestStatusEl = document.getElementById("file-status");
const latestTimeEl = document.getElementById("latest-time");
const fileInputEl = document.getElementById("file-input");
const uploadBtnEl = document.getElementById("upload-btn");
const tablesRootEl = document.getElementById("tables-root");
const dateSelectEl = document.getElementById("date-select");
const sbDotEl = document.getElementById("sb-dot");
const sbTextEl = document.getElementById("sb-text");
const sbLatestEl = document.getElementById("sb-latest");
const sbRowsEl = document.getElementById("sb-rows");
const sbTimeEl = document.getElementById("sb-time");

let currentViewKey = null;
let pendingFile = null;
let selectedDate = null;

function setMessage(text, isError = false) {
  setStatus(isError ? "error" : "ready", text);
  latestTimeEl.textContent = isError ? `Error: ${text}` : text;
}

function setStatus(state, text) {
  sbDotEl.className = `sb-dot${state === "ready" ? " ready" : state === "calc" ? " calc" : state === "error" ? " error" : ""}`;
  sbTextEl.textContent = text;
}

function updateClock() {
  headerDateEl.textContent = new Date().toLocaleString();
}

function isNonEmptyCell(v) {
  return v !== null && v !== undefined && String(v).trim() !== "";
}

function trimRow(row) {
  let end = row.length;
  while (end > 0 && !isNonEmptyCell(row[end - 1])) {
    end -= 1;
  }
  return row.slice(0, end).map((v) => (v === null || v === undefined ? "" : String(v)));
}

function splitIntoBlocks(rows) {
  const blocks = [];
  let block = [];
  for (const row of rows) {
    const t = trimRow(row);
    const hasData = t.some(isNonEmptyCell);
    if (hasData) {
      block.push(t);
    } else if (block.length > 0) {
      blocks.push(block);
      block = [];
    }
  }
  if (block.length > 0) {
    blocks.push(block);
  }
  return blocks;
}

function renderBlocks(blocks) {
  tablesRootEl.innerHTML = "";
  if (!blocks.length) {
    tablesRootEl.innerHTML = '<div class="empty-note">No table data found in the Summary sheet.</div>';
    sbRowsEl.textContent = "Rows: 0";
    return;
  }

  const totalRows = blocks.reduce((sum, block) => sum + Math.max(0, block.length - 1), 0);
  sbRowsEl.textContent = `Rows: ${totalRows}`;

  const titleMap = {
    1: "Liquidity Coverage Ratio Management",
    2: "LCR and 3M LIQUIDITY RATIO",
    3: "Liquidity Gap Ratio",
    4: "Liquidity Liquidity Gap Ratio Forecast",
    5: "7 Day",
    6: "1 Month",
    7: "3 Month",
  };

  blocks.forEach((block, idx) => {
    const tableNo = idx + 1;
    let working = block.map((row) => row.slice());
    working = working.map((row) => row.slice(1));

    if (tableNo === 3) {
      working = working.map((row) => row.filter((_, cIdx) => cIdx !== 0));
    }

    if (tableNo === 5 || tableNo === 6 || tableNo === 7) {
      const header = working[0] || [];
      const tenorKey = tableNo === 5 ? "7 DAY" : tableNo === 6 ? "1 MONTH" : "3 MONTH";
      const removeIdx = header.findIndex((h) => String(h || "").toUpperCase().replace(/\s+/g, " ").includes(tenorKey));
      if (removeIdx >= 0) {
        working = working.map((row) => row.filter((_, cIdx) => cIdx !== removeIdx));
      }
    }

    const colCount = Math.max(...working.map((r) => r.length), 1);
    const header = working[0] || [];
    const body = working.slice(1);

    const wrap = document.createElement("section");
    wrap.className = "table-wrap";

    const title = document.createElement("p");
    title.className = "table-title";
    title.textContent = titleMap[tableNo] || `Table ${tableNo}`;
    wrap.appendChild(title);

    const scroll = document.createElement("div");
    scroll.className = "scroll";
    const table = document.createElement("table");

    const thead = document.createElement("thead");
    const hr = document.createElement("tr");
    const highlightCols = new Set();
    for (let c = 0; c < colCount; c += 1) {
      const th = document.createElement("th");
      const headerText = header[c] || `Column ${c + 1}`;
      th.textContent = headerText;
      if (/trigger|limit/i.test(String(headerText))) {
        th.classList.add("c-limit");
        highlightCols.add(c);
      }
      hr.appendChild(th);
    }
    thead.appendChild(hr);
    table.appendChild(thead);

    const tbody = document.createElement("tbody");
    const rows = body.length ? body : [header];
    for (const row of rows) {
      const tr = document.createElement("tr");
      const rowLabel = String(row[0] || "").trim();
      const isTriggerRow = /trigger|limit/i.test(rowLabel);
      for (let c = 0; c < colCount; c += 1) {
        const td = document.createElement("td");
        td.textContent = row[c] || "";
        if (highlightCols.has(c) || (isTriggerRow && c > 0)) {
          td.classList.add("c-limit");
        }
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    scroll.appendChild(table);
    wrap.appendChild(scroll);
    tablesRootEl.appendChild(wrap);
  });
}

function renderDateOptions(availableDates, currentDate) {
  const previous = dateSelectEl.value;
  dateSelectEl.innerHTML = "";
  if (!availableDates || !availableDates.length) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "No data";
    dateSelectEl.appendChild(opt);
    dateSelectEl.disabled = true;
    return;
  }

  dateSelectEl.disabled = false;
  for (const d of availableDates) {
    const opt = document.createElement("option");
    opt.value = d;
    opt.textContent = d;
    dateSelectEl.appendChild(opt);
  }

  const chosen = currentDate || previous || availableDates[0];
  if (chosen) {
    dateSelectEl.value = chosen;
  }
}

async function renderSummaryFromFile(url) {
  const res = await fetch(`${url}?t=${Date.now()}`, { cache: "no-store" });
  if (!res.ok) {
    throw new Error("Failed to download latest workbook.");
  }
  const buf = await res.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const ws = wb.Sheets.Summary;
  if (!ws) {
    tablesRootEl.innerHTML = '<div class="empty-note">The workbook does not contain a "Summary" sheet.</div>';
    return;
  }
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: "" });
  const blocks = splitIntoBlocks(rows);
  renderBlocks(blocks);
}

async function refreshLatest(force = false) {
  setStatus("calc", "Checking workbook...");
  const query = selectedDate ? `&date=${encodeURIComponent(selectedDate)}` : "";
  const res = await fetch(`/api/latest?t=${Date.now()}${query}`, { cache: "no-store" });
  if (!res.ok) {
    throw new Error("Failed to load workbook metadata.");
  }
  const data = await res.json();
  renderDateOptions(data.availableDates || [], data.selectedDate || selectedDate);
  selectedDate = data.selectedDate || null;

  if (!data.exists) {
    latestStatusEl.textContent = "No file selected";
    latestTimeEl.textContent = "Uploaded: -";
    sbLatestEl.textContent = "Latest: -";
    sbRowsEl.textContent = "Rows: -";
    tablesRootEl.innerHTML = '<div class="empty-note">Upload a partial .xlsx file to show Summary tables.</div>';
    currentViewKey = null;
    setStatus("ready", "Waiting for upload");
    return;
  }

  latestStatusEl.textContent = data.filename || "latest.xlsx";
  const modeText = data.processingMode ? ` [${data.processingMode}]` : "";
  latestTimeEl.textContent = `Uploaded: ${data.uploadedAt || "-"}${modeText}`;
  sbLatestEl.textContent = `Latest: ${data.selectedDate || data.filename || "latest.xlsx"}`;

  const newKey = `${data.selectedDate || ""}:${data.contentHash || ""}`;
  const shouldReload = force || currentViewKey !== newKey;
  if (shouldReload) {
    currentViewKey = newKey;
    await renderSummaryFromFile(data.fileUrl);
  }
  sbTimeEl.textContent = `Refreshed: ${new Date().toLocaleTimeString()}`;
  setStatus("ready", "Dashboard synced");
}

async function uploadFile() {
  const file = fileInputEl.files?.[0] || pendingFile;
  if (!file) {
    setMessage("Select an .xlsx file first.", true);
    fileInputEl.click();
    return;
  }
  if (!file.name.toLowerCase().endsWith(".xlsx")) {
    setMessage("Only .xlsx files are allowed.", true);
    return;
  }

  uploadBtnEl.disabled = true;
  setStatus("calc", "Uploading workbook...");
  setMessage("Uploading...");
  try {
    const res = await fetch("/api/upload", {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        "X-Filename": file.name,
      },
      body: file,
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      throw new Error(data.error || "Upload failed.");
    }
    selectedDate = data.selectedDate || data.date || null;
    setMessage(`Upload complete: ${data.filename}`);
    latestStatusEl.textContent = data.filename;
    pendingFile = null;
    await refreshLatest(true);
  } catch (err) {
    const msg = err.message || "Upload failed.";
    latestStatusEl.textContent = "Upload failed";
    setMessage(msg, true);
  } finally {
    uploadBtnEl.disabled = false;
  }
}

dropZoneEl.addEventListener("click", () => fileInputEl.click());
dropZoneEl.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropZoneEl.classList.add("drag-over");
});
dropZoneEl.addEventListener("dragleave", () => {
  dropZoneEl.classList.remove("drag-over");
});
dropZoneEl.addEventListener("drop", (e) => {
  e.preventDefault();
  dropZoneEl.classList.remove("drag-over");
  const file = e.dataTransfer?.files?.[0];
  if (!file) {
    return;
  }
  pendingFile = file;
  latestStatusEl.textContent = file.name;
});

fileInputEl.addEventListener("change", () => {
  const file = fileInputEl.files?.[0];
  if (file) {
    pendingFile = null;
    latestStatusEl.textContent = file.name;
    uploadFile().catch((err) => {
      setStatus("error", err.message || "Upload failed.");
    });
  }
});

dateSelectEl.addEventListener("change", () => {
  selectedDate = dateSelectEl.value || null;
  refreshLatest(true).catch((err) => {
    setStatus("error", err.message || "Failed to load selected date.");
  });
});

uploadBtnEl.addEventListener("click", uploadFile);
refreshLatest(true).catch((err) => {
  tablesRootEl.innerHTML = `<div class="empty-note">${err.message}</div>`;
  setStatus("error", err.message);
});
setInterval(() => {
  refreshLatest(false).catch(() => {});
}, 30000);
updateClock();
setInterval(updateClock, 1000);
