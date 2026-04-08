# SmartSpend Agent

A **multi-agent AI system** built with LangGraph and FastAPI that evaluates online purchases and recommends **BUY**, **WAIT**, or **AVOID** — personalised to the user's financial profile, risk tolerance, purchase history, and real-time page signals.

Designed to power the SmartSpend Chrome Extension, which injects a decision pill + sidebar on any checkout page.

---

## Architecture

```
Context Agent  ──▶  Profile Agent  ──▶  Financial Agent  ──▶  Sentiment Agent  ──▶  Supervisor Agent  ──▶  Decision
```

All agents run sequentially. Each agent returns only the keys it owns; LangGraph merges them into shared state.

### Agents

| Agent | Skills |
|---|---|
| **Context Agent** | Classifies product (category, subcategory, tags) via Groq LLM; analyses local price history to detect trend (rising/falling/stable) and flag historical highs/lows |
| **Profile Agent** | Converts raw profile input into a structured `UserProfile`; detects seasonal spending risk (Black Friday, Diwali, Prime Day, etc.) from purchase history |
| **Financial Agent** | Converts page price to USD for comparison; scores affordability (comfortable / borderline / concerning); calculates 3/6/12-month EMI at 15% APR; computes opportunity cost and investment value |
| **Sentiment Agent** | Scores impulse-purchase risk from purchase history; detects late-night / weekend browsing (+0.2/+0.1); flags cart abandonment with prior AVOID/WAIT (+0.25); identifies urgency keywords ("Only 2 left", "Flash sale") |
| **Supervisor Agent** | Risk-tolerance-aware decision matrix (Conservative / Balanced / Liberal); generates 2-sentence personalised reason via Groq LLM; suggests alternative timing or EMI plan; calculates smart waitlist target price |

### Decisions

| Decision | Meaning |
|---|---|
| `BUY` | Purchase fits within budget, habits, and financial goals |
| `WAIT` | One or more mild concerns — price, impulse risk, or savings goal conflict |
| `AVOID` | Strong financial stress and/or high impulse risk — skip this one |

---

## Project Structure

```
smart-spend-agent/
├── backend/
│   ├── main.py              # FastAPI server — request/response schemas, CORS
│   ├── graph.py             # LangGraph sequential workflow
│   ├── state.py             # AgentState TypedDict with Annotated reducers
│   └── agents/
│       ├── context_agent.py     # LLM classification + price history analysis
│       ├── profile_agent.py     # Profile builder + seasonal risk detection
│       ├── financial_agent.py   # Affordability + EMI + opportunity cost
│       ├── sentiment_agent.py   # Impulse scoring (history + page signals)
│       └── supervisor_agent.py  # Decision matrix + LLM reason + sidebar breakdown
├── requirements.txt
└── README.md

extension/
├── manifest.json            # Manifest V3
├── content.js               # Checkout detection, price extraction, sidebar injection
├── options.html / options.js # User profile setup (structured inputs only)
├── popup.html / popup.js    # Extension popup — profile status
└── icon*.png
```

---

## Getting Started

### 1. Clone and install

```bash
cd smart-spend-agent
python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

### 2. Set your Groq API key

Get a free key at [console.groq.com](https://console.groq.com).

```bash
cp .env.example .env               # Windows: copy .env.example .env
```

Edit `.env` and paste your key:

```
GROQ_API_KEY=gsk_your_key_here
```

Then load it before starting the server:

```bash
export $(cat .env | xargs)         # Windows: use a tool like dotenv or set manually
```

### 3. Run the server

```bash
python -m uvicorn backend.main:app --reload --port 8000
```

### 4. Explore the API

Open `http://localhost:8000/docs` for the interactive Swagger UI.

---

## API Reference

### `POST /evaluate_purchase`

Evaluate whether a purchase is a good idea.

**Request body:**

