# SmartSpend

An AI-powered purchase advisor that evaluates online purchases and recommends **BUY**, **WAIT**, or **AVOID** — personalised to your financial profile, risk tolerance, and spending habits.

---

## Overview

SmartSpend consists of two parts:

| Component | Description |
|---|---|
| [`extension/`](extension/) | Chrome Extension (Manifest V3) — detects checkout pages, extracts price, injects a decision pill and sidebar |
| [`smart-spend-agent/`](smart-spend-agent/) | FastAPI + LangGraph backend — multi-agent AI pipeline that produces the decision |

---

## Quick Start

### 1. Run the backend

```bash
cd smart-spend-agent
python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

Set your [Groq API key](https://console.groq.com) in a `.env` file, then:

```bash
python -m uvicorn backend.main:app --reload --port 8000
```

### 2. Load the Chrome Extension

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** → select the `extension/` folder
4. Click the SmartSpend icon → **Open Settings** → fill in your profile

---

## How It Works

1. `content.js` detects checkout pages and extracts product name, price, and currency
2. Page signals (time of day, urgency keywords, browsing history) are collected
3. A `POST /evaluate_purchase` request is sent to the local backend
4. The multi-agent pipeline (Context → Profile → Financial → Sentiment → Supervisor) produces a decision
5. An animated pill appears on the page; clicking it opens a 10-row sidebar breakdown

See [`smart-spend-agent/README.md`](smart-spend-agent/README.md) for full API reference, agent architecture, and decision matrix details.
