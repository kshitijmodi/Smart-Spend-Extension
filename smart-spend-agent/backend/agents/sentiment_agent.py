"""
Sentiment Agent
---------------
Scores impulse-purchase risk from real purchase history + live page signals.

Signals:
  (existing) Purchase volume, category repeats, ignored warnings, unfamiliar category
  (Option A) Time-of-day: late night / weekend purchases are statistically more impulsive
  (Option B) Cart abandonment: user has visited this site before without buying
  (Option C) Urgency keywords: "Only 2 left", "Flash sale", "Ends tonight", etc.
"""

import time
from backend.state import AgentState

IMPULSE_PRONE_CATEGORIES = {"Electronics", "Beauty", "Clothing", "Gaming", "Toys", "Jewelry"}

IMPULSE_FREQ_FALLBACK = {
    "rarely":     0,
    "sometimes":  0.2,
    "often":      0.5,
    "very_often": 0.8,
}

THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000


def sentiment_agent(state: AgentState) -> dict:
    profile      = state["user_profile"]
    context      = state["context_output"] or {}
    history      = state["purchase_history"] or []
    page_signals = state.get("page_signals") or {}
    category     = context.get("category", "Unknown")
    typical      = set(profile.get("typical_categories", []))

    factors: list[str] = []
    score = 0.0
    history_context = ""

    # ------------------------------------------------------------------ #
    # Option A — Time-of-day signal                                       #
    # ------------------------------------------------------------------ #
    hour       = page_signals.get("hour_of_day", 12)
    is_weekend = page_signals.get("is_weekend", False)

    late_night = hour >= 22 or hour <= 4
    if late_night:
        score += 0.2
        factors.append(f"Late-night browsing ({hour:02d}:xx) — impulse risk is higher after 10 PM")
    elif is_weekend:
        score += 0.1
        factors.append("Weekend purchase — you tend to browse more freely on weekends")

    # ------------------------------------------------------------------ #
    # Option B — Cart abandonment / repeat visit                         #
    # ------------------------------------------------------------------ #
    previously_visited = page_signals.get("previously_visited", False)
    if previously_visited:
        # Came back after leaving before — could be considered or impulsive
        prior_decisions = [h for h in history if h.get("site") == page_signals.get("site", "")]
        prior_avoids    = [h for h in prior_decisions if h.get("decision") in ("AVOID", "WAIT")]
        if prior_avoids:
            score += 0.25
            factors.append(f"You were previously cautioned about purchases on this site and returned")
        else:
            # Returning without a prior warning — neutral to slightly positive
            score -= 0.05  # considered purchase, not impulsive

    # ------------------------------------------------------------------ #
    # Option C — Urgency / scarcity keyword detection                    #
    # ------------------------------------------------------------------ #
    urgency_found = page_signals.get("urgency_keywords_found", [])
    if len(urgency_found) >= 3:
        score += 0.3
        factors.append(f"Heavy urgency language detected: {', '.join(urgency_found[:3])} — these are designed to pressure you")
    elif urgency_found:
        score += 0.15
        factors.append(f"Urgency trigger on page: \"{urgency_found[0]}\" — don't let artificial scarcity rush your decision")

    # ------------------------------------------------------------------ #
    # Purchase history signals (existing)                                #
    # ------------------------------------------------------------------ #
    if history:
        now_ms      = int(time.time() * 1000)
        recent      = [h for h in history if (now_ms - h.get("ts", 0)) < THIRTY_DAYS_MS]
        total_count = len(recent)

        if total_count >= 10:
            score += 0.3
            factors.append(f"{total_count} purchases evaluated in the last 30 days — high activity")
            history_context = f"{total_count} purchases in the last 30 days"
        elif total_count >= 5:
            score += 0.15
            history_context = f"{total_count} purchases in the last 30 days"

        impulse_cat_count = sum(1 for h in recent if h.get("category") in IMPULSE_PRONE_CATEGORIES)
        if impulse_cat_count >= 4:
            score += 0.3
            factors.append(f"{impulse_cat_count} purchases in impulse-prone categories recently")
        elif impulse_cat_count >= 2:
            score += 0.15
            factors.append(f"{impulse_cat_count} purchases in impulse-prone categories recently")

        bought_anyway = sum(
            1 for h in recent
            if h.get("decision") in ("WAIT", "AVOID")
            and h.get("category") in IMPULSE_PRONE_CATEGORIES
        )
        if bought_anyway >= 2:
            score += 0.3
            factors.append(f"Proceeded on {bought_anyway} cautioned purchases recently")
        elif bought_anyway == 1:
            score += 0.15

        if category in IMPULSE_PRONE_CATEGORIES and category not in typical:
            score += 0.2
            factors.append(f"'{category}' is impulse-prone and outside your usual categories")
        elif category in IMPULSE_PRONE_CATEGORIES:
            score += 0.1
            factors.append(f"'{category}' is a common impulse-buy category")

    else:
        # No history — fall back to self-reported frequency
        freq  = profile.get("impulse_frequency", "sometimes")
        score = IMPULSE_FREQ_FALLBACK.get(freq, 0.2) + score
        if freq not in ("rarely",):
            factors.append(f"Self-reported impulse frequency: {freq.replace('_', ' ')}")
        history_context = "Based on your profile — improves with purchase history"

        if category in IMPULSE_PRONE_CATEGORIES:
            score = min(score + 0.2, 1.0)
            factors.append(f"'{category}' is a common impulse-buy category")
        if category not in typical and category != "Unknown":
            score = min(score + 0.15, 1.0)
            factors.append(f"'{category}' is outside your usual categories")

    score            = round(min(max(score, 0.0), 1.0), 3)
    is_impulse_prone = score >= 0.4

    return {
        "sentiment_output": {
            "impulse_score":    score,
            "is_impulse_prone": is_impulse_prone,
            "factors":          factors,
            "history_context":  history_context,
            "urgency_count":    len(urgency_found),
            "late_night":       late_night,
            "is_weekend":       is_weekend,
        },
        "logs": [
            f"[SentimentAgent] score={score} impulse={is_impulse_prone} "
            f"late_night={late_night} urgency={len(urgency_found)} "
            f"history={len(history)}"
        ],
    }
