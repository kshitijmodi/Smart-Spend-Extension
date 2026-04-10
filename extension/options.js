// options.js — SmartSpend profile setup

document.addEventListener('DOMContentLoaded', function () {
  var root = document.getElementById('ss-app');
  if (root) {
    var theme = localStorage.getItem('ss_theme') || 'dark';
    root.classList.toggle('dark-mode', theme === 'dark');
  }
});

const CATEGORIES = [
  "Electronics","Clothing","Books","Home",
  "Beauty","Sports","Gaming","Food","Travel","Other"
];

// ---- Restore saved profile on page load ----
chrome.storage.sync.get("smartspend_profile", ({ smartspend_profile: profile }) => {
  if (!profile) return;

  selectRadio("budget",  profile.monthly_budget_range);
  selectRadio("risk",    profile.risk_tolerance);
  selectRadio("savings", profile.savings_priority);
  selectRadio("goal",    profile.financial_goal);
  selectRadio("impulse", profile.impulse_frequency);

  (profile.categories || []).forEach(cat => {
    const el = document.querySelector(`input[name="cats"][value="${cat}"]`);
    if (el) el.checked = true;
  });

  rebuildStrictnessRows(profile.category_strictness || {});
});

function selectRadio(name, value) {
  const el = document.querySelector(`input[name="${name}"][value="${value}"]`);
  if (el) el.checked = true;
}

// ---- Rebuild strictness rows whenever categories change ----
document.querySelectorAll('input[name="cats"]').forEach(cb => {
  cb.addEventListener("change", () => rebuildStrictnessRows());
});

function rebuildStrictnessRows(savedStrictness = {}) {
  const checked = [...document.querySelectorAll('input[name="cats"]:checked')]
    .map(el => el.value);

  const section = document.getElementById("strictness-section");
  const container = document.getElementById("strictness-rows");
  if (!section || !container) return;
  container.innerHTML = "";

  if (checked.length === 0) {
    section.style.display = "none";
    return;
  }
  section.style.display = "block";

  checked.forEach(cat => {
    const saved = savedStrictness[cat] || "normal";
    const row = document.createElement("div");
    row.className = "strictness-row";
    row.innerHTML = `
      <span>${cat}</span>
      <div class="strictness-options">
        ${["lenient","normal","strict"].map(level => `
          <input type="radio" name="strict_${cat}" id="strict_${cat}_${level}" value="${level}"
            ${saved === level ? "checked" : ""}>
          <label for="strict_${cat}_${level}">${level.charAt(0).toUpperCase() + level.slice(1)}</label>
        `).join("")}
      </div>
    `;
    container.appendChild(row);
  });
}

// ---- Save ----
const saveBtnEl = document.getElementById("save-btn");
if (saveBtnEl) saveBtnEl.addEventListener("click", () => {
  const saveBtn = document.getElementById("save-btn");
  const toast   = document.getElementById("toast");

  const budget  = getRadio("budget");
  const risk    = getRadio("risk");
  const savings = getRadio("savings");
  const goal    = getRadio("goal");
  const impulse = getRadio("impulse");

  const categories = [...document.querySelectorAll('input[name="cats"]:checked')]
    .map(el => el.value);

  const category_strictness = {};
  categories.forEach(cat => {
    const val = getRadio(`strict_${cat}`);
    category_strictness[cat] = val || "normal";
  });

  if (!budget || !risk || !savings || !goal || !impulse) {
    showError("Please complete all sections before saving.");
    return;
  }

  // Loading state
  saveBtn.disabled    = true;
  saveBtn.textContent = "Saving…";
  saveBtn.style.opacity = "0.7";

  const profile = {
    monthly_budget_range: budget,
    risk_tolerance:       risk,
    savings_priority:     savings,
    financial_goal:       goal,
    impulse_frequency:    impulse,
    categories,
    category_strictness,
  };

  chrome.storage.sync.set({ smartspend_profile: profile }, () => {
    // Reset button
    saveBtn.disabled    = false;
    saveBtn.textContent = "Save Profile";
    saveBtn.style.opacity = "";

    if (chrome.runtime.lastError) {
      showError("Failed to save — " + chrome.runtime.lastError.message);
      return;
    }

    // Animated success toast
    if (toast) {
      toast.classList.add("show");
      setTimeout(() => toast.classList.remove("show"), 2500);
    }
  });
});

function showError(msg) {
  // Reuse the toast element with an error style, or fall back to a simple inline message
  const existing = document.getElementById("save-error");
  if (existing) {
    existing.textContent = msg;
    existing.style.display = "block";
    setTimeout(() => { existing.style.display = "none"; }, 3500);
    return;
  }
  // Create error element and insert before save bar
  const el = document.createElement("div");
  el.id = "save-error";
  el.style.cssText = "color:#ef4444;font-size:12px;text-align:center;padding:8px 16px;";
  el.textContent = msg;
  const saveBar = document.querySelector(".save-bar");
  if (saveBar) saveBar.prepend(el);
  setTimeout(() => { el.style.display = "none"; }, 3500);
}

function getRadio(name) {
  const el = document.querySelector(`input[name="${name}"]:checked`);
  return el ? el.value : null;
}
