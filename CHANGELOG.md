# Changelog

## Unreleased

- New **Base Breakout** screen: numbered bases with a pivot, listing bases forming near the pivot and recent breakouts, with Sky, VCP and Squat tags. On the website, in the notebook and in the Excel export.
- Base Breakout filters: within 7% of the pivot on either side, RS rating 65 or more, market cap above ₹2,000 crore.
- New **Ichimoku** screen: closes up through the top of the cloud in the last 5 sessions, with Tenkan above Kijun and the Chikou span clear of price.
- Website: the screen tabs are smaller and always fit on one row.
- New TradingView scripts: `pine/base_breakout_pro.pine` (the Base Breakout screen as an indicator, with a volume pane) and `pine/rs_line.pine` (RS line pane).

## v0.1.0 (7 November 2026)

First public release.

**Screens**: VCP, Blue Sky (all-time high), Murphy trend-following (40-week SMA filter with 10/50 crossover, 4-week rule, or crossover + 2-week breakout), Multi-Year Base, IPO Base and Trend Template, over every NSE stock priced ₹50+ with ₹1 crore+ average daily turnover. RS rating 1–99.

**Website** ([india-base-scanner-web.vercel.app](https://india-base-scanner-web.vercel.app)):
- Table and chart view, and a Charts-only grid
- Zoomable charts: scroll, drag, pinch, price-scale drag, auto and log scale, candles or OHLC bars
- TradingView-style RS line with its 50-day average, RS new-high and RS-leads-price dots, against NIFTY 50, NIFTY 500, Midcap 150 or Smallcap 250
- Market cap and fundamentals from Yahoo Finance; distance from the 52-week high and low
- Heatmap of NIFTY 50, Next 50, Midcap 150 and Smallcap 250 with index returns
- Settings: RS benchmark, chart style, light or dark theme
- Free TradingView indicator for the Murphy screen

**Automation**: daily scan on GitHub Actions after the close, published to the `data` branch.

**Colab notebook** with every threshold as a form field, charts and Excel export.
