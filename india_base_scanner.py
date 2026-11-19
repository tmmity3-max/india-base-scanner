"""
India Base Scanner
==================

Open-source base & breakout screens for NSE-listed stocks, designed to run
in Google Colab (or any Python 3.9+ environment).

Screens
-------
1. Trend Template  - Stage-2 uptrend filter (moving-average stack + RS).
2. VCP             - Volatility Contraction Pattern: successively tighter
                     pullbacks with volume drying up, near the pivot.
3. Blue Sky        - Price at / breaking out to an all-time high.
4. Episodic Pivot  - Pradeep Bonde style: a gap up or an above-average move
                     on abnormal volume (earnings or other news) in the
                     last month (21 sessions), still holding above that day's low.
5. IPO Base        - Recent listings basing near their post-listing high.
6. Murphy          - John Murphy's positional trend-following ("Technical
                     Analysis of the Financial Markets"): price above a rising
                     40-week SMA, then a fresh 10/50-day crossover, 4-week-rule
                     breakout, or crossover confirmed by a 2-week breakout.
                     Stop below the 2-week low.
7. ATR Entry       - First close 2 ATR above the 70-day SMA with +DI > -DI,
                     the RS line above its average and not over-extended.

Every threshold lives in ``ScanConfig`` so you can tune or combine them.

Data: daily prices from Yahoo Finance (via the ``yfinance`` package);
symbol lists from NSE's public index files.

DISCLAIMER: For education and research only. Not investment advice.
Data may be delayed, adjusted or wrong - always verify before acting.

License: MIT
"""
from __future__ import annotations

import io
import time
import warnings
from dataclasses import asdict, dataclass
from typing import Dict, Iterable, List, Optional, Tuple

import numpy as np
import pandas as pd

__version__ = "0.1.0"

# --------------------------------------------------------------------------
# Universe (symbol lists)
# --------------------------------------------------------------------------

_NSE_IDX = "https://archives.nseindia.com/content/indices/"
NSE_LISTS = {
    "NIFTY50": _NSE_IDX + "ind_nifty50list.csv",
    "NIFTYNEXT50": _NSE_IDX + "ind_niftynext50list.csv",
    "NIFTY100": _NSE_IDX + "ind_nifty100list.csv",
    "NIFTY200": _NSE_IDX + "ind_nifty200list.csv",
    "NIFTY500": _NSE_IDX + "ind_nifty500list.csv",
    "MIDCAP150": _NSE_IDX + "ind_niftymidcap150list.csv",
    "SMALLCAP250": _NSE_IDX + "ind_niftysmallcap250list.csv",
    "MICROCAP250": _NSE_IDX + "ind_niftymicrocap250_list.csv",
    "ALL_EQ": "https://archives.nseindia.com/content/equities/EQUITY_L.csv",
}
# Index files that carry an Industry column, used to label ALL_EQ stocks.
_INDUSTRY_SOURCES = ["ind_niftytotalmarket_list.csv", "ind_niftymicrocap250_list.csv"]

# Yahoo Finance symbols for benchmarks used by the RS line.
BENCHMARKS = {
    "NIFTY50": "^NSEI",
    "NIFTY500": "^CRSLDX",
}

# Small offline fallback so the notebook still runs if NSE blocks the download.
FALLBACK_SYMBOLS = [
    "RELIANCE", "TCS", "HDFCBANK", "ICICIBANK", "INFY", "BHARTIARTL", "ITC",
    "SBIN", "LT", "HINDUNILVR", "BAJFINANCE", "KOTAKBANK", "AXISBANK",
    "MARUTI", "SUNPHARMA", "TITAN", "ULTRACEMCO", "NTPC", "M&M", "TATAMOTORS",
    "POWERGRID", "ASIANPAINT", "HCLTECH", "WIPRO", "NESTLEIND", "ONGC",
    "TATASTEEL", "JSWSTEEL", "ADANIENT", "ADANIPORTS", "COALINDIA", "BEL",
    "HAL", "TRENT", "DIVISLAB", "CIPLA", "DRREDDY", "EICHERMOT", "HEROMOTOCO",
    "BAJAJ-AUTO", "GRASIM", "HINDALCO", "TECHM", "BRITANNIA", "APOLLOHOSP",
    "INDUSINDBK", "SHRIRAMFIN", "BAJAJFINSV", "SBILIFE", "HDFCLIFE",
]

_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
    ),
    "Accept": "text/csv,text/plain,*/*",
}


def _industry_map(requests) -> dict:
    """Symbol -> industry from NSE index files (best effort, never raises)."""
    mapping: dict = {}
    for fname in _INDUSTRY_SOURCES:
        for base in (_NSE_IDX, "https://www.niftyindices.com/IndexConstituent/"):
            try:
                r = requests.get(base + fname, headers=_HEADERS, timeout=30)
                r.raise_for_status()
                d = pd.read_csv(io.StringIO(r.text))
                d.columns = [c.strip().upper() for c in d.columns]
                for sym, ind in zip(d["SYMBOL"].astype(str).str.strip(), d["INDUSTRY"].astype(str)):
                    mapping.setdefault(sym, ind.strip())
                break
            except Exception:
                continue
    return mapping


def get_universe(name: str = "NIFTY500") -> pd.DataFrame:
    """Return a DataFrame with columns ``symbol`` and ``industry``.

    ``name`` is one of ``NSE_LISTS`` keys, or a comma-separated list of
    symbols such as ``"RELIANCE, TCS, INFY"``.
    """
    key = name.strip().upper().replace(" ", "")
    if key not in NSE_LISTS:
        syms = [s.strip().upper() for s in name.split(",") if s.strip()]
        return pd.DataFrame({"symbol": syms, "industry": ""})

    try:
        import requests

        urls = [NSE_LISTS[key]]
        if "/indices/" in urls[0]:  # same files are mirrored on niftyindices.com
            urls.append("https://www.niftyindices.com/IndexConstituent/"
                        + urls[0].rsplit("/", 1)[1])
        text, last_err = None, None
        for url in urls:
            try:
                r = requests.get(url, headers=_HEADERS, timeout=30)
                r.raise_for_status()
                text = r.text
                break
            except Exception as exc:
                last_err = exc
        if text is None:
            raise last_err
        df = pd.read_csv(io.StringIO(text))
        df.columns = [c.strip().upper() for c in df.columns]
        if key == "ALL_EQ":
            df = df[df["SERIES"].astype(str).str.strip() == "EQ"]
            out = pd.DataFrame({"symbol": df["SYMBOL"].str.strip()})
            out["industry"] = out["symbol"].map(_industry_map(requests)).fillna("")
        else:
            out = pd.DataFrame(
                {
                    "symbol": df["SYMBOL"].str.strip(),
                    "industry": df.get("INDUSTRY", pd.Series("", index=df.index)),
                }
            )
        return out.drop_duplicates("symbol").reset_index(drop=True)
    except Exception as exc:  # network / format problems
        warnings.warn(
            f"Could not download the {key} list from NSE ({exc}). "
            "Using the built-in fallback list of 50 large caps instead."
        )
        return pd.DataFrame({"symbol": FALLBACK_SYMBOLS, "industry": ""})


# --------------------------------------------------------------------------
# Price data
# --------------------------------------------------------------------------

_OHLCV = ["Open", "High", "Low", "Close", "Volume"]


def _extract(raw: pd.DataFrame, ticker: str) -> Optional[pd.DataFrame]:
    """Pull one ticker's OHLCV out of a yfinance download result."""
    if raw is None or raw.empty:
        return None
    if isinstance(raw.columns, pd.MultiIndex):
        if ticker in raw.columns.get_level_values(0):
            df = raw[ticker]
        elif ticker in raw.columns.get_level_values(1):
            df = raw.xs(ticker, axis=1, level=1)
        else:
            return None
    else:
        df = raw
    if not set(_OHLCV).issubset(df.columns):
        return None
    df = df[_OHLCV].dropna(subset=["Close"]).copy()
    df = df[df["Close"] > 0]
    df.index = pd.to_datetime(df.index).tz_localize(None)
    return df if len(df) else None


def download_prices(
    symbols: Iterable[str],
    period: str = "max",
    chunk_size: int = 50,
    pause: float = 1.0,
    suffix: str = ".NS",
    verbose: bool = True,
) -> Dict[str, pd.DataFrame]:
    """Download daily, split/bonus-adjusted OHLCV for NSE symbols.

    Returns ``{symbol: DataFrame}``. Symbols that fail are skipped.
    ``period='max'`` is needed for the Blue Sky (all-time-high) and
    IPO screens; ``'5y'`` is faster if you only need VCP.
    """
    import yfinance as yf

    symbols = list(dict.fromkeys(s.strip().upper() for s in symbols if s.strip()))
    data: Dict[str, pd.DataFrame] = {}
    batches = [symbols[i : i + chunk_size] for i in range(0, len(symbols), chunk_size)]
    for b, batch in enumerate(batches, 1):
        tickers = [s if s.startswith("^") else s + suffix for s in batch]
        raw = None
        for attempt in range(3):
            try:
                raw = yf.download(
                    tickers,
                    period=period,
                    interval="1d",
                    group_by="ticker",
                    auto_adjust=True,
                    threads=True,
                    progress=False,
                )
                break
            except Exception as exc:
                if attempt == 2:
                    warnings.warn(f"Batch {b} failed: {exc}")
                time.sleep(2 * (attempt + 1))
        for sym, tk in zip(batch, tickers):
            df = _extract(raw, tk)
            if df is not None:
                data[sym] = df
        if verbose:
            print(f"  batch {b}/{len(batches)}: {len(data)} stocks loaded so far")
        time.sleep(pause)
    return data


def download_benchmark(name: str = "NIFTY500", period: str = "max") -> Optional[pd.Series]:
    """Benchmark close series (``NIFTY50`` or ``NIFTY500``) for the RS line."""
    import yfinance as yf

    tk = BENCHMARKS.get(name.upper(), name)
    try:
        raw = yf.download(tk, period=period, interval="1d", auto_adjust=True, progress=False)
        df = _extract(raw, tk)
        if df is None:
            return None
        s = df["Close"]
        s = s[s > 0]
        jump = s.pct_change().abs() > 0.15        # bad prints in index data
        return s.mask(jump).ffill()
    except Exception as exc:
        warnings.warn(f"Benchmark {tk} download failed: {exc}")
        return None


_FUND_FIELDS = {
    "marketCap": "market_cap", "trailingPE": "pe", "priceToBook": "pb",
    "returnOnEquity": "roe", "debtToEquity": "debt_to_equity",
    "revenueGrowth": "revenue_growth", "earningsGrowth": "earnings_growth",
    "profitMargins": "profit_margin", "dividendYield": "dividend_yield",
    "trailingEps": "eps", "bookValue": "book_value", "beta": "beta",
    "sector": "sector", "industry": "yf_industry", "longName": "name",
}


