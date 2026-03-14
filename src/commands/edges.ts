/**
 * sf edges — Top edges across all active theses
 *
 * The most important output of the entire system: "what to trade now."
 *
 * Flow:
 * 1. GET /api/thesis → all active theses
 * 2. For each: GET /api/thesis/:id/context → edges with orderbook
 * 3. Optional: getPositions() → Kalshi positions with live prices
 * 4. Merge edges, dedupe by marketId (keep highest edge, note source thesis)
 * 5. Sort by executableEdge descending
 * 6. Display table with position overlay + summary
 */

import { SFClient } from '../client.js'
import { getPositions, getMarketPrice, isKalshiConfigured, type KalshiPosition } from '../kalshi.js'
import { c, pad, rpad, trunc, hr, header, shortId } from '../utils.js'

interface MergedEdge {
  marketId: string
  market: string
  venue: string
  direction: string
  marketPrice: number
  thesisPrice: number
  edge: number
  executableEdge: number | null
  spread: number | null
  liquidityScore: string | null
  thesisId: string
  // Position overlay
  position: {
    side: string
    quantity: number
    avgPrice: number
    currentValue: number
    pnl: number
    totalCost: number
  } | null
}

interface EdgesOpts {
  json?: boolean
  limit?: string
  apiKey?: string
  apiUrl?: string
}

