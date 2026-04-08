// content.js — SmartSpend
// Detects checkout pages, extracts product info, shows animated pill + sidebar.

const BACKEND_URL = "http://localhost:8000";

// ---- Home Currency Detection (auto, no user input needed) ---------------

// Maps browser locale → ISO currency code
const LOCALE_TO_CURRENCY = {
  "en-US": "USD", "en-CA": "CAD", "en-AU": "AUD", "en-GB": "GBP",
  "en-IN": "INR", "en-SG": "SGD", "en-NZ": "NZD", "en-ZA": "ZAR",
  "en-NG": "NGN", "en-PH": "PHP", "en-MY": "MYR", "en-PK": "PKR",
  "de-DE": "EUR", "de-AT": "EUR", "de-CH": "CHF",
  "fr-FR": "EUR", "fr-BE": "EUR", "fr-CH": "CHF", "fr-CA": "CAD",
  "es-ES": "EUR", "es-MX": "MXN", "es-AR": "ARS", "es-CO": "COP",
  "it-IT": "EUR", "pt-BR": "BRL", "pt-PT": "EUR",
  "nl-NL": "EUR", "nl-BE": "EUR",
  "ja-JP": "JPY", "ko-KR": "KRW", "zh-CN": "CNY", "zh-TW": "TWD",
  "zh-HK": "HKD", "ru-RU": "RUB", "tr-TR": "TRY", "pl-PL": "PLN",
  "sv-SE": "SEK", "nb-NO": "NOK", "da-DK": "DKK", "fi-FI": "EUR",
  "ar-AE": "AED", "ar-SA": "SAR", "ar-EG": "EGP",
  "th-TH": "THB", "vi-VN": "VND", "id-ID": "IDR",
  "hi-IN": "INR", "bn-IN": "INR", "ta-IN": "INR",
};

function detectHomeCurrency() {
  // Try full locale first (e.g. "en-IN"), then language only (e.g. "en")
  const locale = navigator.language || "en-US";
  if (LOCALE_TO_CURRENCY[locale]) return LOCALE_TO_CURRENCY[locale];

  // Try Intl API for a more precise answer
  try {
    const fmt = new Intl.NumberFormat(locale, { style: "currency", currency: "USD" });
    const resolved = fmt.resolvedOptions();
    // Some browsers expose the locale's default currency
    if (resolved.currency && resolved.currency !== "USD") return resolved.currency;
  } catch (_) {}

  // Fallback: match by language prefix
  const lang = locale.split("-")[0];
  const match = Object.entries(LOCALE_TO_CURRENCY).find(([k]) => k.startsWith(lang + "-"));
  return match ? match[1] : "USD";
}

// ---- Page Signals -------------------------------------------------------

const URGENCY_PATTERNS = [
  /only \d+ left/i, /selling fast/i, /limited stock/i, /ends tonight/i,
  /flash sale/i, /last chance/i, /hurry/i, /expires in/i, /today only/i,
  /almost gone/i, /low stock/i, /few left/i, /deal ends/i, /limited time/i,
  /order soon/i, /in high demand/i, /running out/i, /\d+ people viewing/i,
  /\d+ in cart/i, /price goes up/i,
];

function extractPageSignals(history) {
  const now       = new Date();
  const hour      = now.getHours();
  const isWeekend = [0, 6].includes(now.getDay());

  const bodyText           = document.body.innerText;
  const urgencyFound       = URGENCY_PATTERNS
    .filter(p => p.test(bodyText))
    .map(p => bodyText.match(p)?.[0] || p.source)
    .slice(0, 5);

  const previouslyVisited  = history.some(h => h.site === window.location.hostname);

  return { hour_of_day: hour, is_weekend: isWeekend, urgency_keywords_found: urgencyFound, previously_visited: previouslyVisited };
}

// ---- Product Price History (per URL) ------------------------------------

function priceStorageKey(url) {
  // Stable short key from the URL
  return "ss_price_" + url.replace(/[^a-z0-9]/gi, "").slice(-40);
}

