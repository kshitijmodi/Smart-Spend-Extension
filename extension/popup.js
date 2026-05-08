// popup.js — SmartSpend

chrome.storage.sync.get("smartspend_profile", ({ smartspend_profile: profile }) => {
  const dot  = document.getElementById("profile-dot");
  const text = document.getElementById("status-text");

  if (profile) {
    dot.classList.add("active");
    text.textContent = "Profile set ✓";
  } else {
    text.textContent = "No profile yet — set one up!";
  }
});

document.getElementById("setup-btn").addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

document.getElementById("help-btn").addEventListener("click", () => {
  chrome.tabs.create({
    url: "https://github.com/kshitijmodi/Smart-Spend-Extension#readme",
  });
});
