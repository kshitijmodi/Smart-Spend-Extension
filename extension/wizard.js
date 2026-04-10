// wizard.js — SmartSpend profile setup wizard

document.addEventListener('DOMContentLoaded', function () {
  var root = document.getElementById('ss-app');
  if (root) {
    var theme = localStorage.getItem('ss_theme') || 'dark';
    root.classList.toggle('dark-mode', theme === 'dark');
  }
});

const TOTAL_STEPS = 4;
let currentStep = 0;

// ---- Validation rules per step ----
const STEP_REQUIRED = [
  ["budget"],                          // step 0
  ["risk", "savings", "goal"],         // step 1
  ["impulse"],                         // step 2
  [],                                  // step 3 — categories optional
];

// ---- Restore saved profile on load ----
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

// ---- Category → strictness rows ----
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

// ---- Step navigation ----
function updateUI() {
  // Panels
  document.querySelectorAll(".panel").forEach((p, i) => {
    p.classList.toggle("active", i === currentStep);
  });

  // Step dots + lines
  document.querySelectorAll(".ss-step-dot").forEach((dot, i) => {
    dot.classList.remove("active", "done");
    if (i < currentStep) dot.classList.add("done");
    if (i === currentStep) dot.classList.add("active");
  });
  document.querySelectorAll(".ss-step-line").forEach((line, i) => {
    line.classList.toggle("done", i < currentStep);
  });

  // Step labels
  document.querySelectorAll(".step-label-item").forEach((lbl, i) => {
    lbl.classList.remove("active", "done");
    if (i < currentStep) lbl.classList.add("done");
    if (i === currentStep) lbl.classList.add("active");
  });

  // Back button
  const backBtn = document.getElementById("back-btn");
  if (backBtn) backBtn.style.display = currentStep > 0 ? "block" : "none";

  // Next button label
  const nextBtn = document.getElementById("next-btn");
  if (nextBtn) nextBtn.textContent = currentStep === TOTAL_STEPS - 1 ? "Save Profile" : "Continue →";

  // Error
  const errorMsg = document.getElementById("error-msg");
  if (errorMsg) errorMsg.classList.remove("show");
}

function validateStep(step) {
  const required = STEP_REQUIRED[step];
  for (const name of required) {
    if (!document.querySelector(`input[name="${name}"]:checked`)) return false;
  }
  return true;
}

const nextBtn = document.getElementById("next-btn");
if (nextBtn) nextBtn.addEventListener("click", () => {
  if (!validateStep(currentStep)) {
    const errorMsg = document.getElementById("error-msg");
    if (errorMsg) errorMsg.classList.add("show");
    return;
  }

  if (currentStep < TOTAL_STEPS - 1) {
    currentStep++;
    updateUI();
    window.scrollTo({ top: 0, behavior: "smooth" });
  } else {
    saveProfile();
  }
});

const backBtn = document.getElementById("back-btn");
if (backBtn) backBtn.addEventListener("click", () => {
  if (currentStep > 0) {
    currentStep--;
    updateUI();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
});

// ---- Save ----
function getRadio(name) {
  const el = document.querySelector(`input[name="${name}"]:checked`);
  return el ? el.value : null;
}

function saveProfile() {
  const nextBtn = document.getElementById("next-btn");
  if (!nextBtn) return;
  nextBtn.disabled = true;
  nextBtn.innerHTML = '<span class="ss-spinner"></span> Saving…';

  const categories = [...document.querySelectorAll('input[name="cats"]:checked')]
    .map(el => el.value);

  const category_strictness = {};
  categories.forEach(cat => {
    category_strictness[cat] = getRadio(`strict_${cat}`) || "normal";
  });

  const profile = {
    monthly_budget_range: getRadio("budget"),
    risk_tolerance:       getRadio("risk"),
    savings_priority:     getRadio("savings"),
    financial_goal:       getRadio("goal"),
    impulse_frequency:    getRadio("impulse"),
    categories,
    category_strictness,
  };

  chrome.storage.sync.set({ smartspend_profile: profile }, () => {
    if (chrome.runtime.lastError) {
      nextBtn.disabled = false;
      nextBtn.textContent = "Save Profile";
      const errorMsgEl = document.getElementById("error-msg");
      if (errorMsgEl) {
        errorMsgEl.textContent = "Save failed — please try again.";
        errorMsgEl.classList.add("show");
      }
      return;
    }
    // Show success state
    document.querySelectorAll(".panel").forEach(p => p.classList.remove("active"));
    const navBar = document.getElementById("nav-bar");
    if (navBar) navBar.style.display = "none";
    const stepLabels = document.getElementById("step-labels");
    if (stepLabels) stepLabels.style.display = "none";
    const stepIndicator = document.getElementById("step-indicator");
    if (stepIndicator) stepIndicator.style.display = "none";
    const successPanel = document.getElementById("success-panel");
    if (successPanel) successPanel.classList.add("active");
  });
}

const doneBtn = document.getElementById("done-btn");
if (doneBtn) doneBtn.addEventListener("click", () => {
  window.close();
});