async function loadProductPriceHistory(url) {
  const key = priceStorageKey(url);
  return new Promise(resolve =>
    chrome.storage.local.get(key, data => resolve(data[key] || []))
  );
}

function saveProductPrice(url, price, currency) {
  const key   = priceStorageKey(url);
  chrome.storage.local.get(key, data => {
    const existing = data[key] || [];
    const updated  = [{ ts: Date.now(), price, currency }, ...existing].slice(0, 30);
    chrome.storage.local.set({ [key]: updated });
  });
}

// ---- Checkout Detection ------------------------------------------------

const CHECKOUT_URL_PATTERNS = [
  "/checkout", "/cart", "/payment", "/pay/", "/order", "/buy",
  "/basket", "/bag", "/purchase", "/confirm", "/billing", "/secure",
];

const CHECKOUT_TEXT_SIGNALS = [
  "place order", "place your order", "complete purchase", "pay now",
  "proceed to checkout", "confirm order", "complete order", "submit order",
  "review your order", "secure checkout", "confirm and pay", "buy now",
  "complete checkout", "finalize order",
];

function isCheckoutPage() {
  const url = window.location.href.toLowerCase();
  if (CHECKOUT_URL_PATTERNS.some((p) => url.includes(p))) return true;

  const bodyText = document.body.innerText.toLowerCase();
  return CHECKOUT_TEXT_SIGNALS.some((t) => bodyText.includes(t));
}

// ---- Currency Detection ------------------------------------------------

// Maps symbol/text prefix → ISO code
const SYMBOL_TO_CODE = {
  "$": "USD", "US$": "USD", "CA$": "CAD", "A$": "AUD", "S$": "SGD",
  "£": "GBP", "€": "EUR",
  "₹": "INR", "Rs.": "INR", "Rs ": "INR", "INR": "INR",
  "¥": "JPY", "CN¥": "CNY",
  "₩": "KRW", "₺": "TRY", "R$": "BRL", "₴": "UAH", "₦": "NGN",
  "د.إ": "AED", "﷼": "SAR", "฿": "THB", "₫": "VND", "zł": "PLN",
  "kr": "SEK", "Rp": "IDR", "RM": "MYR", "₱": "PHP",
  "AED": "AED", "SAR": "SAR", "EUR": "EUR", "GBP": "GBP",
  "USD": "USD", "CAD": "CAD", "AUD": "AUD", "SGD": "SGD",
  "JPY": "JPY", "CNY": "CNY", "KRW": "KRW",
};

// Matches: symbol/code then number, OR number then symbol/code
// Handles: ₹1,234.00 | Rs. 1,234 | INR 1234 | 1,234 INR | 1,234 Rs.
const PRICE_REGEX =
  /(US\$|CA\$|A\$|S\$|CN¥|INR|USD|EUR|GBP|CAD|AUD|SGD|JPY|CNY|KRW|AED|SAR|Rs\.|Rs\s|Rp|RM|R\$|د\.إ|﷼|zł|kr|[\$£€₹¥₩₺₴₦฿₫₱])\s?([\d,]+\.?\d*)|([\d,]+\.?\d*)\s?(INR|USD|EUR|GBP|CAD|AUD|SGD|JPY|CNY|KRW|AED|SAR|Rs\.|Rs)/;

function detectCurrencyAndPrice(text) {
  const match = text.match(PRICE_REGEX);
  if (!match) return null;

  let symbol, rawValue;
  if (match[1]) {
    // symbol-first: ₹1,234 or INR 1,234
    symbol   = match[1].trim();
    rawValue = match[2];
  } else {
    // number-first: 1,234 INR
    rawValue = match[3];
    symbol   = match[4].trim();
  }

  const value = parseFloat(rawValue.replace(/,/g, ""));
  const code  = SYMBOL_TO_CODE[symbol] || SYMBOL_TO_CODE[symbol + " "] || "USD";
  return { value, currency: code, symbol };
}

