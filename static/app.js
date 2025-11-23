const state = {
  dataset: null,
  page: 1,
  pageSize: 25,
  ticker: "",
  quarter: "",
  search: "",
};

const elements = {};
let lastColumns = [];
let graphNetwork = null;

document.addEventListener("DOMContentLoaded", () => {
  elements.datasetSelect = document.getElementById("dataset-select");
  elements.tickerSelect = document.getElementById("ticker-select");
  elements.quarterSelect = document.getElementById("quarter-select");
  elements.searchInput = document.getElementById("search-input");
  elements.applyFilters = document.getElementById("apply-filters");
  elements.loadGraph = document.getElementById("load-graph");
  elements.prevPage = document.getElementById("prev-page");
  elements.nextPage = document.getElementById("next-page");
  elements.pageInfo = document.getElementById("page-info");
  elements.tableHead = document.querySelector("#results-table thead");
  elements.tableBody = document.querySelector("#results-table tbody");
  elements.rowDetails = document.getElementById("row-details");
  elements.agentDetails = document.getElementById("agent-details");
  elements.baselineDetails = document.getElementById("baseline-details");

  fetchDatasets();

  elements.datasetSelect.addEventListener("change", () => {
    state.dataset = elements.datasetSelect.value;
    state.page = 1;
    fetchOptions();
    loadPage();
  });

  elements.applyFilters.addEventListener("click", () => {
    state.ticker = elements.tickerSelect.value;
    state.quarter = elements.quarterSelect.value;
    state.search = elements.searchInput.value.trim();
    state.page = 1;
    loadPage();
  });

  elements.loadGraph.addEventListener("click", () => {
    loadGraph();
  });

  elements.prevPage.addEventListener("click", () => {
    if (state.page > 1) {
      state.page -= 1;
      loadPage();
    }
  });

  elements.nextPage.addEventListener("click", () => {
    const totalPages = computeTotalPages(state.total || 0, state.pageSize);
    if (state.page < totalPages) {
      state.page += 1;
      loadPage();
    }
  });
});

async function fetchDatasets() {
  try {
    const res = await fetch("/api/datasets");
    if (!res.ok) {
      throw new Error(`Failed to load datasets: ${res.status}`);
    }
    const data = await res.json();
    populateDatasets(data.datasets || []);
  } catch (err) {
    alert(err.message || "Could not load datasets.");
  }
}

function populateDatasets(datasets) {
  elements.datasetSelect.innerHTML = "";
  if (datasets.length === 0) {
    const option = document.createElement("option");
    option.textContent = "No datasets found";
    option.disabled = true;
    option.selected = true;
    elements.datasetSelect.appendChild(option);
    return;
  }

  datasets.forEach((name) => {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = name;
    elements.datasetSelect.appendChild(option);
  });

  state.dataset = datasets[0];
  elements.datasetSelect.value = state.dataset;
  fetchOptions();
  loadPage();
}

function buildQueryString() {
  const params = new URLSearchParams({
    dataset: state.dataset,
    page: String(state.page),
    page_size: String(state.pageSize),
  });

  if (state.ticker) params.append("ticker", state.ticker);
  if (state.quarter) params.append("quarter", state.quarter);
  if (state.search) params.append("search", state.search);

  return params.toString();
}

async function loadPage() {
  if (!state.dataset) return;

  try {
    const qs = buildQueryString();
    const res = await fetch(`/api/rows?${qs}`);
    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(errorText || `Request failed: ${res.status}`);
    }

    const data = await res.json();
    state.page = data.page;
    state.pageSize = data.page_size;
    state.total = data.total;
    lastColumns = data.columns || [];

    renderTable(data.columns || [], data.rows || []);
    updatePagination({
      page: data.page,
      page_size: data.page_size,
      total: data.total,
    });
  } catch (err) {
    alert(err.message || "Failed to load data.");
  }
}

