"""Download full daily history for the Nifty Midcap 150 and Smallcap 250 stocks
(plus the Nifty 500 and Nifty 50 indices) for backtests.

Run:  python research/download_data.py
Saves research/data/prices.pkl  ({symbol: OHLCV DataFrame}) and research/data/meta.json.

Note: the stock lists are TODAY's index members, so stocks that dropped out or
were delisted over the years are missing (survivorship bias). Results are
therefore somewhat flattering; compare variants with each other, not with zero.
"""
import json
import os
import pickle
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import india_base_scanner as ibs  # noqa: E402

OUT = os.path.join(ROOT, "research", "data")


def main():
    os.makedirs(OUT, exist_ok=True)
    members = {}
    for idx in ("MIDCAP150", "SMALLCAP250"):
        uni = ibs.get_universe(idx)
        members[idx] = list(uni["symbol"])
        print(f"{idx}: {len(uni)} stocks")
    syms = sorted({s for v in members.values() for s in v})
    t0 = time.time()
    data = ibs.download_prices(syms, period="max")
    print(f"downloaded {len(data)}/{len(syms)} stocks in {time.time() - t0:.0f}s")
    bench = {}
    for name in ("NIFTY500", "NIFTY50"):
        s = ibs.download_benchmark(name, period="max")
        if s is not None:
            bench[name] = s
            print(f"{name}: {len(s)} days from {s.index[0].date()}")
    with open(os.path.join(OUT, "prices.pkl"), "wb") as fh:
        pickle.dump({"stocks": data, "bench": bench, "members": members}, fh)
    first = sorted(df.index[0].year for df in data.values())
    meta = {"downloaded": time.strftime("%Y-%m-%d %H:%M"), "stocks": len(data), "members": {k: len(v) for k, v in members.items()},
            "history_start_years": {"min": first[0], "median": first[len(first) // 2], "max": first[-1]} if first else {}}
    with open(os.path.join(OUT, "meta.json"), "w") as fh:
        json.dump(meta, fh, indent=1)
    print(json.dumps(meta, indent=1))


if __name__ == "__main__":
    main()