def quarter_summary(stmt) -> dict:
    """Latest quarter from a yfinance quarterly income statement: sales and net
    profit (₹ crore) and operating margin %, each against the quarter before
    (QoQ) and the same quarter a year earlier (YoY). Growth is in %, margin
    changes in percentage points. Missing quarters are left out."""
    if stmt is None or not isinstance(stmt, pd.DataFrame) or stmt.empty:
        return {}
    st = stmt.copy()
    st.columns = pd.to_datetime(st.columns, errors="coerce")
    st = st.loc[:, st.columns.notna()]
    st = st.loc[:, ~st.columns.duplicated()].sort_index(axis=1, ascending=False)

    def row(*names):
        for nm in names:
            if nm in st.index:
                return pd.to_numeric(st.loc[nm], errors="coerce")
        return None

    sales = row("Total Revenue", "Operating Revenue")
    pat = row("Net Income", "Net Income Common Stockholders")
    op = row("Operating Income", "Total Operating Income As Reported")
    cols = [c for c in st.columns if sales is not None and sales.get(c) == sales.get(c)]
    if not cols:
        return {}
    cur = cols[0]
    prev = cols[1] if len(cols) > 1 and 60 <= (cur - cols[1]).days <= 120 else None
    ago = next((c for c in cols[1:] if abs((c - (cur - pd.DateOffset(years=1))).days) <= 20), None)

    def val(r, c):
        if r is None or c is None:
            return None
        x = r.get(c)
        return float(x) if x == x and x is not None else None

    def opm(c):
        o, sl = val(op, c), val(sales, c)
        return o / sl * 100 if o is not None and sl else None

    def growth(a, b):
        return round((a - b) / abs(b) * 100, 1) if a is not None and b else None

    def pts(a, b):
        return round(a - b, 1) if a is not None and b is not None else None

    s0, p0, m0 = val(sales, cur), val(pat, cur), opm(cur)
    out = {"q": cur.strftime("%b-%y"),
           "sales_cr": round(s0 / 1e7, 1) if s0 is not None else None,
           "pat_cr": round(p0 / 1e7, 1) if p0 is not None else None,
           "opm": round(m0, 1) if m0 is not None else None,
           "sales_qoq": growth(s0, val(sales, prev)), "sales_yoy": growth(s0, val(sales, ago)),
           "pat_qoq": growth(p0, val(pat, prev)), "pat_yoy": growth(p0, val(pat, ago)),
           "opm_qoq": pts(m0, opm(prev)), "opm_yoy": pts(m0, opm(ago))}
    return out


def fetch_quarter_summaries(symbols: Iterable[str], suffix: str = ".NS", workers: int = 6) -> Dict[str, dict]:
    """``quarter_summary`` for each stock from Yahoo Finance, best effort."""
    from concurrent.futures import ThreadPoolExecutor
    import yfinance as yf

    def one(sym):
        try:
            return sym, quarter_summary(yf.Ticker(sym + suffix).quarterly_income_stmt)
        except Exception:
            return sym, {}

    with ThreadPoolExecutor(max_workers=workers) as ex:
        return {s: q for s, q in ex.map(one, list(dict.fromkeys(symbols))) if q}


def fetch_fundamentals(symbols: Iterable[str], suffix: str = ".NS", workers: int = 6,
                       verbose: bool = True) -> Dict[str, dict]:
    """Market cap and key ratios from Yahoo Finance, one request per stock.

    Best effort: anything Yahoo doesn't return is simply left out. Ratios are
    converted to percentages where Yahoo gives fractions (ROE, margins, growth).
    """
    from concurrent.futures import ThreadPoolExecutor, as_completed
    import yfinance as yf

    def one(sym):
        for attempt in range(2):
            try:
                info = yf.Ticker(sym + suffix).info or {}
                out = {}
                for k, v in _FUND_FIELDS.items():
                    val = info.get(k)
                    if val is None or (isinstance(val, float) and np.isnan(val)):
                        continue
                    out[v] = val
                for k in ("roe", "revenue_growth", "earnings_growth", "profit_margin"):
                    if k in out and isinstance(out[k], (int, float)):
                        out[k] = round(out[k] * 100, 2)
                # Yahoo's dividendYield changed from a fraction to a percent between
                # yfinance versions; dividend per share / price is right in both.
                out.pop("dividend_yield", None)
                rate, price = info.get("dividendRate"), info.get("currentPrice") or info.get("regularMarketPrice")
                if isinstance(rate, (int, float)) and isinstance(price, (int, float)) and price > 0:
                    out["dividend_yield"] = round(rate / price * 100, 2)
                if isinstance(out.get("market_cap"), (int, float)):
                    out["market_cap_cr"] = round(out["market_cap"] / 1e7, 0)
                return sym, out
            except Exception:
                time.sleep(1.5 * (attempt + 1))
        return sym, {}

    syms = list(dict.fromkeys(symbols))
    res: Dict[str, dict] = {}
    with ThreadPoolExecutor(max_workers=workers) as ex:
        futs = [ex.submit(one, s) for s in syms]
        for k, f in enumerate(as_completed(futs), 1):
            try:
                sym, d = f.result(timeout=60)
                res[sym] = d
            except Exception:
                pass
            if verbose and k % 50 == 0:
                print(f"  fundamentals: {k}/{len(syms)}")
    return res


# --------------------------------------------------------------------------
# Configuration - every threshold is a dial
# --------------------------------------------------------------------------


@dataclass
class ScanConfig:
    # --- Liquidity filters (applied to every screen) ---
    min_price: float = 50.0               # ₹ (every screen)
    min_turnover_cr: float = 1.0          # 50-day avg traded value, ₹ crore/day
    min_mcap_cr: float = 500.0            # market cap, ₹ crore (needs fundamentals; see apply_market_cap_filter)

    # --- Trend Template (Stage 2) ---
    min_rs: float = 70.0                  # RS rating 1-99 vs the scanned universe
    min_above_52w_low: float = 25.0       # % above 52-week low
    max_below_52w_high: float = 25.0      # % below 52-week high

    # --- VCP ---
    vcp_lookback: int = 130               # bars to look back for the base (~6 months)
    vcp_swing_pct: float = 4.0            # min % move that counts as a swing
    vcp_min_contractions: int = 2
    vcp_max_first_depth: float = 35.0     # % depth of the first pullback
    vcp_max_last_depth: float = 12.0      # % depth of the final pullback
    vcp_tightening: float = 1.10          # each pullback <= previous x this
    vcp_max_volume_ratio: float = 0.85    # 10-day avg vol / 50-day avg vol
    vcp_max_below_pivot: float = 6.0      # % below pivot still counted as "setting up"
    vcp_max_above_pivot: float = 5.0      # % above pivot still counted as "fresh breakout"

    # --- Blue Sky (all-time high) ---
    bluesky_max_below_ath: float = 3.0    # % below all-time high
    bluesky_min_history_years: float = 3.0

    # --- Episodic Pivot (Pradeep Bonde) ---
    ep_window: int = 21                   # the EP day is one of the last N sessions (~1 month)
    ep_min_gap: float = 3.0               # % gap up at the open (and still up this much at the close)
    ep_min_move: float = 4.0              # or a day's gain of at least this %...
    ep_move_adr_mult: float = 2.0         # ...and at least this x the 20-day average daily range
    ep_min_rvol: float = 3.0              # EP-day volume vs the 50-day average before it
    ep_min_turnover_cr: float = 5.0       # ₹ crore traded on the EP day
    ep_min_close_pos: float = 0.5         # close in the upper part of the day's range (0 = low, 1 = high)
    ep_neglect_max_3m: float = 10.0       # "Neglected" tag: up no more than this % in the 3 months before

    # --- IPO Base ---
    ipo_min_days: int = 20                # trading days since listing
    ipo_max_days: int = 500               # ~2 years
    ipo_min_base_days: int = 10
    ipo_max_depth: float = 35.0
    ipo_max_below_high: float = 8.0
    ipo_max_above_high: float = 8.0

    # --- Murphy trend-following (Strategy 4A) ---
    murphy_filter: str = "sma40"          # "sma40", "macd", "both" or "none" (weekly filter)
    murphy_entry: str = "any"             # "cross", "4week", "cross2week" or "any"
    murphy_fast: int = 10                 # fast daily SMA (book: 10)
    murphy_slow: int = 50                 # slow daily SMA (book: 50)
    murphy_entry_weeks: int = 4           # breakout above the high of the last N full weeks
    murphy_use_adx: bool = False          # also require ADX >= murphy_min_adx
    murphy_min_adx: float = 20.0
    murphy_signal_days: int = 5           # list BUY signals from the last N sessions

    # --- Base Breakout (numbered bases with a pivot) ---
    base_min_weeks: float = 3.0           # weeks spent below the starting high
    base_min_depth: float = 5.0           # % pullback needed to call it a base
    base_max_depth: float = 35.0          # deeper than this cancels the base
    base_trend_filter: bool = True        # breakout must close above the 50 and 200 SMA
    base_forming_ema: int = 50            # a forming base is listed while the close is above this EMA
    base_max_above_pivot: float = 7.0     # % above pivot still listed as a breakout
    base_min_rs: float = 65.0             # RS rating needed for the screen
    base_signal_days: int = 5             # a breakout is "fresh" for N sessions
    base_climb_days: int = 60             # after that it is "climbing" for up to N sessions
    base_squat_pct: float = 40.0          # breakout closing in the lower N% of its bar = squat
    base_history_bars: int = 1260         # bars of history the base count is built from (~5 years)

    # --- Ichimoku cloud breakout ---
    ich_mode: str = "adaptive"            # "adaptive" (periods follow volatility) or "classic"
    ich_tenkan: int = 9
    ich_kijun: int = 26
    ich_senkou_b: int = 52
    ich_displacement: int = 26
    ich_adapt_len: int = 50               # bars of ATR history the adaptive periods are scaled against
    ich_adapt_strength: float = 0.4       # how far a period may stretch or shrink (0.4 = 40%)
    ich_min_score: float = 50.0           # confluence score a TK cross needs
    ich_break_vol_mult: float = 1.3       # cloud breakout: volume vs its 20-bar average
    ich_sl_atr: float = 0.5               # stop: this many ATR beyond the Kijun
    ich_tp_r: Tuple[float, float, float] = (1.5, 2.5, 4.0)   # targets, as multiples of the risk
    ich_div_len: int = 5                  # bars each side of a pivot (momentum divergence)
    ich_div_max_bars: int = 60            # pivots further apart than this are not compared
    ich_signal_days: int = 5              # list signals from the last N sessions
    ich_show_closed_bars: int = 20        # keep a closed setup on the chart this long
    ich_bars: int = 700                   # history analysed (the first ~100 bars are warm-up)

    # --- 50 EMA Pullback ---
    pb_ema: int = 50
    pb_min_rs: float = 80.0               # RS rating needed for the screen
    pb_max_above: float = 3.0             # % above the EMA still counted as a pullback to it
    pb_max_below: float = 2.0             # % the close may sit under the EMA
    pb_lookback: int = 40                 # bars in which the stock must have been extended
    pb_min_extension: float = 8.0         # % above the EMA it had reached in that time
    pb_touch_days: int = 5                # sessions a touch of the EMA stays "recent"

    # --- ATR Entry (the green circle of the "RS Line + Buy Signals" indicator) ---
    atr_entry_ma: int = 70                # close at least atr_entry_mult x ATR above this SMA
    atr_entry_mult: float = 2.0
    atr_len: int = 14                     # ATR and DMI length (Wilder)
    atr_use_rs: bool = True               # RS line (vs the benchmark) above its average
    atr_rs_ma: int = 50
    atr_max_ext: float = 7.0              # skip stocks more than this many ATRs above the 50 SMA (0 = off)
    atr_ext_ma: int = 50
    atr_signal_days: int = 5              # the signal fired in the last N sessions

    # --- Shared ---
    breakout_window: int = 5              # bars in which a breakout counts as "recent"
    surge_volume: float = 1.5             # today's vol / 50-day avg = "volume surge"

    def to_dict(self) -> dict:
        return asdict(self)


