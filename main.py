"""
Offline CSV results viewer for EarningsCallAgenticRag.
Run locally:
1) (Optional) python -m venv .venv && source .venv/bin/activate
2) pip install -r requirements.txt
3) uvicorn main:app --reload
4) Open http://127.0.0.1:8000
"""

import math
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
    if not CREDENTIALS_FILE.exists():
        raise HTTPException(status_code=500, detail="Neo4j credentials file not found")
    creds = json.loads(CREDENTIALS_FILE.read_text())
    try:
        driver = GraphDatabase.driver(
            creds.get("neo4j_uri"),
            auth=(creds.get("neo4j_username"), creds.get("neo4j_password")),
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to init Neo4j driver: {exc}") from exc
    return driver


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
    search: Optional[str] = Query(None),
):
    df = load_dataset(dataset)
    filtered_df = df

    if ticker and "ticker" in filtered_df.columns:
        mask = filtered_df["ticker"].astype(str).str.contains(ticker, case=False, na=False)
        filtered_df = filtered_df[mask]

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