function renderTable(columns, rows) {
  elements.tableHead.innerHTML = "";
  elements.tableBody.innerHTML = "";

  const headerRow = document.createElement("tr");
  columns.forEach((col) => {
    const th = document.createElement("th");
    th.textContent = col;
    headerRow.appendChild(th);
  });
  elements.tableHead.appendChild(headerRow);

  if (!rows || rows.length === 0) {
    const emptyRow = document.createElement("tr");
    const emptyCell = document.createElement("td");
    emptyCell.colSpan = columns.length || 1;
    emptyCell.textContent = "No rows found.";
    emptyRow.appendChild(emptyCell);
    elements.tableBody.appendChild(emptyRow);
    return;
  }

  rows.forEach((row) => {
    const tr = document.createElement("tr");
    columns.forEach((col) => {
      const td = document.createElement("td");
      const value = row[col];
      td.textContent = value === null || value === undefined ? "" : String(value);
      tr.appendChild(td);
    });
    tr.addEventListener("click", () => showRowDetails(row));
    elements.tableBody.appendChild(tr);
  });
}

function showRowDetails(row) {
  elements.rowDetails.textContent = JSON.stringify(row, null, 2);
  renderAgentDetails(row);
  renderBaselineDetails(row);
}

function updatePagination({ page, page_size, total }) {
  const totalPages = computeTotalPages(total, page_size);
  elements.pageInfo.textContent = `Page ${page} of ${totalPages} — ${total} rows`;
  elements.prevPage.disabled = page <= 1;
  elements.nextPage.disabled = page >= totalPages;
}

function computeTotalPages(total, pageSize) {
  return Math.max(1, Math.ceil(total / pageSize));
}

async function loadGraph() {
  const params = new URLSearchParams();
  const tickerVal = elements.tickerSelect.value.trim();
  if (tickerVal) params.append("ticker", tickerVal);
  params.append("limit", "100");

  try {
    const res = await fetch(`/api/graph?${params.toString()}`);
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(txt || `Graph request failed: ${res.status}`);
    }
    const data = await res.json();
    renderGraph(data);
  } catch (err) {
    alert(err.message || "Could not load graph.");
  }
}

async function fetchOptions() {
  if (!state.dataset) return;
  try {
    const res = await fetch(`/api/options?dataset=${encodeURIComponent(state.dataset)}`);
    if (!res.ok) throw new Error("Failed to load options");
    const data = await res.json();
    renderOptions(elements.tickerSelect, data.tickers || [], "All tickers");
    renderOptions(elements.quarterSelect, data.quarters || [], "All quarters");
    state.ticker = "";
    state.quarter = "";
  } catch (err) {
    console.error(err);
  }
}

function renderOptions(selectEl, options, placeholder) {
  if (!selectEl) return;
  selectEl.innerHTML = "";
  const opt = document.createElement("option");
  opt.value = "";
  opt.textContent = placeholder;
  selectEl.appendChild(opt);
  options.forEach((val) => {
    const o = document.createElement("option");
    o.value = val;
    o.textContent = val;
    selectEl.appendChild(o);
  });
}

function renderGraph(data) {
  const container = document.getElementById("graph-container");
  if (!container) return;

  const nodesRaw = Array.isArray(data.nodes) ? data.nodes : [];
  const edgesRaw = Array.isArray(data.edges) ? data.edges : [];

  const nodes = new vis.DataSet(
    nodesRaw.map((n) => {
      const label =
        n.properties?.ticker ||
        n.properties?.symbol ||
        n.properties?.metric ||
        n.properties?.quarter ||
        (n.labels && n.labels[0]) ||
        n.id;
      return {
        id: n.id,
        label,
        group: (n.labels && n.labels[0]) || "Node",
        title: JSON.stringify(n.properties || {}, null, 2),
      };
    })
  );

  const edges = new vis.DataSet(
    edgesRaw.map((e) => ({
      id: e.id,
      from: e.source,
      to: e.target,
      label: e.type || "",
      arrows: "to",
    }))
  );

  const options = {
    physics: {
      stabilization: true,
    },
    edges: {
      font: { align: "horizontal", size: 10 },
      color: { opacity: 0.6 },
    },
    nodes: {
      shape: "dot",
      size: 12,
      font: { size: 12 },
    },
    height: "360px",
  };

  if (graphNetwork) {
    graphNetwork.setData({ nodes, edges });
  } else {
    graphNetwork = new vis.Network(container, { nodes, edges }, options);
  }
}

function clearNode(node, fallbackText = "") {
  node.textContent = "";
  if (fallbackText) {
    node.textContent = fallbackText;
  }
}

