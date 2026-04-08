"""
Supervisor Agent
----------------
Aggregates all agent outputs and produces BUY | WAIT | AVOID.

Enhancements:
  Option A — LLM-generated personalised reason (via Groq)
  Option B — Alternative suggestion (better timing, target price)
  Option C — Waitlist mode: calculate the price at which we'd say BUY
"""

import os
import json
from langchain_groq import ChatGroq
from langchain_core.messages import HumanMessage

from backend.state import AgentState, FinalDecision


def _get_llm() -> ChatGroq:
    return ChatGroq(
        model="llama-3.3-70b-versatile",
        temperature=0.4,
        groq_api_key=os.getenv("GROQ_API_KEY", ""),
    )


# ---------------------------------------------------------------------------
# Option A — LLM-generated personalised reason
# ---------------------------------------------------------------------------

def _generate_reason(decision: str, signals: dict) -> str:
    """Ask the LLM to write a 2-sentence personalised reason."""
    prompt = f"""
You are a personal finance advisor helping someone decide whether to make an online purchase.

Decision: {decision}
Signals:
{json.dumps(signals, indent=2)}

Write exactly 2 sentences:
1. State clearly why the decision is {decision} using the most relevant signals.
2. Give one specific, actionable piece of advice.

Keep the tone direct, warm, and non-judgmental. No bullet points. No markdown.
"""
    try:
        llm      = _get_llm()
        response = llm.invoke([HumanMessage(content=prompt)])
        return response.content.strip()
    except Exception:
        return ""   # fall back to template reason if LLM fails


# ---------------------------------------------------------------------------
# Option B — Alternative suggestion
# ---------------------------------------------------------------------------

def _alternative_suggestion(
    decision: str,
    price_analysis: dict,
    seasonal: dict,
    emi: dict,
    price_usd: float,
    budget_usd: float,
    page_currency: str,
    raw_price: float,
) -> str:
    suggestions = []

    if decision in ("AVOID", "WAIT"):
        # Price trend
        if price_analysis.get("available"):
            if price_analysis.get("is_at_high"):
                avg = price_analysis["avg_price"]
                avg_local = avg  # already in page currency (stored from same page)
                suggestions.append(
                    f"This item is at its historical high — the average price was {page_currency} {avg_local:,.0f}. "
                    f"Consider waiting for it to return to average."
                )
            elif price_analysis.get("trend") == "falling":
                suggestions.append("Price is trending downward — waiting a few weeks could save you money.")

        # Sale season coming?
        if not seasonal.get("in_sale_season"):
            upcoming = _next_sale_season()
            if upcoming:
                suggestions.append(f"Consider waiting for {upcoming} — prices often drop significantly.")

        # EMI option
        if emi.get("recommended_plan") and decision == "WAIT":
            plan = emi["plans"][emi["recommended_plan"]]
            suggestions.append(
                f"If you do buy, a {emi['recommended_plan']} EMI plan at "
                f"~{page_currency} {plan['monthly_emi_local']:,.0f}/month could make it manageable."
            )

    return " ".join(suggestions[:2])  # keep it concise


def _next_sale_season() -> str:
    import datetime
    from backend.agents.profile_agent import SALE_SEASONS
    now   = datetime.datetime.utcnow()
    month = now.month
    day   = now.day

    for (m, d_start, d_end, name) in SALE_SEASONS:
        if m > month or (m == month and d_start > day + 7):
            return name
    # Wrap around to next year
    return SALE_SEASONS[0][3] if SALE_SEASONS else ""


# ---------------------------------------------------------------------------
# Option C — Waitlist / target price
# ---------------------------------------------------------------------------

