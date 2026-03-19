import {
  kalshiFetchAllSeries,
  kalshiFetchEvents,
  kalshiFetchMarket,
  kalshiFetchMarketsBySeries,
  kalshiFetchMarketsByEvent,
} from '../client.js'
import { c, vol, cents, pad, rpad, header, hr } from '../utils.js'

interface ScanOpts {
  series?: string
  market?: string
  json?: boolean
  apiKey?: string
  apiUrl?: string
}

export async function scanCommand(query: string, opts: ScanOpts): Promise<void> {
  // Mode 1: --market TICKER — single market detail
  if (opts.market) {
    await showMarket(opts.market.toUpperCase(), opts.json)
    return
  }

  // Mode 2: --series TICKER — list events + markets for a series
  if (opts.series) {
    await showSeries(opts.series.toUpperCase(), opts.json)
    return
  }

  // Mode 3: keyword scan across all series
  await keywordScan(query, opts.json)
}

async function showMarket(ticker: string, json?: boolean): Promise<void> {
  console.log(`${c.dim}Fetching market ${ticker}...${c.reset}`)
  const m = await kalshiFetchMarket(ticker)

  if (json) {
    console.log(JSON.stringify(m, null, 2))
    return
  }

  header(`${m.title || m.ticker}`)
  if (m.subtitle) console.log(`${c.dim}${m.subtitle}${c.reset}`)
  console.log(`Event: ${m.event_ticker}  Status: ${m.status}`)
  console.log('')
  console.log(`Yes Ask: ${cents(m.yes_ask_dollars)}  (size: ${m.yes_ask_size_fp || '-'})`)
  console.log(`Yes Bid: ${cents(m.yes_bid_dollars)}  (size: ${m.yes_bid_size_fp || '-'})`)
  console.log(`No Ask:  ${cents(m.no_ask_dollars)}`)
  console.log(`No Bid:  ${cents(m.no_bid_dollars)}`)
  console.log(`Last:    ${cents(m.last_price_dollars)}`)
  console.log('')
  console.log(`Volume:     ${vol(m.volume_fp)}`)
  console.log(`Vol 24h:    ${vol(m.volume_24h_fp)}`)
  console.log(`Open Int:   ${vol(m.open_interest_fp)}`)
  console.log(`Liquidity:  ${vol(m.liquidity_dollars)}`)
  console.log('')
  console.log(`Open:    ${m.open_time}`)
  console.log(`Close:   ${m.close_time}`)
  if (m.rules_primary) {
    console.log(`\nRules: ${m.rules_primary.slice(0, 300)}`)
  }
}

async function showSeries(seriesTicker: string, json?: boolean): Promise<void> {
  console.log(`${c.dim}Fetching events for series ${seriesTicker}...${c.reset}`)
  let events = await kalshiFetchEvents(seriesTicker)

  if (events.length === 0) {
    // Fallback: direct market lookup by series
    const markets = await kalshiFetchMarketsBySeries(seriesTicker)
    if (json) {
      console.log(JSON.stringify(markets, null, 2))
      return
    }
    if (markets.length === 0) {
      console.log(`${c.dim}No open markets found for series ${seriesTicker}.${c.reset}`)
      return
    }
    header(`${seriesTicker} — ${markets.length} markets`)
    printMarketsTable(markets)
    return
  }

  if (json) {
    console.log(JSON.stringify(events, null, 2))
    return
  }

  for (const event of events) {
    header(`${event.title || event.event_ticker}`)
    console.log(`${c.dim}${event.event_ticker} | ${event.category || '-'} | strike: ${event.strike_date || '-'}${c.reset}`)
    const markets = event.markets && event.markets.length > 0
      ? event.markets
      : await kalshiFetchMarketsByEvent(event.event_ticker)
    printMarketsTable(markets)
  }
}