// ---- Product Extraction ------------------------------------------------

function extractPriceAndCurrency() {
  const prioritySelectors = [
    "[class*='grand-total']", "[class*='order-total']", "[class*='cart-total']",
    "[class*='total-price']", "[class*='order-summary']", "[id*='grand-total']",
    "[id*='order-total']", "[id*='cart-total']", ".grand-total", ".order-total",
  ];

  for (const sel of prioritySelectors) {
    const el = document.querySelector(sel);
    if (el) {
      const result = detectCurrencyAndPrice(el.innerText);
      if (result) return result;
    }
  }

  // Fallback: scan body text near the word "total"
  const bodyText = document.body.innerText;
  const totalSection = bodyText.match(/(?:total|order total|grand total)[^\n]{0,40}/i);
  if (totalSection) {
    const result = detectCurrencyAndPrice(totalSection[0]);
    if (result) return result;
  }

  // Last resort: scan every element for a price pattern
  const genericSelectors = ["[class*='price']", "[class*='amount']", "[class*='total']", "[class*='summary']"];
  for (const sel of genericSelectors) {
    for (const el of document.querySelectorAll(sel)) {
      const result = detectCurrencyAndPrice(el.innerText);
      if (result && result.value > 0) return result;
    }
  }

  // Nuclear fallback: scan all visible text on the page for any price pattern
  const allText = document.body.innerText;
  const allMatches = [...allText.matchAll(
    /(US\$|CA\$|A\$|S\$|CN¥|INR|USD|EUR|GBP|Rs\.|Rs\s|[\$£€₹¥₩₺₴₦฿₫₱])\s?([\d,]{2,}\.?\d*)/g
  )];
  const candidates = allMatches
    .map(m => ({ value: parseFloat(m[2].replace(/,/g, "")), symbol: m[1].trim() }))
    .filter(c => c.value > 0)
    .sort((a, b) => b.value - a.value); // largest value is most likely the total

  if (candidates.length) {
    const top = candidates[0];
    return { value: top.value, currency: SYMBOL_TO_CODE[top.symbol] || "USD", symbol: top.symbol };
  }

  return null;
}

// Blacklisted page-title words that are useless as product names
const TITLE_BLACKLIST = ["checkout", "cart", "basket", "payment", "order", "bag", "secure"];

function extractProductName() {
  const selectors = [
    "[class*='product-title']", "[class*='product-name']",
    "[class*='item-title']",    "[class*='item-name']",
    "[class*='product-heading']", "[class*='cart-item']",
    "h1", "h2",
  ];
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    const text = el?.innerText?.trim();
    if (text && text.length > 3 && !TITLE_BLACKLIST.some(w => text.toLowerCase().includes(w))) {
      return text.slice(0, 120);
    }
  }
  // Fall back to page title only if it's not a generic checkout title
  const title = document.title.trim();
  if (title && !TITLE_BLACKLIST.some(w => title.toLowerCase().includes(w))) return title;
  return window.location.hostname;
}

// ---- Inject Styles -------------------------------------------------------

