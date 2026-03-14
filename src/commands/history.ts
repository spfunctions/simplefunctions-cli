import { getHistoricalMarket } from '../kalshi.js'
import { c } from '../utils.js'

export async function historyCommand(ticker: string, opts: { json?: boolean }): Promise<void> {
  const market = await getHistoricalMarket(ticker)

  if (!market) {
    console.log(`${c.dim}No historical data for ${ticker}${c.reset}`)
    return
  }

  if (opts.json) {
    console.log(JSON.stringify(market, null, 2))
    return
  }

  console.log(`${c.bold}${c.cyan}${market.title || ticker}${c.reset}`)
  console.log(`${c.dim}${'─'.repeat(60)}${c.reset}`)
  console.log(`  Ticker:      ${market.ticker || ticker}`)
  console.log(`  Event:       ${market.event_ticker || '-'}`)
  console.log(`  Status:      ${market.status || '-'}`)
  console.log(`  Result:      ${market.result || market.market_result || '-'}`)

  if (market.last_price_dollars) {
    console.log(`  Last Price:  ${Math.round(parseFloat(market.last_price_dollars) * 100)}¢`)
  }
  if (market.settlement_value !== undefined) {
    console.log(`  Settlement:  ${market.settlement_value}`)
  }
  if (market.volume) {
    console.log(`  Volume:      ${market.volume}`)
  }
  if (market.open_interest) {
    console.log(`  Open Int:    ${market.open_interest}`)
  }
  if (market.expiration_time) {
    console.log(`  Expired:     ${market.expiration_time}`)
  }
  console.log()
}
