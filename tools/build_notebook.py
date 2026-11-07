"""Rebuild India_Base_Scanner.ipynb from india_base_scanner.py.

The notebook embeds the engine with %%writefile so it runs in Colab with no
other files. Edit the .py file, then run:  python tools/build_notebook.py
"""
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GITHUB_USER = "tmmity3-max"
REPO = "india-base-scanner"


def md(text):
    return {"cell_type": "markdown", "metadata": {}, "source": text.strip("\n").splitlines(True)}


def code(text, form=False):
    meta = {"cellView": "form"} if form else {}
    return {"cell_type": "code", "metadata": meta, "execution_count": None,
            "outputs": [], "source": text.strip("\n").splitlines(True)}


engine = open(os.path.join(ROOT, "india_base_scanner.py"), encoding="utf-8").read()

cells = [
    md(f"""
# 🇮🇳 India Base Scanner

[![Open In Colab](https://colab.research.google.com/assets/colab-badge.svg)](https://colab.research.google.com/github/{GITHUB_USER}/{REPO}/blob/main/India_Base_Scanner.ipynb)

Free, open-source **base & breakout screens for NSE stocks**:

| Screen | Looks for |
|---|---|
| **Trend Template** | Stage-2 uptrend: price > 50 > 150 > 200 SMA, 200 SMA rising, near 52-week high, strong RS |
| **VCP** | Volatility Contraction Pattern: each pullback tighter than the last, volume drying up, price near the pivot |
| **Blue Sky** | Price at or breaking out to an **all-time high** - no overhead supply |
| **Multi-Year Base** | Breaking out of a high that held for **2+ years** |
| **IPO Base** | Recent listings basing just under their post-listing high |
| **Murphy** | John Murphy's 10 laws: a 33-66% pullback in an uptrend at the 50-day average, RSI and MACD turning up, ADX ≥ 20, lighter volume |

**How to use:** `Runtime → Run all`, or run the cells one by one. Change the settings in the form and re-run the scan cell - no need to download again.

> ⚠️ **For education and research only. Not investment advice.** Data comes from Yahoo Finance and may be delayed or wrong. Always verify on your broker's chart.
"""),
    md("## 1. Install"),
    code("!pip -q install yfinance openpyxl"),
    md("## 2. Load the scanner engine\nRun this cell once. It writes `india_base_scanner.py` and imports it. (The same file is in the GitHub repo if you want to read the code.)"),
    code("%%writefile india_base_scanner.py\n" + engine),
    code("import importlib, india_base_scanner as ibs\nimportlib.reload(ibs)\nprint('India Base Scanner', ibs.__version__, 'ready')"),
    md("## 3. Choose the universe and download prices\nNIFTY500 takes about 2-4 minutes; `ALL_EQ` (every NSE stock) about 10-15 minutes. Run this cell **once**; later scans reuse the data. Illiquid stocks are filtered out in the settings below (₹1 crore average daily turnover by default)."),
    code("""
#@title Universe & data { run: "manual" }
UNIVERSE = "NIFTY500"  #@param ["NIFTY50", "NIFTY100", "NIFTY200", "NIFTY500", "MIDCAP150", "SMALLCAP250", "MICROCAP250", "ALL_EQ"]
#@markdown Or type your own symbols (comma-separated). Leave blank to use the list above.
CUSTOM_SYMBOLS = ""  #@param {type:"string"}
RS_BENCHMARK = "NIFTY500"  #@param ["NIFTY500", "NIFTY50"]
HISTORY = "max"  #@param ["max", "10y", "5y", "2y"]

universe = ibs.get_universe(CUSTOM_SYMBOLS if CUSTOM_SYMBOLS.strip() else UNIVERSE)
print(f"{len(universe)} symbols - downloading daily prices...")
data = ibs.download_prices(universe["symbol"], period=HISTORY)
bench = ibs.download_benchmark(RS_BENCHMARK, period=HISTORY)
latest = max(df.index[-1] for df in data.values()).date()
print(f"\\nLoaded {len(data)}/{len(universe)} stocks. Latest bar: {latest}")
""", form=True),
    md("## 4. Settings - every threshold is a dial\nChange anything here and re-run this cell. It re-scans in seconds using the data already downloaded."),
    code("""
#@title Scan settings
#@markdown **Liquidity**
MIN_PRICE = 20  #@param {type:"number"}
MIN_TURNOVER_CR = 1.0  #@param {type:"number"}
#@markdown **Trend Template**
MIN_RS = 70  #@param {type:"slider", min:0, max:99, step:1}
MAX_BELOW_52W_HIGH = 25  #@param {type:"number"}
#@markdown **VCP**
VCP_LOOKBACK_BARS = 130  #@param {type:"integer"}
VCP_MIN_CONTRACTIONS = 2  #@param {type:"slider", min:2, max:6, step:1}
VCP_MAX_FIRST_DEPTH = 35  #@param {type:"number"}
VCP_MAX_LAST_DEPTH = 12  #@param {type:"number"}
VCP_MAX_BELOW_PIVOT = 6  #@param {type:"number"}
VCP_MAX_VOLUME_RATIO = 0.85  #@param {type:"number"}
#@markdown **Blue Sky / Multi-Year / IPO**
BLUESKY_MAX_BELOW_ATH = 3  #@param {type:"number"}
MYB_MIN_BASE_YEARS = 2  #@param {type:"number"}
IPO_MAX_DAYS = 500  #@param {type:"integer"}
#@markdown **Murphy (10 laws pullback)**
MURPHY_MIN_RETRACE = 33  #@param {type:"number"}
MURPHY_MAX_RETRACE = 66  #@param {type:"number"}
MURPHY_MAX_FROM_SMA50 = 5  #@param {type:"number"}
MURPHY_MIN_ADX = 20  #@param {type:"number"}

cfg = ibs.ScanConfig(
    min_price=MIN_PRICE, min_turnover_cr=MIN_TURNOVER_CR,
    min_rs=MIN_RS, max_below_52w_high=MAX_BELOW_52W_HIGH,
    vcp_lookback=VCP_LOOKBACK_BARS, vcp_min_contractions=VCP_MIN_CONTRACTIONS,
    vcp_max_first_depth=VCP_MAX_FIRST_DEPTH, vcp_max_last_depth=VCP_MAX_LAST_DEPTH,
    vcp_max_below_pivot=VCP_MAX_BELOW_PIVOT, vcp_max_volume_ratio=VCP_MAX_VOLUME_RATIO,
    bluesky_max_below_ath=BLUESKY_MAX_BELOW_ATH, myb_min_base_years=MYB_MIN_BASE_YEARS,
    ipo_max_days=IPO_MAX_DAYS,
    murphy_min_retrace=MURPHY_MIN_RETRACE, murphy_max_retrace=MURPHY_MAX_RETRACE,
    murphy_max_from_sma50=MURPHY_MAX_FROM_SMA50, murphy_min_adx=MURPHY_MIN_ADX,
)
result = ibs.scan(data, cfg, universe, bench)
display(result.summary())
""", form=True),
    md("## 5. Results"),
    code("""
import pandas as pd
pd.set_option("display.max_rows", 200, "display.width", 200)
for name, table in result.screens.items():
    print(f"\\n=== {name}: {len(table)} stocks ===")
    display(table.head(50))
"""),
    md("## 6. Chart any stock\nCandles with 50/150/200 SMAs, pivot lines, volume and the RS line vs your benchmark."),
    code("""
#@title Chart a stock
SYMBOL = "RELIANCE"  #@param {type:"string"}
BARS = 260  #@param {type:"integer"}
ibs.plot_stock(SYMBOL, data, result, bars=BARS);
""", form=True),
    code("""
#@title Chart the top matches of one screen
SCREEN = "VCP"  #@param ["VCP", "Blue Sky", "Murphy", "Multi-Year Base", "IPO Base", "Trend Template"]
TOP_N = 6  #@param {type:"slider", min:1, max:20, step:1}
for sym in result.screens[SCREEN]["symbol"].head(TOP_N):
    ibs.plot_stock(sym, data, result)
""", form=True),
    md("## 7. Export to Excel\nOne sheet per screen, plus your settings and every metric."),
    code("""
from datetime import date
path = result.to_excel(f"base_scan_{date.today():%Y-%m-%d}.xlsx")
print("Saved", path)
try:
    from google.colab import files
    files.download(path)
except ImportError:
    pass
"""),
    md("""
## How the screens work

- **RS rating (1-99):** weighted 12-month return (last quarter counts double), ranked against every stock in your scan. 99 = top 1%.
- **RS line new high:** the stock/index ratio is at a 52-week high - often seen before price breakouts.
- **VCP:** the scanner finds swing highs and lows (moves of at least 4%). Starting from the highest high in the last ~6 months, it measures each pullback. It needs 2+ pullbacks, each no deeper than the one before, a final pullback under 12%, the 10-day volume below 85% of the 50-day average, and price within 6% of the pivot. The pivot is the high of the last contraction.
- **Blue Sky:** close within 3% of the all-time high, with at least 3 years of history.
- **Multi-Year Base:** the highest high before the last 5 bars was set 2+ years ago, the base was no deeper than 60%, and price is now within 5% below or up to 10% above that old high.
- **IPO Base:** listed 20-500 trading days ago, based 10+ days below the post-listing high with a depth of 35% or less, and now within 8% of that high.
- **Murphy:** John Murphy's 10 Laws of Technical Trading as one scan. Trend (laws 1, 2, 6): close above the 200-day, 50-day above the 200-day and rising. Retracement (law 4): 33-66% of the last up-leg given back. Support (laws 3, 5): within 5% of the 50-day average. Turning points (laws 7, 8): RSI 38-62 and rising, MACD histogram rising. Trend strength (law 9): ADX ≥ 20. Volume (law 10): pullback volume below the 50-day average.
- **Liquidity:** every screen needs price ≥ ₹20 and 50-day average turnover ≥ ₹1 crore. RS is ranked among those liquid stocks only.
- **vol_ratio:** today's volume ÷ 50-day average. Above 1.5 on a breakout day is a strong sign.

These are standard, published ideas from technical analysis, applied with the same fixed rules to every stock.

## Contributing
Ideas, bug reports and pull requests are welcome on GitHub. ⭐ the repo if it helps you!

> ⚠️ Not investment advice. Backtest and verify before trading. Markets carry risk of loss.
"""),
]

nb = {
    "cells": cells,
    "metadata": {
        "colab": {"provenance": [], "toc_visible": True},
        "kernelspec": {"display_name": "Python 3", "name": "python3"},
        "language_info": {"name": "python"},
    },
    "nbformat": 4,
    "nbformat_minor": 0,
}
out = os.path.join(ROOT, "India_Base_Scanner.ipynb")
with open(out, "w", encoding="utf-8") as f:
    json.dump(nb, f, indent=1, ensure_ascii=False)
print("wrote", out)
