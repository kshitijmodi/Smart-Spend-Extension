"""
Context Agent
-------------
1. Classifies product category/subcategory/tags via LLM.
2. Analyses local price history to detect trends (rising, falling, stable)
   and flag whether the current price is at a historical high.
"""

import os
import json
import statistics
from langchain_groq import ChatGroq
from langchain_core.messages import HumanMessage

from backend.state import AgentState


def _get_llm() -> ChatGroq:
    return ChatGroq(
        model="llama-3.3-70b-versatile",
        temperature=0,
        groq_api_key=os.getenv("GROQ_API_KEY", ""),
    )


# ---------------------------------------------------------------------------
# Price history analysis (Option A)
# ---------------------------------------------------------------------------

def _analyse_price_history(current_price: float, history: list[dict]) -> dict:
    """
    Compare current price against locally stored price observations for this URL.
    Returns signals the supervisor can surface in the sidebar.
    """
    if not history or len(history) < 2:
        return {"available": False}

    prices = [h["price"] for h in history if h.get("price", 0) > 0]
    if not prices:
        return {"available": False}

    avg_price     = statistics.mean(prices)
    min_price     = min(prices)
    max_price     = max(prices)
    observations  = len(prices)

    pct_vs_avg    = (current_price - avg_price) / avg_price if avg_price else 0
    pct_vs_min    = (current_price - min_price) / min_price if min_price else 0

    # Trend: compare latest 2 observations
    sorted_h = sorted(history, key=lambda h: h.get("ts", 0))
    if len(sorted_h) >= 2:
        older = sorted_h[-2]["price"]
        newer = sorted_h[-1]["price"]
        trend = "rising" if newer > older * 1.02 else ("falling" if newer < older * 0.98 else "stable")
    else:
        trend = "unknown"

    is_at_high = current_price >= max_price * 0.97
    is_at_low  = current_price <= min_price * 1.03

    return {
        "available":      True,
        "observations":   observations,
        "avg_price":      round(avg_price, 2),
        "min_price":      round(min_price, 2),
        "max_price":      round(max_price, 2),
        "trend":          trend,
        "pct_vs_avg":     round(pct_vs_avg * 100, 1),   # e.g. +12.5 means 12.5% above avg
        "pct_vs_min":     round(pct_vs_min * 100, 1),
        "is_at_high":     is_at_high,
        "is_at_low":      is_at_low,
    }


# ---------------------------------------------------------------------------
# Agent node
# ---------------------------------------------------------------------------

def context_agent(state: AgentState) -> dict:
    """
    Classifies the product and analyses price history.
    """
    product_name          = state["purchase_context"]["product_name"]
    price                 = state["purchase_context"]["price"]
    product_price_history = state.get("product_price_history") or []

    # 1. LLM classification
    prompt = f"""
You are a product classification assistant.

Given the product name and price below, return a JSON object with:
  - "category": broad product category (e.g. Electronics, Clothing, Food, Books, Home, Sports, Beauty, Jewelry, Other)
  - "subcategory": more specific type (e.g. Headphones, Running Shoes, Novel, Earrings)
  - "tags": list of 3-5 lowercase descriptive tags

Product name: {product_name}
Price: {price}

Respond ONLY with valid JSON. No markdown, no explanation.
"""
    try:
        llm      = _get_llm()
        response = llm.invoke([HumanMessage(content=prompt)])
        context_output = json.loads(response.content.strip())
    except Exception as exc:
        context_output = {
            "category":    "Unknown",
            "subcategory": "Unknown",
            "tags":        [],
            "error":       str(exc),
        }

    # 2. Price history analysis
    price_analysis = _analyse_price_history(price, product_price_history)
    context_output["price_analysis"] = price_analysis

    price_note = ""
    if price_analysis.get("available"):
        trend = price_analysis["trend"]
        if price_analysis["is_at_high"]:
            price_note = f"AT HISTORICAL HIGH (avg={price_analysis['avg_price']})"
        elif price_analysis["is_at_low"]:
            price_note = f"AT HISTORICAL LOW (avg={price_analysis['avg_price']})"
        else:
            price_note = f"trend={trend} vs avg {price_analysis['pct_vs_avg']:+.1f}%"

    return {
        "context_output": context_output,
        "logs": [
            f"[ContextAgent] category={context_output.get('category')} "
            f"subcategory={context_output.get('subcategory')} "
            + (f"| price history: {price_note}" if price_note else "| no price history yet")
        ],
    }
