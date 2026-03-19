/**
 * sf performance — Portfolio P&L over time with thesis event annotations
 */

import { SFClient } from '../client.js'
import { getFills, getBatchCandlesticks, isKalshiConfigured } from '../kalshi.js'
import { loadConfig } from '../config.js'
import { c, pad, rpad } from '../utils.js'

/** Abbreviate ticker: KXWTIMAX-26DEC31-T135 -> T135 */
function abbrevTicker(ticker: string): string {
  const parts = ticker.split('-')
  return parts[parts.length - 1] || ticker
}

/** Format date as "Mar 01" */
function fmtDate(d: Date): string {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${months[d.getMonth()]} ${String(d.getDate()).padStart(2, '0')}`
}

/** Format dollar amount: positive -> +$12.30, negative -> -$12.30 */
function fmtDollar(cents: number): string {
  const abs = Math.abs(cents / 100)
  if (cents >= 0) return `+$${abs.toFixed(cents === 0 ? 2 : abs >= 100 ? 1 : 2)}`
  return `-$${abs.toFixed(abs >= 100 ? 1 : 2)}`
}

/** Date string key YYYY-MM-DD from a Date */
function dateKey(d: Date): string {
  return d.toISOString().slice(0, 10)
}

export async function performanceCommand(opts: {
  ticker?: string
  since?: string
  json?: boolean
}): Promise<void> {
  if (!isKalshiConfigured()) {
    console.log(`${c.yellow}Kalshi not configured.${c.reset} Run ${c.cyan}sf setup --kalshi${c.reset} first.`)
    return
  }

  // 1. Fetch fills
  const fillsResult = await getFills({ limit: 500 })
  if (!fillsResult || fillsResult.fills.length === 0) {
    console.log(`${c.dim}No fills found.${c.reset}`)
    return
  }

  const fills = fillsResult.fills

  // 2. Group by ticker -> compute net position and weighted avg entry price
  interface TickerInfo {
    ticker: string
    netQty: number           // positive = long yes, negative = short
    totalCostCents: number   // total cost in cents for avg price calculation
    totalContracts: number   // total contracts bought (for avg price)
    earliestFillTs: number   // unix seconds
  }

  const tickerMap = new Map<string, TickerInfo>()

  for (const fill of fills) {
    const ticker: string = fill.ticker || fill.market_ticker || ''
    if (!ticker) continue

    const side: string = fill.side || 'yes'
    const action: string = fill.action || 'buy'
    const count: number = Math.round(parseFloat(fill.count_fp || fill.count || '0'))
    const yesPrice: number = Math.round(parseFloat(fill.yes_price_dollars || '0') * 100)  // dollars string → cents int

    // Determine direction: buy yes = +count, sell yes = -count
    let delta = count
    if (action === 'sell') delta = -count

    const info = tickerMap.get(ticker) || {
      ticker,
      netQty: 0,
      totalCostCents: 0,
      totalContracts: 0,
      earliestFillTs: Infinity,
    }

    info.netQty += delta
    if (delta > 0) {
      // Buying: accumulate cost
      info.totalCostCents += yesPrice * count
      info.totalContracts += count
    }

    // Track earliest fill
    const fillTime = fill.created_time || fill.ts || fill.created_at
    if (fillTime) {
      const ts = Math.floor(new Date(fillTime).getTime() / 1000)
      if (ts < info.earliestFillTs) info.earliestFillTs = ts
    }

    tickerMap.set(ticker, info)
  }

  // 3. Filter out fully closed positions (net qty = 0)
  let tickers = [...tickerMap.values()].filter(t => t.netQty !== 0)

  // 4. Apply --ticker fuzzy filter
  if (opts.ticker) {
    const needle = opts.ticker.toLowerCase()
    tickers = tickers.filter(t => t.ticker.toLowerCase().includes(needle))
  }

  if (tickers.length === 0) {
    console.log(`${c.dim}No open positions found${opts.ticker ? ` matching "${opts.ticker}"` : ''}.${c.reset}`)
    return
  }

  // Determine date range
  const sinceTs = opts.since
    ? Math.floor(new Date(opts.since).getTime() / 1000)
    : Math.min(...tickers.map(t => t.earliestFillTs === Infinity ? Math.floor(Date.now() / 1000) - 30 * 86400 : t.earliestFillTs))
  const nowTs = Math.floor(Date.now() / 1000)

  // 5. Fetch candlesticks
  const candleData = await getBatchCandlesticks({
    tickers: tickers.map(t => t.ticker),
    startTs: sinceTs,
    endTs: nowTs,
    periodInterval: 1440,
  })

  // Build candlestick lookup: ticker -> dateKey -> close price (cents)
  const candleMap = new Map<string, Map<string, number>>()
  for (const mc of candleData) {
    const priceByDate = new Map<string, number>()
    for (const candle of (mc.candlesticks || [])) {
      // close_dollars is a string like "0.4800"
      // price object may be empty; use midpoint of yes_bid.close and yes_ask.close
      const bidClose = parseFloat(candle.yes_bid?.close_dollars || '0')
      const askClose = parseFloat(candle.yes_ask?.close_dollars || '0')
      const mid = bidClose > 0 && askClose > 0 ? (bidClose + askClose) / 2 : bidClose || askClose
      const closeDollars = parseFloat(candle.price?.close_dollars || '0') || mid
      const closeCents = Math.round(closeDollars * 100)
      const ts = candle.end_period_ts || candle.period_end_ts || candle.ts
      if (ts) {
        const d = new Date(ts * 1000)
        priceByDate.set(dateKey(d), closeCents)
      }
    }
    candleMap.set(mc.market_ticker, priceByDate)
  }

  // 6. Build daily P&L matrix
  // Collect all unique dates across all tickers
  const allDates = new Set<string>()
  for (const [, priceByDate] of candleMap) {
    for (const dk of priceByDate.keys()) {
      allDates.add(dk)
    }
  }
  const sortedDates = [...allDates].sort()

  // For each ticker compute entry price
  const entryPrices = new Map<string, number>()
  for (const t of tickers) {
    const avgEntry = t.totalContracts > 0 ? Math.round(t.totalCostCents / t.totalContracts) : 0
    entryPrices.set(t.ticker, avgEntry)
  }

  // Daily P&L: for each date, for each ticker: (close - entry) * netQty
  interface DailyRow {
    date: string
    pnlByTicker: Map<string, number>  // cents
    total: number                      // cents
  }

  const dailyRows: DailyRow[] = []
  for (const dk of sortedDates) {
    const pnlByTicker = new Map<string, number>()
    let total = 0
    for (const t of tickers) {
      const prices = candleMap.get(t.ticker)
      const closePrice = prices?.get(dk)
      if (closePrice !== undefined) {
        const entry = entryPrices.get(t.ticker) || 0
        const pnl = (closePrice - entry) * t.netQty
        pnlByTicker.set(t.ticker, pnl)
        total += pnl
      }
    }
    dailyRows.push({ date: dk, pnlByTicker, total })
  }

  // 7. Fetch thesis events from feed
  interface ThesisEvent {
    date: string
    direction: 'up' | 'down'
    deltaPct: number
    summary: string
  }

  const events: ThesisEvent[] = []
  try {
    const config = loadConfig()
    const client = new SFClient(config.apiKey, config.apiUrl)
    const feedData = await client.getFeed(720)
    const feedItems = feedData?.items || feedData?.events || feedData || []
    if (Array.isArray(feedItems)) {
      for (const item of feedItems) {
        const confDelta = item.confidenceDelta ?? item.confidence_delta ?? 0
        if (Math.abs(confDelta) > 0.03) {
          const itemDate = item.createdAt || item.created_at || item.timestamp || ''
          if (itemDate) {
            events.push({
              date: dateKey(new Date(itemDate)),
              direction: confDelta > 0 ? 'up' : 'down',
              deltaPct: Math.round(confDelta * 100),
              summary: item.summary || item.title || item.description || '',
            })
          }
        }
      }
    }
  } catch {
    // Feed unavailable — continue without events
  }

  // Compute summary
  const totalCostCents = tickers.reduce((sum, t) => sum + t.totalCostCents, 0)
  const lastRow = dailyRows.length > 0 ? dailyRows[dailyRows.length - 1] : null
  const currentPnlCents = lastRow?.total ?? 0
  const currentValueCents = totalCostCents + currentPnlCents
  const pnlPct = totalCostCents > 0 ? (currentPnlCents / totalCostCents) * 100 : 0

  // 8. Output
  if (opts.json) {
    console.log(JSON.stringify({
      daily: dailyRows.map(row => {
        const tickerPnl: Record<string, number> = {}
        for (const [tk, pnl] of row.pnlByTicker) {
          tickerPnl[tk] = pnl
        }
        return { date: row.date, tickers: tickerPnl, total: row.total }
      }),
      events,
      summary: {
        cost: totalCostCents,
        current: currentValueCents,
        pnl: currentPnlCents,
        pnlPct: Math.round(pnlPct * 10) / 10,
      },
    }, null, 2))
    return
  }

  // Formatted output
  const startDate = sortedDates.length > 0 ? fmtDate(new Date(sortedDates[0])) : '?'
  const endDate = fmtDate(new Date())

  console.log()
  console.log(`  ${c.bold}Portfolio Performance${c.reset} ${c.dim}(${startDate} -> ${endDate})${c.reset}`)
  console.log(`  ${c.dim}${'─'.repeat(50)}${c.reset}`)
  console.log()

  // Column headers
  const abbrevs = tickers.map(t => abbrevTicker(t.ticker))
  const colWidth = 9
  const dateCol = 'Date'.padEnd(12)
  const headerCols = abbrevs.map(a => rpad(a, colWidth)).join('')
  const totalCol = rpad('Total', colWidth)
  console.log(`  ${c.dim}${dateCol}${headerCols}${totalCol}${c.reset}`)

  // Rows — show at most ~30 rows, sample if more
  const maxRows = 30
  let rowsToShow = dailyRows
  if (dailyRows.length > maxRows) {
    // Sample evenly + always include first and last
    const step = Math.ceil(dailyRows.length / maxRows)
    rowsToShow = dailyRows.filter((_, i) => i === 0 || i === dailyRows.length - 1 || i % step === 0)
  }

  for (const row of rowsToShow) {
    const d = new Date(row.date)
    const dateStr = fmtDate(d).padEnd(12)
    const cols = tickers.map(t => {
      const pnl = row.pnlByTicker.get(t.ticker)
      if (pnl === undefined) return rpad('--', colWidth)
      const str = fmtDollar(pnl)
      const color = pnl > 0 ? c.green : pnl < 0 ? c.red : c.dim
      return color + rpad(str, colWidth) + c.reset
    }).join('')
    const totalStr = fmtDollar(row.total)
    const totalColor = row.total > 0 ? c.green : row.total < 0 ? c.red : c.dim
    console.log(`  ${dateStr}${cols}${totalColor}${rpad(totalStr, colWidth)}${c.reset}`)
  }

  // Sparkline of total P&L
  if (dailyRows.length >= 2) {
    const totals = dailyRows.map(r => r.total)
    const min = Math.min(...totals)
    const max = Math.max(...totals)
    const range = max - min || 1
    const blocks = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█']
    const spark = totals.map(v => {
      const idx = Math.round(((v - min) / range) * (blocks.length - 1))
      const ch = blocks[idx]
      return v >= 0 ? `${c.green}${ch}${c.reset}` : `${c.red}${ch}${c.reset}`
    }).join('')
    console.log()
    console.log(`  ${c.dim}P&L trend:${c.reset} ${spark}`)
  }

  // Events
  if (events.length > 0) {
    console.log()
    // Match events to date range
    const dateSet = new Set(sortedDates)
    const relevantEvents = events.filter(e => dateSet.has(e.date))
    for (const ev of relevantEvents.slice(0, 10)) {
      const arrow = ev.direction === 'up' ? `${c.green}▲${c.reset}` : `${c.red}▼${c.reset}`
      const dateFmt = fmtDate(new Date(ev.date))
      const sign = ev.deltaPct > 0 ? '+' : ''
      const summary = ev.summary.length > 60 ? ev.summary.slice(0, 59) + '...' : ev.summary
      console.log(`  ${arrow} ${c.dim}${dateFmt}${c.reset}  ${sign}${ev.deltaPct}% -> ${summary}`)
    }
  }

  // Summary line
  console.log()
  const costStr = `$${(totalCostCents / 100).toFixed(0)}`
  const currentStr = `$${(currentValueCents / 100).toFixed(0)}`
  const pnlStr = fmtDollar(currentPnlCents)
  const pnlPctStr = `${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(1)}%`
  const pnlColor = currentPnlCents >= 0 ? c.green : c.red
  console.log(`  ${c.dim}Cost:${c.reset} ${costStr}  ${c.dim}|  Current:${c.reset} ${currentStr}  ${c.dim}|  P&L:${c.reset} ${pnlColor}${pnlStr} (${pnlPctStr})${c.reset}`)
  console.log()
}
