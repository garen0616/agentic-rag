"""
Offline CSV results viewer for EarningsCallAgenticRag.
Run locally:
1) (Optional) python -m venv .venv && source .venv/bin/activate
2) pip install -r requirements.txt
3) uvicorn main:app --reload
4) Open http://127.0.0.1:8000
"""

import math
import os
from functools import lru_cache
from pathlib import Path
from typing import Dict, Optional, Tuple

import json

import pandas as pd
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from neo4j import GraphDatabase

app = FastAPI(title="Earnings Call Agentic RAG - Offline Viewer")

DATA_DIR = Path(__file__).parent / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)
DATA_CACHE: Dict[str, Tuple[float, pd.DataFrame]] = {}
CREDENTIALS_FILE = Path(__file__).parent / "orchestrator_repo" / "credentials.json"
SAMPLE_CALLS_FILE = DATA_DIR / "sample_calls.json"


def load_dataset(dataset_name: str) -> pd.DataFrame:
    """Load a dataset from disk with simple in-memory caching."""
    dataset_path = DATA_DIR / dataset_name
    if not dataset_path.exists():
        raise HTTPException(status_code=404, detail="Dataset not found")

    mtime = dataset_path.stat().st_mtime
    cached = DATA_CACHE.get(dataset_name)
    if cached and cached[0] == mtime:
        return cached[1]

    try:
        df = pd.read_csv(dataset_path)
    except Exception as exc:  # pragma: no cover - defensive logging not needed
        raise HTTPException(status_code=500, detail=f"Failed to read dataset: {exc}") from exc

    DATA_CACHE[dataset_name] = (mtime, df)
    return df


@lru_cache(maxsize=1)
def get_neo4j_driver():
    uri = os.getenv("NEO4J_URI")
    user = os.getenv("NEO4J_USERNAME")
    pwd = os.getenv("NEO4J_PASSWORD")

    if not uri or not user or not pwd:
        if not CREDENTIALS_FILE.exists():
            raise HTTPException(status_code=500, detail="Neo4j credentials not found (env or credentials.json)")
        creds = json.loads(CREDENTIALS_FILE.read_text())
        uri = uri or creds.get("neo4j_uri")
        user = user or creds.get("neo4j_username")
        pwd = pwd or creds.get("neo4j_password")

    if not uri or not user or not pwd:
        raise HTTPException(status_code=500, detail="Neo4j credentials incomplete")

    try:
        driver = GraphDatabase.driver(uri, auth=(user, pwd))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to init Neo4j driver: {exc}") from exc
    return driver


def load_sample_calls() -> list[dict]:
    if not SAMPLE_CALLS_FILE.exists():
        return []
    try:
        return json.loads(SAMPLE_CALLS_FILE.read_text())
    except Exception:
        return []


app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/datasets")
def list_datasets():
    datasets = sorted([p.name for p in DATA_DIR.glob("*_results.csv") if p.is_file()])
    return {"datasets": datasets}


@app.get("/api/rows")
def get_rows(
    dataset: str = Query(..., description="Dataset filename, e.g. merged_data_nyse_results.csv"),
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=500),
    ticker: Optional[str] = Query(None),
    quarter: Optional[str] = Query(None, description="Quarter value, if present"),
    search: Optional[str] = Query(None),
):
    df = load_dataset(dataset)
    filtered_df = df

    if ticker and "ticker" in filtered_df.columns:
        mask = filtered_df["ticker"].astype(str).str.contains(ticker, case=False, na=False)
        filtered_df = filtered_df[mask]

    # Handle quarter column as "quarter" or "q"
    quarter_col = None
    if "quarter" in filtered_df.columns:
        quarter_col = "quarter"
    elif "q" in filtered_df.columns:
        quarter_col = "q"
    if quarter and quarter_col:
        filtered_df = filtered_df[filtered_df[quarter_col].astype(str) == quarter]

    if search:
        search_mask = pd.Series(False, index=filtered_df.index)
        for col in filtered_df.columns:
            search_mask |= filtered_df[col].astype(str).str.contains(search, case=False, na=False)
        filtered_df = filtered_df[search_mask]

    total = len(filtered_df)
    start = (page - 1) * page_size
    end = start + page_size
    page_df = filtered_df.iloc[start:end]

    def _sanitize(val):
        if val is None:
            return None
        try:
            if pd.isna(val):
                return None
        except Exception:
            pass
        if isinstance(val, float) and (math.isinf(val) or math.isnan(val)):
            return None
        return val

    rows_raw = page_df.to_dict(orient="records")
    rows = [{k: _sanitize(v) for k, v in rec.items()} for rec in rows_raw]
    columns = list(filtered_df.columns)

    return {
        "dataset": dataset,
        "page": page,
        "page_size": page_size,
        "total": total,
        "columns": columns,
        "rows": rows,
    }