function injectStyles() {
  if (document.getElementById("ss-styles")) return;
  const style = document.createElement("style");
  style.id = "ss-styles";
  style.textContent = `
    /* Pill */
    #ss-pill {
      position: fixed;
      bottom: 24px;
      right: 24px;
      z-index: 2147483647;
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 18px;
      border-radius: 100px;
      background: #1a1a24;
      border: 1.5px solid #2a2a38;
      color: #e8e8f0;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      box-shadow: 0 8px 32px rgba(0,0,0,0.4);
      transition: transform 0.2s ease, box-shadow 0.2s ease;
      user-select: none;
    }
    #ss-pill:hover { transform: translateY(-2px); box-shadow: 0 12px 40px rgba(0,0,0,0.5); }

    #ss-pill .ss-dot {
      width: 8px; height: 8px;
      border-radius: 50%;
      background: #6b7280;
      animation: ss-pulse 1.2s infinite;
    }
    @keyframes ss-pulse {
      0%,100% { opacity: 1; transform: scale(1); }
      50%      { opacity: 0.4; transform: scale(0.7); }
    }

    /* Decision colours on pill */
    #ss-pill.ss-buy  { border-color: #6ee7b7; }
    #ss-pill.ss-buy  .ss-dot { background:#6ee7b7; animation:none; }
    #ss-pill.ss-wait { border-color: #fbbf24; }
    #ss-pill.ss-wait .ss-dot { background:#fbbf24; animation:none; }
    #ss-pill.ss-avoid{ border-color: #f87171; }
    #ss-pill.ss-avoid .ss-dot{ background:#f87171; animation:none; }

    /* Sidebar */
    #ss-sidebar {
      position: fixed;
      top: 0; right: 0;
      width: 320px;
      height: 100vh;
      z-index: 2147483646;
      background: #0f0f13;
      border-left: 1px solid #2a2a38;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      color: #e8e8f0;
      overflow-y: auto;
      transform: translateX(100%);
      transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      box-shadow: -8px 0 32px rgba(0,0,0,0.5);
    }
    #ss-sidebar.ss-open { transform: translateX(0); }

    .ss-sidebar-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 18px 20px;
      border-bottom: 1px solid #2a2a38;
    }
    .ss-logo {
      font-size: 15px; font-weight: 800;
      background: linear-gradient(135deg, #6ee7b7, #3b82f6);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    .ss-close {
      background: none; border: none;
      color: #6b7280; font-size: 18px; cursor: pointer; padding: 4px;
    }
    .ss-close:hover { color: #e8e8f0; }

    /* Decision hero */
    .ss-decision-hero {
      padding: 28px 20px 20px;
      text-align: center;
    }
    .ss-badge {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 10px 22px;
      border-radius: 100px;
      font-size: 18px;
      font-weight: 800;
      letter-spacing: 0.04em;
      margin-bottom: 14px;
    }
    .ss-badge.buy  { background: rgba(110,231,183,0.15); color: #6ee7b7; }
    .ss-badge.wait { background: rgba(251,191,36,0.15);  color: #fbbf24; }
    .ss-badge.avoid{ background: rgba(248,113,113,0.15); color: #f87171; }

    .ss-confidence {
      font-size: 12px; color: #6b7280; margin-bottom: 12px;
    }
    .ss-confidence span { color: #9ca3af; font-weight: 600; }

    .ss-reason {
      font-size: 13px; color: #c4c4d4; line-height: 1.6;
      padding: 14px 16px;
      background: #1a1a24;
      border-radius: 10px;
      text-align: left;
    }

    /* Breakdown */
    .ss-section-title {
      font-size: 11px; font-weight: 600; text-transform: uppercase;
      letter-spacing: 0.08em; color: #4b5563;
      padding: 16px 20px 8px;
    }
    .ss-breakdown { padding: 0 20px 8px; }
    .ss-row {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      padding: 10px 0;
      border-bottom: 1px solid #1a1a24;
      font-size: 13px;
    }
    .ss-row:last-child { border-bottom: none; }
    .ss-row-icon { font-size: 15px; margin-top: 1px; min-width: 20px; }
    .ss-row-body { flex: 1; }
    .ss-row-label { font-weight: 600; color: #c4c4d4; margin-bottom: 2px; }
    .ss-row-detail { color: #6b7280; font-size: 12px; }
    .ss-row-sub { color: #4b5563; font-size: 11px; margin-top: 3px; font-style: italic; }

    /* Product info */
    .ss-product { padding: 12px 20px 24px; }
    .ss-product-name { font-size: 13px; color: #9ca3af; line-height: 1.4; }
    .ss-product-meta { font-size: 11px; color: #4b5563; margin-top: 4px; }

    /* No profile warning */
    .ss-no-profile {
      padding: 32px 20px;
      text-align: center;
    }
    .ss-no-profile p { color: #6b7280; font-size: 13px; line-height: 1.6; margin-bottom: 16px; }
    .ss-setup-btn {
      display: inline-block;
      background: linear-gradient(135deg, #3b82f6, #6366f1);
      color: #fff; border: none; border-radius: 100px;
      padding: 10px 24px; font-size: 13px; font-weight: 600; cursor: pointer;
    }
  `;
  document.head.appendChild(style);
}