```json
{
  "product_name": "Sony WH-1000XM5 Headphones",
  "price": 399.0,
  "currency": "USD",
  "home_currency": "USD",
  "url": "https://amazon.com/dp/B09XS7JWHH",
  "site": "amazon.com",
  "profile": {
    "monthly_budget_range": "300_600",
    "risk_tolerance": "conservative",
    "categories": ["Electronics", "Books"],
    "impulse_frequency": "sometimes",
    "savings_priority": "top_priority",
    "financial_goal": "emergency_fund",
    "category_strictness": {}
  },
  "purchase_history": [
    {
      "ts": 1710000000000,
      "product": "AirPods Pro",
      "price": 249.0,
      "currency": "USD",
      "site": "apple.com",
      "decision": "BUY",
      "category": "Electronics"
    }
  ],
  "page_signals": {
    "hour_of_day": 23,
    "is_weekend": false,
    "urgency_keywords_found": ["Only 2 left", "Flash sale"],
    "previously_visited": true
  },
  "product_price_history": [
    { "ts": 1705000000000, "price": 349.0, "currency": "USD" },
    { "ts": 1707000000000, "price": 379.0, "currency": "USD" }
  ]
}
```

**Field reference:**

| Field | Type | Description |
|---|---|---|
| `product_name` | string | Product name as scraped from the page |
| `price` | float | Raw price in page currency |
| `currency` | string | Page currency code (e.g. `INR`, `USD`, `EUR`) |
| `home_currency` | string | User's home currency (auto-detected from locale) |
| `url` | string | Full product URL |
| `site` | string | Domain (e.g. `amazon.in`) |
| `profile` | object | User profile from extension options page |
| `purchase_history` | array | Past decisions stored in `chrome.storage.local` |
| `page_signals` | object | Time-of-day, urgency keywords, previously visited |
| `product_price_history` | array | Per-URL price observations stored locally |

**Profile fields:**

| Field | Options |
|---|---|
| `monthly_budget_range` | `under_100` \| `100_300` \| `300_600` \| `600_1000` \| `1000_plus` |
| `risk_tolerance` | `conservative` \| `balanced` \| `liberal` |
| `savings_priority` | `not_priority` \| `moderate` \| `top_priority` |
| `financial_goal` | `emergency_fund` \| `debt_payoff` \| `investing` \| `saving_purchase` \| `no_goal` |
| `impulse_frequency` | `rarely` \| `sometimes` \| `often` \| `very_often` |
| `categories` | Any subset of standard categories |

**Response:**

```json
{
  "decision": "AVOID",
  "confidence": 0.98,
  "reason": "The price exceeds your budget by 188% and late-night browsing increases impulse risk. Wait until morning and reassess whether this aligns with your emergency fund goal.",
  "breakdown": {
    "budget": {
      "label": "Budget Impact",
      "status": "concerning",
      "detail": "INR 70,500 (~$844) vs your INR 37,575/month (~$450)",
      "sub": "That's 188% of your monthly budget — Well over your limit."
    },
    "emi": { "label": "Instalment Option", "status": "ok", "detail": "Best option: 12m plan at INR 6,363/month (total with interest: INR 76,358)", "sub": null },
    "opportunity": { "label": "Opportunity Cost", "status": "borderline", "detail": "This amount would fund 6.3 months of savings toward your emergency fund.", "sub": "If invested for 1 year at 8%, this could grow to $912." },
    "impulse": { "label": "Impulse Risk", "status": "high", "detail": "Late-night browsing (23:xx) — impulse risk is higher after 10 PM", "sub": null },
    "price_history": { "label": "Price History", "status": "concerning", "detail": "📈 Price trend: rising | Avg: INR 68,333 | Seen 3x", "sub": "⚠️ Currently at historical high — you may have paid less before." },
    "category": { "label": "Category Fit", "status": "unfamiliar", "detail": "Jewelry", "sub": "Outside your usual shopping categories" },
    "savings": { "label": "Savings Goal", "status": "at_risk", "detail": "Emergency Fund", "sub": "This purchase conflicts with your goal." },
    "seasonal": { "label": "Seasonal Timing", "status": "comfortable", "detail": "No major sale season right now", "sub": null },
    "waitlist": { "label": "Smart Buy Price", "status": "borderline", "detail": "This item is well outside your budget range — it would need a 95% drop to fit comfortably.", "sub": null },
    "risk_profile": { "label": "Your Risk Profile", "status": "high", "detail": "Conservative — you prefer to play it safe", "sub": null }
  },
  "logs": [
    "[ContextAgent] category=Jewelry subcategory=Earrings | price history: AT HISTORICAL HIGH (avg=68333.33)",
    "[ProfileAgent] budget=$450.0 sensitivity=high impulse_history=1 goal=emergency_fund",
    "[FinancialAgent] $844.31 vs $450.0 budget | concerning (188% of budget, threshold=10%) | EMI option: 12m @ $76/mo",
    "[SentimentAgent] score=0.5 impulse=True late_night=True urgency=2 history=3",
    "[SupervisorAgent] risk=high affordability=concerning impulse=True → decision=AVOID confidence=0.98"
  ]
}
```

