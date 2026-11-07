# 🇮🇳 India Base Scanner

**Free, open-source base & breakout screens for NSE stocks, running in Google Colab.**
No installation, no account, no paid data. Open the notebook, click *Run all*, and get today's setups with charts and an Excel export.

[![Open In Colab](https://colab.research.google.com/assets/colab-badge.svg)](https://colab.research.google.com/github/tmmity3-max/india-base-scanner/blob/main/India_Base_Scanner.ipynb)
![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)
![Python 3.9+](https://img.shields.io/badge/python-3.9%2B-blue)

---

## What it finds

| Screen | Looks for |
|---|---|
| **Trend Template** | Stage-2 uptrend: price above the 50, 150 and 200-day SMAs in that order, 200 SMA rising, within 25% of the 52-week high, RS rating ≥ 70 |
| **VCP** | Volatility Contraction Pattern: 2+ pullbacks, each tighter than the last, volume drying up, price within 6% of the pivot |
| **Blue Sky** | At or breaking out to an **all-time high**, so there is no overhead supply |
| **Multi-Year Base** | Breaking out of a high that held for **2+ years** |
| **IPO Base** | Recent listings basing just under their post-listing high |
| **Murphy** | John Murphy's positional trend-following: above a rising 40-week SMA, then a fresh 10/50 crossover, 4-week-rule breakout, or crossover + 2-week breakout, with a stop below the 2-week low |

Every threshold is a **dial** in the notebook form. Change it, re-run, and the re-scan takes seconds without downloading again.

### Extras
- **All NSE stocks** with a liquidity filter: price ≥ ₹20 and average daily turnover ≥ ₹1 crore
- **RS rating (1-99)** ranked against the liquid stocks you scan
- **RS line vs NIFTY 50 or NIFTY 500** (switchable), with a "new 52-week high" flag
- **Charts**: candles, 50/150/200 SMAs, pivot lines, volume and the RS line
- **Excel export**: one sheet per screen, plus your settings and every metric
- Universes: NIFTY 50 / 100 / 200 / 500, Midcap 150, Smallcap 250, Microcap 250, all NSE EQ stocks, or your own list

## Website

A free website shows the latest scan. It is updated automatically every weekday after the market closes:

- `scripts/daily_scan.py` scans every NSE stock, keeps those with ₹1 crore+ daily turnover, and writes JSON.
- `.github/workflows/daily-scan.yml` runs it at 16:53 IST, Monday to Friday, and force-pushes the JSON to the `data` branch, so `main` doesn't grow every day.
- Vercel serves the static site in `web/`, which reads the data from `raw.githubusercontent.com`. No server, no database.
- Charts zoom and pan like TradingView (scroll, drag, pinch, 3M/6M/1Y/2Y), and a *Charts only* view shows every match as a grid.

To host your own copy, import this repo on [Vercel](https://vercel.com/new), set **Root Directory** to `web` and **Framework Preset** to *Other*, then click Deploy.

## Quick start

1. Click **Open in Colab** above.
2. `Runtime → Run all`.
3. Read the result tables, chart the matches, and download the Excel file.

The first NIFTY 500 download takes about 2-4 minutes.

## Use it as a Python library

```python
import india_base_scanner as ibs

cfg = ibs.ScanConfig(min_rs=80, vcp_max_last_depth=8)
result, data = ibs.run("NIFTY500", cfg, benchmark="NIFTY500")

print(result.summary())
print(result.screens["VCP"])
ibs.plot_stock("TRENT", data, result)
result.to_excel("scan.xlsx")
```

Install the dependencies with `pip install -r requirements.txt`.

## How the screens work

<details>
<summary><b>VCP: Volatility Contraction Pattern</b></summary>

1. Find swing highs and lows using a zig-zag of moves of at least `vcp_swing_pct` (4%).
2. Take the highest swing high in the last `vcp_lookback` bars (130) as the left side of the base.
3. Measure each high-to-low pullback after it.
4. Pass when:
   - there are at least `vcp_min_contractions` (2) pullbacks,
   - each pullback is no deeper than the previous one × `vcp_tightening` (1.10),
   - the first is ≤ 35% and the last ≤ 12%,
   - 10-day average volume ≤ 85% of the 50-day average,
   - the close is between 6% below and 5% above the **pivot**, which is the high of the last contraction,
   - and the stock passes the Trend Template.
</details>

<details>
<summary><b>Blue Sky</b></summary>

Close within `bluesky_max_below_ath` (3%) of the all-time high, at least 3 years of history, and RS ≥ `min_rs`. The `new_ath_recent` column shows a new all-time high within the last 5 bars.
</details>

<details>
<summary><b>Multi-Year Base</b></summary>

The highest high before the last 5 bars was set at least `myb_min_base_years` (2) years ago, the base depth is ≤ 60%, and price is now between 5% below and 10% above that old high.
</details>

<details>
<summary><b>IPO Base</b></summary>

Listed 20-500 trading days ago, based at least 10 days below the post-listing high with depth ≤ 35%, and now within 8% of that high.
</details>

<details>
<summary><b>Murphy: positional trend-following</b></summary>

Based on John Murphy's *Technical Analysis of the Financial Markets* (moving averages, the weekly rule, MACD).

| Part | Rule |
|---|---|
| Weekly filter (completed weeks, no repainting) | Close > 40-week SMA and the 40-week SMA rising over 4 weeks. Optional: weekly MACD > signal, or both |
| Entry: crossover | 10-day SMA crosses above the 50-day SMA |
| Entry: 4-week rule | Close breaks above the high of the last 4 full weeks |
| Entry: crossover + 2-week breakout | Within 10 days of a crossover, close breaks the last 2 full weeks' high |
| Stop and exit | Initial stop below the 2-week low; exit on the opposite crossover, or (4-week rule) a close below the 2-week low, which also trails the stop |
| Optional | ADX(14) ≥ 20 trend filter; weekly MACD histogram turning down as an early warning |

The screen lists stocks whose BUY signal fired in the last 5 sessions and is still open, with entry, stop and risk %. All settings are `murphy_*` in `ScanConfig`.
</details>

<details>
<summary><b>RS rating</b></summary>

0.4 × 3-month return + 0.2 × 6-month + 0.2 × 9-month + 0.2 × 12-month, then ranked as a percentile (1-99) across the scanned universe.
</details>

## Data

- **Prices:** Yahoo Finance via [`yfinance`](https://github.com/ranaroussi/yfinance), daily and adjusted for splits and bonuses. End-of-day data; it may be delayed or contain errors.
- **Symbol lists:** NSE's public index constituent files, with a built-in fallback list if NSE blocks the request.

## Project layout

```
india_base_scanner.py      # the engine (screens, RS, charts, export)
India_Base_Scanner.ipynb   # Colab notebook (generated)
tools/build_notebook.py    # rebuilds the notebook from the engine
tests/test_screens.py      # offline tests on synthetic price paths
scripts/daily_scan.py      # writes the website's JSON data
web/                       # static website for Vercel (HTML, CSS, JS, canvas charts)
.github/workflows/         # daily scan on GitHub Actions
```

After editing `india_base_scanner.py`, run `python tools/build_notebook.py` to update the notebook, and `python tests/test_screens.py` to check nothing broke.

## Roadmap

- [ ] Backtest each screen over past years
- [ ] Sector / industry rotation table
- [ ] Cup-with-handle and flat-base screens
- [x] Daily auto-run with GitHub Actions and a website on Vercel
- [ ] Telegram alert when a stock breaks its pivot on volume

Suggestions and pull requests are welcome. Open an issue first for big changes.

## Disclaimer

This project is for **education and research only**. It is **not investment advice** and the author is not a SEBI-registered adviser or research analyst. A stock appearing in a screen is the output of a fixed rule, not a recommendation. Trading and investing carry risk of loss. Verify everything independently.

## License

[MIT](LICENSE)
