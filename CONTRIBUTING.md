# Contributing to India Base Scanner

Thanks for helping! This project scans NSE stocks for base and breakout setups and publishes the results at **[india-base-scanner-web.vercel.app](https://india-base-scanner-web.vercel.app)**.

## Ways to help
- **Report a problem:** a wrong result, a broken chart, a stock that should or shouldn't be in a screen. [Open an issue](https://github.com/tmmity3-max/india-base-scanner/issues/new/choose) with the stock symbol and the date.
- **Suggest a screen or feature:** describe the rules as precisely as you can (e.g. "close above the 20-week high on 1.5x average volume").
- **Send a pull request:** small, focused changes are easiest to review.

## Project layout
| Path | What it is |
|---|---|
| `india_base_scanner.py` | The engine: data download, every screen, RS rating, charts, Excel export |
| `India_Base_Scanner.ipynb` | Colab notebook, **generated** from the engine |
| `scripts/daily_scan.py` | Writes the website's JSON (screens, charts, heatmap, benchmarks) |
| `web/` | The static website (HTML, CSS, plain JavaScript, canvas charts) |
| `pine/` | TradingView indicator |
| `tests/test_screens.py` | Offline tests on synthetic price data |
| `.github/workflows/daily-scan.yml` | Runs the scan every weekday and publishes to the `data` branch |

## Working on the code
```bash
git clone https://github.com/tmmity3-max/india-base-scanner
cd india-base-scanner
pip install -r requirements.txt

python tests/test_screens.py            # runs offline, no internet needed
python tools/build_notebook.py          # after editing india_base_scanner.py
python scripts/daily_scan.py --universe NIFTY50 --out web/data   # small real scan
cd web && python -m http.server 8000    # then open http://localhost:8000
```
On `localhost` the website reads `web/data/` instead of the published data.

## Guidelines
- **Every screen is a fixed, published rule.** Put thresholds in `ScanConfig` so users can change them, and describe the rule in the README and on the website.
- **Add a test** in `tests/test_screens.py` for any new screen, using a synthetic price path that should pass and one that shouldn't.
- **Keep the website dependency-free:** plain HTML, CSS and JavaScript, no build step.
- **No investment advice.** Screens list stocks that match rules; they never say "buy" or suggest a stop-loss. See the Risk advisory in the README.
- Keep pull requests focused, and explain *why* in the description.

## Good first issues
- Add a **cup-with-handle** screen.
- Add a **flat base** screen (tight sideways range, under 15% deep, 5+ weeks).
- **Sector rotation** table: average RS and 1M/3M return by industry.
- A **watchlist** saved in the browser, with a star button on each stock.
- Show the date each stock **first appeared** in a screen.
