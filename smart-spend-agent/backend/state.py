"""
Shared state object for the SmartSpend LangGraph multi-agent system.
All agents read from and write to this shared state.
"""

import operator
from typing import Annotated, Any, Optional
from typing_extensions import TypedDict


# Reducer: always keep the latest value (last-write-wins)
def _keep_last(a: Any, b: Any) -> Any:
    return b


class PurchaseContext(TypedDict):
    """Input data about the purchase being evaluated."""
    user_id: str
    product_name: str
    price: float
    currency: str        # ISO code detected from the page e.g. "INR", "EUR"
    home_currency: str   # auto-detected from browser locale e.g. "INR"
    url: str
    site: str


class UserProfile(TypedDict):
    """Parsed user profile derived from the extension's options page."""
    user_id: str
    monthly_budget: float
    budget_currency: str          # auto-detected from browser locale, no user input needed
    price_sensitivity: str        # "low", "medium", "high"
    typical_categories: list[str]
    impulse_history: int          # 0–10 score derived from impulse_frequency
    savings_priority: str         # "not_priority", "moderate", "top_priority"
    financial_goal: str
    category_strictness: dict     # per-category override e.g. {"Electronics": "strict"}


class FinalDecision(TypedDict):
    """The final output returned to the client."""
    decision: str                 # "BUY", "WAIT", "AVOID"
    confidence: float             # 0.0 – 1.0
    reason: str
    breakdown: dict[str, Any]     # per-signal summary for the sidebar


class AgentState(TypedDict):
    """
    Central shared state passed through every node in the LangGraph workflow.
    All fields declare an explicit reducer so LangGraph 1.x never raises
    INVALID_CONCURRENT_GRAPH_UPDATE.
    """
    # --- Input ---
    user_id: Annotated[str, _keep_last]
    purchase_context: Annotated[PurchaseContext, _keep_last]

    # --- Raw profile from the extension options page ---
    profile_input: Annotated[Optional[dict[str, Any]], _keep_last]

    # --- Real purchase history from chrome.storage.local ---
    purchase_history: Annotated[Optional[list[dict[str, Any]]], _keep_last]

    # --- Live page signals from the extension (time, urgency, cart signals) ---
    page_signals: Annotated[Optional[dict[str, Any]], _keep_last]

    # --- Price observations for this specific product URL ---
    product_price_history: Annotated[Optional[list[dict[str, Any]]], _keep_last]

    # --- Agent outputs (populated as the graph executes) ---
    user_profile: Annotated[Optional[UserProfile], _keep_last]
    context_output: Annotated[Optional[dict[str, Any]], _keep_last]
    financial_output: Annotated[Optional[dict[str, Any]], _keep_last]
    sentiment_output: Annotated[Optional[dict[str, Any]], _keep_last]

    # --- Final result ---
    final_decision: Annotated[Optional[FinalDecision], _keep_last]

    # --- Execution log: each agent appends; operator.add merges the lists ---
    logs: Annotated[list[str], operator.add]
