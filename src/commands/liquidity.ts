/**
 * sf liquidity — Market liquidity scanner by topic and horizon
 *
 * Scans known series, fetches public orderbooks, and displays
 * spread/depth/slippage data grouped by topic and horizon.
 */

import { kalshiFetchMarketsBySeries } from '../client.js'
import { getPublicOrderbook, getPositions, isKalshiConfigured } from '../kalshi.js'
import { TOPIC_SERIES } from '../topics.js'
import { c, pad, rpad } from '../utils.js'

// ── Types ────────────────────────────────────────────────────────────────────

interface MarketLiquidity {
  ticker: string
  shortTicker: string
  horizon: 'weekly' | 'monthly' | 'long-term'
  closeTime: string
  bestBid: number   // cents
  bestAsk: number   // cents
  spread: number    // cents
  bidDepth: number  // total contracts on yes bids
  askDepth: number  // total contracts on no bids (= yes ask side)
  slippage100: string // weighted avg price to buy 100 YES contracts, or "∞"
  held: boolean
}

type Horizon = 'weekly' | 'monthly' | 'long-term'

// ── Horizon classification ───────────────────────────────────────────────────

function classifyHorizon(closeTime: string): Horizon {
  const now = Date.now()
  const close = new Date(closeTime).getTime()
  const daysAway = (close - now) / (1000 * 60 * 60 * 24)
  if (daysAway < 7) return 'weekly'
  if (daysAway <= 35) return 'monthly'
  return 'long-term'
}

function horizonLabel(h: Horizon): string {
  switch (h) {
    case 'weekly': return 'weekly (<7d)'
    case 'monthly': return 'monthly (7-35d)'
    case 'long-term': return 'long-term (>35d)'
  }
}

// ── Slippage calculation ─────────────────────────────────────────────────────

/**
 * Calculate weighted average price to buy `qty` YES contracts
 * by eating NO bids (selling NO = buying YES).
 *
 * no_dollars are sorted low→high by price. The best NO bid
 * (highest price) is the cheapest YES ask.
 */
function calcSlippage100(noDollars: Array<[string, string]>, qty: number): string {
  // Sort descending by price (highest no bid = cheapest yes ask)
  const levels = noDollars
    .map(([price, amount]) => ({
      noPrice: parseFloat(price),
      yesAsk: 1.0 - parseFloat(price),
      qty: parseFloat(amount),
    }))
    .filter(l => l.noPrice > 0 && l.qty > 0)
    .sort((a, b) => b.noPrice - a.noPrice) // highest no price first = lowest yes ask

  let remaining = qty
  let totalCost = 0

  for (const level of levels) {
    if (remaining <= 0) break
    const fill = Math.min(remaining, level.qty)
    totalCost += fill * level.yesAsk
    remaining -= fill
  }

  if (remaining > 0) return '∞'
  const avgPrice = totalCost / qty
  return (avgPrice * 100).toFixed(1) + '¢'
}

// ── Batch concurrency helper ─────────────────────────────────────────────────

async function batchProcess<T, R>(
  items: T[],
  fn: (item: T) => Promise<R>,
  batchSize: number,
  delayMs: number,
): Promise<(R | null)[]> {
  const results: (R | null)[] = []
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize)
    const settled = await Promise.allSettled(batch.map(fn))
    for (const s of settled) {
      results.push(s.status === 'fulfilled' ? s.value : null)
    }
    if (i + batchSize < items.length) {
      await new Promise(resolve => setTimeout(resolve, delayMs))
    }
  }
  return results
}

// ── Main command ─────────────────────────────────────────────────────────────

