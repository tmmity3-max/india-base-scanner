/* Where the daily scan data lives.
 *
 * The scan force-pushes its JSON to the repo's `data` branch. Reading
 * raw.githubusercontent.com/<repo>/data/... can return a copy cached from
 * before the latest scan, so we ask GitHub for the branch's current commit
 * and read the files at that exact commit, which is never stale.
 */
(() => {
  "use strict";
  const REPO = "tmmity3-max/india-base-scanner";
  const BRANCH_URL = `https://raw.githubusercontent.com/${REPO}/data/`;
  const LOCAL = /^(localhost|127\.|\[::1\])/.test(location.hostname);
  const KEY = "ibs-data-sha";
  let pending = null;

  async function resolve() {
    if (LOCAL) return "data/";
    try {
      const cached = JSON.parse(sessionStorage.getItem(KEY) || "null");
      if (cached && Date.now() - cached.t < 5 * 60 * 1000) return `https://raw.githubusercontent.com/${REPO}/${cached.sha}/`;
    } catch (e) { /* storage unavailable */ }
    try {
      const r = await fetch(`https://api.github.com/repos/${REPO}/branches/data`, { cache: "no-store" });
      if (!r.ok) throw new Error(r.status);
      const sha = (await r.json()).commit.sha;
      try { sessionStorage.setItem(KEY, JSON.stringify({ sha, t: Date.now() })); } catch (e) { /* ignore */ }
      return `https://raw.githubusercontent.com/${REPO}/${sha}/`;
    } catch (e) {
      return BRANCH_URL;   // GitHub API limit reached or offline: fall back to the branch path
    }
  }
  window.ibsDataBase = () => (pending = pending || resolve());
})();