// ---- Build DOM elements -------------------------------------------------

function createPill() {
  const pill = document.createElement("div");
  pill.id = "ss-pill";
  pill.innerHTML = `<div class="ss-dot"></div><span id="ss-pill-text">SmartSpend analyzing…</span>`;
  document.body.appendChild(pill);
  return pill;
}

function createSidebar() {
  const sidebar = document.createElement("div");
  sidebar.id = "ss-sidebar";
  sidebar.innerHTML = `
    <div class="ss-sidebar-header">
      <div class="ss-logo">SmartSpend</div>
      <button class="ss-close" id="ss-close-btn">✕</button>
    </div>
    <div id="ss-sidebar-body"></div>
  `;
  document.body.appendChild(sidebar);

  document.getElementById("ss-close-btn").addEventListener("click", () => {
    sidebar.classList.remove("ss-open");
    const pill = document.getElementById("ss-pill");
    if (pill) pill.style.display = "flex";
  });

  return sidebar;
}

// ---- Render Sidebar Content ---------------------------------------------

function statusIcon(status) {
  const icons = {
    comfortable: "✅", borderline: "⚠️", concerning: "🔴",
    low: "✅", medium: "⚠️", high: "🔴",
    familiar: "✅", unfamiliar: "⚠️",
    ok: "✅", at_risk: "🔴",
    conservative: "🛡️", balanced: "⚖️", liberal: "🚀",
  };
  return icons[status] || "•";
}

function renderResult(data, productName, price, currency, site) {
  const { decision, confidence, reason, breakdown } = data;
  const decClass = decision.toLowerCase();
  const decIcon  = { BUY: "✅", WAIT: "🟡", AVOID: "🚫" }[decision] || "•";
  const pct      = Math.round(confidence * 100);

  const breakdownHTML = Object.values(breakdown || {}).map(row => `
    <div class="ss-row">
      <div class="ss-row-icon">${statusIcon(row.status)}</div>
      <div class="ss-row-body">
        <div class="ss-row-label">${row.label}</div>
        <div class="ss-row-detail">${row.detail}</div>
        ${row.sub ? `<div class="ss-row-sub">${row.sub}</div>` : ""}
      </div>
    </div>
  `).join("");

  const priceDisplay = price
    ? `${currency} ${price.toLocaleString()}`
    : "Price not detected";

  document.getElementById("ss-sidebar-body").innerHTML = `
    <div class="ss-decision-hero">
      <div class="ss-badge ${decClass}">${decIcon} ${decision}</div>
      <div class="ss-confidence">SmartSpend is <span>${pct}%</span> confident in this call</div>
      <div class="ss-reason">${reason}</div>
    </div>
    <div class="ss-section-title">Why this decision?</div>
    <div class="ss-breakdown">${breakdownHTML}</div>
    <div class="ss-section-title">This purchase</div>
    <div class="ss-product">
      <div class="ss-product-name">${productName}</div>
      <div class="ss-product-meta">${priceDisplay} · ${site || window.location.hostname}</div>
    </div>
  `;
}

function renderNoProfile() {
  document.getElementById("ss-sidebar-body").innerHTML = `
    <div class="ss-no-profile">
      <p>Set up your SmartSpend profile once to get personalised buy/avoid recommendations on every checkout page.</p>
      <button class="ss-setup-btn" id="ss-open-options">Set Up Profile →</button>
    </div>
  `;
  document.getElementById("ss-open-options").addEventListener("click", () => {
    chrome.runtime.sendMessage({ action: "open_options" });
  });
}