The `breakdown` object always contains these 10 rows for the sidebar:

| Key | What it shows |
|---|---|
| `budget` | Price vs monthly budget in both page currency and USD |
| `emi` | Best EMI plan that fits within 20% of budget |
| `opportunity` | Months of savings / investment value at 8% p.a. |
| `impulse` | Top impulse risk signal and history context |
| `price_history` | Trend, average, and high/low flag from local observations |
| `category` | Whether product category is in the user's usual categories |
| `savings` | Savings goal status and conflict detection |
| `seasonal` | Current sale season (Diwali, Black Friday, Prime Day, etc.) |
| `waitlist` | Target price at which we'd say BUY; alternative suggestion |
| `risk_profile` | User's risk profile label |

### `GET /health`

```json
{ "status": "ok" }
```

---

## Chrome Extension

### Setup

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** → select the `extension/` folder
4. Click the SmartSpend icon → **Open Settings** → fill in your profile

### How it works

1. `content.js` runs on every page and detects checkout pages via URL patterns and page text
2. On detection, it extracts `product_name`, `price`, `currency` from the DOM
3. Home currency is auto-detected from `navigator.language` (40+ locales supported)
4. Page signals (time of day, urgency keywords, previously visited) are collected
5. Product price history is loaded from `chrome.storage.local` and a new observation is saved
6. A `POST /evaluate_purchase` request is sent to `http://localhost:8000`
7. An animated pill appears on the page; clicking it opens a full sidebar with the 10-row breakdown
8. The decision is saved to `chrome.storage.local` (max 100 entries) for future history analysis

### Supported currencies

The extension auto-detects: USD, EUR, GBP, INR, CAD, AUD, SGD, JPY, KRW, BRL, CNY, TRY, UAH, NGN, AED, SAR, THB, VND, PLN, SEK, IDR, MYR, PHP and more.

Price patterns supported: `$1,234`, `₹1,234`, `€1.234`, `1,234 INR`, `Rs. 1234`, `USD 1,234`

---

## Decision Matrix

The supervisor uses a **risk-tolerance-aware** decision matrix:

| Risk Profile | AVOID triggered when | WAIT triggered when |
|---|---|---|
| **Conservative** | Affordability is `concerning` OR (`borderline` + impulse/savings pressure) | Price exceeds threshold OR borderline OR savings pressure |
| **Balanced** | Affordability is `concerning` AND (impulse OR savings pressure) | Affordability is `concerning` OR exceeds threshold OR impulse |
| **Liberal** | Affordability is `concerning` AND impulse AND savings pressure | Exceeds threshold OR savings pressure |

---

## Known Sale Seasons

The Profile Agent detects proximity to these events and warns users:

| Season | Window |
|---|---|
| New Year Sale | Jan 1–20 |
| Republic Day Sale (India) | Jan 24–31 |
| Valentine's Day Sale | Feb 10–20 |
| Mid-Year / Summer Sale | Jun 1–30 |
| Amazon Prime Day | Jul 1–20 |
| Navratri Sale (India) | Sep 20–30 |
| Diwali / Big Billion Days | Oct 1–31 |
| Black Friday / Cyber Monday | Nov 1–30 |
| Christmas / Year-End Sale | Dec 15–31 |

---

## Roadmap

- [x] Multi-agent LangGraph workflow
- [x] Real user profiles from Chrome Extension options page (structured inputs)
- [x] Currency auto-detection and conversion (24 currencies)
- [x] Local price history tracking per product URL
- [x] LLM-generated personalised reason (Groq)
- [x] EMI / instalment analysis
- [x] Opportunity cost calculation
- [x] Impulse scoring from real purchase history
- [x] Time-of-day and urgency keyword signals
- [x] Seasonal spending detection
- [x] Risk-tolerance-aware decision matrix
- [x] 10-row sidebar breakdown
- [ ] Backend deployment (Railway / Render)
- [ ] Multi-user support with authentication
- [ ] Streaming responses for faster sidebar load
- [ ] External price history API (Keepa / CamelCamelCamel) as fallback