async function keywordScan(query: string, json?: boolean): Promise<void> {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
  console.log(`${c.dim}Scanning Kalshi for: "${query}"...${c.reset}`)

  const allSeries = await kalshiFetchAllSeries()

  // Score each series
  const thesisKeywords = [
    'oil', 'wti', 'gas', 'recession', 'gdp', 'fed', 'inflation',
    'unemployment', 'cpi', 'interest rate', 'congress', 'election',
    'iran', 'hormuz', 'war', 'tariff', 'trade', 'rate',
  ]

  const matches: Array<{ series: any; score: number; volume: number }> = []
  for (const s of allSeries) {
    const text = `${s.title} ${s.ticker} ${(s.tags || []).join(' ')} ${s.category}`.toLowerCase()
    let score = 0
    for (const term of terms) {
      if (text.includes(term)) score += 10
    }
    for (const kw of thesisKeywords) {
      if (text.includes(kw)) score += 5
    }
    const v = parseFloat(s.volume_fp || '0')
    if (v > 1_000_000) score += 3
    else if (v > 100_000) score += 1
    if (score > 0 && v > 1000) matches.push({ series: s, score, volume: v })
  }

  // Sort by score first, then by volume as tiebreaker
  matches.sort((a, b) => b.score - a.score || b.volume - a.volume)
  const topSeries = matches.slice(0, 15)

  console.log(`\n${c.bold}Found ${matches.length} relevant series. Top ${topSeries.length}:${c.reset}\n`)
  for (const { series: s, volume } of topSeries) {
    const volStr = volume >= 1_000_000 ? `$${(volume / 1_000_000).toFixed(1)}M` : volume >= 1000 ? `$${(volume / 1000).toFixed(0)}k` : `$${volume.toFixed(0)}`
    console.log(`  ${rpad(volStr, 10)} ${pad(s.ticker, 25)} ${s.title}`)
  }

  // Fetch live markets for top 10
  console.log(`\n${c.dim}Fetching live markets...${c.reset}\n`)
  const allMarkets: any[] = []

  for (const { series: s } of topSeries.slice(0, 10)) {
    try {
      const events = await kalshiFetchEvents(s.ticker)
      for (const event of events) {
        const markets = event.markets || []
        for (const m of markets) {
          if (m.status === 'open' || m.status === 'active') {
            allMarkets.push({
              seriesTicker: s.ticker,
              ticker: m.ticker,
              title: m.title || m.subtitle || '',
              yesAsk: parseFloat(m.yes_ask_dollars || '0'),
              lastPrice: parseFloat(m.last_price_dollars || '0'),
              volume24h: parseFloat(m.volume_24h_fp || '0'),
              liquidity: parseFloat(m.liquidity_dollars || '0'),
            })
          }
        }
      }
      await new Promise(r => setTimeout(r, 150))
    } catch {
      // skip failed series
    }
  }

  allMarkets.sort((a, b) => b.liquidity - a.liquidity)

  if (json) {
    console.log(JSON.stringify(allMarkets, null, 2))
    return
  }

  header(`${allMarkets.length} Live Markets`)
  console.log(
    c.bold +
    pad('Ticker', 35) +
    rpad('Yes', 6) +
    rpad('Last', 6) +
    rpad('Vol24h', 10) +
    rpad('Liq', 10) +
    '  Title' +
    c.reset
  )
  hr(110)

  for (const m of allMarkets.slice(0, 50)) {
    console.log(
      pad(m.ticker, 35) +
      rpad(`${Math.round(m.yesAsk * 100)}¢`, 6) +
      rpad(`${Math.round(m.lastPrice * 100)}¢`, 6) +
      rpad(vol(m.volume24h), 10) +
      rpad(vol(m.liquidity), 10) +
      `  ${m.title.slice(0, 55)}`
    )
  }
  console.log('')
}

function printMarketsTable(markets: any[]): void {
  if (markets.length === 0) {
    console.log(`  ${c.dim}(no markets)${c.reset}`)
    return
  }

  markets.sort((a: any, b: any) => {
    const pa = parseFloat(a.yes_ask_dollars || a.last_price_dollars || '0')
    const pb = parseFloat(b.yes_ask_dollars || b.last_price_dollars || '0')
    return pb - pa
  })

  console.log(
    '  ' + c.bold +
    pad('Ticker', 35) +
    rpad('YesAsk', 8) +
    rpad('Last', 8) +
    rpad('Vol24h', 10) +
    rpad('Liq', 12) +
    '  Title' +
    c.reset
  )
  console.log('  ' + c.dim + '─'.repeat(100) + c.reset)

  for (const m of markets) {
    console.log(
      '  ' +
      pad(m.ticker || '', 35) +
      rpad(cents(m.yes_ask_dollars), 8) +
      rpad(cents(m.last_price_dollars), 8) +
      rpad(vol(m.volume_24h_fp), 10) +
      rpad(vol(m.liquidity_dollars), 12) +
      `  ${(m.title || m.subtitle || '').slice(0, 55)}`
    )
  }
  console.log('')
}
