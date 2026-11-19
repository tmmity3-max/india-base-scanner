# Changelog

## Unreleased

- Website: every filter now sits in one box behind a gear Filters button, with quick buttons for market cap and for daily turnover (₹1, 5, 10 or 50 crore+).
- Website: the table shows as many rows as fit on the screen, with Prev / Next pages, so the sideways scrollbar is always in view; the Stock column stays fixed when scrolling sideways. The chart's width and height handles stop where the table and chart still fit side by side on the screen.
- Website: drag the bar between the table and the chart to resize them, and the bar under the chart to change its height (kept in your browser; double-click to reset). Smaller text across the page.
- Website chart panel: latest quarter's sales, net profit and operating margin, each against the quarter before and the same quarter a year earlier (margin change in percentage points).
- `pine/base_breakout_pro.pine`: operating margin row in the fundamentals table, with its change against the last quarter and last year in percentage points.
- New **Episodic Pivot** screen (after Pradeep Bonde) replaces Multi-Year Base: a gap up or well above-average move on 3×+ volume in the last month (stages Today, This week, This month), still above that day's low, tagged Earnings or News / volume and Neglected. On the website, in the notebook and in the Excel export.
- Base Breakout: a stock resting in a new base is now listed as **Forming** while it holds above its 50-day EMA, however far it is under the new pivot. Before, it could show as Played out or Climbing because of its previous breakout.
- New **50 EMA Pullback** screen: leaders with RS 80+ in an uptrend that ran well above their 50-day EMA and have come back to it, in three stages (at the EMA, bouncing, approaching).
- Every screen now needs a market cap of ₹500 crore or more (`min_mcap_cr`). The Base Breakout screen's own ₹2,000 crore floor is gone; on the website, market cap buttons raise the floor to ₹1,000 or ₹2,000 crore for all screens.
- New **Base Breakout** screen: numbered bases with a pivot, listing bases forming near the pivot and recent breakouts, with Sky, VCP and Squat tags. On the website, in the notebook and in the Excel export.
- Base Breakout filters: within 7% of the pivot on either side, RS rating 65 or more, market cap above ₹2,000 crore.
- New **Ichimoku** screen: closes up through the top of the cloud in the last 5 sessions, with Tenkan above Kijun and the Chikou span clear of price.
- Website: the screen tabs are smaller and always fit on one row.
- Base Breakout now has four stages: forming, fresh breakout, climbing (broke out up to 60 sessions ago and holding) and played out (the breakout failed: price closed back under the pivot, at once or later).
- Website: every screen splits into stages you can click (it opens on the first stage that has stocks), and a Filters panel (RS, market cap, turnover, price, distance from the 52-week high, RS line at a high) applies to every screen.
- Website: charts draw each base as a shaded box with its pivot and a green breakout marker, and show only the key level of the screen you are on instead of every level at once. A "Bases" button turns the boxes on or off outside the Base Breakout screen.
- **Ichimoku** screen rebuilt on adaptive Ichimoku: periods that follow volatility, a 0–100 confluence score, scored TK crosses, cloud breakouts on volume and cloud retests. Rules follow the Adaptive Ichimoku Nexus indicator by WillyAlgoTrader.
- Website: the Ichimoku chart shows the adaptive cloud and lines, signal labels, cloud twists, divergences, Kijun support/resistance zones and the entry, stop and targets of the latest setup. No base boxes on that screen.
- Website: charts on the Ichimoku screen are drawn in Ichimoku style, with the cloud running ahead of price, Tenkan, Kijun and the Chikou span, in place of the SMAs.
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