@app.get("/api/options")
def get_options(
    dataset: str = Query(..., description="Dataset filename"),
):
    df = load_dataset(dataset)

    tickers = []
    if "ticker" in df.columns:
        tickers = sorted(df["ticker"].dropna().astype(str).unique().tolist())

    quarter_col = "quarter" if "quarter" in df.columns else ("q" if "q" in df.columns else None)
    quarters = []
    if quarter_col:
        quarters = sorted(df[quarter_col].dropna().astype(str).unique().tolist())

    return {"tickers": tickers, "quarters": quarters}


@app.get("/api/sample-calls")
def list_sample_calls(
    exchange: Optional[str] = Query(None),
    sector: Optional[str] = Query(None),
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
    return_min: Optional[float] = Query(None),
    return_max: Optional[float] = Query(None),
    pred_label: Optional[str] = Query(None),
    sort_by: Optional[str] = Query("date", description="date|abs_return|wrong_first"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=200),
):
    calls = load_sample_calls()

    def to_date(val):
        try:
            return pd.to_datetime(val)
        except Exception:
            return None

    filtered = []
    for c in calls:
        if exchange and str(c.get("exchange", "")).lower() != exchange.lower():
            continue
        if sector and str(c.get("sector", "")).lower() != sector.lower():
            continue
        if pred_label and str(c.get("pred_label", "")).lower() != pred_label.lower():
            continue
        if return_min is not None and c.get("true_return") is not None and c["true_return"] < return_min:
            continue
        if return_max is not None and c.get("true_return") is not None and c["true_return"] > return_max:
            continue
        dt = to_date(c.get("date"))
        if start_date and dt is not None and dt < to_date(start_date):
            continue
        if end_date and dt is not None and dt > to_date(end_date):
            continue
        filtered.append(c)

    if sort_by == "abs_return":
        filtered.sort(key=lambda x: abs(x.get("true_return") or 0), reverse=True)
    elif sort_by == "wrong_first":
        filtered.sort(key=lambda x: (x.get("is_correct") is True, abs(x.get("true_return") or 0)), reverse=False)
    else:  # date default
        filtered.sort(key=lambda x: x.get("date") or "", reverse=True)

    total = len(filtered)
    start = (page - 1) * page_size
    end = start + page_size
    return {"total": total, "page": page, "page_size": page_size, "rows": filtered[start:end]}


@app.get("/api/sample-calls/{call_id}")
def get_sample_call(call_id: str):
    calls = load_sample_calls()
    for c in calls:
        if c.get("id") == call_id:
            return c
    raise HTTPException(status_code=404, detail="Call not found")


@app.get("/api/graph")
def get_graph(
    ticker: Optional[str] = Query(None, description="Ticker symbol to focus the graph on"),
    limit: int = Query(50, ge=1, le=500),
):
    """
    Return a small subgraph from Neo4j for visualization.
    If ticker is provided, fetch nodes/edges around that ticker; otherwise sample facts.
    """
    driver = get_neo4j_driver()
    if ticker:
        cypher = """
        MATCH (t:Ticker {symbol:$ticker})-[r]-(n)
        RETURN t AS a, r AS r, n AS b
        LIMIT $limit
        """
        params = {"ticker": ticker, "limit": limit}
    else:
        cypher = """
        MATCH (t:Ticker)-[r:HAS_FACT]-(f:Fact)
        RETURN t AS a, r AS r, f AS b
        LIMIT $limit
        """
        params = {"limit": limit}

    nodes = {}
    edges = []

    try:
        with driver.session() as ses:
            result = ses.run(cypher, **params)
            for record in result:
                a = record["a"]
                b = record["b"]
                r = record["r"]

                def add_node(node):
                    node_id = node.element_id
                    if node_id not in nodes:
                        nodes[node_id] = {
                            "id": node_id,
                            "labels": list(node.labels),
                            "properties": dict(node),
                        }

                add_node(a)
                add_node(b)
                edges.append(
                    {
                        "id": r.element_id,
                        "source": r.start_node.element_id,
                        "target": r.end_node.element_id,
                        "type": r.type,
                        "properties": dict(r),
                    }
                )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to query Neo4j: {exc}") from exc

    return {"nodes": list(nodes.values()), "edges": edges}


app.mount("/", StaticFiles(directory="static", html=True), name="static")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)
