/**
 * sf book — Orderbook depth, price history, and liquidity for individual markets
 *
 * Usage:
 *   sf book KXWTIMAX-26DEC31-T135                  Single Kalshi market
 *   sf book KXWTI-T135 KXCPI-26MAY                 Multiple markets
 *   sf book --poly "oil price"                      Polymarket search
 *   sf book KXWTIMAX-26DEC31-T135 --history         With 7d price history
 *   sf book KXWTIMAX-26DEC31-T135 --json            JSON output
 */

import { kalshiFetchMarket } from '../client.js'
import { getPublicOrderbook, getBatchCandlesticks, isKalshiConfigured } from '../kalshi.js'
import {
  polymarketSearch,
  polymarketGetOrderbookWithDepth,
  polymarketGetPriceHistory,
  parseClobTokenIds,
  parseOutcomePrices,
  toCents,
} from '../polymarket.js'
import { c, pad, rpad, vol, cents } from '../utils.js'

interface BookOpts {
  poly?: string
  history?: boolean
  json?: boolean
}

interface MarketBook {
  venue: string
  ticker: string
  title: string
  bestBid: number
  bestAsk: number
  spread: number
  bidDepth: number
  askDepth: number
  liquidityScore: string
  volume24h: number
  openInterest: number
  lastPrice: number
  expiry: string | null
  sparkline?: string
  bidLevels?: Array<{ price: number; size: number }>
  askLevels?: Array<{ price: number; size: number }>
}

