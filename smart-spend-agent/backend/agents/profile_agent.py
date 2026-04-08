"""
Profile Agent
-------------
1. Converts raw profile_input into a structured UserProfile.
2. Detects seasonal spending patterns from purchase history (Option C):
   - Identifies known global/regional sale seasons near the current date.
   - Detects if the user historically spends more during this time of year.
"""

import time
import datetime
from backend.state import AgentState, UserProfile

# ---- Budget / sensitivity maps ------------------------------------------

BUDGET_MAP = {
    "under_100":  75.0,
    "100_300":    200.0,
    "300_600":    450.0,
    "600_1000":   800.0,
    "1000_plus":  1500.0,
}

IMPULSE_MAP = {
    "rarely":     1,
    "sometimes":  3,
    "often":      6,
    "very_often": 9,
}

RISK_TO_SENSITIVITY = {
    "conservative": "high",
    "balanced":     "medium",
    "liberal":      "low",
}

# ---- Known sale seasons (month, day_start, day_end, name) ---------------
# Approximate windows; ±2 weeks around major shopping events

SALE_SEASONS = [
    (1,  1,  20,  "New Year Sale"),
    (1, 24,  31,  "Republic Day Sale (India)"),
    (2, 10,  20,  "Valentine's Day Sale"),
    (6,  1,  30,  "Mid-Year / Summer Sale"),
    (7,  1,  20,  "Amazon Prime Day"),
    (9, 20,  30,  "Navratri Sale (India)"),
    (10, 1,  31,  "Diwali / Big Billion Days"),
    (11, 1,  30,  "Black Friday / Cyber Monday"),
    (12, 15, 31,  "Christmas / Year-End Sale"),
]


def _detect_seasonal_risk(history: list[dict]) -> dict:
    """
    Returns:
        in_sale_season (bool)  — current date is within a known sale window
        sale_season_name (str) — name of the current sale period, if any
        user_overspends_seasonally (bool) — user's past history shows more purchases this month
        seasonal_context (str) — human-readable note for the sidebar
    """
    now   = datetime.datetime.utcnow()
    month = now.month
    day   = now.day

    # Check if we're in a known sale season
    current_season = None
    for (m, d_start, d_end, name) in SALE_SEASONS:
        if month == m and d_start <= day <= d_end:
            current_season = name
            break

    # Analyse user history: how many purchases happened in this calendar month?
    thirty_days_ms  = 30 * 24 * 60 * 60 * 1000
    now_ms          = int(time.time() * 1000)
    recent_count    = sum(1 for h in history if (now_ms - h.get("ts", 0)) < thirty_days_ms)

    # Compare to the user's average monthly rate
    if history:
        oldest_ts      = min(h.get("ts", now_ms) for h in history)
        months_tracked = max((now_ms - oldest_ts) / (30 * 24 * 60 * 60 * 1000), 1)
        avg_per_month  = len(history) / months_tracked
        overspending   = recent_count > avg_per_month * 1.5 and recent_count >= 3
    else:
        avg_per_month  = 0
        overspending   = False

    seasonal_context = ""
    if current_season and overspending:
        seasonal_context = f"It's {current_season} season and you've been buying more than usual this month ({recent_count} purchases vs avg {avg_per_month:.1f}/month)."
    elif current_season:
        seasonal_context = f"It's {current_season} season — be mindful of sale-induced spending urges."
    elif overspending:
        seasonal_context = f"You've made {recent_count} purchases this month vs your average of {avg_per_month:.1f}/month."

    return {
        "in_sale_season":              current_season is not None,
        "sale_season_name":            current_season or "",
        "user_overspends_seasonally":  overspending,
        "recent_purchase_count":       recent_count,
        "avg_monthly_purchases":       round(avg_per_month, 1),
        "seasonal_context":            seasonal_context,
    }


# ---- Agent node ----------------------------------------------------------

def profile_agent(state: AgentState) -> dict:
    raw     = state.get("profile_input") or {}
    history = state.get("purchase_history") or []

    budget_range     = raw.get("monthly_budget_range", "300_600")
    risk_tolerance   = raw.get("risk_tolerance", "balanced")
    categories       = raw.get("categories", [])
    impulse_freq     = raw.get("impulse_frequency", "sometimes")
    savings_priority = raw.get("savings_priority", "moderate")
    financial_goal   = raw.get("financial_goal", "no_goal")
    cat_strictness   = raw.get("category_strictness", {})

    monthly_budget    = BUDGET_MAP.get(budget_range, 450.0)
    impulse_history   = IMPULSE_MAP.get(impulse_freq, 3)
    price_sensitivity = RISK_TO_SENSITIVITY.get(risk_tolerance, "medium")
    budget_currency   = state["purchase_context"].get("home_currency", "USD")

    if savings_priority == "top_priority" and price_sensitivity == "medium":
        price_sensitivity = "high"
    elif savings_priority == "top_priority" and price_sensitivity == "low":
        price_sensitivity = "medium"

    # Seasonal pattern detection (Option C)
    seasonal = _detect_seasonal_risk(history)

    profile: UserProfile = {
        "user_id":            "extension_user",
        "monthly_budget":     monthly_budget,
        "budget_currency":    budget_currency,
        "price_sensitivity":  price_sensitivity,
        "typical_categories": categories,
        "impulse_history":    impulse_history,
        "impulse_frequency":  impulse_freq,
        "savings_priority":   savings_priority,
        "financial_goal":     financial_goal,
        "category_strictness": cat_strictness,
        "seasonal":           seasonal,
    }

    season_note = f" | 🛍 {seasonal['sale_season_name']}" if seasonal["in_sale_season"] else ""
    return {
        "user_profile": profile,
        "logs": [
            f"[ProfileAgent] budget=${monthly_budget} sensitivity={price_sensitivity} "
            f"impulse_history={impulse_history} goal={financial_goal}{season_note}"
        ],
    }