# --------------------------------------------------------------------------
# Building blocks
# --------------------------------------------------------------------------


def zigzag(high: np.ndarray, low: np.ndarray, pct: float) -> List[Tuple[int, float, str]]:
    """Swing points where price reversed by at least ``pct`` percent.

    Returns ``[(index, price, 'H' or 'L'), ...]``. The final element is the
    current, not-yet-confirmed extreme, so the latest swing is always included.
    """
    n = len(high)
    if n < 3:
        return []
    up, down = 1 + pct / 100.0, 1 - pct / 100.0
    piv: List[Tuple[int, float, str]] = []
    trend = 0
    hi_i, lo_i = 0, 0
    hi, lo = high[0], low[0]
    for i in range(1, n):
        if trend == 0:
            if high[i] > hi:
                hi, hi_i = high[i], i
            if low[i] < lo:
                lo, lo_i = low[i], i
            if hi >= lo * up:
                if lo_i < hi_i:
                    piv.append((lo_i, lo, "L"))
                    trend = 1
                else:
                    piv.append((hi_i, hi, "H"))
                    trend = -1
        elif trend == 1:
            if high[i] > hi:
                hi, hi_i = high[i], i
            elif low[i] <= hi * down:
                piv.append((hi_i, hi, "H"))
                trend, lo, lo_i = -1, low[i], i
        else:
            if low[i] < lo:
                lo, lo_i = low[i], i
            elif high[i] >= lo * up:
                piv.append((lo_i, lo, "L"))
                trend, hi, hi_i = 1, high[i], i
    if trend == 1:
        piv.append((hi_i, hi, "H"))
    elif trend == -1:
        piv.append((lo_i, lo, "L"))
    return piv


def find_vcp(df: pd.DataFrame, cfg: ScanConfig) -> dict:
    """Detect a Volatility Contraction Pattern in the last ``vcp_lookback`` bars.

    Logic: start at the highest swing high in the window (left side of the
    base), then measure each swing-high -> swing-low pullback after it. A VCP
    needs at least ``vcp_min_contractions`` pullbacks, each no deeper than the
    one before (within ``vcp_tightening``), a shallow final pullback, and the
    pivot (high of the last contraction) close to the current price.
    """
    out = {"vcp": False, "vcp_contractions": 0, "vcp_depths": "",
           "vcp_pivot": np.nan, "vcp_base_days": 0}
    w = df.iloc[-cfg.vcp_lookback:]
    if len(w) < 30:
        return out
    h, l = w["High"].to_numpy(float), w["Low"].to_numpy(float)
    piv = zigzag(h, l, cfg.vcp_swing_pct)
    highs = [p for p in piv if p[2] == "H"]
    if not highs:
        return out
    start = max(highs, key=lambda p: p[1])          # left-side high of the base
    seq = [p for p in piv if p[0] >= start[0]]

    depths, pivot = [], start[1]
    for a, b in zip(seq, seq[1:]):
        if a[2] == "H" and b[2] == "L":
            depths.append((a[1] - b[1]) / a[1] * 100)
            pivot = a[1]
    # The last swing is still forming. If it is a high below the previous
    # pivot and price has eased off it (by less than vcp_swing_pct), treat it
    # as the final, tightest contraction and make it the new pivot.
    last = seq[-1]
    if depths and last[2] == "H" and last[1] < pivot and len(seq) >= 2:
        low_since = float(l[last[0]:].min())
        d = (last[1] - low_since) / last[1] * 100
        if d >= 0.5:
            depths.append(d)
            pivot = last[1]
    if not depths:
        return out

    tight = all(d2 <= d1 * cfg.vcp_tightening for d1, d2 in zip(depths, depths[1:]))
    close = float(w["Close"].iloc[-1])
    dist = (close - pivot) / pivot * 100
    out.update(
        vcp_contractions=len(depths),
        vcp_depths=" > ".join(f"{d:.0f}%" for d in depths),
        vcp_pivot=round(pivot, 2),
        vcp_base_days=len(w) - start[0],
        vcp_pct_from_pivot=round(dist, 2),
    )
    out["vcp"] = bool(
        len(depths) >= cfg.vcp_min_contractions
        and tight
        and depths[0] <= cfg.vcp_max_first_depth
        and depths[-1] <= cfg.vcp_max_last_depth
        and -cfg.vcp_max_below_pivot <= dist <= cfg.vcp_max_above_pivot
    )
    return out


BASE_STAGES = ("Forming", "Fresh breakout", "Climbing", "Played out")