export async function edgesCommand(opts: EdgesOpts): Promise<void> {
  const client = new SFClient(opts.apiKey, opts.apiUrl)
  const limit = parseInt(opts.limit || '20')

  // ── Step 1: Fetch all active theses ────────────────────────────────────────
  console.log(`${c.dim}Fetching theses...${c.reset}`)
  const data = await client.listTheses()
  const rawTheses = data.theses || (data as unknown as any[])
  const theses = (Array.isArray(rawTheses) ? rawTheses : []).filter((t: any) => t.status === 'active')

  if (theses.length === 0) {
    console.log(`${c.yellow}No active theses found.${c.reset} Create one: sf create "your thesis"`)
    return
  }

  // ── Step 2: Fetch context for each thesis (parallel) ───────────────────────
  console.log(`${c.dim}Fetching edges from ${theses.length} theses...${c.reset}`)
  const allEdges: Array<MergedEdge> = []

  const contextPromises = theses.map(async (t: any) => {
    try {
      const ctx = await client.getContext(t.id)
      return { thesisId: t.id, edges: ctx.edges || [] }
    } catch {
      return { thesisId: t.id, edges: [] }
    }
  })

  const results = await Promise.all(contextPromises)

  for (const { thesisId, edges } of results) {
    for (const e of edges) {
      allEdges.push({
        marketId: e.marketId || '',
        market: e.market || e.marketTitle || e.marketId || '',
        venue: e.venue || 'kalshi',
        direction: e.direction || 'yes',
        marketPrice: typeof e.marketPrice === 'number' ? e.marketPrice : 0,
        thesisPrice: typeof e.thesisPrice === 'number' ? e.thesisPrice : 0,
        edge: typeof e.edge === 'number' ? e.edge : 0,
        executableEdge: typeof e.executableEdge === 'number' ? e.executableEdge : null,
        spread: e.orderbook?.spread ?? null,
        liquidityScore: e.orderbook?.liquidityScore ?? null,
        thesisId,
        position: null,
      })
    }
  }

  if (allEdges.length === 0) {
    console.log(`${c.yellow}No edges found across ${theses.length} theses.${c.reset}`)
    return
  }

  // ── Step 3: Dedupe by marketId — keep highest absolute edge ────────────────
  const deduped = new Map<string, MergedEdge>()
  for (const edge of allEdges) {
    const key = edge.marketId
    if (!key) continue
    const existing = deduped.get(key)
    if (!existing || Math.abs(edge.edge) > Math.abs(existing.edge)) {
      deduped.set(key, edge)
    }
  }

  let merged = Array.from(deduped.values())

  // ── Step 4: Fetch positions (optional) ─────────────────────────────────────
  let positions: KalshiPosition[] | null = null
  if (isKalshiConfigured()) {
    console.log(`${c.dim}Fetching Kalshi positions...${c.reset}`)
    positions = await getPositions()

    if (positions) {
      // Enrich with live prices
      for (const pos of positions) {
        const livePrice = await getMarketPrice(pos.ticker)
        if (livePrice !== null) {
          pos.current_value = livePrice
          pos.unrealized_pnl = Math.round((livePrice - pos.average_price_paid) * pos.quantity)
        }
      }

      // Match positions to edges
      for (const edge of merged) {
        const pos = positions.find(p =>
          p.ticker === edge.marketId ||
          (edge.marketId && p.ticker?.includes(edge.marketId))
        )
        if (pos) {
          edge.position = {
            side: pos.side || 'yes',
            quantity: pos.quantity,
            avgPrice: pos.average_price_paid,
            currentValue: pos.current_value,
            pnl: pos.unrealized_pnl || 0,
            totalCost: pos.total_cost || Math.round(pos.average_price_paid * pos.quantity),
          }
        }
      }
    }
  }

  // ── Step 5: Sort by executableEdge (or edge) descending ────────────────────
  merged.sort((a, b) => {
    const aVal = a.executableEdge !== null ? a.executableEdge : a.edge
    const bVal = b.executableEdge !== null ? b.executableEdge : b.edge
    return Math.abs(bVal) - Math.abs(aVal)
  })

  // Apply limit
  const display = merged.slice(0, limit)

  // ── Step 6: JSON output ────────────────────────────────────────────────────
  if (opts.json) {
    console.log(JSON.stringify({
      totalEdges: merged.length,
      displayed: display.length,
      thesesScanned: theses.length,
      edges: display,
    }, null, 2))
    return
  }

  // ── Step 6: Pretty output ──────────────────────────────────────────────────
  console.log()
  header(`Top Edges Across ${theses.length} Theses`)
  console.log()

  // Header row
  const hdr = [
    pad('Market', 32),
    rpad('Mkt', 5),
    rpad('Thesis', 7),
    rpad('Edge', 6),
    rpad('Exec', 6),
    rpad('Sprd', 5),
    pad('Liq', 5),
    pad('Thesis', 10),
    pad('Position', 20),
  ].join(' ')
  console.log(`${c.dim}${hdr}${c.reset}`)
  hr(100)

  for (const edge of display) {
    const name = trunc(edge.market, 31)
    const mktStr = `${edge.marketPrice}¢`
    const thesisStr = `${edge.thesisPrice}¢`
    const edgeStr = edge.edge > 0 ? `+${edge.edge}` : `${edge.edge}`
    const execStr = edge.executableEdge !== null ? (edge.executableEdge > 0 ? `+${edge.executableEdge}` : `${edge.executableEdge}`) : '—'
    const spreadStr = edge.spread !== null ? `${edge.spread}¢` : '—'
    const liqStr = edge.liquidityScore || '—'
    const thesisIdStr = shortId(edge.thesisId)

    // Color the edge values
    const edgeColor = edge.edge > 0 ? c.green : edge.edge < 0 ? c.red : c.dim
    const execColor = edge.executableEdge !== null ? (edge.executableEdge > 0 ? c.green : c.red) : c.dim
    const liqColor = liqStr === 'high' ? c.green : liqStr === 'medium' ? c.yellow : c.dim

    // Position string
    let posStr = `${c.dim}—${c.reset}`
    if (edge.position) {
      const p = edge.position
      const pnlStr = p.pnl >= 0 ? `${c.green}+$${(p.pnl / 100).toFixed(0)}${c.reset}` : `${c.red}-$${(Math.abs(p.pnl) / 100).toFixed(0)}${c.reset}`
      posStr = `${c.green}${p.quantity}@${p.avgPrice}¢${c.reset} ${pnlStr}`
    }

    const row = [
      edge.position ? `${c.green}${pad(name, 32)}${c.reset}` : pad(name, 32),
      rpad(mktStr, 5),
      rpad(thesisStr, 7),
      `${edgeColor}${rpad(edgeStr, 6)}${c.reset}`,
      `${execColor}${rpad(execStr, 6)}${c.reset}`,
      rpad(spreadStr, 5),
      `${liqColor}${pad(liqStr, 5)}${c.reset}`,
      `${c.dim}${pad(thesisIdStr, 10)}${c.reset}`,
      posStr,
    ].join(' ')

    console.log(row)
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  hr(100)

  // Positioned summary
  const positioned = display.filter(e => e.position)
  if (positioned.length > 0) {
    let totalCost = 0
    let totalPnl = 0
    for (const e of positioned) {
      totalCost += e.position!.totalCost
      totalPnl += e.position!.pnl
    }
    const costStr = `$${(totalCost / 100).toFixed(0)}`
    const pnlColor = totalPnl >= 0 ? c.green : c.red
    const pnlSign = totalPnl >= 0 ? '+' : '-'
    const pnlStr = `${pnlColor}${pnlSign}$${(Math.abs(totalPnl) / 100).toFixed(0)}${c.reset}`
    console.log(`${c.bold}Total positioned:${c.reset} ${costStr} cost | P&L: ${pnlStr}`)
  }

  // Top unpositioned
  const unpositioned = display.filter(e => !e.position && e.edge > 0)
  if (unpositioned.length > 0) {
    const top = unpositioned[0]
    const execLabel = top.executableEdge !== null ? `exec +${top.executableEdge}` : `edge +${top.edge}`
    const liq = top.liquidityScore ? `, ${top.liquidityScore} liq` : ''
    console.log(`${c.bold}Top unpositioned:${c.reset} ${trunc(top.market, 30)} @ ${top.marketPrice}¢ (${execLabel}${liq})`)
  }

  console.log()
}
