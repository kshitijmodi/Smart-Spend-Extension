// popup.js — SmartSpend

document.addEventListener('DOMContentLoaded', function () {
  var root = document.getElementById('ss-app');
  if (root) {
    var theme = localStorage.getItem('ss_theme') || 'dark';
    root.classList.toggle('dark-mode', theme === 'dark');
  }
});

const BUDGET_MAX = {
  under_100:  100,
  "100_300":  300,
  "300_600":  600,
  "600_1000": 1000,
  "1000_plus": 2000,
};

function isThisMonth(ts) {
  const d = new Date(ts), now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
}

function decisionClass(d = "") {
  const v = d.toLowerCase();
  if (v === "buy")   return "buy";
  if (v === "wait")  return "wait";
  if (v === "avoid") return "avoid";
  return "unknown";
}

// Load profile + history in parallel
Promise.all([
  new Promise(res => chrome.storage.sync.get("smartspend_profile",  ({ smartspend_profile })  => res(smartspend_profile  || null))),
  new Promise(res => chrome.storage.local.get("smartspend_history", ({ smartspend_history }) => res(smartspend_history || []))),
]).then(([profile, history]) => {
  renderStatus(profile);
  if (profile) renderBudget(profile, history);
  if (history.length > 0) renderLastItem(history[0]);
}).catch(err => console.error("SmartSpend popup load error:", err));

function renderStatus(profile) {
  const dot  = document.getElementById("profile-dot");
  const text = document.getElementById("status-text");
  if (profile) {
    if (dot) dot.classList.add("active");
    if (text) text.textContent = "Profile set ✓";
  } else {
    if (text) text.textContent = "No profile yet — set one up!";
  }
}

function renderBudget(profile, history) {
  if (!profile.monthly_budget_range) return;
  const max    = BUDGET_MAX[profile.monthly_budget_range] || 500;
  const spent  = history
    .filter(h => isThisMonth(h.ts))
    .reduce((sum, h) => sum + (parseFloat(h.price) || 0), 0);
  const pct    = Math.min(100, Math.round((spent / max) * 100));

  const budgetPct     = document.getElementById("budget-pct");
  const budgetFill    = document.getElementById("budget-fill");
  const budgetSub     = document.getElementById("budget-sub");
  const budgetSection = document.getElementById("budget-section");

  if (budgetPct)  budgetPct.textContent  = pct + "% used";
  if (budgetFill) budgetFill.style.width = pct + "%";
  if (budgetSub)  budgetSub.textContent  = `$${spent.toFixed(0)} tracked this month`;

  if (pct >= 90) {
    if (budgetFill) budgetFill.classList.add("warn");
    if (budgetPct)  budgetPct.style.color = "#ef4444";
  } else if (pct >= 75) {
    if (budgetPct) budgetPct.style.color = "#f59e0b";
  }

  if (budgetSection) budgetSection.classList.add("visible");
}

function renderLastItem(item) {
  if (!item) return;
  const el     = document.getElementById("last-item");
  const nameEl = document.getElementById("last-name");
  const metaEl = document.getElementById("last-meta");
  const badge  = document.getElementById("last-badge");

  if (!el || !nameEl || !metaEl || !badge) return;

  nameEl.textContent  = item.product || item.item || "Unknown item";
  const price = item.price != null ? `$${parseFloat(item.price).toFixed(2)}` : "";
  const site  = item.site || "";
  metaEl.textContent  = [site, price].filter(Boolean).join(" · ");

  const dc = decisionClass(item.decision);
  badge.className    = `ss-badge ${dc}`;
  badge.textContent  = item.decision || "—";

  el.classList.add("visible");
}

const setupBtn = document.getElementById("setup-btn");
if (setupBtn) setupBtn.addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("wizard.html") });
});

const dashboardBtn = document.getElementById("dashboard-btn");
if (dashboardBtn) dashboardBtn.addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("dashboard.html") });
});

const helpBtn = document.getElementById("help-btn");
if (helpBtn) helpBtn.addEventListener("click", () => {
  chrome.tabs.create({
    url: chrome.runtime.getURL("README.md"),
  });
});
