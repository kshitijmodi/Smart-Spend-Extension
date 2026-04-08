// options.js — SmartSpend profile setup

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
document.getElementById("save-btn").addEventListener("click", () => {
  const budget   = getRadio("budget");
  const risk     = getRadio("risk");
  const savings  = getRadio("savings");
  const goal     = getRadio("goal");
  const impulse  = getRadio("impulse");

  const categories = [...document.querySelectorAll('input[name="cats"]:checked')]
    .map(el => el.value);

  const category_strictness = {};
  categories.forEach(cat => {
    const val = getRadio(`strict_${cat}`);
    category_strictness[cat] = val || "normal";
  });

  if (!budget || !risk || !savings || !goal || !impulse) {
    alert("Please complete all sections before saving.");
    return;
  }

  const profile = {
    monthly_budget_range: budget,
    risk_tolerance: risk,
    savings_priority: savings,
    financial_goal: goal,
    impulse_frequency: impulse,
    categories,
    category_strictness,
  };

  chrome.storage.sync.set({ smartspend_profile: profile }, () => {
    const toast = document.getElementById("toast");
    toast.classList.add("show");
    setTimeout(() => toast.classList.remove("show"), 2500);
  });
});

function getRadio(name) {
  const el = document.querySelector(`input[name="${name}"]:checked`);
  return el ? el.value : null;
}
