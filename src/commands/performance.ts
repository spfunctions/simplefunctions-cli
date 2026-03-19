/**
 * sf performance — Portfolio P&L over time with thesis event annotations
 *
 * Layout: each row is a position, with inline sparkline and current P&L.
 * Scales from 7 days to months — sparkline adapts to available data.
 */

import { SFClient } from '../client.js'
import { getFills, getBatchCandlesticks, isKalshiConfigured } from '../kalshi.js'
import { loadConfig } from '../config.js'
import { c, rpad } from '../utils.js'

function fmtDate(d: Date): string {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${months[d.getMonth()]} ${String(d.getDate()).padStart(2, '0')}`
}

function fmtDollar(cents: number): string {
  const abs = Math.abs(cents / 100)
  const str = abs >= 1000 ? `${(abs / 1000).toFixed(1)}k` : abs >= 100 ? abs.toFixed(0) : abs.toFixed(2)
  return cents >= 0 ? `+$${str}` : `-$${str}`
}

function dateKey(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/** Build a sparkline string from an array of values */
function sparkline(values: number[], colorFn?: (v: number) => string): string {
  if (values.length === 0) return ''
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1
  const blocks = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█']
  return values.map(v => {
    const idx = Math.round(((v - min) / range) * (blocks.length - 1))
    const ch = blocks[idx]
    if (colorFn) return colorFn(v) + ch + c.reset
    return ch
  }).join('')
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

  // 2. Group by ticker
  interface TickerInfo {
    ticker: string
    netQty: number
    totalCostCents: number
    totalContracts: number
    earliestFillTs: number
  }

  const tickerMap = new Map<string, TickerInfo>()
  for (const fill of fillsResult.fills) {
    const ticker: string = fill.ticker || fill.market_ticker || ''
    if (!ticker) continue
    const action: string = fill.action || 'buy'
    const count = Math.round(parseFloat(fill.count_fp || fill.count || '0'))
    const yesPrice = Math.round(parseFloat(fill.yes_price_dollars || '0') * 100)

    let delta = count
    if (action === 'sell') delta = -count

    const info = tickerMap.get(ticker) || { ticker, netQty: 0, totalCostCents: 0, totalContracts: 0, earliestFillTs: Infinity }
    info.netQty += delta
    if (delta > 0) {
      info.totalCostCents += yesPrice * count
      info.totalContracts += count
    }
    const fillTime = fill.created_time || fill.ts || fill.created_at
    if (fillTime) {
      const ts = Math.floor(new Date(fillTime).getTime() / 1000)
      if (ts < info.earliestFillTs) info.earliestFillTs = ts
    }
    tickerMap.set(ticker, info)
  }

  let tickers = [...tickerMap.values()].filter(t => t.netQty !== 0)
  if (opts.ticker) {
    const needle = opts.ticker.toLowerCase()
    tickers = tickers.filter(t => t.ticker.toLowerCase().includes(needle))
  }
  if (tickers.length === 0) {
    console.log(`${c.dim}No open positions found${opts.ticker ? ` matching "${opts.ticker}"` : ''}.${c.reset}`)
    return
  }

  // 3. Fetch candlesticks
  const sinceTs = opts.since
    ? Math.floor(new Date(opts.since).getTime() / 1000)
    : Math.min(...tickers.map(t => t.earliestFillTs === Infinity ? Math.floor(Date.now() / 1000) - 30 * 86400 : t.earliestFillTs))
  const nowTs = Math.floor(Date.now() / 1000)

  const candleData = await getBatchCandlesticks({
    tickers: tickers.map(t => t.ticker),
    startTs: sinceTs,
    endTs: nowTs,
    periodInterval: 1440,
  })

  // Build candlestick lookup: ticker -> sorted [{ date, closeCents }]
  const candleMap = new Map<string, { date: string; close: number }[]>()
  for (const mc of candleData) {
    const entries: { date: string; close: number }[] = []
    for (const candle of (mc.candlesticks || [])) {
      const bidClose = parseFloat(candle.yes_bid?.close_dollars || '0')
      const askClose = parseFloat(candle.yes_ask?.close_dollars || '0')
      const mid = bidClose > 0 && askClose > 0 ? (bidClose + askClose) / 2 : bidClose || askClose
      const closeDollars = parseFloat(candle.price?.close_dollars || '0') || mid
      const closeCents = Math.round(closeDollars * 100)
      const ts = candle.end_period_ts || candle.period_end_ts || candle.ts
      if (ts) entries.push({ date: dateKey(new Date(ts * 1000)), close: closeCents })
    }
    entries.sort((a, b) => a.date.localeCompare(b.date))
    candleMap.set(mc.market_ticker, entries)
  }

  // Collect all dates for total P&L
  const allDates = new Set<string>()
  for (const [, entries] of candleMap) for (const e of entries) allDates.add(e.date)
  const sortedDates = [...allDates].sort()

  // Entry prices
  const entryPrices = new Map<string, number>()
  for (const t of tickers) {
    entryPrices.set(t.ticker, t.totalContracts > 0 ? Math.round(t.totalCostCents / t.totalContracts) : 0)
  }

  // 4. Fetch thesis events
  interface ThesisEvent { date: string; direction: 'up' | 'down'; deltaPct: number; summary: string }
  const events: ThesisEvent[] = []
  try {
    const config = loadConfig()
    const client = new SFClient(config.apiKey, config.apiUrl)
    const feedData = await client.getFeed(720)
    const feedItems = feedData?.feed || feedData?.items || feedData || []
    if (Array.isArray(feedItems)) {
      for (const item of feedItems) {
        const confDelta = item.delta ?? item.confidenceDelta ?? 0
        if (Math.abs(confDelta) >= 0.02) {
          const itemDate = item.evaluatedAt || item.createdAt || item.timestamp || ''
          if (itemDate) {
            events.push({
              date: dateKey(new Date(itemDate)),
              direction: confDelta > 0 ? 'up' : 'down',
              deltaPct: Math.round(confDelta * 100),
              summary: item.summary || '',
            })
          }
        }
      }
    }
  } catch { /* feed unavailable */ }

  // 5. Compute per-ticker stats
  interface TickerPerf {
    ticker: string
    qty: number
    entry: number      // cents
    current: number    // cents
    pnlCents: number
    pnlPct: number
    dailyPnl: number[] // for sparkline
  }

  const perfs: TickerPerf[] = []
  for (const t of tickers) {
    const entry = entryPrices.get(t.ticker) || 0
    const entries = candleMap.get(t.ticker) || []
    const current = entries.length > 0 ? entries[entries.length - 1].close : entry
    const pnlCents = (current - entry) * t.netQty
    const costBasis = entry * t.netQty
    const pnlPct = costBasis !== 0 ? (pnlCents / Math.abs(costBasis)) * 100 : 0
    const dailyPnl = entries.map(e => (e.close - entry) * t.netQty)
    perfs.push({ ticker: t.ticker, qty: t.netQty, entry, current, pnlCents, pnlPct, dailyPnl })
  }

  // Sort by absolute P&L descending
  perfs.sort((a, b) => Math.abs(b.pnlCents) - Math.abs(a.pnlCents))

  // Total daily P&L
  const totalDailyPnl = sortedDates.map(dk => {
    let total = 0
    for (const t of tickers) {
      const entries = candleMap.get(t.ticker) || []
      const entry = entryPrices.get(t.ticker) || 0
      const dayEntry = entries.find(e => e.date === dk)
      if (dayEntry) total += (dayEntry.close - entry) * t.netQty
    }
    return total
  })

  // Summary
  const totalCostCents = tickers.reduce((sum, t) => sum + t.totalCostCents, 0)
  const totalPnlCents = perfs.reduce((sum, p) => sum + p.pnlCents, 0)
  const totalPnlPct = totalCostCents > 0 ? (totalPnlCents / totalCostCents) * 100 : 0

  // 6. JSON output
  if (opts.json) {
    console.log(JSON.stringify({
      positions: perfs.map(p => ({
        ticker: p.ticker, qty: p.qty, entry: p.entry, current: p.current,
        pnl: p.pnlCents, pnlPct: Math.round(p.pnlPct * 10) / 10,
      })),
      totalDailyPnl: sortedDates.map((d, i) => ({ date: d, pnl: totalDailyPnl[i] })),
      events,
      summary: { cost: totalCostCents, pnl: totalPnlCents, pnlPct: Math.round(totalPnlPct * 10) / 10 },
    }, null, 2))
    return
  }

  // 7. Formatted output — rows are positions
  const startDate = sortedDates.length > 0 ? fmtDate(new Date(sortedDates[0])) : '?'
  const endDate = fmtDate(new Date())

  console.log()
  console.log(`  ${c.bold}Portfolio Performance${c.reset} ${c.dim}(${startDate} → ${endDate})${c.reset}`)
  console.log(`  ${c.dim}${'─'.repeat(76)}${c.reset}`)
  console.log()

  // Header
  const maxTickerLen = Math.max(...perfs.map(p => p.ticker.length), 5) + 2
  const w = maxTickerLen + 50
  const pad2 = (s: string, n: number) => s.padEnd(n)
  console.log(`  ${c.dim}${pad2('Ticker', maxTickerLen)} Qty     Entry  Now    P&L          Trend${c.reset}`)

  for (const p of perfs) {
    const pnlStr = fmtDollar(p.pnlCents)
    const pnlColor = p.pnlCents > 0 ? c.green : p.pnlCents < 0 ? c.red : c.dim
    const spark = sparkline(p.dailyPnl, v => v >= 0 ? c.green : c.red)

    console.log(
      `  ${pad2(p.ticker, maxTickerLen)} ` +
      `${rpad(String(p.qty), 8)}` +
      `${rpad(p.entry + '¢', 7)}` +
      `${rpad(p.current + '¢', 7)}` +
      `${pnlColor}${rpad(pnlStr, 13)}${c.reset}` +
      spark
    )
  }

  // Total row
  console.log(`  ${c.dim}${'─'.repeat(w)}${c.reset}`)
  const totalPnlStr = fmtDollar(totalPnlCents)
  const totalPctStr = `${totalPnlPct >= 0 ? '+' : ''}${totalPnlPct.toFixed(1)}%`
  const totalColor = totalPnlCents >= 0 ? c.green : c.red
  const totalSpark = sparkline(totalDailyPnl, v => v >= 0 ? c.green : c.red)
  console.log(
    `  ${c.bold}${pad2('TOTAL', maxTickerLen)}${c.reset} ` +
    `${rpad('', 22)}` +
    `${totalColor}${c.bold}${rpad(`${totalPnlStr} (${totalPctStr})`, 13)}${c.reset}` +
    totalSpark
  )

  // Events
  if (events.length > 0) {
    const dateSet = new Set(sortedDates)
    const relevant = events.filter(e => dateSet.has(e.date))
    if (relevant.length > 0) {
      console.log()
      for (const ev of relevant.slice(0, 8)) {
        const arrow = ev.direction === 'up' ? `${c.green}▲${c.reset}` : `${c.red}▼${c.reset}`
        const summary = ev.summary.length > 55 ? ev.summary.slice(0, 54) + '…' : ev.summary
        console.log(`  ${arrow} ${c.dim}${fmtDate(new Date(ev.date))}${c.reset}  ${ev.deltaPct > 0 ? '+' : ''}${ev.deltaPct}% → ${summary}`)
      }
    }
  }

  // Summary
  console.log()
  const costStr = `$${(totalCostCents / 100).toFixed(0)}`
  console.log(`  ${c.dim}Cost basis:${c.reset} ${costStr}  ${c.dim}|${c.reset}  ${totalColor}${c.bold}${totalPnlStr} (${totalPctStr})${c.reset}`)
  console.log()
}
