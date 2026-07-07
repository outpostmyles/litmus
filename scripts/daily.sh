#!/bin/zsh
# Litmus daily refresh — runs unattended via launchd (com.litmus.daily).
# Zero-cost and key-free: it only refreshes live prices and fires alerts.
# It deliberately does NOT score new markets (that costs money) — run
# `npm run backfill` by hand when you want newly-listed markets scored.
export PATH="/usr/local/bin:$PATH"
cd /Users/mylesschenfield/Litmus || exit 1
echo ""
echo "=== litmus daily $(date '+%Y-%m-%d %H:%M:%S') ==="
npm run ingest || echo "  (ingest failed — alerting on cached prices)"
# Refresh World Cup families (prices + legs). Free once scored — worldcup-cli only
# touches the paid model for UNscored families, and is budget-gated. Keeps the
# tournament page and cross-venue leg gaps current during the event.
npm run worldcup || echo "  (worldcup refresh skipped)"
npm run snapshot
npm run settle
npm run pairs-settle
npm run alerts