def _waitlist_price(
    price_usd: float,
    budget_usd: float,
    threshold: float,
    page_currency: str,
    raw_price: float,
) -> dict:
    """Calculate the price at which we'd say BUY comfortably.

    Target = the price where budget_fraction reaches threshold (the user's
    own sensitivity boundary). Expressed in page currency via the
    page-price / USD ratio already captured in raw_price vs price_usd.
    """
    # Price (in USD) at which spend equals exactly the sensitivity threshold
    target_usd   = budget_usd * threshold
    # Convert back to page currency using the same ratio as the current price
    target_local = target_usd * (raw_price / price_usd) if price_usd else target_usd
    pct_drop     = ((raw_price - target_local) / raw_price * 100) if raw_price else 0

    if pct_drop > 70:
        msg = f"This item is well outside your budget range — it would need a {pct_drop:.0f}% drop to fit comfortably."
    elif pct_drop > 5:
        msg = (
            f"We'd say BUY if the price drops to "
            f"{page_currency} {target_local:,.0f} "
            f"(~{pct_drop:.0f}% off current price)."
        )
    else:
        msg = ""

    return {
        "target_price_usd":   round(target_usd, 2),
        "target_price_local": round(target_local, 2),
        "currency":           page_currency,
        "pct_drop_needed":    round(pct_drop, 1),
        "message":            msg,
    }


# ---------------------------------------------------------------------------
# Agent node
# ---------------------------------------------------------------------------

