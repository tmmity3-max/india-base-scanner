/* Settings page: saved to this browser with window.ibsSaveSettings. */
(() => {
  "use strict";
  const form = document.getElementById("settingsForm");
  const msg = document.getElementById("savedMsg");
  function fill(s) {
    form.rsBench.value = s.rsBench;
    form.rsMa.value = s.rsMa;
    form.rsHi.value = s.rsHi;
    form.showRsMa.checked = !!s.showRsMa;
    form.showRsDots.checked = !!s.showRsDots;
    form.chartType.value = s.chartType || "candles";
    form.theme.value = s.theme || "system";
  }
  function clampInt(v, lo, hi, dflt) {
    const n = Math.round(Number(v));
    return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt;
  }
  fill(window.ibsSettings());
  // preview the theme as soon as it's picked; Save keeps it
  for (const r of form.querySelectorAll('input[name="theme"]')) r.addEventListener("change", () => window.ibsApplyTheme(r.value));
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const d = window.IBS_SETTING_DEFAULTS;
    const s = {
      rsBench: form.rsBench.value || d.rsBench,
      rsMa: clampInt(form.rsMa.value, 5, 200, d.rsMa),
      rsHi: clampInt(form.rsHi.value, 20, 400, d.rsHi),
      showRsMa: form.showRsMa.checked,
      showRsDots: form.showRsDots.checked,
      chartType: form.chartType.value || "candles",
      theme: form.theme.value || "system",
    };
    window.ibsApplyTheme(s.theme);
    fill(s);
    if (window.ibsSaveSettings(s)) {
      msg.textContent = "Saved. Opening the dashboard…";
      setTimeout(() => { location.href = "/"; }, 600);   // back to the dashboard with the new settings
    } else {
      msg.textContent = "Couldn't save: this browser is blocking site storage.";
    }
  });
  document.getElementById("resetSettings").addEventListener("click", () => {
    fill(window.IBS_SETTING_DEFAULTS);
    window.ibsApplyTheme(window.IBS_SETTING_DEFAULTS.theme);
    msg.textContent = "Defaults restored. Click Save settings to keep them.";
  });
})();
