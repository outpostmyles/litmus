#!/bin/zsh
# Litmus daily refresh — runs unattended via launchd (see com.litmus.daily.plist.example).
# Essentially free and key-free: it refreshes prices, grades settlements, and fires
# alerts. The only step that can touch the paid model is the World Cup refresh, and
# that is budget-gated and skips already-scored families. It deliberately does NOT
# backfill new markets (that costs money) — run `npm run backfill` by hand for that.
export PATH="/usr/local/bin:$PATH"
# Resolve the repo root from this script's location, so there's no hardcoded path.
cd "$(dirname "$0")/.." || exit 1
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
