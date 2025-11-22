function getParam(key) {
  const url = new URL(window.location.href);
  return url.searchParams.get(key);
}

document.addEventListener("DOMContentLoaded", () => {
  const id = getParam("id");
  if (!id) {
    alert("Missing id");
    return;
  }
  loadCall(id);
});

async function loadCall(id) {
  try {
    const res = await fetch(`/api/sample-calls/${encodeURIComponent(id)}`);
    if (!res.ok) throw new Error(`Not found: ${res.status}`);
    const data = await res.json();
    renderBasic(data);
    renderAgent(data.agent_outputs || {});
    renderBaseline(data);
    renderTokens(data.token_usage || {});
  } catch (err) {
    alert(err.message || "Failed to load call");
  }
}

function renderBasic(c) {
  const el = document.getElementById("basic-info");
  const lines = [
    `Ticker: ${c.ticker}`,
    `Company: ${c.company || ""}`,
    `Date/Quarter: ${c.date || ""} / ${c.quarter || ""}`,
    `Sector/Exchange: ${c.sector || ""} / ${c.exchange || ""}`,
    `True return: ${c.true_return != null ? (c.true_return * 100).toFixed(2) + "%" : ""}`,
    `Prediction: ${c.pred_label || ""} (conf ${c.pred_conf != null ? (c.pred_conf * 100).toFixed(1) + "%" : "n/a"})`,
    `Correct: ${c.is_correct ? "✔" : "✖"}`,
  ];
  el.innerHTML = `<ul>${lines.map((l) => `<li>${l}</li>`).join("")}</ul>`;
}

function renderAgent(agent) {
  const el = document.getElementById("agent-section");
  const summary = agent.main_summary || "No summary";
  const comps = Array.isArray(agent.comparative_points) ? agent.comparative_points : [];
  const hist = Array.isArray(agent.historical_notes) ? agent.historical_notes : [];
  el.innerHTML = `
    <p><strong>Main summary:</strong> ${summary}</p>
    <p><strong>Comparative:</strong></p>
    <ul>${comps.map((c) => `<li>${c}</li>`).join("") || "<li>None</li>"}</ul>
    <p><strong>Historical:</strong></p>
    <ul>${hist.map((c) => `<li>${c}</li>`).join("") || "<li>None</li>"}</ul>
  `;
}

function renderBaseline(c) {
  const el = document.getElementById("baseline-section");
  const lm = c.baseline_lm_score != null ? c.baseline_lm_score : "n/a";
  const finbert = c.finbert_pred || "n/a";
  el.innerHTML = `
    <ul>
      <li>LM sentiment score: ${lm}</li>
      <li>FinBERT: ${finbert}</li>
    </ul>
  `;
}

function renderTokens(tokens) {
  const el = document.getElementById("token-section");
  const rows = Object.entries(tokens || {}).map(
    ([k, v]) => `<li>${k}: ${v}</li>`
  );
  el.innerHTML = `<ul>${rows.join("") || "<li>n/a</li>"}</ul>`;
}