function renderError(message) {
  document.getElementById("ss-sidebar-body").innerHTML = `
    <div class="ss-no-profile">
      <p style="color:#f87171">⚠️ ${message}</p>
    </div>
  `;
}

// ---- Update Pill State --------------------------------------------------

function setPillResult(decision) {
  const pill = document.getElementById("ss-pill");
  const text = document.getElementById("ss-pill-text");
  if (!pill || !text) return;

  pill.classList.remove("ss-buy", "ss-wait", "ss-avoid");
  const map = { BUY: ["ss-buy", "✅ BUY"], WAIT: ["ss-wait", "🟡 WAIT"], AVOID: ["ss-avoid", "🚫 AVOID"] };
  const [cls, label] = map[decision] || ["", decision];
  pill.classList.add(cls);
  text.textContent = label + " — tap for details";
}

function setPillLoading() {
  const text = document.getElementById("ss-pill-text");
  if (text) text.textContent = "SmartSpend analyzing…";
}

// ---- Main Flow ----------------------------------------------------------

async function run() {
  if (!isCheckoutPage()) return;
  if (document.getElementById("ss-pill")) return; // already injected

  injectStyles();
  const pill   = createPill();
  const sidebar = createSidebar();

  // Toggle sidebar — hide pill when open, show when closed
  pill.addEventListener("click", () => {
    const isOpening = !sidebar.classList.contains("ss-open");
    sidebar.classList.toggle("ss-open");
    pill.style.display = isOpening ? "none" : "flex";
  });

  // Load profile + history from storage, then run analysis
  chrome.storage.sync.get("smartspend_profile", async ({ smartspend_profile: profile }) => {
    if (!profile) {
      setPillResult("WAIT");
      document.getElementById("ss-pill-text").textContent = "⚙ Set up SmartSpend";
      renderNoProfile();
      return;
    }

    const productName  = extractProductName();
    const priceInfo    = extractPriceAndCurrency();
    const price        = priceInfo?.value || 0;
    const currency     = priceInfo?.currency || "USD";
    const homeCurrency = detectHomeCurrency();
    const pageUrl      = window.location.href;

    // Load purchase history + product price history in parallel
    const [history, productPriceHistory] = await Promise.all([
      new Promise(resolve =>
        chrome.storage.local.get("smartspend_history", ({ smartspend_history }) =>
          resolve(smartspend_history || [])
        )
      ),
      loadProductPriceHistory(pageUrl),
    ]);

    const pageSignals = extractPageSignals(history);

    try {
      const response = await fetch(`${BACKEND_URL}/evaluate_purchase`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          product_name:          productName,
          price,
          currency,
          home_currency:         homeCurrency,
          url:                   pageUrl,
          site:                  window.location.hostname,
          profile,
          purchase_history:      history.slice(0, 50),
          page_signals:          pageSignals,
          product_price_history: productPriceHistory,
        }),
      });

      if (!response.ok) throw new Error(`Server error ${response.status}`);

      const data = await response.json();
      setPillResult(data.decision);
      renderResult(data, productName, price, currency, window.location.hostname);

      // Save price observation and decision to local storage
      if (price > 0) saveProductPrice(pageUrl, price, currency);
      const entry = {
        ts: Date.now(), product: productName, price, currency,
        site: window.location.hostname, decision: data.decision,
        category: data.category || "Unknown",
      };
      chrome.storage.local.set({ smartspend_history: [entry, ...history].slice(0, 100) });

    } catch (err) {
      document.getElementById("ss-pill-text").textContent = "SmartSpend — error";
      renderError("Couldn't reach the SmartSpend backend. Is it running?");
    }
  });
}

// Run once DOM is ready, then watch for SPA navigations
run();

// For single-page apps (Amazon, etc.) re-check on URL changes
let lastUrl = location.href;
new MutationObserver(() => {
  if (location.href !== lastUrl) {
    lastUrl = location.href;
    // Small delay so the new page content loads
    setTimeout(run, 1500);
  }
}).observe(document.body, { subtree: true, childList: true });
