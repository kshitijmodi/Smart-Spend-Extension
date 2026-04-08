"""
Financial Agent
---------------
1. Converts page price to USD and scores affordability.
2. EMI / Instalment Analysis (Option A): shows monthly cost for 3/6/12 month plans.
3. Opportunity Cost (Option B): shows what the money could do instead.
"""

from backend.state import AgentState

SENSITIVITY_THRESHOLDS = {
    "low":    0.50,
    "medium": 0.20,
    "high":   0.10,
}

# Approximate exchange rates: 1 USD = X local units
RATES_VS_USD = {
    "USD": 1.0,   "EUR": 0.92,  "GBP": 0.79,  "INR": 83.5,
    "CAD": 1.36,  "AUD": 1.53,  "SGD": 1.34,  "JPY": 149.5,
    "KRW": 1325.0,"BRL": 5.0,   "CNY": 7.24,  "TRY": 32.0,
    "UAH": 38.0,  "NGN": 1550.0,"AED": 3.67,  "SAR": 3.75,
    "THB": 35.5,  "VND": 24800.0,"PLN": 3.95, "SEK": 10.5,
    "IDR": 15800.0,"MYR": 4.7,  "PHP": 56.5,
}

GOAL_LABELS = {
    "emergency_fund":  "emergency fund",
    "debt_payoff":     "debt payoff",
    "investing":       "investment portfolio",
    "saving_purchase": "saving goal",
    "no_goal":         "",
}


def convert_price(price: float, from_cur: str, to_cur: str) -> float:
    r_from = RATES_VS_USD.get(from_cur, 1.0)
    r_to   = RATES_VS_USD.get(to_cur, 1.0)
    return price / r_from * r_to


def _emi_analysis(price_usd: float, budget_usd: float, page_currency: str, raw_price: float) -> dict:
    """
    Option A — Instalment Analysis.
    Annual interest rate ~15% (typical consumer credit / BNPL).
    """
    annual_rate   = 0.15
    monthly_rate  = annual_rate / 12
    results       = {}

    for months in [3, 6, 12]:
        if monthly_rate > 0:
            emi_usd = price_usd * monthly_rate * (1 + monthly_rate) ** months / ((1 + monthly_rate) ** months - 1)
        else:
            emi_usd = price_usd / months

        emi_local    = convert_price(emi_usd, "USD", page_currency)
        pct_of_budget = emi_usd / budget_usd if budget_usd else 1.0
        total_paid   = emi_usd * months
        interest_usd = total_paid - price_usd

        results[f"{months}m"] = {
            "monthly_emi_usd":   round(emi_usd, 2),
            "monthly_emi_local": round(emi_local, 2),
            "pct_of_budget":     round(pct_of_budget, 3),
            "total_paid_usd":    round(total_paid, 2),
            "interest_usd":      round(interest_usd, 2),
            "fits_budget":       pct_of_budget <= 0.20,
        }

    # Find the shortest plan that fits within 20% of budget
    recommended = next(
        (k for k in ["3m", "6m", "12m"] if results[k]["fits_budget"]),
        None
    )
    return {"plans": results, "recommended_plan": recommended}


def _opportunity_cost(price_usd: float, budget_usd: float, financial_goal: str, monthly_budget: float) -> dict:
    """
    Option B — Opportunity Cost.
    Shows what else this money could achieve.
    """
    # How many months of full budget does this represent?
    months_of_budget = price_usd / monthly_budget if monthly_budget else 0

    # Savings capacity: assume user saves ~30% of monthly budget
    monthly_savings  = monthly_budget * 0.30
    months_to_goal   = price_usd / monthly_savings if monthly_savings else 0

    # Simple investment return at 8% annual over 1 year
    investment_value_1yr = price_usd * 1.08

    goal_label = GOAL_LABELS.get(financial_goal, "")
    goal_note  = ""
    if goal_label and monthly_savings > 0:
        goal_note = f"This amount would fund {months_to_goal:.1f} months of savings toward your {goal_label}."

    return {
        "months_of_budget":      round(months_of_budget, 1),
        "months_to_save_back":   round(months_to_goal, 1),
        "investment_value_1yr":  round(investment_value_1yr, 2),
        "goal_note":             goal_note,
        "monthly_savings_est":   round(monthly_savings, 2),
    }


def financial_agent(state: AgentState) -> dict:
    profile        = state["user_profile"]
    ctx            = state["purchase_context"]
    raw_price      = ctx["price"]
    page_currency  = ctx.get("currency", "USD")
    budget_currency = profile.get("budget_currency", "USD")
    monthly_budget  = profile["monthly_budget"]
    sensitivity     = profile["price_sensitivity"]
    financial_goal  = profile.get("financial_goal", "no_goal")

    price_in_usd  = convert_price(raw_price, page_currency, "USD")
    budget_in_home = round(convert_price(monthly_budget, "USD", budget_currency), 2)
    currency_note  = (
        f" ({raw_price} {page_currency} → ${price_in_usd:.2f} USD)"
        if page_currency != "USD" else ""
    )

    budget_fraction = price_in_usd / monthly_budget if monthly_budget > 0 else 1.0
    threshold       = SENSITIVITY_THRESHOLDS.get(sensitivity, 0.20)
    exceeds         = budget_fraction > threshold

    if budget_fraction <= threshold * 0.5:
        affordability = "comfortable"
    elif budget_fraction <= threshold:
        affordability = "borderline"
    else:
        affordability = "concerning"

    # Option A — EMI
    emi = _emi_analysis(price_in_usd, monthly_budget, page_currency, raw_price)

    # Option B — Opportunity Cost
    opp = _opportunity_cost(price_in_usd, monthly_budget, financial_goal, monthly_budget)

    financial_output = {
        "raw_price":         raw_price,
        "page_currency":     page_currency,
        "price_usd":         round(price_in_usd, 2),
        "budget_usd":        monthly_budget,
        "budget_currency":   budget_currency,
        "budget_in_home":    budget_in_home,
        "budget_fraction":   round(budget_fraction, 3),
        "threshold":         threshold,
        "exceeds_threshold": exceeds,
        "affordability":     affordability,
        "emi":               emi,
        "opportunity_cost":  opp,
    }

    emi_note = ""
    if emi["recommended_plan"]:
        plan = emi["plans"][emi["recommended_plan"]]
        emi_note = f" | EMI option: {emi['recommended_plan']} @ ${plan['monthly_emi_usd']:.0f}/mo"

    return {
        "financial_output": financial_output,
        "logs": [
            f"[FinancialAgent]{currency_note} "
            f"${price_in_usd:.2f} vs ${monthly_budget} budget | "
            f"{affordability} ({budget_fraction:.0%} of budget, threshold={threshold:.0%}){emi_note}"
        ],
    }
