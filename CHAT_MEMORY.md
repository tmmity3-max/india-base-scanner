# Chat memory: India Base Scanner and TradingView indicators

Summary of the work done with Claude in this chat (14–16 November 2026), plus a list of later commits found on `main` on 26 November 2026. Use it to pick up where the chat left off.

## The project

- **Repo:** https://github.com/tmmity3-max/india-base-scanner (public, branch `main`)
- **Live site:** https://india-base-scanner-web.vercel.app (Vercel serves `web/`, reads data from the `data` branch)
- **Daily scan:** `.github/workflows/daily-scan.yml` runs `scripts/daily_scan.py` at 16:53 IST on weekdays and force-pushes JSON to the `data` branch. It can be started by hand from the Actions tab (`workflow_dispatch`).
- **Engine:** `india_base_scanner.py` (`ScanConfig`, one `find_*` function per screen, `apply_screens`, `scan`)
- **Tests:** `python3 tests/test_screens.py` (pytest is not installed in the container)
- **Notebook:** `India_Base_Scanner.ipynb` is generated. Edit `tools/build_notebook.py`, then run `python3 tools/build_notebook.py`.

## How we worked

1. Claude made each change on a new branch, ran the tests and checked the site in a local browser on synthetic data.
2. Claude pushed the branch; the user opened and merged the pull request on GitHub.
3. After the merge, Claude ran the daily scan by hand (`gh workflow run daily-scan.yml --ref main`) and reported the counts from `latest.json` on the `data` branch.

Merged pull requests from this chat: #1 Base Breakout screen, #2 filters + Ichimoku screen + one-row tabs, #3 Ichimoku-style chart, #4 stages + filters + base boxes, #5 remove the "All" stage card, #6 adaptive Ichimoku + Played out = failed breakout, #7 50 EMA Pullback + ₹500 crore floor.

## Screens on the website (as of PR #7)

Tab order: VCP, Blue Sky, Murphy, Base Breakout, 50 EMA Pullback, Ichimoku, Multi-Year Base, IPO Base, Trend Template. (Later commits replaced Multi-Year Base with Episodic Pivot and added an ATR Entry screen; see the end.)

Every screen needs price ≥ ₹50, 50-day average turnover ≥ ₹1 crore and **market cap ≥ ₹500 crore** (`min_mcap_cr`). Market cap comes from Yahoo Finance after the price scan (`apply_market_cap_filter`); a stock with no market cap is dropped.

| Screen | Rule | Stages |
|---|---|---|
| **Base Breakout** | A base starts at a swing high (the pivot); valid after 3+ weeks below it with a 5–35% pullback. Breakout = close above the pivot while above the 50 and 200-day SMAs. Bases numbered B1, B2…; count restarts when a base undercuts the previous base's low. RS ≥ 65. Tags: Sky, VCP, Squat. | **Forming** (within 7% under the pivot), **Fresh breakout** (last 5 sessions, ≤ 7% above), **Climbing** (broke out ≤ 60 sessions ago, never closed back under the pivot), **Played out** (breakout failed: closed back under the pivot, at once or later) |
| **50 EMA Pullback** | RS ≥ 80; close > 200 SMA, 50 EMA > 200 SMA and rising; ran ≥ 8% above the 50 EMA in the last 40 sessions; now closes between 2% under and 3% over it. | **At the 50 EMA**, **Bouncing**, **Approaching** |
| **Ichimoku** | Adaptive Ichimoku, after the "Adaptive Ichimoku Nexus" Pine script by WillyAlgoTrader (default settings): periods 9/26/52 stretch ±40% with volatility, 0–100 confluence score. Listed when a bullish signal fired in the last 5 sessions, nothing bearish since, setup not stopped out. | **TK cross**, **Cloud breakout**, **Cloud retest** |
| VCP | Zig-zag contractions, each tighter, volume drying up, near the pivot | Setting up, Breaking out |
| Blue Sky | Within 3% of the all-time high, RS ≥ 70 | New high this week, Just under the high |
| Murphy | 40-week SMA filter + 10/50 cross / 4-week rule | Signal today, 1–2 sessions ago, 3–5 sessions ago |
| Multi-Year Base | Back at a high that held 2+ years | Under / Above the old high |
| IPO Base | Recent listing basing under its listing high | Under / Above the listing high |
| Trend Template | Stage-2 uptrend, RS ≥ 70 | RS 90+, RS 80–89, RS 70–79 |

