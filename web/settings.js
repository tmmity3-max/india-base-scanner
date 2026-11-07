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
  }
  function clampInt(v, lo, hi, dflt) {
    const n = Math.round(Number(v));
    return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt;
  }
  fill(window.ibsSettings());
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const d = window.IBS_SETTING_DEFAULTS;
    const s = {
      rsBench: form.rsBench.value || d.rsBench,
      rsMa: clampInt(form.rsMa.value, 5, 200, d.rsMa),
      rsHi: clampInt(form.rsHi.value, 20, 400, d.rsHi),
      showRsMa: form.showRsMa.checked,
      showRsDots: form.showRsDots.checked,
    };
    fill(s);
    msg.textContent = window.ibsSaveSettings(s)
      ? `Saved. Charts now draw the RS line against the ${window.IBS_BENCH_NAMES[s.rsBench]}.`
      : "Couldn't save: this browser is blocking site storage.";
  });
  document.getElementById("resetSettings").addEventListener("click", () => {
    fill(window.IBS_SETTING_DEFAULTS);
    msg.textContent = "Defaults restored. Click Save settings to keep them.";
  });
})();
