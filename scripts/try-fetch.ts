// Dev tool: fetch + map a live market without scoring it (no Anthropic call).
//   npx tsx scripts/try-fetch.ts --kalshi <TICKER>
//   npx tsx scripts/try-fetch.ts --polymarket <slug|url>
import { fetchKalshiMarket } from '../src/platforms/kalshi'
import { fetchPolymarketMarket } from '../src/platforms/polymarket'

const [flag, id] = process.argv.slice(2)
if ((flag !== '--kalshi' && flag !== '--polymarket') || !id) {
  console.error('usage: tsx scripts/try-fetch.ts --kalshi <ticker> | --polymarket <slug|url>')
  process.exit(1)
}

const fetcher = flag === '--kalshi' ? fetchKalshiMarket : fetchPolymarketMarket
fetcher(id)
  .then((m) => console.log(JSON.stringify(m, null, 2)))
  .catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : String(e))
    process.exit(1)
  })