Counts from the last scan in this chat (16 Nov, 14:00 IST, part-day bar): VCP 26, Blue Sky 28, Murphy 228, Base Breakout 321 (Forming 53, Fresh 25, Climbing 50, Played out 193), 50 EMA Pullback 30, Ichimoku 175, Multi-Year Base 1, IPO Base 16, Trend Template 220.

## Website features added

- **Tabs** are small and always on one row.
- **Stage cards** under the tabs; each screen opens on its first stage that has stocks. There is **no "All" card** (user did not want it).
- **Filters** button (RS, market cap, turnover, price, distance from 52-week high, RS line at a high) plus **market-cap buttons** ₹500 / ₹1,000 / ₹2,000 crore+. Saved in the browser.
- **Charts:**
  - Bases drawn as shaded boxes, labelled like `Sky · B2 · 6w`, pivot as a dashed green line, green triangle on the breakout bar (hollow for a squat). A "Bases" toolbar button shows them on other screens.
  - Only the current screen's key level is drawn (VCP pivot, Murphy entry, ATH…), not all of them at once.
  - **Ichimoku tab:** Ichimoku style only (no bases, no SMAs): adaptive cloud, Tenkan, Kijun, Chikou, Long/Short score labels, breakout diamonds, retest dots, twist marks, divergence labels, Kijun S/R zones, ENTRY / SL / TP1–3 lines, and a trend / momentum / score / past-setups line under the chart.
  - **50 EMA Pullback tab:** draws the 50 EMA.

## TradingView scripts

- `pine/base_breakout_pro.pine`: Base Breakout Pro + Volume. Base boxes B1…, pivot line, breakout / squat / failed-poke markers on closed bars only (non-repainting), volume pane with relative volume and HVY/HVQ, Ichimoku cloud, ATR table, fundamentals table (EPS / revenue / PAT with Q% and Y%), dashboard with RS score vs a chosen index.
- `pine/rs_line.pine`: RS line in its own pane (stock ÷ index × 100), RS base selectable: NIFTY 50, NIFTY 500, NIFTY SMALLCAP 250 (`NSE:NIFTYSMLCAP250`, ticker not verified), NIFTY MIDCAP 150, Custom. Blue = RS above its 50-bar average, red = below; blue dots = RS new high, pink = RS leads price.
- `pine/murphy_trend_following.pine`: existing Murphy indicator.
- Volume and RS line are **two separate panes / indicators**: a Pine script can own only one pane, and putting both in one was too cluttered.
- On the price chart: red dashed = 21 EMA, purple = 50 SMA, orange = 200 SMA.

## User preferences learned

- No repainting signals; everything on closed bars.
- Visual style modelled on the BananaPatterns site (stages, base boxes, green breakout markers), built in the site's own design, not copied.
- One row of tabs, small icons; no "All" stage.
- "Played out" means a **failed** breakout, not an extended one.
- Ichimoku screen uses only the Ichimoku chart style.
- Market cap floor ₹500 crore on every screen, with optional ₹1,000 / ₹2,000 crore filters.

## Environment notes for future sessions

- Pushing needs the repo attached with write access (`add_repo` with `access: "push"`); that only worked after the user linked GitHub at https://claude.ai/connect-github.
- `gh` works for running and watching workflows.
- The container cannot reach `india-base-scanner-web.vercel.app`; check the live site in your own browser (hard refresh: Ctrl+Shift+R).
- A scan run during market hours publishes a part-day bar; the 16:53 IST run replaces it.

## Later commits on `main` (after PR #7, not covered in detail in this chat)

Found on 26 Nov 2026, newest first:

- Daily scan: reuse last good fundamentals when Yahoo refuses (Invalid Crumb); fundamentals cache on the `data` branch
- Daily scan: fill sessions Yahoo is missing from NSE's bhavcopy (and NIFTY closes); 5-day top-up before the freshness check
- Website restyle (Hallmark, Vantage theme), look only
- New **ATR Entry** screen
- Separate filters per screen with Apply / Cancel; all filters behind a gear button; turnover quick buttons
- Paged table, frozen Stock column, column resizing, drag-to-resize table/chart
- Operating margin with QoQ / YoY on the site and in Pine
- New **Episodic Pivot** screen (replaces Multi-Year Base), stages Today / This week / This month
- Base Breakout: a new base is Forming while above the 50 EMA
- Charts: 5 years of candles, 5Y zoom, Ichimoku cloud aligned with them
- Daily scan guards: don't publish when Yahoo misses the latest session or most fundamentals fail; rate-limit guard; dividend yield fix
