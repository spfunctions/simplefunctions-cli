/**
 * sf dashboard — Portfolio overview
 *
 * One-screen summary: theses, positions, risk exposure, top unpositioned edges.
 * Uses existing APIs + local Kalshi positions.
 */

import { SFClient } from '../client.js'
import { getPositions, getMarketPrice } from '../kalshi.js'
import { RISK_CATEGORIES } from '../topics.js'

function categorize(ticker: string): string {
  // Match longest prefix first
  const sorted = Object.keys(RISK_CATEGORIES).sort((a, b) => b.length - a.length)
  for (const prefix of sorted) {
    if (ticker.startsWith(prefix)) return RISK_CATEGORIES[prefix]
  }
  return 'Other'
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

export async function dashboardCommand(opts?: { json?: boolean; apiKey?: string; apiUrl?: string }) {
  const client = new SFClient(opts?.apiKey, opts?.apiUrl)

  // ── Fetch data in parallel ─────────────────────────────────────────────────
  const [thesesResult, positions] = await Promise.all([
    client.listTheses(),
    getPositions().catch(() => null),
  ])

  const theses = thesesResult.theses || (thesesResult as any)

  // Fetch context for each thesis (edges)
  const contexts: any[] = []
  for (const t of theses) {
    try {
      const ctx = await client.getContext(t.id)
      contexts.push(ctx)
    } catch {
      contexts.push(null)
    }
  }

  // Enrich positions with live prices
  if (positions) {
    for (const pos of positions) {
      const livePrice = await getMarketPrice(pos.ticker)
      if (livePrice !== null) {
        pos.current_value = livePrice
        pos.unrealized_pnl = Math.round((livePrice - pos.average_price_paid) * pos.quantity)
      }
    }
  }

  // ── Collect all edges across all theses ────────────────────────────────────
  const allEdges: any[] = []
  for (const ctx of contexts) {
    if (!ctx?.edges) continue
    for (const e of ctx.edges) {
      allEdges.push(e)
    }
  }

  // Dedupe edges by marketId (keep highest absolute edge)
  const edgeMap = new Map<string, any>()
  for (const e of allEdges) {
    const existing = edgeMap.get(e.marketId)
    if (!existing || Math.abs(e.edge) > Math.abs(existing.edge)) {
      edgeMap.set(e.marketId, e)
    }
  }

  // Find positioned tickers
  const positionedTickers = new Set(positions?.map((p: any) => p.ticker) || [])

  // Unpositioned edges = edges where no position exists on that marketId
  const unpositionedEdges = [...edgeMap.values()]
    .filter(e => !positionedTickers.has(e.marketId))
    .sort((a, b) => Math.abs(b.edge) - Math.abs(a.edge))
    .slice(0, 10)

  // ── JSON output ────────────────────────────────────────────────────────────
  if (opts?.json) {
    console.log(JSON.stringify({
      theses,
      positions,
      unpositionedEdges,
    }, null, 2))
    return
  }

  // ── Formatted output ───────────────────────────────────────────────────────
  console.log()
  console.log('  SimpleFunctions Dashboard')
  console.log('  ' + '─'.repeat(50))
  console.log()

  // ── Theses ─────────────────────────────────────────────────────────────────
  console.log('  Theses')
  if (theses.length === 0) {
    console.log('    (none)')
  } else {
    for (let i = 0; i < theses.length; i++) {
      const t = theses[i]
      const ctx = contexts[i]
      const id = t.id.slice(0, 8)
      const title = (t.title || '').slice(0, 35).padEnd(35)
      const conf = t.confidence != null ? `${Math.round(t.confidence * 100)}%` : '?%'
      const edgeCount = ctx?.edges?.length || 0
      const updated = t.updatedAt ? timeAgo(t.updatedAt) : '?'
      console.log(`    ${id}  ${title}  ${conf.padStart(4)}  ${String(edgeCount).padStart(2)} edges  updated ${updated}`)
    }
  }
  console.log()

  // ── Positions ──────────────────────────────────────────────────────────────
  console.log('  Positions')
  if (!positions || positions.length === 0) {
    console.log('    (no Kalshi positions or Kalshi not configured)')
  } else {
    let totalCost = 0
    let totalPnl = 0

    for (const p of positions) {
      const ticker = (p.ticker || '').padEnd(22)
      const qty = String(p.quantity || 0).padStart(5)
      const avg = `${p.average_price_paid || 0}¢`
      const now = typeof p.current_value === 'number' ? `${p.current_value}¢` : '?¢'
      const pnlCents = p.unrealized_pnl || 0
      const pnlDollars = (pnlCents / 100).toFixed(2)
      const pnlStr = pnlCents >= 0 ? `+$${pnlDollars}` : `-$${Math.abs(parseFloat(pnlDollars)).toFixed(2)}`
      const cost = (p.average_price_paid || 0) * (p.quantity || 0)
      totalCost += cost
      totalPnl += pnlCents

      console.log(`    ${ticker} ${qty} @ ${avg.padEnd(5)} now ${now.padEnd(5)}  ${pnlStr}`)
    }

    console.log('    ' + '─'.repeat(45))
    const totalCostDollars = (totalCost / 100).toFixed(0)
    const totalPnlDollars = (totalPnl / 100).toFixed(2)
    const pnlDisplay = totalPnl >= 0 ? `+$${totalPnlDollars}` : `-$${Math.abs(parseFloat(totalPnlDollars)).toFixed(2)}`
    console.log(`    Total cost: $${totalCostDollars}  |  P&L: ${pnlDisplay}`)
  }
  console.log()

  // ── Risk Exposure ──────────────────────────────────────────────────────────
  if (positions && positions.length > 0) {
    console.log('  Risk Exposure')

    const riskGroups = new Map<string, { cost: number; contracts: number; tickers: string[] }>()

    for (const p of positions) {
      const cat = categorize(p.ticker || '')
      const existing = riskGroups.get(cat) || { cost: 0, contracts: 0, tickers: [] }
      const cost = (p.average_price_paid || 0) * (p.quantity || 0)
      existing.cost += cost
      existing.contracts += p.quantity || 0
      if (!existing.tickers.includes(p.ticker)) existing.tickers.push(p.ticker)
      riskGroups.set(cat, existing)
    }

    // Sort by cost descending
    const sorted = [...riskGroups.entries()].sort((a, b) => b[1].cost - a[1].cost)

    for (const [category, data] of sorted) {
      const costDollars = `$${(data.cost / 100).toFixed(0)}`
      const tickerSummary = data.tickers.length <= 2
        ? ` (${data.tickers.join('+')})`
        : ` (${data.tickers.length} markets)`
      console.log(`    ${(category + tickerSummary + ':').padEnd(35)} ${costDollars.padStart(7)} cost  |  ${String(data.contracts).padStart(5)} contracts`)
    }
    console.log()
  }

  // ── Top Unpositioned Edges ─────────────────────────────────────────────────
  if (unpositionedEdges.length > 0) {
    console.log('  Top Unpositioned Edges')
    for (const e of unpositionedEdges) {
      const name = (e.market || e.marketId || '').slice(0, 25).padEnd(25)
      const mkt = `${e.marketPrice}¢`
      const thesis = `${e.thesisPrice}¢`
      const edge = e.edge > 0 ? `+${e.edge}` : `${e.edge}`
      const liq = e.orderbook?.liquidityScore || '?'
      console.log(`    ${name} ${mkt.padStart(5)} → ${thesis.padStart(5)}  edge ${edge.padStart(4)}  ${liq}`)
    }
    console.log()
  }
}
