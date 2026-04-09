// dashboard.js — SmartSpend spending insights

const BUDGET_MAX = {
  under_100:  100,
  "100_300":  300,
  "300_600":  600,
  "600_1000": 1000,
  "1000_plus": 2000,
};

const BUDGET_LABEL = {
  under_100:  "< $100",
  "100_300":  "$100–$300",
  "300_600":  "$300–$600",
  "600_1000": "$600–$1,000",
  "1000_plus": "$1,000+",
};

const CATEGORY_ICON = {
  Electronics: "🖥️", Clothing: "👕", Books: "📚", Home: "🏠",
  Beauty: "💄", Sports: "⚽", Gaming: "🎮", Food: "🍔",
  Travel: "✈️", Other: "📦", Unknown: "🛍️",
};

function decisionClass(d = "") {
  const v = d.toLowerCase();
  if (v === "buy")   return "buy";
  if (v === "wait")  return "wait";
  if (v === "avoid") return "avoid";
  return "unknown";
}

function formatCurrency(price, currency = "USD") {
  if (price == null || isNaN(price)) return "—";
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency", currency, maximumFractionDigits: 2,
    }).format(price);
  } catch {
    return `${currency} ${Number(price).toFixed(2)}`;
  }
}

function formatDate(ts) {
  try {
    return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  } catch {
    return "";
  }
}

function isThisMonth(ts) {
  const d = new Date(ts);
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
}

// ---- Load and render ----
Promise.all([
  new Promise(res => chrome.storage.sync.get("smartspend_profile",  ({ smartspend_profile })  => res(smartspend_profile  || null))),
  new Promise(res => chrome.storage.local.get("smartspend_history", ({ smartspend_history }) => res(smartspend_history || []))),
]).then(([profile, history]) => {
  renderStats(history);
  renderBudget(profile, history);
  renderCategories(history);
  renderHistory(history);
}).catch(err => console.error("SmartSpend dashboard load error:", err));

const settingsBtn = document.getElementById("settings-btn");
if (settingsBtn) settingsBtn.addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("wizard.html") });
});

function renderStats(history) {
  const thisMonth = history.filter(h => isThisMonth(h.ts));
  const statTotal = document.getElementById("stat-total");
  const statBuy   = document.getElementById("stat-buy");
  const statWait  = document.getElementById("stat-wait");
  const statAvoid = document.getElementById("stat-avoid");
  if (statTotal) statTotal.textContent = thisMonth.length;
  if (statBuy)   statBuy.textContent   = thisMonth.filter(h => h.decision?.toLowerCase() === "buy").length;
  if (statWait)  statWait.textContent  = thisMonth.filter(h => h.decision?.toLowerCase() === "wait").length;
  if (statAvoid) statAvoid.textContent = thisMonth.filter(h => h.decision?.toLowerCase() === "avoid").length;
}

function renderBudget(profile, history) {
  if (!profile?.monthly_budget_range) return;

  const card    = document.getElementById("budget-card");
  const fill    = document.getElementById("budget-fill");
  const amounts = document.getElementById("budget-amounts");
  const hint    = document.getElementById("budget-hint");

  if (!card || !fill || !amounts || !hint) return;

  const max     = BUDGET_MAX[profile.monthly_budget_range] || 500;
  const label   = BUDGET_LABEL[profile.monthly_budget_range] || "";

  // Sum this month's analyzed prices as a proxy for tracked spend
  const thisMonth = history.filter(h => isThisMonth(h.ts));
  const spent = thisMonth.reduce((sum, h) => sum + (parseFloat(h.price) || 0), 0);
  const pct   = Math.min(100, Math.round((spent / max) * 100));

  amounts.innerHTML = `<span>$${spent.toFixed(0)}</span> of ${label} budget`;
  fill.style.width  = pct + "%";
  if (pct >= 90) fill.classList.add("warn");

  if (pct >= 100) {
    hint.textContent = "You've reached your monthly budget limit.";
    hint.style.color = "#ef4444";
  } else if (pct >= 75) {
    hint.textContent = `${100 - pct}% of budget remaining — almost there.`;
    hint.style.color = "#f59e0b";
  } else {
    hint.textContent = `${100 - pct}% of budget remaining this month.`;
  }

  card.style.display = "block";
}

function renderCategories(history) {
  const catList = document.getElementById("cat-list");
  if (!catList) return;
  const counts  = {};

  history.forEach(h => {
    const cat = h.category || "Unknown";
    counts[cat] = (counts[cat] || 0) + 1;
  });

  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 6);

  if (sorted.length === 0) {
    catList.innerHTML = `<div class="empty-state">
      <div class="empty-sub">No category data yet. SmartSpend will log categories as you shop.</div>
    </div>`;
    return;
  }

  const maxCount = sorted[0][1];
  catList.innerHTML = sorted.map(([cat, count]) => `
    <div class="ss-cat-bar">
      <div class="ss-cat-name">${cat}</div>
      <div class="ss-cat-track">
        <div class="ss-cat-fill" style="width:${Math.round((count / maxCount) * 100)}%"></div>
      </div>
      <div class="ss-cat-count">${count}</div>
    </div>
  `).join("");
}

function renderHistory(history) {
  const listEl = document.getElementById("history-list");
  if (!listEl) return;

  if (history.length === 0) {
    listEl.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🛍️</div>
        <div class="empty-title">No purchase history yet</div>
        <div class="empty-sub">Visit a checkout page and SmartSpend will log it here automatically.</div>
      </div>`;
    return;
  }

  const items = history.slice(0, 30);
  listEl.innerHTML = `<div class="history-list">${items.map(h => {
    const icon  = CATEGORY_ICON[h.category] || CATEGORY_ICON.Unknown;
    const dc    = decisionClass(h.decision);
    const price = h.price != null
      ? formatCurrency(parseFloat(h.price), h.currency)
      : "—";
    const date  = formatDate(h.ts);
    const site  = h.site || "";
    const name  = h.item || "Unknown item";

    return `
      <div class="history-item">
        <div class="history-icon">${icon}</div>
        <div class="history-info">
          <div class="history-name">${escapeHtml(name)}</div>
          <div class="history-meta">${escapeHtml(site)}${date ? ` · ${date}` : ""}</div>
        </div>
        <div class="history-right">
          <span class="ss-badge ${dc}">${h.decision || "—"}</span>
          <span class="history-price">${price}</span>
        </div>
      </div>`;
  }).join("")}</div>`;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
