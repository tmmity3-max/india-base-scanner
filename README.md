# 🇮🇳 India Base Scanner

**Free, open-source base & breakout screens for every liquid NSE stock.**
See today's setups on the website, or run your own scan in Google Colab. No installation, no account, no paid data.

### 🌐 Live site: **[india-base-scanner-web.vercel.app](https://india-base-scanner-web.vercel.app)**
Updated automatically after every market close: VCP, Blue Sky, Murphy trend-following, Base Breakout, Ichimoku cloud breakout, Episodic Pivot, IPO Base and Trend Template screens, zoomable charts with an RS line, fundamentals, and a NIFTY 50 / Next 50 / Midcap 150 / Smallcap 250 heatmap.

[![Website](https://img.shields.io/badge/website-live-E39B2D)](https://india-base-scanner-web.vercel.app)
[![Daily scan](https://github.com/tmmity3-max/india-base-scanner/actions/workflows/daily-scan.yml/badge.svg)](https://github.com/tmmity3-max/india-base-scanner/actions/workflows/daily-scan.yml)
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
| **Base Breakout** | Numbered bases (B1, B2, …) with a pivot: 3+ weeks below a high with a 5–35% pullback. Four stages: forming, fresh breakout, climbing, played out. RS ≥ 65 |
| **50 EMA Pullback** | Leaders (RS ≥ 80) in an uptrend that ran 8%+ above the 50-day EMA and are now back within 3% of it |
| **Ichimoku** | Adaptive Ichimoku: a scored Tenkan/Kijun cross, a cloud breakout on volume, or a cloud retest in the last 5 sessions, with an entry, stop and targets |
| **Episodic Pivot** | Pradeep Bonde style: a **gap up or well above-average move on 3×+ volume** (earnings or other news) in the last month, still above that day's low |
| **IPO Base** | Recent listings basing just under their post-listing high |
| **Murphy** | John Murphy's positional trend-following: above a rising 40-week SMA, then a fresh 10/50 crossover, 4-week-rule breakout, or crossover + 2-week breakout |

Every threshold is a **dial** in the notebook form. Change it, re-run, and the re-scan takes seconds without downloading again.

### Extras
- **All NSE stocks** with a liquidity and size filter: price ≥ ₹50, average daily turnover ≥ ₹1 crore, and market cap ≥ ₹500 crore (`min_mcap_cr`; on the website, buttons raise it to ₹1,000 or ₹2,000 crore). Market cap comes from Yahoo Finance after the price scan, so in the notebook it applies only if you fetch fundamentals and call `ibs.apply_market_cap_filter`
- **RS rating (1-99)** ranked against the liquid stocks you scan
- **RS line like TradingView**: blue RS line, orange 50-day RS average, blue dots at RS new highs and pink dots when RS leads price. Pick the benchmark (NIFTY 50, NIFTY 500, Midcap 150 or Smallcap 250) on the website's Settings page
- **Stages and filters** on the website: every screen splits into a few stages (Base Breakout into forming, fresh breakout, climbing and played out), and one set of filters (RS, market cap, turnover, price, distance from the 52-week high) applies to all of them
- **Charts**: candles, 50/150/200 SMAs, bases drawn as boxes with their pivot and breakout, the key level of the screen you are on, volume and the RS line
- **Market cap and fundamentals** (P/E, P/B, ROE, debt/equity, margins, growth, dividend yield) from Yahoo Finance, plus distance from the 52-week high and low
- **Excel export**: one sheet per screen, plus your settings and every metric
- Universes: NIFTY 50 / 100 / 200 / 500, Midcap 150, Smallcap 250, Microcap 250, all NSE EQ stocks, or your own list

## Website

A free website, **[india-base-scanner-web.vercel.app](https://india-base-scanner-web.vercel.app)**, shows the latest scan. It is updated automatically every weekday after the market closes:

- `scripts/daily_scan.py` scans every NSE stock, keeps those with ₹1 crore+ daily turnover, and writes JSON.
- `.github/workflows/daily-scan.yml` runs it at 16:53 IST, Monday to Friday, and force-pushes the JSON to the `data` branch, so `main` doesn't grow every day.
- Vercel serves the static site in `web/`, which reads the data from `raw.githubusercontent.com`. No server, no database.
- Charts zoom and pan like TradingView (scroll, drag, pinch, 3M/6M/1Y/2Y), and a *Charts only* view shows every match as a grid.

To host your own copy, import this repo on [Vercel](https://vercel.com/new), set **Root Directory** to `web` and **Framework Preset** to *Other*, then click Deploy.

## Free TradingView indicator

[`pine/murphy_trend_following.pine`](pine/murphy_trend_following.pine) is the Murphy screen as a TradingView indicator for daily charts. It has the weekly 40-week SMA filter (completed weeks, no repainting), ENTRY labels for the 10/50 crossover, the 4-week rule or a crossover with a 2-week breakout, an optional ADX filter, a weekly MACD warning, and an RS line against NIFTY 50, NIFTY 500 or any index.

Two more scripts sit next to it:

- [`pine/base_breakout_pro.pine`](pine/base_breakout_pro.pine): the Base Breakout screen as an indicator. Base boxes numbered B1, B2, …, a pivot line, breakout / squat / failed-poke markers on closed bars only, a volume pane with relative volume and HVY / HVQ tags, an Ichimoku cloud, and ATR and fundamentals tables.
- [`pine/rs_line.pine`](pine/rs_line.pine): the RS line in its own pane against NIFTY 50, NIFTY 500, Smallcap 250, Midcap 150 or any symbol.

**To add it to TradingView:**
1. Open [the file](pine/murphy_trend_following.pine), click **Raw**, and copy everything. You can also use the *Copy code* button on the website's Murphy screen.
2. In TradingView, open a **daily** chart and click **Pine Editor** at the bottom.
3. Delete what's in the editor, paste the code, then click **Add to chart**. Click **Save** to keep it under *My scripts*.
4. Open the indicator settings (gear icon) to choose the entry method, the weekly filter, the ADX filter and the RS benchmark.
5. Optional: create an alert on **Murphy trend: ENTRY** to be notified of new signals.

> Before using any signal, read the [Risk advisory](#risk-advisory).

## Heatmap

The website has a heatmap of **NIFTY 50** and **NIFTY Next 50** stocks, grouped by sector, sized by market cap and coloured by 1-day, 1-week, 1-month or 3-month change. Click a tile to open the stock on TradingView.

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
<summary><b>Base Breakout</b></summary>

1. Walk the bars once, closed bars only. A structure starts at a swing high, the **pivot**. While price keeps making higher highs the pivot moves up with it.
2. It becomes a base once price has spent `base_min_weeks` (3) below the pivot with a pullback between `base_min_depth` (5%) and `base_max_depth` (35%). A deeper pullback cancels it.
3. A close above the pivot is the breakout. With `base_trend_filter` on, the close must also be above the 50 and 200-day SMAs.
4. Bases are numbered B1, B2 and so on. The count restarts at 1 when a base undercuts the low of the base before it.
5. Every listed stock is in one of four stages:
   - **Forming**: a new base is in place and the close is above its 50-day EMA (`base_forming_ema`). A forming base always comes before an older breakout.
   - **Fresh breakout**: closed above the pivot in the last `base_signal_days` (5) sessions, still above it and no more than `base_max_above_pivot` (7%) beyond it.
   - **Climbing**: broke out up to `base_climb_days` (60) sessions ago and has not closed back under the pivot.
   - **Played out**: broke out in that time but the breakout failed: price has closed back under the pivot, whether straight away or weeks later.
6. Filter: RS rating of `base_min_rs` (65) or more.
7. Tags: **Sky** (the pivot is an all-time high), **VCP** (the last third of the base is tight and 10-day volume is below the 50-day average; a looser test than the VCP screen), **Squat** (the breakout bar closed in the lower 40% of its range).

The same rules are in [`pine/base_breakout_pro.pine`](pine/base_breakout_pro.pine) for TradingView.

</details>

<details>
<summary><b>Ichimoku (adaptive)</b></summary>

The rules follow the *Adaptive Ichimoku Nexus* TradingView indicator by WillyAlgoTrader, at its default settings, long side only for the list.

1. **Adaptive periods.** Tenkan 9, Kijun 26 and Senkou B 52 are Donchian midpoints whose length shrinks by up to 40% when ATR(14) is at the top of its 50-bar range and stretches by up to 40% at the bottom. Set `ich_mode="classic"` for fixed lengths.
2. **Confluence score, 0–100**, from eight factors: price against the cloud, Tenkan against Kijun, the Chikou span, the direction of the cloud ahead, cloud thickness, volume, momentum and momentum acceleration.
3. **Signals**, all on closed bars:
   - **TK cross**: Tenkan crosses above Kijun, the cloud is not thin, volume is above 1.2 times its 20-day average, the Chikou span is above price, and the score is `ich_min_score` (50) or more.
   - **Cloud breakout**: a close above the cloud after a close in or below it, on volume of `ich_break_vol_mult` (1.3) times the average.
   - **Cloud retest**: within 10 sessions of a breakout, the low touches the cloud top and the close holds above it.
4. **Listed** when a bullish signal fired in the last `ich_signal_days` (5) sessions, no bearish signal has fired since, and the setup has not been stopped out.
5. **The setup**: entry at the signal close, a stop `ich_sl_atr` (0.5) ATR under the Kijun (2 ATR under the entry if that lands on the wrong side), and targets at 1.5, 2.5 and 4 times the risk. A new signal replaces the open setup.

The chart also marks cloud twists, momentum divergences and flat-Kijun support/resistance zones. The "past setups" line under the chart counts earlier setups on that stock: a third sold at each target, the stop taken first when one bar touches both. It is a tally on the chart's history, not a backtest.

</details>

<details>
<summary><b>50 EMA Pullback</b></summary>

A leader resting on its rising 50-day EMA.

1. RS rating of `pb_min_rs` (80) or more.
2. Uptrend: close above the 200-day SMA, the 50 EMA above the 200 SMA and higher than ten sessions ago.
3. A real pullback: the high was at least `pb_min_extension` (8%) above the EMA at some point in the last `pb_lookback` (40) sessions.
4. Now the close is between `pb_max_below` (2%) under and `pb_max_above` (3%) over the EMA.
5. Stages: **At the 50 EMA** (the low came within 0.5% of it in the last three sessions, or the close is within 1%), **Bouncing** (touched it in the last `pb_touch_days` (5) sessions and closed above the previous day's high), **Approaching** (within 3%, no touch yet).

</details>

<details>
<summary><b>Episodic Pivot</b></summary>

After Pradeep Bonde's Episodic Pivot: new information (earnings, an order, a policy change, any news) makes the market reprice a stock quickly, and abnormal volume is its footprint. An EP day is one of the last `ep_window` (21) sessions, about a month, where the stock

- gapped up at least `ep_min_gap` (3%) and still closed that much higher, **or** gained at least `ep_min_move` (4%) and `ep_move_adr_mult` (2) × its 20-day average daily range;
- traded at least `ep_min_rvol` (3) × its 50-day average volume and `ep_min_turnover_cr` (₹5 crore);
- closed in the upper half of the day's range.

It must not have closed below the EP day's low since. `ep_neglected` marks stocks that were up no more than 10% in the three months before (the classic EP context). The daily scan checks Yahoo's earnings dates for each match and sets `ep_catalyst` to *Earnings* or *News / volume*. The EP day's low is the usual stop.
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
| Optional | ADX(14) ≥ 20 trend filter; weekly MACD histogram turning down as an early warning |

The screen lists stocks whose entry signal fired in the last 5 sessions, with the entry price and how far price has moved since. All settings are `murphy_*` in `ScanConfig`.
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

## Risk advisory

The screens and the TradingView indicator only point out stocks whose charts match a set of rules. They don't tell you where to exit. Before you act on any of them:

1. **Take a proper stop-loss in every trade.** Decide where you are wrong before you buy, and place the stop-loss as soon as you enter.
2. **Manage your risk properly.** Risk only a small, fixed part of your capital on any one trade, so a string of losses can't hurt you badly.
3. **Size the position from the stop.** Work out the quantity from the distance between your entry and your stop-loss, not from how sure you feel.
4. **Never widen a stop-loss.** Move it up to protect profit if you like, but never lower it to avoid taking a loss.
5. **Don't average down a losing trade.** Adding to a position that is going against you increases the risk you already decided to take.
6. **A screen is a starting point, not a signal to buy.** Check the chart, the news and the company yourself before every trade.

## Disclaimer

This project is for **education and research only**. It is **not investment advice** and the author is not a SEBI-registered adviser or research analyst. A stock appearing in a screen is the output of a fixed rule, not a recommendation. Trading and investing carry risk of loss. Verify everything independently.

## Contributing

Bug reports, ideas and pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) to get started.

## License

[MIT](LICENSE)
