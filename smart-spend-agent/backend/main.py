"""
FastAPI server for the SmartSpend agent system.

Endpoints
---------
POST /evaluate_purchase
    Accepts purchase details, runs the LangGraph multi-agent workflow,
    and returns a buy/avoid recommendation.

GET /health
    Simple liveness probe.
"""

import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import Optional

from backend.graph import workflow
from backend.state import AgentState

app = FastAPI(
    title="SmartSpend Agent API",
    description="Multi-agent AI system that evaluates online purchases.",
    version="0.2.0",
)

# Allow Chrome extension to call the API
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Request / response schemas
# ---------------------------------------------------------------------------

class ProfileInput(BaseModel):
    """User profile as collected from the extension's options page."""
    monthly_budget_range: str = Field(..., example="300_600")
    # under_100 | 100_300 | 300_600 | 600_1000 | 1000_plus

    risk_tolerance: str = Field(..., example="balanced")
    # conservative | balanced | liberal

    categories: list[str] = Field(..., example=["Electronics", "Books"])
    # any subset of the standard category list

    impulse_frequency: str = Field(..., example="sometimes")
    # rarely | sometimes | often | very_often

    savings_priority: str = Field(..., example="moderate")
    # not_priority | moderate | top_priority

    financial_goal: str = Field(..., example="emergency_fund")
    # emergency_fund | debt_payoff | investing | saving_purchase | no_goal

    category_strictness: Optional[dict[str, str]] = Field(default_factory=dict)
    # e.g. {"Electronics": "strict", "Books": "lenient"}


class PurchaseHistoryEntry(BaseModel):
    ts:        int
    product:   str
    price:     float
    currency:  str
    site:      str
    decision:  str
    category:  str = "Unknown"

class PageSignals(BaseModel):
    hour_of_day:            int  = 12
    is_weekend:             bool = False
    urgency_keywords_found: list[str] = Field(default_factory=list)
    previously_visited:     bool = False

class PriceObservation(BaseModel):
    ts:       int
    price:    float
    currency: str

class EvaluateRequest(BaseModel):
    product_name: str = Field(..., example="Sony WH-1000XM5 Headphones")
    price: float = Field(..., ge=0, example=399.0)
    currency: str = Field(default="USD", example="INR")
    home_currency: str = Field(default="USD", example="INR")
    url: str = Field(..., example="https://amazon.com/dp/B09XS7JWHH")
    site: str = Field(default="", example="amazon.com")
    profile: ProfileInput
    purchase_history:       list[PurchaseHistoryEntry] = Field(default_factory=list)
    page_signals:           PageSignals                = Field(default_factory=PageSignals)
    product_price_history:  list[PriceObservation]    = Field(default_factory=list)


class EvaluateResponse(BaseModel):
    decision: str
    confidence: float
    reason: str
    breakdown: dict
    logs: list[str]


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.get("/health")
def health() -> dict:
    """Liveness probe."""
    return {"status": "ok"}


@app.post("/evaluate_purchase", response_model=EvaluateResponse)
def evaluate_purchase(request: EvaluateRequest) -> EvaluateResponse:
    """
    Run the SmartSpend multi-agent workflow and return a purchase decision.

    The user profile is sent directly from the extension — no DB lookup needed.
    """
    initial_state: AgentState = {
        "user_id": "extension_user",
        "purchase_context": {
            "user_id": "extension_user",
            "product_name": request.product_name,
            "price": request.price,
            "currency": request.currency,
            "home_currency": request.home_currency,
            "url": request.url,
            "site": request.site,
        },
        "profile_input":          request.profile.model_dump(),
        "purchase_history":       [e.model_dump() for e in request.purchase_history],
        "page_signals":           request.page_signals.model_dump(),
        "product_price_history":  [p.model_dump() for p in request.product_price_history],
        "user_profile": None,
        "context_output": None,
        "financial_output": None,
        "sentiment_output": None,
        "final_decision": None,
        "logs": [],
    }

    try:
        result: AgentState = workflow.invoke(initial_state)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Agent workflow failed: {exc}")

    decision = result.get("final_decision")
    if not decision:
        raise HTTPException(status_code=500, detail="No final decision produced by the workflow.")

    return EvaluateResponse(
        decision=decision["decision"],
        confidence=decision["confidence"],
        reason=decision["reason"],
        breakdown=decision.get("breakdown", {}),
        logs=result.get("logs", []),
    )


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    uvicorn.run("backend.main:app", host="0.0.0.0", port=8000, reload=True)
