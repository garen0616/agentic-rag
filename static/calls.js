const callState = {
  page: 1,
  pageSize: 10,
  exchange: "",
  sector: "",
  pred: "",
  retMin: "",
  retMax: "",
  sort: "date",
};

const callElements = {};

document.addEventListener("DOMContentLoaded", () => {
  callElements.exchange = document.getElementById("exchange-filter");
  callElements.sector = document.getElementById("sector-filter");
  callElements.pred = document.getElementById("pred-filter");
  callElements.retMin = document.getElementById("ret-min");
  callElements.retMax = document.getElementById("ret-max");
  callElements.sort = document.getElementById("sort-select");
  callElements.apply = document.getElementById("apply-call-filters");
  callElements.reset = document.getElementById("reset-call-filters");
  callElements.prev = document.getElementById("prev-page");
  callElements.next = document.getElementById("next-page");
  callElements.pageInfo = document.getElementById("page-info");
  callElements.tableBody = document.querySelector("#calls-table tbody");

  callElements.apply.addEventListener("click", () => {
    callState.exchange = callElements.exchange.value;
    callState.sector = callElements.sector.value.trim();
    callState.pred = callElements.pred.value;
    callState.retMin = callElements.retMin.value;
    callState.retMax = callElements.retMax.value;
    callState.sort = callElements.sort.value;
    callState.page = 1;
    loadCalls();
  });

  callElements.reset.addEventListener("click", () => {
    callElements.exchange.value = "";
    callElements.sector.value = "";
    callElements.pred.value = "";
    callElements.retMin.value = "";
    callElements.retMax.value = "";
    callElements.sort.value = "date";
    callState.exchange = "";
    callState.sector = "";
    callState.pred = "";
    callState.retMin = "";
    callState.retMax = "";
    callState.sort = "date";
    callState.page = 1;
    loadCalls();
  });

  callElements.prev.addEventListener("click", () => {
    if (callState.page > 1) {
      callState.page -= 1;
      loadCalls();
    }
  });
  callElements.next.addEventListener("click", () => {
    const maxPage = callState.maxPage || 1;
    if (callState.page < maxPage) {
      callState.page += 1;
      loadCalls();
    }
  });

  loadCalls();
});

async function loadCalls() {
  const params = new URLSearchParams({
    page: String(callState.page),
    page_size: String(callState.pageSize),
    sort_by: callState.sort,
  });
  if (callState.exchange) params.append("exchange", callState.exchange);
  if (callState.sector) params.append("sector", callState.sector);
  if (callState.pred) params.append("pred_label", callState.pred);
  if (callState.retMin) params.append("return_min", callState.retMin);
  if (callState.retMax) params.append("return_max", callState.retMax);

  try {
    const res = await fetch(`/api/sample-calls?${params.toString()}`);
    if (!res.ok) throw new Error(`Failed: ${res.status}`);
    const data = await res.json();
    renderCalls(data.rows || []);
    const total = data.total || 0;
    const maxPage = Math.max(1, Math.ceil(total / callState.pageSize));
    callState.maxPage = maxPage;
    callElements.pageInfo.textContent = `Page ${callState.page} of ${maxPage} — ${total} rows`;
  } catch (err) {
    alert(err.message || "Failed to load calls");
  }
}

function renderCalls(rows) {
  callElements.tableBody.innerHTML = "";
  if (!rows || rows.length === 0) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 7;
    td.textContent = "No data.";
    tr.appendChild(td);
    callElements.tableBody.appendChild(tr);
    return;
  }

  rows.forEach((row) => {
    const tr = document.createElement("tr");
    const cols = [
      row.ticker,
      row.company || "",
      row.date || "",
      row.sector || "",
      row.true_return != null ? `${(row.true_return * 100).toFixed(2)}%` : "",
      row.pred_label || "",
      row.is_correct ? "✔" : "✖",
    ];
    cols.forEach((val) => {
      const td = document.createElement("td");
      td.textContent = val;
      tr.appendChild(td);
    });
    const tdLink = document.createElement("td");
    const a = document.createElement("a");
    a.textContent = "View";
    a.href = `call.html?id=${encodeURIComponent(row.id)}`;
    tdLink.appendChild(a);
    tr.appendChild(tdLink);
    callElements.tableBody.appendChild(tr);
  });
}