def _walk_bases(df: pd.DataFrame, cfg: ScanConfig) -> Tuple[dict, List[dict]]:
    """Walk the bars once and return (current base metrics, every base found).

    Same rules as ``pine/base_breakout_pro.pine``, closed bars only. A structure
    starts at a swing high (the pivot). It becomes a *base* once price has spent
    ``base_min_weeks`` below that high with a pullback between
    ``base_min_depth`` and ``base_max_depth``. A close above the pivot is the
    breakout; the base count goes up by one, or restarts at 1 when the base
    undercut the low of the previous base.

    The stock's stage is one of ``BASE_STAGES``:

    * **Fresh breakout**: broke out in the last ``base_signal_days`` sessions,
      still above the pivot and no more than ``base_max_above_pivot`` beyond it.
    * **Forming**: a base is in place and the close is above the
      ``base_forming_ema``-day EMA. This comes before an older breakout's stage,
      so a stock resting in a new base is not shown as Climbing or Played out.
      Under the EMA a forming base is not listed.
    * **Climbing**: broke out up to ``base_climb_days`` sessions ago and has not
      closed back below the pivot since.
    * **Played out**: broke out in that window but the breakout failed: price
      has since closed back below the pivot, straight away or weeks later.
    """
    out = {"base_bo": False, "base_state": "", "base_no": 0, "base_pivot": np.nan,
           "base_pct_from_pivot": np.nan, "base_weeks": np.nan, "base_depth": np.nan,
           "base_tags": "", "base_days_ago": np.nan}
    bases: List[dict] = []
    n = len(df)
    if n < 60:
        return out, bases
    c_s, v_s = df["Close"], df["Volume"]
    h = df["High"].to_numpy(float)
    l = df["Low"].to_numpy(float)
    c = c_s.to_numpy(float)
    sma50 = c_s.rolling(50).mean().to_numpy(float)
    sma200 = c_s.rolling(200).mean().to_numpy(float)
    ema_f = float(c_s.ewm(span=cfg.base_forming_ema, adjust=False).mean().iloc[-1])
    vol10 = v_s.rolling(10).mean().to_numpy(float)
    vol50 = v_s.rolling(50).mean().to_numpy(float)
    # all-time high before each bar, for the "Sky" tag
    prior_ath = np.r_[np.nan, np.maximum.accumulate(h)[:-1]]
    days = (df.index - df.index[0]).days.to_numpy(float)

    start = max(0, n - cfg.base_history_bars)
    peak = low = np.nan
    peak_i = -1
    peak_sky = active = False
    base_n = 0
    prev_low = np.nan
    last = None                                  # the most recent breakout

    for i in range(start, n):
        restart = False
        if peak_i < 0:
            restart = True
        else:
            low = min(low, l[i])
            depth = (peak - low) / peak * 100
            weeks = (days[i] - days[peak_i]) / 7
            if depth > cfg.base_max_depth:
                restart = True                   # too deep: not a base any more
            elif not active:
                if h[i] > peak:
                    restart = True               # still trending: the high moves up
                elif weeks >= cfg.base_min_weeks and depth >= cfg.base_min_depth:
                    active = True
            elif c[i] > peak:
                ok = (not cfg.base_trend_filter
                      or ((np.isnan(sma50[i]) or c[i] > sma50[i])
                          and (np.isnan(sma200[i]) or c[i] > sma200[i])))
                if ok:
                    undercut = prev_low == prev_low and low < prev_low
                    base_n = 1 if undercut else base_n + 1
                    prev_low = low
                    k = max(5, min(100, (i - peak_i) // 3))
                    tight = h[i - k + 1:i + 1].max() - l[i - k + 1:i + 1].min()
                    vcp = bool(tight <= 0.5 * (peak - low) and vol10[i] < vol50[i])
                    rng = h[i] - l[i]
                    squat = bool(rng > 0 and (c[i] - l[i]) / rng * 100 < cfg.base_squat_pct)
                    tags = [t for t, on in (("VCP", vcp), ("Sky", peak_sky), ("Squat", squat)) if on]
                    last = {"i": i, "start": peak_i, "pivot": peak, "low": low, "no": base_n,
                            "weeks": weeks, "depth": depth, "tags": ", ".join(tags), "breakout": True}
                    bases.append(last)
                restart = True
        if restart:
            peak, peak_i, low = h[i], i, l[i]
            peak_sky = bool(np.isnan(prior_ath[i]) or h[i] >= prior_ath[i])
            active = False

    close = c[-1]
    forming = None
    if active:
        undercut = prev_low == prev_low and low < prev_low
        forming = {"i": n - 1, "start": peak_i, "pivot": peak, "low": low,
                   "no": 1 if undercut else base_n + 1,
                   "weeks": (days[-1] - days[peak_i]) / 7, "depth": (peak - low) / peak * 100,
                   "tags": "Sky" if peak_sky else "", "breakout": False}
        bases.append(forming)

    def fill(b, state, days_ago=np.nan):
        out.update(base_bo=True, base_state=state, base_no=b["no"], base_pivot=round(b["pivot"], 2),
                   base_pct_from_pivot=round((close / b["pivot"] - 1) * 100, 2),
                   base_weeks=round(b["weeks"], 1), base_depth=round(b["depth"], 1),
                   base_tags=b["tags"], base_days_ago=days_ago)

    ago = (n - 1 - last["i"]) if last is not None else None
    gain = (close / last["pivot"] - 1) * 100 if last is not None else np.nan
    held = last is not None and bool((c[last["i"]:] >= last["pivot"]).all())
    if last is not None and ago <= cfg.base_signal_days and held and gain <= cfg.base_max_above_pivot:
        fill(last, "Fresh breakout", int(ago))
    elif forming is not None and close >= ema_f:
        # a new base, still above the EMA: that is the stock's stage, whatever
        # happened to the breakout before it
        fill(forming, "Forming")
    elif last is not None and ago <= cfg.base_climb_days:
        fill(last, "Climbing" if held else "Played out", int(ago))
    elif forming is not None:                    # a base, but under the EMA: not listed
        fill(forming, "Forming")
        out["base_bo"] = False
    return out, bases


def find_base(df: pd.DataFrame, cfg: ScanConfig) -> dict:
    """Stage, pivot and base number of the stock's current base. See ``_walk_bases``."""
    return _walk_bases(df, cfg)[0]


def base_boxes(df: pd.DataFrame, cfg: ScanConfig, since=None) -> List[dict]:
    """Every base as a box for charting: start and end date, pivot, low and label.

    ``bo`` is 1 for a base that broke out (``e`` is the breakout bar) and 0 for
    the base still forming. ``since`` drops bases that ended before that date.
    """
    idx = df.index
    boxes = []
    for b in _walk_bases(df, cfg)[1]:
        if since is not None and idx[b["i"]] < since:
            continue
        tags = [t for t in b["tags"].split(", ") if t and t != "Squat"]
        label = " · ".join(["+".join(tags)] * bool(tags) + [f"B{b['no']}", f"{round(b['weeks'])}w"])
        boxes.append({"s": idx[b["start"]].strftime("%Y-%m-%d"), "e": idx[b["i"]].strftime("%Y-%m-%d"),
                      "p": round(float(b["pivot"]), 2), "l": round(float(b["low"]), 2),
                      "t": label, "bo": int(b["breakout"]), "sq": int("Squat" in b["tags"])})
    return boxes


ICH_BULL_KINDS = ("long", "break_up", "retest_up")
ICH_BEAR_KINDS = ("short", "break_down", "retest_down")
ICH_SIGNAL_NAMES = {"long": "TK cross", "break_up": "Cloud breakout", "retest_up": "Cloud retest"}


def _ichimoku_engine(df: pd.DataFrame, cfg: ScanConfig) -> Optional[dict]:
    """Adaptive Ichimoku with scored signals and a tracked TP/SL setup.

    The rules follow the "Adaptive Ichimoku Nexus" TradingView indicator by
    WillyAlgoTrader, at its default settings:

    * **Adaptive periods.** Tenkan, Kijun and Senkou B use Donchian midpoints
      whose length stretches or shrinks by up to ``ich_adapt_strength`` with
      where ATR(14) sits in its ``ich_adapt_len``-bar range: shorter when
      volatility is high, longer when it is low. ``ich_mode = "classic"``
      keeps the lengths fixed.
    * **Confluence score (0-100)** from eight factors: price against the cloud,
      Tenkan against Kijun, the Chikou span, the direction of the cloud ahead,
      cloud thickness, volume, momentum and momentum acceleration.
    * **Signals**, all on closed bars: a Tenkan/Kijun cross that passes the
      cloud-thickness, volume and Chikou filters and scores ``ich_min_score``
      or more ("long" / "short"); a close through the cloud on volume of
      ``ich_break_vol_mult`` times its 20-bar average ("break_up" /
      "break_down"); and a retest of the cloud edge within 10 bars of a
      breakout ("retest_up" / "retest_down"). Cloud twists and momentum
      divergences are recorded as information only.
    * **Trade record.** Every signal sets an entry, a stop under the Kijun
      (plus ``ich_sl_atr`` ATR, falling back to 2 ATR if that lands on the
      wrong side) and three targets at ``ich_tp_r`` multiples of the risk. A
      new signal replaces the open setup. A bar that touches both the stop and
      a target counts as the stop.

    Only the last ``ich_bars`` bars are analysed; the first part of that window
    is warm-up. Returns None when there is too little history.
    """
    w = df.iloc[-cfg.ich_bars:]
    n = len(w)
    disp, d_off = cfg.ich_displacement, cfg.ich_displacement - 1
    adaptive = cfg.ich_mode == "adaptive"
    stretch = cfg.ich_adapt_strength if adaptive else 0.0
    warm = max(int(round(cfg.ich_senkou_b * (1 + stretch))) + disp, 80)
    if n < warm + 30:
        return None
    h = w["High"].to_numpy(float)
    l = w["Low"].to_numpy(float)
    c = w["Close"].to_numpy(float)
    v = np.nan_to_num(w["Volume"].to_numpy(float))

    # ATR(14), Wilder smoothing
    pc = np.r_[c[0], c[:-1]]
    tr = np.maximum(h - l, np.maximum(np.abs(h - pc), np.abs(l - pc)))
    atr = np.zeros(n)
    atr[13] = tr[:14].mean()
    for i in range(14, n):
        atr[i] = (atr[i - 1] * 13 + tr[i]) / 14
    atr_s = pd.Series(atr)
    atr_hi = atr_s.rolling(cfg.ich_adapt_len).max().fillna(atr_s).to_numpy()
    atr_lo = atr_s.rolling(cfg.ich_adapt_len).min().fillna(0.0).to_numpy()
    rng = atr_hi - atr_lo
    vol_ratio = np.where(rng > 0, np.clip((atr - atr_lo) / np.where(rng > 0, rng, 1), 0, 1), 0.5)

    def donchian(base: int) -> np.ndarray:
        lo_p = max(int(round(base * (1 - stretch))), 3)
        hi_p = int(round(base * (1 + stretch)))
        out = np.empty(n)
        for i in range(n):
            p = base if not adaptive else min(max(int(round(base * (1 + stretch * (1 - 2 * vol_ratio[i])))), lo_p), hi_p)
            out[i] = (h[i - p + 1:i + 1].max() + l[i - p + 1:i + 1].min()) / 2 if i >= p - 1 else (h[i] + l[i]) / 2
        return out

    tenkan, kijun, span_b = donchian(cfg.ich_tenkan), donchian(cfg.ich_kijun), donchian(cfg.ich_senkou_b)
    span_a = (tenkan + kijun) / 2

    def lag(a: np.ndarray, k: int) -> np.ndarray:      # a[i - k], or a[i] where there is no such bar
        out = a.copy()
        out[k:] = a[:-k]
        return out

    kumo_a, kumo_b = lag(span_a, d_off), lag(span_b, d_off)      # the cloud under each bar
    top, bot = np.maximum(kumo_a, kumo_b), np.minimum(kumo_a, kumo_b)
    thick = top - bot
    thin = thick < pd.Series(thick).rolling(50).mean().fillna(pd.Series(thick)).to_numpy() * 0.3
    above, below = c > top, c < bot
    tk_bull, tk_bear = tenkan > kijun, tenkan < kijun
    chikou_bull, chikou_bear = c > lag(c, disp), c < lag(c, disp)
    vol_sma = pd.Series(v).rolling(20).mean().fillna(0.0).to_numpy()
    has_vol = v > 0
    vol_ok = np.where(has_vol, v > vol_sma * 1.2, True)
    vol_strong = np.where(has_vol, v > vol_sma * cfg.ich_break_vol_mult, True)

    # momentum pulse, -100..100: Tenkan-Kijun spread, its acceleration, and the slope of the cloud ahead
    safe_atr = np.where(atr > 0, atr, 1.0)
    spread = np.where(atr > 0, (tenkan - kijun) / safe_atr, 0.0)
    slope = np.where(atr > 0, ((span_a - lag(span_a, 5)) - (span_b - lag(span_b, 5))) / safe_atr, 0.0)
    pulse = np.clip(spread * 40 + (spread - lag(spread, 3)) * 100 + slope * 30, -100, 100)
    mom = pd.Series(pulse).ewm(span=5, adjust=False).mean().to_numpy()
    mom_prev = lag(mom, 1)
    future_bull = (span_a - lag(span_a, 3)) > (span_b - lag(span_b, 3))

    def score(i: int, bull: bool) -> float:
        s = (20.0 if (above[i] if bull else below[i]) else 8.0 if not (above[i] or below[i]) else 0.0)
        s += 15.0 if (tk_bull[i] if bull else tk_bear[i]) else 0.0
        s += 15.0 if (chikou_bull[i] if bull else chikou_bear[i]) else 0.0
        s += 10.0 if future_bull[i] == bull else 0.0
        s += 2.0 if thin[i] else 8.0
        s += 10.0 if vol_ok[i] else 0.0
        m = mom[i] if bull else -mom[i]
        s += 12.0 if m > 20 else 6.0 if m > 0 else 0.0
        rising = (mom[i] > mom_prev[i] and mom[i] > 0) if bull else (mom[i] < mom_prev[i] and mom[i] < 0)
        s += 10.0 if rising else 0.0
        return min(s, 100.0)

    events: List[dict] = []
    zones: List[dict] = []
    trade = None                 # the setup being tracked, or the last one closed
    stats = {"closed": 0, "tp1": 0, "tp2": 0, "tp3": 0, "sl": 0, "r_sum": 0.0}
    tp_r = cfg.ich_tp_r
    last_up = last_down = -100
    piv = cfg.ich_div_len
    last_ph = last_pl = None     # (price, momentum, bar) of the previous pivot high / low

    def close_trade(t: dict, i: int, r_rest: float, how: str) -> None:
        r = ((tp_r[0] if t["tp1_hit"] else r_rest) + (tp_r[1] if t["tp2_hit"] else r_rest)
             + (tp_r[2] if how == "tp3" else r_rest)) / 3
        stats["closed"] += 1
        stats["r_sum"] += r
        stats["tp1"] += int(t["tp1_hit"])
        stats["tp2"] += int(t["tp2_hit"])
        stats["tp3"] += int(how == "tp3")
        stats["sl"] += int(how == "sl")
        t.update(open=False, close_i=i, result=how)

    def open_trade(i: int, long: bool) -> dict:
        entry, buf = c[i], atr[i] * cfg.ich_sl_atr
        sl = kijun[i] - buf if long else kijun[i] + buf
        if (sl >= entry) if long else (sl <= entry):          # stop on the wrong side: use an ATR stop
            sl = entry - atr[i] * 2 if long else entry + atr[i] * 2
        risk = max(abs(entry - sl), atr[i] * 0.5)
        sign = 1 if long else -1
        return {"dir": sign, "i": i, "entry": entry, "sl": sl, "risk": risk, "open": True,
                "tp": [entry + sign * risk * m for m in tp_r],
                "tp1_hit": False, "tp2_hit": False, "tp3_hit": False, "close_i": None, "result": ""}

    for i in range(warm, n):
        buy = (tk_bull[i] and not tk_bull[i - 1] and tenkan[i - 1] <= kijun[i - 1] and not thin[i]
               and vol_ok[i] and chikou_bull[i] and score(i, True) >= cfg.ich_min_score)
        sell = (tk_bear[i] and not tk_bear[i - 1] and tenkan[i - 1] >= kijun[i - 1] and not thin[i]
                and vol_ok[i] and chikou_bear[i] and score(i, False) >= cfg.ich_min_score)
        brk_up = bool(above[i] and c[i - 1] <= top[i - 1] and vol_strong[i])
        brk_dn = bool(below[i] and c[i - 1] >= bot[i - 1] and vol_strong[i])
        if brk_up:
            last_up = i
        if brk_dn:
            last_down = i
        ret_up = bool(1 < i - last_up <= 10 and l[i] <= top[i] and c[i] > top[i])
        ret_dn = bool(1 < i - last_down <= 10 and h[i] >= bot[i] and c[i] < bot[i])
        if buy:
            events.append({"i": i, "k": "long", "score": int(round(score(i, True)))})
        if sell:
            events.append({"i": i, "k": "short", "score": int(round(score(i, False)))})
        for on, kind in ((brk_up, "break_up"), (brk_dn, "break_down"), (ret_up, "retest_up"), (ret_dn, "retest_down")):
            if on:
                events.append({"i": i, "k": kind})
        # cloud twist: Senkou A crossing Senkou B (the cloud 25 bars ahead changes colour)
        if span_a[i] > span_b[i] and span_a[i - 1] <= span_b[i - 1]:
            events.append({"i": i, "k": "twist_up"})
        elif span_a[i] < span_b[i] and span_a[i - 1] >= span_b[i - 1]:
            events.append({"i": i, "k": "twist_down"})
        # momentum divergence at confirmed price pivots (known `piv` bars after the pivot)
        j = i - piv
        if j - piv >= 0:
            if h[j] == h[j - piv:i + 1].max() and (h[j - piv:i + 1] == h[j]).sum() == 1:
                if last_ph and i - last_ph[2] <= cfg.ich_div_max_bars and h[j] > last_ph[0] and mom[j] < last_ph[1]:
                    events.append({"i": j, "k": "div_down"})
                last_ph = (h[j], mom[j], i)
            if l[j] == l[j - piv:i + 1].min() and (l[j - piv:i + 1] == l[j]).sum() == 1:
                if last_pl and i - last_pl[2] <= cfg.ich_div_max_bars and l[j] < last_pl[0] and mom[j] > last_pl[1]:
                    events.append({"i": j, "k": "div_up"})
                last_pl = (l[j], mom[j], i)
        # a Kijun that was flat for four bars and has just moved leaves a support/resistance zone
        flat_now = all(abs(kijun[i] - kijun[i - k]) <= 0.01 for k in (1, 2, 3))
        flat_before = all(abs(kijun[i - 1] - kijun[i - 1 - k]) <= 0.01 for k in (1, 2, 3))
        if flat_before and not flat_now:
            zones.append({"i0": i - 5, "i1": i + 10, "p": kijun[i - 1], "band": atr[i] * 0.15})

        any_buy, any_sell = buy or brk_up or ret_up, sell or brk_dn or ret_dn
        opened = False
        if any_buy or any_sell:                  # a new signal replaces the open setup (buy wins a tie)
            if trade and trade["open"]:
                mk = trade["dir"] * (c[i] - trade["entry"]) / max(trade["risk"], 1e-9)
                close_trade(trade, i, mk, "replaced")
            trade = open_trade(i, bool(any_buy))
            opened = True
        if trade and trade["open"] and not opened and i > trade["i"]:
            d = trade["dir"]
            hit = (lambda p: l[i] <= p) if d == 1 else (lambda p: h[i] >= p)       # stop side
            reach = (lambda p: h[i] >= p) if d == 1 else (lambda p: l[i] <= p)     # target side
            if hit(trade["sl"]):                 # worst case first: stop before targets on the same bar
                close_trade(trade, i, -1.0, "sl")
            else:
                trade["tp1_hit"] = trade["tp1_hit"] or reach(trade["tp"][0])
                trade["tp2_hit"] = trade["tp2_hit"] or reach(trade["tp"][1])
                if reach(trade["tp"][2]):
                    trade["tp3_hit"] = True
                    close_trade(trade, i, 0.0, "tp3")

    i = n - 1
    trend = "Bullish" if above[i] and tk_bull[i] else "Bearish" if below[i] and tk_bear[i] else "Neutral"
    if mom[i] > 0:
        momentum = "Accelerating" if mom[i] > mom_prev[i] else "Fading"
    elif mom[i] < 0:
        momentum = "Falling" if mom[i] < mom_prev[i] else "Recovering"
    else:
        momentum = "Neutral"
    cloud = "Thin" if thin[i] else "Above" if above[i] else "Below" if below[i] else "Inside"
    return {"index": w.index, "n": n, "shift": d_off, "tenkan": tenkan, "kijun": kijun,
            "span_a": span_a, "span_b": span_b, "events": events, "zones": zones, "trade": trade,
            "stats": stats, "trend": trend, "momentum": momentum, "momentum_value": float(mom[i]),
            "cloud": cloud, "score": max(score(i, True), score(i, False))}


def find_ichimoku(df: pd.DataFrame, cfg: ScanConfig) -> dict:
    """Latest bullish Ichimoku signal, if it is recent and nothing bearish followed it.

    Listed when a bullish signal (TK cross, cloud breakout or cloud retest; see
    ``_ichimoku_engine``) fired in the last ``ich_signal_days`` sessions, no
    bearish signal has fired since, and the setup it opened has not been
    stopped out.
    """
    out = {"ichimoku": False, "ich_signal": "", "ich_days_ago": np.nan, "ich_score": np.nan,
           "ich_trend": "", "ich_momentum": "", "ich_cloud": "", "ich_entry": np.nan,
           "ich_sl": np.nan, "ich_tp1": np.nan}
    e = _ichimoku_engine(df, cfg)
    if e is None:
        return out
    out.update(ich_score=int(round(e["score"])), ich_trend=e["trend"], ich_momentum=e["momentum"],
               ich_cloud=e["cloud"])
    bulls = [x for x in e["events"] if x["k"] in ICH_BULL_KINDS]
    bears = [x for x in e["events"] if x["k"] in ICH_BEAR_KINDS]
    if not bulls:
        return out
    sig = bulls[-1]
    # several bullish signals on the same bar: name the strongest (TK cross, then breakout, then retest)
    same = [x for x in bulls if x["i"] == sig["i"]]
    sig = min(same, key=lambda x: ICH_BULL_KINDS.index(x["k"]))
    ago = e["n"] - 1 - sig["i"]
    t = e["trade"]
    out.update(ich_signal=ICH_SIGNAL_NAMES[sig["k"]], ich_days_ago=int(ago))
    if "score" in sig:
        out["ich_score"] = sig["score"]
    if t and t["dir"] == 1:
        out.update(ich_entry=round(float(t["entry"]), 2), ich_sl=round(float(t["sl"]), 2),
                   ich_tp1=round(float(t["tp"][0]), 2))
    out["ichimoku"] = bool(
        ago <= cfg.ich_signal_days
        and (not bears or bears[-1]["i"] < sig["i"])
        and t is not None and t["dir"] == 1 and t["result"] != "sl"
    )
    return out


def ichimoku_chart(df: pd.DataFrame, cfg: ScanConfig, bars: int) -> Optional[dict]:
    """Everything a chart needs to draw the Ichimoku view for the last ``bars`` bars:
    the lines, the signals, the support/resistance zones and the tracked setup."""
    e = _ichimoku_engine(df, cfg)
    if e is None:
        return None
    n = e["n"]
    k = min(bars, n)
    off = n - k                                   # engine index -> chart index
    idx = e["index"]
    day = lambda i: idx[min(max(i, 0), n - 1)].strftime("%Y-%m-%d")  # noqa: E731
    r2 = lambda a: [round(float(x), 2) for x in a[off:]]            # noqa: E731
    out = {"shift": e["shift"], "tenkan": r2(e["tenkan"]), "kijun": r2(e["kijun"]),
           "spanA": r2(e["span_a"]), "spanB": r2(e["span_b"]),
           "events": [{"d": day(x["i"]), "k": x["k"], **({"s": x["score"]} if "score" in x else {})}
                      for x in e["events"] if x["i"] >= off],
           "zones": [{"s": day(z["i0"]), "e": day(z["i1"]), "p": round(float(z["p"]), 2),
                      "b": round(float(z["band"]), 2)} for z in e["zones"] if z["i1"] >= off],
           "trend": e["trend"], "momentum": e["momentum"], "score": int(round(e["score"])),
           "stats": {**{k2: v for k2, v in e["stats"].items() if k2 != "r_sum"},
                     "avg_r": round(e["stats"]["r_sum"] / e["stats"]["closed"], 2) if e["stats"]["closed"] else None}}
    t = e["trade"]
    if t and t["i"] >= off and (t["open"] or n - 1 - t["close_i"] <= cfg.ich_show_closed_bars):
        out["trade"] = {"d": day(t["i"]), "dir": t["dir"], "entry": round(float(t["entry"]), 2),
                        "sl": round(float(t["sl"]), 2), "tp": [round(float(p), 2) for p in t["tp"]],
                        "hit": [bool(t["tp1_hit"]), bool(t["tp2_hit"]), bool(t["tp3_hit"])],
                        "open": bool(t["open"]), "result": t["result"],
                        "end": day(t["close_i"]) if t["close_i"] is not None else None}
    return out


def find_ep(df: pd.DataFrame, cfg: ScanConfig) -> dict:
    """Episodic Pivot: new information forces a quick repricing (Pradeep Bonde).

    An *EP day* is one of the last ``ep_window`` sessions where the stock

    * gapped up at least ``ep_min_gap`` % and still closed that much higher, or
      gained at least ``ep_min_move`` % and ``ep_move_adr_mult`` x its usual
      daily range (an above-average move);
    * traded ``ep_min_rvol`` x its 50-day average volume and at least
      ``ep_min_turnover_cr`` crore. Abnormal volume is the catalyst's footprint
      (earnings, an order, a policy change, any news), the idea behind EP 9M;
    * closed in the upper part of the day's range (``ep_min_close_pos``).

    It must still be holding: no close below the EP day's low since. The most
    recent EP day counts. Tagged "Neglected" when the stock had done little
    in the three months before (the classic EP context). Whether the day was
    an earnings day is added later by the daily scan (``ep_catalyst``).
    """
    out = {"ep": False, "ep_date": "", "ep_days_ago": np.nan, "ep_type": "", "ep_gap": np.nan,
           "ep_chg": np.nan, "ep_rvol": np.nan, "ep_low": np.nan, "ep_pct_since": np.nan,
           "ep_neglected": False, "ep_catalyst": ""}
    n = len(df)
    if n < 60:
        return out
    o, h, l, c = (df[k].to_numpy(float) for k in ("Open", "High", "Low", "Close"))
    v = df["Volume"].fillna(0).to_numpy(float)
    adr = (h / l - 1) * 100
    for k in range(min(cfg.ep_window, n - 52)):
        d = n - 1 - k
        pc = c[d - 1]
        if not pc > 0:
            continue
        gap = (o[d] / pc - 1) * 100
        chg = (c[d] / pc - 1) * 100
        avg_v = v[d - 50:d].mean()
        rvol = v[d] / avg_v if avg_v > 0 else np.nan
        adr20 = np.nanmean(adr[d - 20:d])
        rng = h[d] - l[d]
        pos = (c[d] - l[d]) / rng if rng > 0 else 1.0
        gapped = gap >= cfg.ep_min_gap and chg >= cfg.ep_min_gap
        big = chg >= max(cfg.ep_min_move, cfg.ep_move_adr_mult * adr20)
        if not ((gapped or big) and rvol == rvol and rvol >= cfg.ep_min_rvol
                and c[d] * v[d] / 1e7 >= cfg.ep_min_turnover_cr and pos >= cfg.ep_min_close_pos):
            continue
        if (c[d:] < l[d]).any():                 # broke the EP day's low since: not holding
            continue
        ret3m = (pc / c[max(0, d - 64)] - 1) * 100
        out.update(ep=True, ep_date=df.index[d].strftime("%Y-%m-%d"), ep_days_ago=k,
                   ep_type="Gap up" if gapped else "Big move", ep_gap=round(gap, 2),
                   ep_chg=round(chg, 2), ep_rvol=round(rvol, 1), ep_low=round(l[d], 2),
                   ep_pct_since=round((c[-1] / c[d] - 1) * 100, 2),
                   ep_neglected=bool(ret3m <= cfg.ep_neglect_max_3m))
        break
    return out


def earnings_on(ep_date: str, dates) -> bool:
    """True when an earnings date falls on the EP day or up to 4 days before it
    (Indian results often come out after the close, so the reaction is the next session)."""
    if not ep_date:
        return False
    d = pd.Timestamp(ep_date).normalize()
    for x in dates or []:
        try:
            gap = (d - pd.Timestamp(x).tz_localize(None).normalize()).days
        except TypeError:
            gap = (d - pd.Timestamp(x).normalize()).days
        if 0 <= gap <= 4:
            return True
    return False


def fetch_earnings_dates(symbols: Iterable[str], suffix: str = ".NS", workers: int = 4) -> Dict[str, list]:
    """Recent earnings dates from Yahoo Finance, best effort (Yahoo's NSE coverage is patchy)."""
    from concurrent.futures import ThreadPoolExecutor
    import yfinance as yf

    def one(sym):
        try:
            ed = yf.Ticker(sym + suffix).get_earnings_dates(limit=8)
            return sym, [] if ed is None or ed.empty else list(ed.index)
        except Exception:
            return sym, []

    with ThreadPoolExecutor(max_workers=workers) as ex:
        return dict(ex.map(one, list(dict.fromkeys(symbols))))


def find_pullback(df: pd.DataFrame, cfg: ScanConfig) -> dict:
    """A leader pulling back to its rising 50-day EMA.

    The stock must be in an uptrend (close above the 200-day SMA, the 50 EMA
    above the 200 SMA and higher than ten sessions ago), must have run at least
    ``pb_min_extension`` above the EMA in the last ``pb_lookback`` bars, and
    must now close between ``pb_max_below`` under and ``pb_max_above`` over it.
    The RS floor (``pb_min_rs``) is applied in ``apply_screens``.

    Stage: **Bouncing** when it touched the EMA in the last ``pb_touch_days``
    sessions and today closed above yesterday's high; **At the 50 EMA** when it
    touched the EMA in the last three sessions or is within 1% of it;
    otherwise **Approaching**.
    """
    out = {"pullback": False, "pb_stage": "", "pb_ema50": np.nan, "pb_pct_from_ema": np.nan,
           "pb_days_since_touch": np.nan, "pb_from_high": np.nan}
    n = len(df)
    if n < 200 + 11:
        return out
    c, h, l = df["Close"], df["High"].to_numpy(float), df["Low"].to_numpy(float)
    ema = c.ewm(span=cfg.pb_ema, adjust=False).mean().to_numpy(float)
    sma200 = float(c.tail(200).mean())
    cv = c.to_numpy(float)
    close, e = cv[-1], ema[-1]
    dist = (close / e - 1) * 100
    k = cfg.pb_lookback
    out.update(pb_ema50=round(float(e), 2), pb_pct_from_ema=round(float(dist), 2),
               pb_from_high=round(float(close / h[-k:].max() - 1) * 100, 2))
    uptrend = close > sma200 and e > sma200 and e > ema[-11]
    extended = float((h[-k:] / ema[-k:] - 1).max()) * 100 >= cfg.pb_min_extension
    if not (uptrend and extended and -cfg.pb_max_below <= dist <= cfg.pb_max_above):
        return out
    touched = np.nonzero(l[-k:] <= ema[-k:] * 1.005)[0]          # low came within 0.5% of the EMA
    since = int(k - 1 - touched[-1]) if len(touched) else None
    if since is not None:
        out["pb_days_since_touch"] = since
    if since is not None and since <= cfg.pb_touch_days and close > h[-2] and close > e:
        stage = "Bouncing"
    elif (since is not None and since <= 2) or abs(dist) <= 1.0:
        stage = "At the 50 EMA"
    else:
        stage = "Approaching"
    out.update(pullback=True, pb_stage=stage)
    return out


def _base_from_high(df: pd.DataFrame, exclude_last: int) -> Tuple[float, int, float]:
    """Highest high before the last ``exclude_last`` bars, its bar index and
    the depth (%) of the lowest low after it."""
    n = len(df)
    hist = df["High"].to_numpy(float)[: n - exclude_last]
    if len(hist) == 0:
        return np.nan, -1, np.nan
    i = int(np.argmax(hist))
    pivot = float(hist[i])
    low_after = float(df["Low"].to_numpy(float)[i:].min())
    return pivot, i, (pivot - low_after) / pivot * 100


def rsi(close: pd.Series, n: int = 14) -> pd.Series:
    """Wilder's RSI."""
    d = close.diff()
    up = d.clip(lower=0).ewm(alpha=1 / n, adjust=False).mean()
    dn = (-d.clip(upper=0)).ewm(alpha=1 / n, adjust=False).mean()
    rs = up / dn.replace(0, np.nan)
    return (100 - 100 / (1 + rs)).fillna(100)


def macd_hist(close: pd.Series, fast: int = 12, slow: int = 26, signal: int = 9) -> pd.Series:
    line = close.ewm(span=fast, adjust=False).mean() - close.ewm(span=slow, adjust=False).mean()
    return line - line.ewm(span=signal, adjust=False).mean()


def adx(df: pd.DataFrame, n: int = 14) -> pd.Series:
    """Wilder's Average Directional Index."""
    h, l, c = df["High"], df["Low"], df["Close"]
    up, dn = h.diff(), -l.diff()
    plus_dm = np.where((up > dn) & (up > 0), up, 0.0)
    minus_dm = np.where((dn > up) & (dn > 0), dn, 0.0)
    tr = pd.concat([h - l, (h - c.shift()).abs(), (l - c.shift()).abs()], axis=1).max(axis=1)
    atr = tr.ewm(alpha=1 / n, adjust=False).mean()
    pdi = 100 * pd.Series(plus_dm, index=df.index).ewm(alpha=1 / n, adjust=False).mean() / atr
    mdi = 100 * pd.Series(minus_dm, index=df.index).ewm(alpha=1 / n, adjust=False).mean() / atr
    dx = 100 * (pdi - mdi).abs() / (pdi + mdi).replace(0, np.nan)
    return dx.ewm(alpha=1 / n, adjust=False).mean()


def _weekly_on_daily(df: pd.DataFrame, cfg: ScanConfig) -> pd.DataFrame:
    """Weekly values from *completed* weeks only, mapped onto each daily bar.

    Mirrors Pine's ``request.security(..., "W", expr[1], lookahead_on)``: every
    day of a week sees the previous finished week's numbers, so nothing repaints.
    """
    wk = df.resample("W-FRI").agg({"Open": "first", "High": "max", "Low": "min",
                                    "Close": "last", "Volume": "sum"}).dropna(subset=["Close"])
    wc = wk["Close"]
    sma40 = wc.rolling(40).mean()
    macd_line = wc.ewm(span=12, adjust=False).mean() - wc.ewm(span=26, adjust=False).mean()
    signal = macd_line.ewm(span=9, adjust=False).mean()
    w = pd.DataFrame({
        "w_sma40": sma40,
        "w_sma40_ago": sma40.shift(4),          # Pine: sma40[5] seen from the live week
        "w_macd": macd_line, "w_signal": signal,
        "w_hist": macd_line - signal,
        "w_hist_prev": (macd_line - signal).shift(1),
        "w_high_n": wk["High"].rolling(cfg.murphy_entry_weeks).max(),
        "w_high2": wk["High"].rolling(2).max(),
    }).shift(1)                                  # previous completed week
    week_of_day = df.index.to_period("W-FRI").to_timestamp(how="end").normalize()
    w.index = w.index.normalize()
    return w.reindex(week_of_day).set_axis(df.index)


def _murphy_entries(close, fast, slow, w, entry_mode) -> np.ndarray:
    """Raw daily entry events for one method (before the weekly filter)."""
    c = close.to_numpy()
    cross_up = ((fast > slow) & (fast.shift() <= slow.shift())).to_numpy()
    if entry_mode == "cross":
        return cross_up
    hi_n, hi2 = w["w_high_n"].to_numpy(), w["w_high2"].to_numpy()
    prev = np.r_[np.nan, c[:-1]]
    if entry_mode == "4week":
        return (c > hi_n) & (prev <= hi_n)
    # crossover in the last 10 bars, fast still above slow, close breaks the 2-week high today
    fs = (fast > slow).to_numpy()
    recent = pd.Series(cross_up).rolling(11, min_periods=1).max().to_numpy() > 0
    two = c > hi2
    two_prev = np.r_[False, two[:-1]]
    return recent & fs & two & ~two_prev


def find_murphy(df: pd.DataFrame, cfg: ScanConfig, bench: Optional[pd.Series] = None) -> dict:
    """Murphy positional trend-following (Strategy 4A) as a daily scan, entries only.

    Weekly filter (completed weeks): price > rising 40-week SMA, and/or weekly
    MACD > signal. Entry on the daily chart: 10/50 SMA crossover, the 4-week
    rule (close above the high of the last 4 full weeks), or a crossover
    confirmed by a 2-week breakout. A stock is listed when an entry that
    passed the filter fired in the last ``murphy_signal_days`` sessions.

    """
    out = {"murphy": False}
    if len(df) < 300:
        return out
    df = df.tail(600)
    c = df["Close"]
    w = _weekly_on_daily(df, cfg)
    f40 = ((c > w["w_sma40"]) & (w["w_sma40"] > w["w_sma40_ago"])).to_numpy()
    fmacd = (w["w_macd"] > w["w_signal"]).to_numpy()
    filt = {"sma40": f40, "macd": fmacd, "both": f40 & fmacd}.get(cfg.murphy_filter, np.ones(len(df), bool))
    ax = adx(df)
    adx_ok = (ax >= cfg.murphy_min_adx).to_numpy() if cfg.murphy_use_adx else np.ones(len(df), bool)
    fast, slow = c.rolling(cfg.murphy_fast).mean(), c.rolling(cfg.murphy_slow).mean()

    modes = ["cross", "4week", "cross2week"] if cfg.murphy_entry == "any" else [cfg.murphy_entry]
    labels = {"cross": f"{cfg.murphy_fast}/{cfg.murphy_slow} crossover",
              "4week": f"{cfg.murphy_entry_weeks}-week rule",
              "cross2week": "Crossover + 2-week breakout"}
    n, best_i, how = len(df), None, []
    first = max(0, n - cfg.murphy_signal_days)
    for mode in modes:
        sig = _murphy_entries(c, fast, slow, w, mode) & filt & adx_ok
        hits = np.flatnonzero(sig[first:])
        if len(hits):
            i = first + int(hits[-1])
            if best_i is None or i > best_i:
                best_i, how = i, [labels[mode]]
            elif i == best_i:
                how.append(labels[mode])

    last = w.iloc[-1]
    close = float(c.iloc[-1])
    rs_score = np.nan
    if bench is not None:
        b = bench.reindex(df.index).ffill()
        def wperf(s):
            s = s.to_numpy(float)
            if len(s) < 253 or np.isnan(s[-253]):
                return np.nan
            r = lambda k: s[-1] / s[-1 - k] - 1  # noqa: E731
            return (2 * r(63) + r(126) + r(189) + r(252)) / 5 * 100
        rs_score = wperf(c) - wperf(b)
    out.update(
        murphy_filter_ok=bool(filt[-1]),
        murphy_sma40w=round(float(last["w_sma40"]), 2) if last["w_sma40"] == last["w_sma40"] else np.nan,
        murphy_weekly_macd_ok=bool(fmacd[-1]),
        murphy_week_high=round(float(last["w_high_n"]), 2) if last["w_high_n"] == last["w_high_n"] else np.nan,
        murphy_weekly_hist_down=bool(last["w_hist"] > 0 and last["w_hist"] < last["w_hist_prev"]),
        adx14=round(float(ax.iloc[-1]), 1),
        murphy_rs_score=round(float(rs_score), 1) if rs_score == rs_score else np.nan,
    )
    if best_i is not None:
        entry = float(c.iloc[best_i])
        out.update(
            murphy=True,
            murphy_signal=", ".join(how),
            murphy_signal_date=df.index[best_i].date().isoformat(),
            murphy_days_ago=int(n - 1 - best_i),
            murphy_entry=round(entry, 2),
            murphy_pct_from_entry=round((close / entry - 1) * 100, 2),
        )
    return out


def rs_raw_score(close: pd.Series) -> float:
    """IBD-style weighted 12-month performance (recent quarter weighted 2x)."""
    if len(close) < 253:
        return np.nan
    c = close.to_numpy(float)
    r = lambda k: c[-1] / c[-1 - k] - 1  # noqa: E731
    return 0.4 * r(63) + 0.2 * r(126) + 0.2 * r(189) + 0.2 * r(252)


def find_atr_entry(df: pd.DataFrame, cfg: ScanConfig, bench: Optional[pd.Series] = None) -> dict:
    """ATR Entry: the first close at least ``atr_entry_mult`` ATRs above the
    ``atr_entry_ma``-day SMA, the green buy circle of the "RS Line + Buy
    Signals" TradingView indicator. On that bar these filters must also pass:

    * +DI above -DI (Wilder DMI, ``atr_len``): the trend points up;
    * the RS line (stock / benchmark) above its ``atr_rs_ma``-day average, when
      ``atr_use_rs`` and a benchmark is given;
    * no more than ``atr_max_ext`` ATRs above the ``atr_ext_ma``-day SMA,
      measured as (close / SMA - 1) / (ATR / close), so very stretched stocks drop out.

    The signal is the first bar of that zone (in the zone, not in it the bar
    before). Listed when the latest signal fired in the last ``atr_signal_days``.
    """
    out = {"atr_entry": False, "atr_signal_date": "", "atr_days_ago": np.nan, "atr_line": np.nan,
           "atr_pct_from_line": np.nan, "atr_ext": np.nan, "atr_in_zone": False}
    n = len(df)
    if n < max(cfg.atr_entry_ma, cfg.atr_ext_ma) + cfg.atr_signal_days + 2:
        return out
    h, l, c = df["High"], df["Low"], df["Close"]
    a = 1 / cfg.atr_len
    tr = pd.concat([h - l, (h - c.shift()).abs(), (l - c.shift()).abs()], axis=1).max(axis=1)
    atr = tr.ewm(alpha=a, adjust=False).mean()
    up, dn = h.diff(), -l.diff()
    pdm = pd.Series(np.where((up > dn) & (up > 0), up, 0.0), index=df.index).ewm(alpha=a, adjust=False).mean()
    mdm = pd.Series(np.where((dn > up) & (dn > 0), dn, 0.0), index=df.index).ewm(alpha=a, adjust=False).mean()
    line = c.rolling(cfg.atr_entry_ma).mean() + cfg.atr_entry_mult * atr
    sma_x = c.rolling(cfg.atr_ext_ma).mean()
    ext = (c / sma_x - 1) / (atr / c)
    zone = (c >= line) & (pdm > mdm)
    if cfg.atr_max_ext:
        zone &= ext <= cfg.atr_max_ext
    if cfg.atr_use_rs and bench is not None:
        b = bench.reindex(df.index).ffill()
        rs = c / b
        zone &= rs >= rs.rolling(cfg.atr_rs_ma).mean()
    zone = zone.fillna(False).to_numpy(bool)
    sig = zone & ~np.r_[False, zone[:-1]]
    last = np.flatnonzero(sig[n - cfg.atr_signal_days:])
    out.update(atr_line=_r2(line.iloc[-1]), atr_ext=_r2(ext.iloc[-1]), atr_in_zone=bool(zone[-1]),
               atr_pct_from_line=_r2((c.iloc[-1] / line.iloc[-1] - 1) * 100))
    if len(last):
        d = n - cfg.atr_signal_days + int(last[-1])
        out.update(atr_entry=True, atr_signal_date=df.index[d].strftime("%Y-%m-%d"), atr_days_ago=n - 1 - d)
    return out


def _r2(x) -> float:
    return round(float(x), 2) if x == x and x is not None and np.isfinite(x) else np.nan


def rs_line(close: pd.Series, bench: Optional[pd.Series]) -> Optional[pd.Series]:
    """Price relative to the benchmark (stock / index), aligned on dates."""
    if bench is None:
        return None
    b = bench.reindex(close.index).ffill()
    return (close / b).dropna()


# --------------------------------------------------------------------------
# Per-stock analysis
# --------------------------------------------------------------------------


def analyze_stock(df: pd.DataFrame, cfg: ScanConfig,
                  bench: Optional[pd.Series] = None) -> Optional[dict]:
    """Compute every metric and pattern flag for one stock."""
    n = len(df)
    if n < cfg.ipo_min_days:
        return None
    c, h, l, v = df["Close"], df["High"], df["Low"], df["Volume"]
    close = float(c.iloc[-1])
    sma = lambda k: float(c.rolling(k).mean().iloc[-1]) if n >= k else np.nan  # noqa: E731
    vol50 = float(v.tail(50).mean())
    vol10 = float(v.tail(10).mean())
    win52 = df.tail(252)
    hi52, lo52 = float(win52["High"].max()), float(win52["Low"].min())

    m: dict = {
        "date": df.index[-1].date(),
        "close": round(close, 2),
        "chg_1d_%": round((close / float(c.iloc[-2]) - 1) * 100, 2) if n > 1 else np.nan,
        "turnover_cr": round(float((c * v).tail(50).mean()) / 1e7, 2),
        "vol_ratio": round(float(v.iloc[-1]) / vol50, 2) if vol50 else np.nan,
        "vol_dryup": round(vol10 / vol50, 2) if vol50 else np.nan,
        "sma50": sma(50), "sma150": sma(150), "sma200": sma(200),
        "pct_from_52w_high": round((close / hi52 - 1) * 100, 2),
        "pct_above_52w_low": round((close / lo52 - 1) * 100, 2),
        "listed_days": n,
        "rs_raw": rs_raw_score(c),
    }

    # SMA200 trending up over the last month
    sma200_series = c.rolling(200).mean()
    m["sma200_rising"] = bool(n >= 222 and sma200_series.iloc[-1] > sma200_series.iloc[-22])

    # RS line at a new 52-week high (classic leadership tell)
    rl = rs_line(c, bench)
    m["rs_line_new_high"] = bool(rl is not None and len(rl) >= 252
                                 and rl.iloc[-1] >= rl.tail(252).max() * 0.999)

    # --- VCP ---
    m.update(find_vcp(df, cfg))

    # --- Blue Sky ---
    ath = float(h.max())
    m["ath"] = round(ath, 2)
    m["pct_from_ath"] = round((close / ath - 1) * 100, 2)
    k = cfg.breakout_window
    prior_ath = float(h.iloc[:-k].max()) if n > k else np.nan
    m["new_ath_recent"] = bool(n > k and h.iloc[-k:].max() > prior_ath)
    m["bluesky"] = bool(
        n >= cfg.bluesky_min_history_years * 252
        and -m["pct_from_ath"] <= cfg.bluesky_max_below_ath
    )

    # --- Episodic Pivot ---
    m.update(find_ep(df, cfg))

    # --- IPO Base ---
    m["ipo_base"] = False
    if cfg.ipo_min_days <= n <= cfg.ipo_max_days:
        ip, ii, idepth = _base_from_high(df, exclude_last=min(k, n - 1))
        ibase = (n - 1 - ii) if ii >= 0 else 0
        idist = (close / ip - 1) * 100
        m.update(ipo_high=round(ip, 2), ipo_base_days=ibase,
                 ipo_depth=round(idepth, 1), ipo_pct_from_high=round(idist, 2))
        m["ipo_base"] = bool(
            ibase >= cfg.ipo_min_base_days
            and idepth <= cfg.ipo_max_depth
            and -cfg.ipo_max_below_high <= idist <= cfg.ipo_max_above_high
        )

    # --- Murphy ---
    m.update(find_murphy(df, cfg, bench))

    # --- Base Breakout ---
    m.update(find_base(df, cfg))

    # --- Ichimoku cloud breakout ---
    m.update(find_ichimoku(df, cfg))

    # --- 50 EMA Pullback ---
    m.update(find_pullback(df, cfg))

    # --- ATR Entry ---
    m.update(find_atr_entry(df, cfg, bench))
    return m


# --------------------------------------------------------------------------
# Running the scan
# --------------------------------------------------------------------------

SCREEN_COLUMNS = {
    "Trend Template": ["symbol", "industry", "close", "chg_1d_%", "rs_rating",
                       "rs_line_new_high", "pct_from_52w_high", "pct_above_52w_low",
                       "vol_ratio", "turnover_cr"],
    "VCP": ["symbol", "industry", "close", "rs_rating", "vcp_pivot",
            "vcp_pct_from_pivot", "vcp_contractions", "vcp_depths", "vcp_base_days",
            "vol_dryup", "vol_ratio", "rs_line_new_high", "turnover_cr", "pct_from_52w_high", "pct_above_52w_low"],
    "Blue Sky": ["symbol", "industry", "close", "rs_rating", "ath", "pct_from_ath",
                 "new_ath_recent", "vol_ratio", "rs_line_new_high", "turnover_cr", "pct_from_52w_high", "pct_above_52w_low"],
    "Episodic Pivot": ["symbol", "industry", "close", "rs_rating", "ep_date", "ep_days_ago",
                       "ep_type", "ep_catalyst", "ep_gap", "ep_chg", "ep_rvol", "ep_low",
                       "ep_pct_since", "ep_neglected", "turnover_cr", "pct_from_52w_high",
                       "pct_above_52w_low"],
    "Murphy": ["symbol", "industry", "close", "rs_rating", "murphy_signal",
               "murphy_signal_date", "murphy_days_ago", "murphy_entry",
               "murphy_pct_from_entry", "murphy_sma40w",
               "murphy_weekly_macd_ok", "adx14", "murphy_rs_score", "turnover_cr", "pct_from_52w_high", "pct_above_52w_low"],
    "Base Breakout": ["symbol", "industry", "close", "rs_rating", "base_state", "base_no",
                      "base_pivot", "base_pct_from_pivot", "base_weeks", "base_depth",
                      "base_tags", "base_days_ago", "vol_ratio", "rs_line_new_high",
                      "turnover_cr", "pct_from_52w_high", "pct_above_52w_low"],
    "Ichimoku": ["symbol", "industry", "close", "rs_rating", "ich_signal", "ich_days_ago",
                 "ich_score", "ich_trend", "ich_momentum", "ich_cloud",
                 "ich_entry", "ich_sl", "ich_tp1", "vol_ratio", "rs_line_new_high", "turnover_cr",
                 "pct_from_52w_high", "pct_above_52w_low"],
    "50 EMA Pullback": ["symbol", "industry", "close", "rs_rating", "pb_stage", "pb_ema50",
                        "pb_pct_from_ema", "pb_days_since_touch", "pb_from_high", "vol_dryup",
                        "vol_ratio", "rs_line_new_high", "turnover_cr", "pct_from_52w_high",
                        "pct_above_52w_low"],
    "ATR Entry": ["symbol", "industry", "close", "rs_rating", "atr_signal_date", "atr_days_ago",
                  "atr_line", "atr_pct_from_line", "atr_in_zone", "atr_ext", "vol_ratio",
                  "rs_line_new_high", "turnover_cr", "pct_from_52w_high", "pct_above_52w_low"],
    "IPO Base": ["symbol", "industry", "close", "listed_days", "ipo_high",
                 "ipo_pct_from_high", "ipo_base_days", "ipo_depth", "vol_ratio",
                 "turnover_cr", "pct_from_52w_high", "pct_above_52w_low"],
}


@dataclass
class ScanResult:
    metrics: pd.DataFrame
    screens: Dict[str, pd.DataFrame]
    config: ScanConfig
    benchmark: Optional[pd.Series] = None

    def summary(self) -> pd.DataFrame:
        return pd.DataFrame(
            {"screen": list(self.screens), "matches": [len(d) for d in self.screens.values()]}
        )

    def to_excel(self, path: str = "scan_results.xlsx") -> str:
        with pd.ExcelWriter(path) as xw:
            self.summary().to_excel(xw, sheet_name="Summary", index=False)
            for name, d in self.screens.items():
                d.to_excel(xw, sheet_name=name[:31], index=False)
            pd.DataFrame(self.config.to_dict().items(), columns=["setting", "value"]) \
                .to_excel(xw, sheet_name="Settings", index=False)
            self.metrics.to_excel(xw, sheet_name="All Metrics", index=False)
        return path


def apply_screens(metrics: pd.DataFrame, cfg: ScanConfig) -> Dict[str, pd.DataFrame]:
    """Turn the metrics table into one filtered table per screen."""
    m = metrics
    liquid = (m["close"] >= cfg.min_price) & (m["turnover_cr"] >= cfg.min_turnover_cr)
    trend = (
        liquid
        & (m["close"] > m["sma150"]) & (m["close"] > m["sma200"])
        & (m["sma150"] > m["sma200"]) & m["sma200_rising"]
        & (m["sma50"] > m["sma150"]) & (m["close"] > m["sma50"])
        & (m["pct_above_52w_low"] >= cfg.min_above_52w_low)
        & (-m["pct_from_52w_high"] <= cfg.max_below_52w_high)
        & (m["rs_rating"] >= cfg.min_rs)
    )
    masks = {
        "Trend Template": trend,
        "VCP": trend & m["vcp"],
        "Blue Sky": liquid & m["bluesky"] & (m["rs_rating"].fillna(0) >= cfg.min_rs),
        "Episodic Pivot": liquid & m["ep"],
        "IPO Base": liquid & m["ipo_base"],
        "Murphy": liquid & m["murphy"],
        "Base Breakout": liquid & m["base_bo"] & (m["rs_rating"].fillna(0) >= cfg.base_min_rs),
        "Ichimoku": liquid & m["ichimoku"],
        "50 EMA Pullback": liquid & m["pullback"] & (m["rs_rating"].fillna(0) >= cfg.pb_min_rs),
        "ATR Entry": liquid & m["atr_entry"],
    }
    sort_by = {"Trend Template": "rs_rating", "VCP": "rs_rating", "Blue Sky": "rs_rating",
               "Episodic Pivot": ["ep_days_ago", "ep_rvol"], "IPO Base": "ipo_base_days",
               "Murphy": "murphy_days_ago", "Base Breakout": "base_pct_from_pivot",
               "Ichimoku": "ich_days_ago", "50 EMA Pullback": "rs_rating",
               "ATR Entry": ["atr_days_ago", "rs_rating"]}
    ascending = {"Murphy": True, "Ichimoku": True,   # newest signals first
                 "Episodic Pivot": [True, False],
                 "ATR Entry": [True, False]}       # newest signal first, then strongest RS   # newest first, then heaviest volume
    out = {}
    for name, mask in masks.items():
        cols = [c for c in SCREEN_COLUMNS[name] if c in m.columns]
        out[name] = (m.loc[mask.fillna(False), cols]
                     .sort_values(sort_by[name], ascending=ascending.get(name, False))
                     .reset_index(drop=True))
    return out


def apply_market_cap_filter(result: "ScanResult", fund: Dict[str, dict]) -> "ScanResult":
    """Drop rows below ``min_mcap_cr`` from every screen, once fundamentals are known.

    Market cap comes from ``fetch_fundamentals``, which runs after the price
    scan, so this is a second pass. A stock whose market cap Yahoo did not
    return is dropped too. If no market caps came back at all, nothing is
    filtered, so a failed fetch does not empty the screens.
    """
    floor = result.config.min_mcap_cr
    caps = {s: d.get("market_cap_cr") for s, d in (fund or {}).items()}
    if not floor or not any(isinstance(v, (int, float)) and v == v for v in caps.values()):
        return result
    for name, t in result.screens.items():
        if t.empty:
            continue
        cap = pd.to_numeric(t["symbol"].map(caps), errors="coerce")
        result.screens[name] = t.loc[cap >= floor].reset_index(drop=True)
    return result


def scan(data: Dict[str, pd.DataFrame], cfg: Optional[ScanConfig] = None,
         universe: Optional[pd.DataFrame] = None,
         benchmark: Optional[pd.Series] = None) -> ScanResult:
    """Analyse every stock in ``data`` and apply all screens."""
    cfg = cfg or ScanConfig()
    rows = []
    for sym, df in data.items():
        try:
            m = analyze_stock(df, cfg, benchmark)
        except Exception as exc:  # one bad series shouldn't kill the scan
            warnings.warn(f"{sym}: {exc}")
            continue
        if m:
            m["symbol"] = sym
            rows.append(m)
    metrics = pd.DataFrame(rows)
    if metrics.empty:
        return ScanResult(metrics, {k: pd.DataFrame() for k in SCREEN_COLUMNS}, cfg, benchmark)

    # RS rating: percentile of rs_raw across the scanned universe, 1-99
    # RS rating: percentile of rs_raw among the *liquid* stocks only, 1-99,
    # so thinly traded names don't distort the ranking.
    liquid = (metrics["close"] >= cfg.min_price) & (metrics["turnover_cr"] >= cfg.min_turnover_cr)
    metrics["liquid"] = liquid
    metrics["rs_rating"] = np.nan
    metrics.loc[liquid, "rs_rating"] = (metrics.loc[liquid, "rs_raw"].rank(pct=True) * 98 + 1).round()
    if universe is not None and "industry" in universe:
        metrics = metrics.merge(universe[["symbol", "industry"]], on="symbol", how="left")
    else:
        metrics["industry"] = ""
    metrics["industry"] = metrics["industry"].fillna("")
    front = ["symbol", "industry", "date", "close", "rs_rating"]
    metrics = metrics[front + [c for c in metrics.columns if c not in front]]
    return ScanResult(metrics, apply_screens(metrics, cfg), cfg, benchmark)


def run(universe: str = "NIFTY500", cfg: Optional[ScanConfig] = None,
        period: str = "max", benchmark: str = "NIFTY500") -> Tuple[ScanResult, dict]:
    """One-call convenience: fetch universe + prices + benchmark, then scan.

    Returns ``(result, data)`` - keep ``data`` to re-scan with new settings
    or to draw charts without downloading again.
    """
    uni = get_universe(universe)
    print(f"Universe {universe}: {len(uni)} symbols. Downloading prices...")
    data = download_prices(uni["symbol"], period=period)
    bench = download_benchmark(benchmark, period=period)
    print(f"Loaded {len(data)} stocks. Scanning...")
    res = scan(data, cfg, uni, bench)
    return res, data


# --------------------------------------------------------------------------
# Charts
# --------------------------------------------------------------------------


def plot_stock(symbol: str, data: Dict[str, pd.DataFrame], result: Optional[ScanResult] = None,
               bars: int = 260, benchmark: Optional[pd.Series] = None):
    """Candlestick chart with 50/150/200 SMAs, pivot lines, volume and RS line."""
    import matplotlib.pyplot as plt

    symbol = symbol.strip().upper()
    if symbol not in data:
        raise KeyError(f"{symbol} not in downloaded data")
    full = data[symbol]
    df = full.tail(bars)
    bench = benchmark if benchmark is not None else (result.benchmark if result else None)
    rl = rs_line(full["Close"], bench)

    rows = 3 if rl is not None else 2
    ratios = [4, 1, 1.3] if rows == 3 else [4, 1]
    fig, axes = plt.subplots(rows, 1, figsize=(13, 8), sharex=True,
                             gridspec_kw={"height_ratios": ratios})
    ax, axv = axes[0], axes[1]
    x = np.arange(len(df))
    up = df["Close"] >= df["Open"]
    col = np.where(up, "#1a9850", "#d73027")
    ax.vlines(x, df["Low"], df["High"], color=col, linewidth=0.8)
    ax.bar(x, (df["Close"] - df["Open"]).abs().clip(lower=df["Close"] * 0.0005),
           bottom=np.minimum(df["Open"], df["Close"]), color=col, width=0.7)
    for k, c in ((50, "#2b83ba"), (150, "#fdae61"), (200, "#7b3294")):
        s = full["Close"].rolling(k).mean().tail(bars)
        ax.plot(x, s.to_numpy(), color=c, linewidth=1.1, label=f"SMA {k}")

    title = symbol
    if result is not None and not result.metrics.empty:
        row = result.metrics.loc[result.metrics["symbol"] == symbol]
        if len(row):
            r = row.iloc[0]
            tags = [n for n, d in result.screens.items()
                    if not d.empty and symbol in set(d["symbol"])]
            title += f"   RS {r['rs_rating']:.0f}" if r["rs_rating"] == r["rs_rating"] else ""
            if tags:
                title += "   [" + ", ".join(tags) + "]"
            for key, flag, lbl, c in (("vcp_pivot", "vcp", "VCP pivot", "#e66101"),
                                      ("ep_low", "ep", "EP day low", "#5e3c99"),
                                      ("ipo_high", "ipo_base", "IPO high", "#008837"),
                                      ("murphy_entry", "murphy", "Murphy entry", "#b2182b")):
                val = r.get(key, np.nan)
                if not bool(r.get(flag, False)) or val != val:
                    continue
                if df["Low"].min() * 0.8 <= val <= df["High"].max() * 1.2:
                    ax.axhline(val, color=c, linestyle="--", linewidth=1, label=f"{lbl} {val:,.1f}")
    ax.set_title(title, loc="left", fontsize=13, fontweight="bold")
    ax.legend(loc="upper left", fontsize=8)
    ax.grid(alpha=0.25)

    axv.bar(x, df["Volume"], color=col, width=0.7)
    axv.plot(x, full["Volume"].rolling(50).mean().tail(bars).to_numpy(),
             color="black", linewidth=0.9)
    axv.set_ylabel("Volume")
    axv.grid(alpha=0.25)

    if rows == 3:
        axr = axes[2]
        rr = rl.reindex(df.index)
        axr.plot(x, rr.to_numpy(), color="#4d4d4d", linewidth=1.1)
        axr.set_ylabel("RS line")
        axr.grid(alpha=0.25)

    ticks = np.linspace(0, len(df) - 1, 8).astype(int)
    axes[-1].set_xticks(ticks)
    axes[-1].set_xticklabels([df.index[i].strftime("%b %y") for i in ticks])
    plt.tight_layout()
    plt.show()
    return fig