def supervisor_agent(state: AgentState) -> dict:
    financial = state["financial_output"] or {}
    sentiment = state["sentiment_output"] or {}
    context   = state["context_output"] or {}
    profile   = state["user_profile"] or {}

    affordability:  str   = financial.get("affordability", "comfortable")
    exceeds:        bool  = financial.get("exceeds_threshold", False)
    budget_fraction: float = financial.get("budget_fraction", 0.0)
    impulse_score:  float = sentiment.get("impulse_score", 0.0)
    is_impulse:     bool  = sentiment.get("is_impulse_prone", False)
    factors:        list  = sentiment.get("factors", [])
    urgency_count:  int   = sentiment.get("urgency_count", 0)
    late_night:     bool  = sentiment.get("late_night", False)
    category:       str   = context.get("category", "this category")
    price_analysis: dict  = context.get("price_analysis", {})

    risk_tolerance   = profile.get("price_sensitivity", "medium")
    savings_priority = profile.get("savings_priority", "moderate")
    financial_goal   = profile.get("financial_goal", "no_goal")
    savings_pressure = savings_priority == "top_priority"
    seasonal         = profile.get("seasonal", {})

    raw_price      = financial.get("raw_price", 0)
    page_currency  = financial.get("page_currency", "USD")
    price_usd      = financial.get("price_usd", raw_price)
    budget_usd     = financial.get("budget_usd", 0)
    budget_home    = financial.get("budget_in_home", budget_usd)
    home_currency  = financial.get("budget_currency", "USD")
    threshold      = financial.get("threshold", 0.20)
    emi            = financial.get("emi", {})
    opp            = financial.get("opportunity_cost", {})

    # ---- Decision matrix (risk-tolerance-aware) ----
    if risk_tolerance == "high":
        if affordability == "concerning":
            decision = "AVOID"
        elif affordability == "borderline" and (is_impulse or savings_pressure):
            decision = "AVOID"
        elif exceeds or affordability == "borderline" or savings_pressure:
            decision = "WAIT"
        else:
            decision = "BUY"
    elif risk_tolerance == "medium":
        if affordability == "concerning" and (is_impulse or savings_pressure):
            decision = "AVOID"
        elif affordability == "concerning":
            decision = "WAIT"
        elif exceeds or is_impulse or savings_pressure:
            decision = "WAIT"
        else:
            decision = "BUY"
    else:
        if affordability == "concerning" and is_impulse and savings_pressure:
            decision = "AVOID"
        elif affordability == "concerning" and is_impulse:
            decision = "WAIT"
        elif exceeds or savings_pressure:
            decision = "WAIT"
        else:
            decision = "BUY"

    # ---- Confidence ----
    if decision == "AVOID":
        confidence = round(min(0.65 + budget_fraction * 0.15 + impulse_score * 0.1, 1.0), 2)
    elif decision == "WAIT":
        confidence = round(min(0.55 + budget_fraction * 0.1 + impulse_score * 0.1, 1.0), 2)
    else:
        confidence = round(min(0.75 + (1 - impulse_score) * 0.15, 1.0), 2)

    # ---- Option A: LLM-generated reason ----
    llm_signals = {
        "decision":          decision,
        "product_category":  category,
        "price":             f"{page_currency} {raw_price:,.0f}",
        "budget":            f"{home_currency} {budget_home:,.0f}/month",
        "budget_fraction":   f"{budget_fraction:.0%}",
        "affordability":     affordability,
        "impulse_score":     impulse_score,
        "key_factors":       factors[:3],
        "risk_profile":      {"high": "conservative", "medium": "balanced", "low": "liberal"}.get(risk_tolerance),
        "financial_goal":    financial_goal.replace("_", " "),
        "price_at_high":     price_analysis.get("is_at_high", False),
        "urgency_detected":  urgency_count > 0,
        "late_night":        late_night,
        "sale_season":       seasonal.get("sale_season_name", ""),
    }
    llm_reason = _generate_reason(decision, llm_signals)

    # Template fallback if LLM fails
    if not llm_reason:
        if decision == "AVOID":
            parts = []
            if affordability in ("concerning", "borderline"):
                parts.append(f"price is {budget_fraction:.0%} of your monthly budget")
            if is_impulse and factors:
                parts.append(f"impulse signals: {'; '.join(factors[:2])}")
            if savings_pressure:
                parts.append(f"conflicts with your {financial_goal.replace('_', ' ')} goal")
            llm_reason = f"Skip this one — {' and '.join(parts)}."
        elif decision == "WAIT":
            parts = []
            if exceeds:
                parts.append(f"price is {budget_fraction:.0%} of your monthly budget")
            if is_impulse and factors:
                parts.append(f"impulse signals detected")
            if savings_pressure:
                parts.append(f"conflicts with your goal")
            llm_reason = "Pause before buying — " + " and ".join(parts) + "."
        else:
            llm_reason = f"This purchase fits your budget and aligns with your habits."

    # ---- Option B: Alternative suggestion ----
    suggestion = _alternative_suggestion(decision, price_analysis, seasonal, emi, price_usd, budget_usd, page_currency, raw_price)

    # ---- Option C: Waitlist target price ----
    waitlist = _waitlist_price(price_usd, budget_usd, threshold, page_currency, raw_price)

    # ---- Sidebar breakdown ----
    price_display  = f"{page_currency} {raw_price:,.0f}"
    if page_currency != "USD":
        price_display += f" (~${price_usd:,.0f})"
    budget_display = f"{home_currency} {budget_home:,.0f}/month"
    if home_currency != "USD":
        budget_display += f" (~${budget_usd:,.0f})"

    budget_sub = (
        "Well within your limit." if affordability == "comfortable" else
        "Getting close to your limit." if affordability == "borderline" else
        "Well over your limit."
    )

    # EMI row
    emi_detail = "No affordable EMI plan found for this price."
    if emi.get("recommended_plan"):
        plan = emi["plans"][emi["recommended_plan"]]
        emi_detail = (
            f"Best option: {emi['recommended_plan']} plan at "
            f"{page_currency} {plan['monthly_emi_local']:,.0f}/month "
            f"(total with interest: {page_currency} {plan['total_paid_usd'] * (raw_price / price_usd if price_usd else 1):,.0f})"
        )

    # Opportunity cost row
    opp_detail = opp.get("goal_note") or f"Equivalent to {opp.get('months_of_budget', 0):.1f} months of your shopping budget."
    opp_sub    = f"If invested for 1 year at 8%, this could grow to ${opp.get('investment_value_1yr', 0):,.0f}."

    # Price history row
    price_hist_detail = "No price history yet — visit again to track changes."
    price_hist_sub    = None
    if price_analysis.get("available"):
        trend = price_analysis.get("trend", "stable")
        avg   = price_analysis.get("avg_price", 0)
        avg_local = avg  # already in page currency (stored from same product page)
        trend_icon = "📈" if trend == "rising" else ("📉" if trend == "falling" else "➡️")
        price_hist_detail = (
            f"{trend_icon} Price trend: {trend} | "
            f"Avg: {page_currency} {avg_local:,.0f} | "
            f"Seen {price_analysis['observations']}x"
        )
        if price_analysis.get("is_at_high"):
            price_hist_sub = "⚠️ Currently at historical high — you may have paid less before."
        elif price_analysis.get("is_at_low"):
            price_hist_sub = "✅ Currently at historical low — good time if you need it."

    # Waitlist row
    waitlist_detail = waitlist.get("message") or "Price fits your comfortable zone."
    waitlist_sub    = suggestion or None

    breakdown = {
        "budget": {
            "label":  "Budget Impact",
            "status": affordability,
            "detail": f"{price_display} vs your {budget_display}",
            "sub":    f"That's {budget_fraction:.0%} of your monthly budget — {budget_sub}",
        },
        "emi": {
            "label":  "Instalment Option",
            "status": "ok" if emi.get("recommended_plan") else "concerning",
            "detail": emi_detail,
            "sub":    None,
        },
        "opportunity": {
            "label":  "Opportunity Cost",
            "status": "borderline" if budget_fraction > 0.3 else "comfortable",
            "detail": opp_detail,
            "sub":    opp_sub,
        },
        "impulse": {
            "label":  "Impulse Risk",
            "status": "high" if is_impulse else ("medium" if impulse_score > 0.2 else "low"),
            "detail": factors[0] if factors else "No strong impulse signals detected",
            "sub":    sentiment.get("history_context") or None,
        },
        "price_history": {
            "label":  "Price History",
            "status": "concerning" if price_analysis.get("is_at_high") else "comfortable",
            "detail": price_hist_detail,
            "sub":    price_hist_sub,
        },
        "category": {
            "label":  "Category Fit",
            "status": "familiar" if category in profile.get("typical_categories", []) else "unfamiliar",
            "detail": category,
            "sub":    f"{'In' if category in profile.get('typical_categories', []) else 'Outside'} your usual shopping categories",
        },
        "savings": {
            "label":  "Savings Goal",
            "status": "at_risk" if (savings_pressure and exceeds) else "ok",
            "detail": financial_goal.replace("_", " ").title() if financial_goal != "no_goal" else "No specific goal set",
            "sub":    "This purchase conflicts with your goal." if (savings_pressure and exceeds and financial_goal != "no_goal") else None,
        },
        "seasonal": {
            "label":  "Seasonal Timing",
            "status": "borderline" if seasonal.get("in_sale_season") else "comfortable",
            "detail": seasonal.get("sale_season_name") or "No major sale season right now",
            "sub":    seasonal.get("seasonal_context") or None,
        },
        "waitlist": {
            "label":  "Smart Buy Price",
            "status": "ok" if decision == "BUY" else "borderline",
            "detail": waitlist_detail,
            "sub":    waitlist_sub,
        },
        "risk_profile": {
            "label":  "Your Risk Profile",
            "status": risk_tolerance,
            "detail": {"high": "Conservative — you prefer to play it safe", "medium": "Balanced — you weigh pros and cons", "low": "Liberal — you spend freely"}.get(risk_tolerance, "Balanced"),
            "sub":    None,
        },
    }

    final_decision: FinalDecision = {
        "decision":   decision,
        "confidence": confidence,
        "reason":     llm_reason,
        "breakdown":  breakdown,
    }

    return {
        "final_decision": final_decision,
        "logs": [
            f"[SupervisorAgent] risk={risk_tolerance} affordability={affordability} "
            f"impulse={is_impulse} urgency={urgency_count} late_night={late_night} "
            f"→ decision={decision} confidence={confidence}"
        ],
    }