export async function liquidityCommand(opts: {
  topic?: string
  horizon?: string
  minDepth?: number
  json?: boolean
}): Promise<void> {
  // Determine which topics to scan
  const allTopics = Object.keys(TOPIC_SERIES)
  const topics = opts.topic
    ? allTopics.filter(t => t.toLowerCase() === opts.topic!.toLowerCase())
    : allTopics

  if (topics.length === 0) {
    const valid = allTopics.join(', ')
    console.error(`Unknown topic: ${opts.topic}. Valid topics: ${valid}`)
    process.exit(1)
  }

  // Fetch held positions if Kalshi is configured
  let heldTickers = new Set<string>()
  if (isKalshiConfigured()) {
    try {
      const positions = await getPositions()
      if (positions) {
        heldTickers = new Set(positions.map(p => p.ticker))
      }
    } catch {
      // ignore — positions are optional decoration
    }
  }

  // Collect all markets per topic
  const topicMarkets: Record<string, any[]> = {}
  for (const topic of topics) {
    const series = TOPIC_SERIES[topic]
    const markets: any[] = []
    for (const seriesTicker of series) {
      try {
        const m = await kalshiFetchMarketsBySeries(seriesTicker)
        markets.push(...m)
      } catch {
        // skip failed series
      }
    }
    if (markets.length > 0) {
      topicMarkets[topic] = markets
    }
  }

  // Filter by horizon if specified, classify all markets
  const horizonFilter = opts.horizon as Horizon | undefined

  // Build list of tickers to fetch orderbooks for
  interface MarketInfo {
    ticker: string
    closeTime: string
    topic: string
    horizon: Horizon
  }

  const marketInfos: MarketInfo[] = []
  for (const [topic, markets] of Object.entries(topicMarkets)) {
    for (const m of markets) {
      const closeTime = m.close_time || m.expiration_time || ''
      if (!closeTime) continue
      const horizon = classifyHorizon(closeTime)
      if (horizonFilter && horizon !== horizonFilter) continue
      marketInfos.push({ ticker: m.ticker, closeTime, topic, horizon })
    }
  }

  if (marketInfos.length === 0) {
    console.log('No markets found matching filters.')
    return
  }

  // Fetch orderbooks in batches of 5, 100ms between batches
  const orderbooks = await batchProcess(
    marketInfos,
    async (info) => {
      const ob = await getPublicOrderbook(info.ticker)
      return { info, ob }
    },
    5,
    100,
  )

  // Build liquidity rows
  const rows: MarketLiquidity[] = []
  for (const result of orderbooks) {
    if (!result || !result.ob) continue
    const { info, ob } = result

    const yesDollars = ob.yes_dollars.map(([p, q]) => ({
      price: Math.round(parseFloat(p) * 100),
      qty: parseFloat(q),
    })).filter(l => l.price > 0)

    const noDollars = ob.no_dollars.map(([p, q]) => ({
      price: Math.round(parseFloat(p) * 100),
      qty: parseFloat(q),
    })).filter(l => l.price > 0)

    // Sort descending
    yesDollars.sort((a, b) => b.price - a.price)
    noDollars.sort((a, b) => b.price - a.price)

    const bestBid = yesDollars.length > 0 ? yesDollars[0].price : 0
    const bestAsk = noDollars.length > 0 ? (100 - noDollars[0].price) : 100
    const spread = bestAsk - bestBid

    const bidDepth = yesDollars.reduce((sum, l) => sum + l.qty, 0)
    const askDepth = noDollars.reduce((sum, l) => sum + l.qty, 0)

    const slippage100 = calcSlippage100(ob.no_dollars, 100)

    // Filter by minDepth
    if (opts.minDepth && (bidDepth + askDepth) < opts.minDepth) continue

    rows.push({
      ticker: info.ticker,
      shortTicker: info.ticker, // will abbreviate per-group below
      horizon: info.horizon,
      closeTime: info.closeTime,
      bestBid,
      bestAsk,
      spread,
      bidDepth,
      askDepth,
      slippage100,
      held: heldTickers.has(info.ticker),
    })
  }

  // ── JSON output ────────────────────────────────────────────────────────────
  if (opts.json) {
    console.log(JSON.stringify(rows, null, 2))
    return
  }

  // ── Formatted output ───────────────────────────────────────────────────────
  const now = new Date().toISOString().slice(0, 10)
  console.log()
  console.log(`${c.bold}Liquidity Scanner${c.reset} ${c.dim}(${now} UTC)${c.reset}`)
  console.log(c.dim + '─'.repeat(68) + c.reset)

  // Group rows by topic → horizon
  const grouped: Record<string, Record<string, MarketLiquidity[]>> = {}
  for (const row of rows) {
    // find which topic this ticker belongs to
    let topic = 'OTHER'
    for (const [t, series] of Object.entries(TOPIC_SERIES)) {
      for (const s of series) {
        if (row.ticker.toUpperCase().startsWith(s)) {
          topic = t.toUpperCase()
          break
        }
      }
      if (topic !== 'OTHER') break
    }
    if (!grouped[topic]) grouped[topic] = {}
    if (!grouped[topic][row.horizon]) grouped[topic][row.horizon] = []
    grouped[topic][row.horizon].push(row)
  }

  let totalMarkets = 0
  let thinMarkets = 0
  let heldCount = 0

  const horizonOrder: Horizon[] = ['weekly', 'monthly', 'long-term']

  for (const [topic, horizons] of Object.entries(grouped)) {
    for (const h of horizonOrder) {
      const marketRows = horizons[h]
      if (!marketRows || marketRows.length === 0) continue

      // Find common prefix for abbreviation within this group
      const commonPrefix = findCommonPrefix(marketRows.map(r => r.ticker))

      // Abbreviate tickers
      for (const row of marketRows) {
        row.shortTicker = commonPrefix.length > 0
          ? row.ticker.slice(commonPrefix.length).replace(/^-/, '')
          : row.ticker
        if (row.shortTicker.length === 0) row.shortTicker = row.ticker
      }

      // Sort by ticker
      marketRows.sort((a, b) => a.ticker.localeCompare(b.ticker))

      console.log()
      console.log(`${c.bold}${c.cyan}${topic}${c.reset} ${c.dim}— ${horizonLabel(h)}${c.reset}`)
      console.log(
        `${c.dim}${pad('Ticker', 20)} ${rpad('Bid¢', 5)} ${rpad('Ask¢', 5)} ${rpad('Spread', 6)} ${rpad('BidDep', 6)} ${rpad('AskDep', 6)} ${rpad('Slip100', 7)}${c.reset}`
      )

      for (const row of marketRows) {
        totalMarkets++
        if (row.held) heldCount++
        const thin = row.spread > 5

        if (thin) thinMarkets++

        // Color spread
        let spreadStr: string
        if (row.spread <= 2) {
          spreadStr = `${c.green}${row.spread}¢${c.reset}`
        } else if (row.spread <= 5) {
          spreadStr = `${c.yellow}${row.spread}¢${c.reset}`
        } else {
          spreadStr = `${c.red}${row.spread}¢${c.reset}`
        }

        const thinMark = thin ? ' \u26A0\uFE0F' : ''
        const heldMark = row.held ? `  ${c.magenta}\u2190 held${c.reset}` : ''

        // Pad spread field accounting for ANSI codes
        const spreadPadded = rpad(`${row.spread}¢`, 6)
        const spreadColored = row.spread <= 2
          ? `${c.green}${spreadPadded}${c.reset}`
          : row.spread <= 5
            ? `${c.yellow}${spreadPadded}${c.reset}`
            : `${c.red}${spreadPadded}${c.reset}`

        console.log(
          `${pad(row.shortTicker, 20)} ${rpad(String(row.bestBid), 5)} ${rpad(String(row.bestAsk), 5)} ${spreadColored} ${rpad(String(Math.round(row.bidDepth)), 6)} ${rpad(String(Math.round(row.askDepth)), 6)} ${rpad(row.slippage100, 7)}${thinMark}${heldMark}`
        )
      }
    }
  }

  // Summary
  console.log()
  console.log(
    `${c.dim}Summary: ${totalMarkets} markets | ${thinMarkets} thin (spread>5¢) | ${heldCount} held${c.reset}`
  )
  console.log()
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function findCommonPrefix(strings: string[]): string {
  if (strings.length === 0) return ''
  if (strings.length === 1) return ''
  let prefix = strings[0]
  for (let i = 1; i < strings.length; i++) {
    while (!strings[i].startsWith(prefix)) {
      prefix = prefix.slice(0, -1)
      if (prefix.length === 0) return ''
    }
  }
  // Don't strip if it would leave nothing for some tickers
  // Also strip trailing hyphen from prefix for cleaner display
  return prefix
}
