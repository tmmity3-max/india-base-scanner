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
4. Multi-Year Base - Breaking out of a high that held for 2+ years.
5. IPO Base        - Recent listings basing near their post-listing high.
6. Murphy          - John Murphy's positional trend-following ("Technical
                     Analysis of the Financial Markets"): price above a rising
                     40-week SMA, then a fresh 10/50-day crossover, 4-week-rule
                     breakout, or crossover confirmed by a 2-week breakout.
                     Stop below the 2-week low.

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
    Multi-Year screens; ``'5y'`` is faster if you only need VCP.
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
                dy = out.get("dividend_yield")
                if isinstance(dy, (int, float)) and dy < 1:   # older yfinance gives a fraction
                    out["dividend_yield"] = round(dy * 100, 2)
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

    # --- Multi-Year Base ---
    myb_min_base_years: float = 2.0       # years the old high held
    myb_max_below_pivot: float = 5.0
    myb_max_above_pivot: float = 10.0
    myb_max_depth: float = 60.0           # % from old high to base low

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

    # --- Multi-Year Base ---
    pivot, pi, depth = _base_from_high(df, exclude_last=k)
    base_days = (n - 1 - pi) if pi >= 0 else 0
    dist = (close / pivot - 1) * 100 if pivot == pivot else np.nan
    m.update(myb_pivot=round(pivot, 2), myb_base_years=round(base_days / 252, 1),
             myb_depth=round(depth, 1), myb_pct_from_pivot=round(dist, 2))
    m["multiyear_base"] = bool(
        pi >= 0
        and base_days >= cfg.myb_min_base_years * 252
        and depth <= cfg.myb_max_depth
        and -cfg.myb_max_below_pivot <= dist <= cfg.myb_max_above_pivot
    )

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
    "Multi-Year Base": ["symbol", "industry", "close", "rs_rating", "myb_pivot",
                        "myb_pct_from_pivot", "myb_base_years", "myb_depth",
                        "vol_ratio", "turnover_cr", "pct_from_52w_high", "pct_above_52w_low"],
    "Murphy": ["symbol", "industry", "close", "rs_rating", "murphy_signal",
               "murphy_signal_date", "murphy_days_ago", "murphy_entry",
               "murphy_pct_from_entry", "murphy_sma40w",
               "murphy_weekly_macd_ok", "adx14", "murphy_rs_score", "turnover_cr", "pct_from_52w_high", "pct_above_52w_low"],
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
        "Multi-Year Base": liquid & m["multiyear_base"],
        "IPO Base": liquid & m["ipo_base"],
        "Murphy": liquid & m["murphy"],
    }
    sort_by = {"Trend Template": "rs_rating", "VCP": "rs_rating", "Blue Sky": "rs_rating",
               "Multi-Year Base": "myb_base_years", "IPO Base": "ipo_base_days",
               "Murphy": "murphy_days_ago"}
    ascending = {"Murphy": True}  # newest signals first
    out = {}
    for name, mask in masks.items():
        cols = [c for c in SCREEN_COLUMNS[name] if c in m.columns]
        out[name] = (m.loc[mask.fillna(False), cols]
                     .sort_values(sort_by[name], ascending=ascending.get(name, False))
                     .reset_index(drop=True))
    return out


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
                                      ("myb_pivot", "multiyear_base", "Multi-year high", "#5e3c99"),
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