function renderAgentDetails(row) {
  const container = elements.agentDetails;
  if (!container) return;
  clearNode(container);

  const raw = row.parsed_and_analyzed_facts;
  if (!raw) {
    container.textContent = "No multi-agent analysis in this row.";
    return;
  }

  let parsed;
  try {
    parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch (err) {
    container.textContent = "Could not parse multi-agent analysis.";
    return;
  }

  const items = Array.isArray(parsed.items) ? parsed.items : [];
  const summaryText = parsed.summary || "";

  if (!items.length && !summaryText) {
    container.textContent = "No multi-agent analysis in this row.";
    return;
  }

  const groups = {};
  items.forEach((item) => {
    const t = item.type || "Other";
    if (!groups[t]) groups[t] = [];
    groups[t].push(item);
  });

  Object.entries(groups).forEach(([type, list], idx) => {
    const detailsEl = document.createElement("details");
    if (idx === 0) detailsEl.open = true;
    const summary = document.createElement("summary");
    summary.textContent = `${type} (${list.length})`;
    detailsEl.appendChild(summary);

    const wrapper = document.createElement("div");
    wrapper.className = "fact-list";

    list.forEach((item) => {
      const metric = item.metric || "Metric";
      const value = item.value || "";
      const reason = item.reason || "";

      const fact = document.createElement("div");
      fact.className = "fact-item";

      const header = document.createElement("div");
      header.className = "fact-header";
      const metricEl = document.createElement("strong");
      metricEl.textContent = metric;
      const valueEl = document.createElement("span");
      valueEl.className = "fact-value";
      valueEl.textContent = value;
      header.appendChild(metricEl);
      if (value) {
        header.appendChild(document.createTextNode(" · "));
        header.appendChild(valueEl);
      }

      fact.appendChild(header);
      if (reason) {
        const reasonEl = document.createElement("div");
        reasonEl.className = "fact-reason";
        reasonEl.textContent = reason;
        fact.appendChild(reasonEl);
      }
      wrapper.appendChild(fact);
    });

    detailsEl.appendChild(wrapper);
    container.appendChild(detailsEl);
  });

  if (summaryText) {
    const summaryBlock = document.createElement("div");
    const h = document.createElement("h4");
    h.textContent = "Summary";
    const p = document.createElement("p");
    p.textContent = summaryText;
    summaryBlock.appendChild(h);
    summaryBlock.appendChild(p);
    container.appendChild(summaryBlock);
  }
}

function renderBaselineDetails(row) {
  const container = elements.baselineDetails;
  if (!container) return;
  clearNode(container);

  const hasBaseline =
    Array.isArray(lastColumns) &&
    (lastColumns.includes("sentiment") ||
      lastColumns.includes("positive_count") ||
      lastColumns.includes("polarity"));

  if (!hasBaseline) {
    container.textContent = "No baseline sentiment metrics in this dataset.";
    return;
  }

  const sentiment = row.sentiment;
  const polarity = row.polarity;
  const pos = row.positive_count;
  const neg = row.negative_count;
  const label = row.label;
  const pred = row.pred;
  const futureRet = row.future_3bday_cum_return ?? row.actual_return;

  const list = document.createElement("ul");
  const add = (labelText, value) => {
    if (value === undefined || value === null || value === "") return;
    const li = document.createElement("li");
    li.textContent = `${labelText}: ${value}`;
    list.appendChild(li);
  };

  add("Sentiment", sentiment);
  add("Polarity", polarity);
  add("Positive count", pos);
  add("Negative count", neg);
  add("Label", label);
  add("Pred", pred);
  add("Future 3-day return / Actual return", futureRet);

  if (!list.childNodes.length) {
    container.textContent = "Baseline columns detected but no values on this row.";
    return;
  }

  container.appendChild(list);
}

async function fetchOptions() {
  if (!state.dataset) return;
  try {
    const res = await fetch(`/api/options?dataset=${encodeURIComponent(state.dataset)}`);
    if (!res.ok) throw new Error("Failed to load options");
    const data = await res.json();
    renderOptions(elements.tickerSelect, data.tickers || [], "All tickers");
    renderOptions(elements.quarterSelect, data.quarters || [], "All quarters");
    state.ticker = "";
    state.quarter = "";
  } catch (err) {
    console.error(err);
  }
}

function renderOptions(selectEl, options, placeholder) {
  if (!selectEl) return;
  selectEl.innerHTML = "";
  const opt = document.createElement("option");
  opt.value = "";
  opt.textContent = placeholder;
  selectEl.appendChild(opt);
  options.forEach((val) => {
    const o = document.createElement("option");
    o.value = val;
    o.textContent = val;
    selectEl.appendChild(o);
  });
}