export async function bookCommand(tickers: string[], opts: BookOpts): Promise<void> {
  const results: MarketBook[] = []

  // ── Polymarket search mode ──
  if (opts.poly) {
    console.log(`${c.dim}Searching Polymarket for "${opts.poly}"...${c.reset}`)
    const events = await polymarketSearch(opts.poly, 10)
    for (const event of events) {
      for (const m of (event.markets || []).slice(0, 5)) {
        if (!m.active || m.closed || !m.clobTokenIds) continue
        const ids = parseClobTokenIds(m.clobTokenIds)
        if (!ids) continue

        const depth = await polymarketGetOrderbookWithDepth(ids[0])
        if (!depth) continue

        const prices = parseOutcomePrices(m.outcomePrices)
        const book: MarketBook = {
          venue: 'polymarket',
          ticker: m.conditionId?.slice(0, 16) || m.id,
          title: m.groupItemTitle
            ? `${event.title}: ${m.groupItemTitle}`
            : m.question || event.title,
          bestBid: depth.bestBid,
          bestAsk: depth.bestAsk,
          spread: depth.spread,
          bidDepth: depth.totalBidDepth,
          askDepth: depth.totalAskDepth,
          liquidityScore: depth.liquidityScore,
          volume24h: m.volume24hr || 0,
          openInterest: m.liquidityNum || 0,
          lastPrice: prices[0] ? toCents(prices[0]) : 0,
          expiry: m.endDateIso || null,
          bidLevels: depth.levels.bids.slice(0, 5).map(l => ({ price: Math.round(parseFloat(l.price) * 100), size: Math.round(parseFloat(l.size)) })),
          askLevels: depth.levels.asks.slice(0, 5).map(l => ({ price: Math.round(parseFloat(l.price) * 100), size: Math.round(parseFloat(l.size)) })),
        }

        // Price history sparkline
        if (opts.history) {
          try {
            const hist = await polymarketGetPriceHistory({ tokenId: ids[0], interval: '1w', fidelity: 360 })
            if (hist.length > 0) {
              book.sparkline = makeSparkline(hist.map(h => h.p * 100))
            }
          } catch { /* skip */ }
        }

        results.push(book)
      }
    }
  }

  // ── Kalshi tickers ──
  for (const ticker of tickers) {
    console.log(`${c.dim}Fetching ${ticker}...${c.reset}`)
    try {
      const market = await kalshiFetchMarket(ticker)
      const ob = await getPublicOrderbook(ticker)

      const yesBids = (ob?.yes_dollars || [])
        .map(([p, q]: [string, string]) => ({ price: Math.round(parseFloat(p) * 100), size: Math.round(parseFloat(q)) }))
        .filter((l: any) => l.price > 0)
        .sort((a: any, b: any) => b.price - a.price)

      const noAsks = (ob?.no_dollars || [])
        .map(([p, q]: [string, string]) => ({ price: Math.round(parseFloat(p) * 100), size: Math.round(parseFloat(q)) }))
        .filter((l: any) => l.price > 0)
        .sort((a: any, b: any) => b.price - a.price)

      const bestBid = yesBids[0]?.price || 0
      const bestAsk = noAsks.length > 0 ? (100 - noAsks[0].price) : 100
      const spread = bestAsk - bestBid
      const bidDepth = yesBids.reduce((s: number, l: any) => s + l.size, 0)
      const askDepth = noAsks.reduce((s: number, l: any) => s + l.size, 0)
      const totalDepth = yesBids.slice(0, 3).reduce((s: number, l: any) => s + l.size, 0) +
                         noAsks.slice(0, 3).reduce((s: number, l: any) => s + l.size, 0)
      const liq = spread <= 2 && totalDepth >= 500 ? 'high' : spread <= 5 && totalDepth >= 100 ? 'medium' : 'low'

      const lastPrice = parseFloat(market.last_price_dollars || '0') * 100

      const book: MarketBook = {
        venue: 'kalshi',
        ticker: market.ticker || ticker,
        title: market.title || market.subtitle || ticker,
        bestBid,
        bestAsk,
        spread,
        bidDepth,
        askDepth,
        liquidityScore: liq,
        volume24h: parseFloat(market.volume_24h_fp || '0'),
        openInterest: parseFloat(market.open_interest_fp || '0'),
        lastPrice: Math.round(lastPrice),
        expiry: market.close_time || market.expiration_time || null,
        bidLevels: yesBids.slice(0, 5),
        askLevels: noAsks.slice(0, 5).map((l: any) => ({ price: 100 - l.price, size: l.size })),
      }

      // Kalshi price history
      if (opts.history) {
        // Try authenticated candlestick API first (requires Kalshi keys)
        if (isKalshiConfigured()) {
          try {
            const now = Math.floor(Date.now() / 1000)
            const weekAgo = now - 7 * 86400
            const candleResults = await getBatchCandlesticks({
              tickers: [ticker],
              startTs: weekAgo,
              endTs: now,
              periodInterval: 1440,
            })
            const mktEntry = candleResults.find((e: any) => e.market_ticker === ticker) || candleResults[0]
            const mktCandles = mktEntry?.candlesticks || []
            if (Array.isArray(mktCandles) && mktCandles.length > 0) {
              const prices = mktCandles.map((cd: any) => {
                // Kalshi nests prices: cd.price.close_dollars or cd.yes_ask.close_dollars
                const p = cd.price?.close_dollars ?? cd.yes_ask?.close_dollars ?? cd.yes_bid?.close_dollars ?? cd.close ?? cd.price
                const v = typeof p === 'string' ? parseFloat(p) * 100 : (typeof p === 'number' ? p : 0)
                return Math.round(v)
              }).filter((p: number) => p > 0)
              if (prices.length >= 2) {
                book.sparkline = makeSparkline(prices)
              }
            }
          } catch { /* skip */ }
        }
        // Fallback: show previous vs current from market data
        if (!book.sparkline) {
          const prev = parseFloat(market.previous_price_dollars || '0') * 100
          if (prev > 0 && Math.abs(prev - book.lastPrice) > 0) {
            const delta = book.lastPrice - Math.round(prev)
            const deltaColor = delta >= 0 ? c.green : c.red
            const deltaStr = delta >= 0 ? `+${delta}` : `${delta}`
            book.sparkline = `prev ${Math.round(prev)}¢ → now ${book.lastPrice}¢ ${deltaColor}${deltaStr}${c.reset}`
          }
        }
      }

      results.push(book)
    } catch (err: any) {
      console.error(`${c.red}Failed to fetch ${ticker}: ${err.message}${c.reset}`)
    }
  }

  if (results.length === 0) {
    console.log(`${c.dim}No markets found.${c.reset}`)
    return
  }

  // ── JSON output ──
  if (opts.json) {
    console.log(JSON.stringify(results, null, 2))
    return
  }

  // ── Formatted output ──
  for (const book of results) {
    const venueTag = book.venue === 'polymarket' ? `${c.blue}POLY${c.reset}` : `${c.cyan}KLSH${c.reset}`
    console.log()
    console.log(`${c.bold}${venueTag} ${book.title}${c.reset}`)
    console.log(`${c.dim}${book.ticker}${c.reset}`)
    console.log()

    // Summary line
    const liqColor = book.liquidityScore === 'high' ? c.green : book.liquidityScore === 'medium' ? c.yellow : c.red
    console.log(
      `  Last ${c.bold}${book.lastPrice}¢${c.reset}  ` +
      `Bid ${c.green}${book.bestBid}¢${c.reset}  ` +
      `Ask ${c.red}${book.bestAsk}¢${c.reset}  ` +
      `Spread ${liqColor}${book.spread}¢${c.reset}  ` +
      `Liq ${liqColor}${book.liquidityScore}${c.reset}`
    )
    console.log(
      `  Vol24h ${vol(book.volume24h)}  ` +
      `OI ${vol(book.openInterest)}` +
      (book.expiry ? `  Expires ${book.expiry.slice(0, 10)}` : '')
    )

    // Sparkline
    if (book.sparkline) {
      console.log(`  7d ${book.sparkline}`)
    }

    // Orderbook depth
    if (book.bidLevels && book.askLevels) {
      console.log()
      console.log(`  ${c.dim}${pad('BID', 18)}  ${pad('ASK', 18)}${c.reset}`)
      console.log(`  ${c.dim}${'─'.repeat(38)}${c.reset}`)
      const maxLevels = Math.max(book.bidLevels.length, book.askLevels.length)
      for (let i = 0; i < Math.min(maxLevels, 5); i++) {
        const bid = book.bidLevels[i]
        const ask = book.askLevels[i]
        const bidStr = bid ? `${c.green}${rpad(`${bid.price}¢`, 5)}${c.reset} ${rpad(String(bid.size), 8)}` : pad('', 18)
        const askStr = ask ? `${c.red}${rpad(`${ask.price}¢`, 5)}${c.reset} ${rpad(String(ask.size), 8)}` : ''
        console.log(`  ${bidStr}  ${askStr}`)
      }
      console.log(`  ${c.dim}depth: ${book.bidDepth} bid / ${book.askDepth} ask${c.reset}`)
    }
    console.log()
  }
}

// ── Sparkline helper ──

function makeSparkline(values: number[]): string {
  if (values.length < 2) return ''
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1
  const blocks = '▁▂▃▄▅▆▇█'
  const line = values.map(v => {
    const idx = Math.round(((v - min) / range) * 7)
    return blocks[idx]
  }).join('')

  const startPrice = Math.round(values[0])
  const endPrice = Math.round(values[values.length - 1])
  const delta = endPrice - startPrice
  const deltaColor = delta >= 0 ? c.green : c.red
  const deltaStr = delta >= 0 ? `+${delta}` : `${delta}`

  return `${line} ${startPrice}¢→${endPrice}¢ ${deltaColor}${deltaStr}${c.reset}`
}
