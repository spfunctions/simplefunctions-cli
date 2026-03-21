/**
 * sf positions — Show Kalshi positions with thesis edge overlay
 *
 * Flow:
 * 1. Call local kalshi.getPositions() (Kalshi SDK + local private key) → real positions
 * 2. Call SF API /api/thesis (via SF_API_KEY) → all theses' edge_analysis
 * 3. Local merge: match position ticker to edge marketId
 * 4. Output
 *
 * No server involvement for positions. Kalshi credentials never leave the machine.
 */

import { SFClient } from '../client.js'
import { getPositions, getMarketPrice, getOrderbook, isKalshiConfigured, type KalshiPosition, type LocalOrderbook } from '../kalshi.js'
import { polymarketGetPositions } from '../polymarket.js'
import { loadConfig } from '../config.js'
import { c, pad, rpad, vol, header, hr, shortId } from '../utils.js'

interface PositionsOpts {
  json?: boolean
  thesis?: string
  apiKey?: string
  apiUrl?: string
}

export async function positionsCommand(opts: PositionsOpts): Promise<void> {
  const client = new SFClient(opts.apiKey, opts.apiUrl)

  // ── Step 1: Fetch Kalshi positions (local) ──
  let positions: KalshiPosition[] | null = null
  if (isKalshiConfigured()) {
    console.log(`${c.dim}Fetching Kalshi positions...${c.reset}`)
    positions = await getPositions()
  }

  // ── Step 1b: Fetch Polymarket positions (if wallet configured) ──
  const config = loadConfig()
  let polyPositions: any[] = []
  if (config.polymarketWalletAddress) {
    console.log(`${c.dim}Fetching Polymarket positions...${c.reset}`)
    try {
      polyPositions = await polymarketGetPositions(config.polymarketWalletAddress)
    } catch {
      // skip
    }
  }

  // ── Step 2: Fetch all theses and their edges (via SF API) ──
  console.log(`${c.dim}Fetching thesis edges...${c.reset}`)
  let theses: any[] = []
  try {
    const data = await client.listTheses()
    theses = data.theses || []
  } catch (err) {
    console.warn(`${c.yellow}Warning: Could not fetch theses: ${err}${c.reset}`)
  }

  // If filtering by thesis, only fetch that one's context
  let allEdges: Array<{ thesisId: string; thesisTitle: string; edge: any }> = []
  if (opts.thesis) {
    try {
      const ctx = await client.getContext(opts.thesis)
      for (const edge of (ctx.edges || [])) {
        allEdges.push({
          thesisId: ctx.thesisId,
          thesisTitle: ctx.thesis || ctx.title || '',
          edge,
        })
      }
    } catch (err) {
      console.warn(`${c.yellow}Warning: Could not fetch context for ${opts.thesis}: ${err}${c.reset}`)
    }
  } else {
    // Fetch context for all monitoring theses
    const monitoringTheses = theses.filter(t => t.status === 'monitoring' || t.status === 'active')
    for (const thesis of monitoringTheses.slice(0, 5)) { // limit to 5 to avoid rate limits
      try {
        const ctx = await client.getContext(thesis.id)
        for (const edge of (ctx.edges || [])) {
          allEdges.push({
            thesisId: thesis.id,
            thesisTitle: ctx.thesis || ctx.title || thesis.title || '',
            edge,
          })
        }
      } catch {
        // skip failed
      }
    }
  }

  // ── Step 2.5: Enrich positions with live prices ──
  if (positions && positions.length > 0) {
    console.log(`${c.dim}Fetching live prices for ${positions.length} positions...${c.reset}`)
    for (const pos of positions) {
      try {
        const livePrice = await getMarketPrice(pos.ticker)
        if (livePrice !== null) {
          pos.current_value = livePrice
          // P&L in cents: (currentPrice - avgEntry) * quantity
          pos.unrealized_pnl = (livePrice - pos.average_price_paid) * pos.quantity
        }
        // Small delay to avoid rate limits
        await new Promise(r => setTimeout(r, 100))
      } catch {
        // skip — live price optional
      }
    }
  }

  // ── Step 3: Merge ──
  // Build a lookup from ticker → edge
  const edgeByTicker = new Map<string, Array<{ thesisId: string; thesisTitle: string; edge: any }>>()
  for (const item of allEdges) {
    const ticker = item.edge.marketId
    if (!edgeByTicker.has(ticker)) edgeByTicker.set(ticker, [])
    edgeByTicker.get(ticker)!.push(item)
  }

  if (opts.json) {
    console.log(JSON.stringify({
      kalshiConfigured: isKalshiConfigured(),
      polymarketConfigured: !!config.polymarketWalletAddress,
      positions: positions || [],
      polymarketPositions: polyPositions,
      edges: allEdges.map(e => ({ ...e.edge, thesisId: e.thesisId })),
    }, null, 2))
    return
  }

  // ── Step 4: Display ──

  // A) Positioned edges (positions that match thesis edges)
  if (positions && positions.length > 0) {
    header('Your Positions (via Kalshi)')

    console.log(
      '  ' + c.bold +
      pad('Ticker', 25) +
      rpad('Side', 5) +
      rpad('Qty', 7) +
      rpad('Avg', 6) +
      rpad('Now', 6) +
      rpad('P&L', 9) +
      rpad('Edge', 7) +
      '  Signal' +
      c.reset
    )
    console.log('  ' + c.dim + '─'.repeat(85) + c.reset)

    for (const pos of positions) {
      // Try to get current price
      const nowPrice = pos.current_value || null
      const avgPrice = pos.average_price_paid || 0
      const pnl = pos.unrealized_pnl || 0
      const pnlColor = pnl > 0 ? c.green : pnl < 0 ? c.red : c.dim
      const pnlStr = pnl >= 0 ? `+$${(pnl / 100).toFixed(2)}` : `-$${(Math.abs(pnl) / 100).toFixed(2)}`

      // Find matching edge
      const matchingEdges = edgeByTicker.get(pos.ticker) || []
      const topEdge = matchingEdges[0]
      const edgeSize: number = topEdge?.edge?.edge ?? topEdge?.edge?.edgeSize ?? 0
      const edgeColor = Math.abs(edgeSize) > 10 ? c.green : Math.abs(edgeSize) > 5 ? c.yellow : c.dim

      // Signal: HOLD if edge still positive in same direction, WATCH otherwise
      let signal = 'HOLD'
      if (topEdge) {
        const posDirection = pos.side
        const edgeDirection = topEdge.edge.direction
        if (posDirection === edgeDirection && edgeSize > 3) {
          signal = 'HOLD'
        } else if (edgeSize < -3) {
          signal = 'CLOSE'
        } else {
          signal = 'HOLD'
        }
      } else {
        signal = '—'
      }
      const signalColor = signal === 'HOLD' ? c.dim : signal === 'CLOSE' ? c.red : c.yellow

      console.log(
        '  ' +
        pad(pos.ticker, 25) +
        rpad(pos.side.toUpperCase(), 5) +
        rpad(String(pos.quantity), 7) +
        rpad(`${avgPrice}¢`, 6) +
        rpad(nowPrice ? `${nowPrice}¢` : '-', 6) +
        `${pnlColor}${rpad(pnlStr, 9)}${c.reset}` +
        `${edgeColor}${rpad(edgeSize ? `${edgeSize > 0 ? '+' : ''}${edgeSize.toFixed(0)}` : '-', 7)}${c.reset}` +
        `  ${signalColor}${signal}${c.reset}`
      )
    }
    console.log('')
  } else if (isKalshiConfigured()) {
    console.log(`\n${c.dim}No open positions on Kalshi.${c.reset}\n`)
  } else {
    console.log(`\n${c.yellow}Kalshi not configured.${c.reset} Set KALSHI_API_KEY_ID and KALSHI_PRIVATE_KEY_PATH to see positions.\n`)
  }

  // C) Polymarket positions
  if (polyPositions.length > 0) {
    header('Polymarket Positions')

    console.log(
      '  ' + c.bold +
      pad('Market', 35) +
      rpad('Side', 5) +
      rpad('Size', 8) +
      rpad('Avg', 6) +
      rpad('Now', 6) +
      rpad('P&L', 9) +
      c.reset
    )
    console.log('  ' + c.dim + '─'.repeat(75) + c.reset)

    for (const pos of polyPositions) {
      const title = (pos.title || pos.slug || pos.asset || '').slice(0, 34)
      const side = pos.outcome || 'YES'
      const size = pos.size || 0
      const avgPrice = Math.round((pos.avgPrice || 0) * 100)
      const curPrice = Math.round((pos.curPrice || pos.currentPrice || 0) * 100)
      const pnl = pos.cashPnl || ((curPrice - avgPrice) * size / 100)
      const pnlColor = pnl >= 0 ? c.green : c.red
      const pnlStr = pnl >= 0 ? `+$${pnl.toFixed(2)}` : `-$${Math.abs(pnl).toFixed(2)}`

      console.log(
        '  ' +
        pad(title, 35) +
        rpad(side.toUpperCase(), 5) +
        rpad(String(Math.round(size)), 8) +
        rpad(`${avgPrice}¢`, 6) +
        rpad(`${curPrice}¢`, 6) +
        `${pnlColor}${rpad(pnlStr, 9)}${c.reset}`
      )
    }
    console.log('')
  } else if (config.polymarketWalletAddress) {
    console.log(`${c.dim}No open positions on Polymarket.${c.reset}\n`)
  }

  // B) Unpositioned edges (edges without matching positions)
  const positionedTickers = new Set((positions || []).map(p => p.ticker))
  const unpositionedEdges = allEdges.filter(e => !positionedTickers.has(e.edge.marketId))

  if (unpositionedEdges.length > 0) {
    // Sort by absolute edge size descending
    unpositionedEdges.sort((a, b) => Math.abs(b.edge.edge ?? b.edge.edgeSize ?? 0) - Math.abs(a.edge.edge ?? a.edge.edgeSize ?? 0))

    // Pre-fetch orderbooks locally for top Kalshi edges that don't already have server OB data
    const topEdgesForOB = unpositionedEdges.slice(0, 10).filter(
      item => item.edge.venue === 'kalshi' && !item.edge.orderbook && Math.abs(item.edge.edge ?? item.edge.edgeSize ?? 0) > 5
    )
    const localObMap = new Map<string, LocalOrderbook>()
    if (topEdgesForOB.length > 0 && isKalshiConfigured()) {
      console.log(`${c.dim}Fetching orderbooks for ${topEdgesForOB.length} edges...${c.reset}`)
      for (const item of topEdgesForOB) {
        try {
          const ob = await getOrderbook(item.edge.marketId)
          if (ob) localObMap.set(item.edge.marketId, ob)
          await new Promise(r => setTimeout(r, 150))
        } catch {
          // skip
        }
      }
    }

    const thesisLabel = opts.thesis ? ` (thesis ${shortId(opts.thesis)})` : ''
    header(`Unpositioned Edges${thesisLabel}`)

    console.log(
      '  ' + c.bold +
      pad('Market', 30) +
      rpad('Mkt', 6) +
      rpad('Thesis', 8) +
      rpad('Edge', 7) +
      rpad('Spread', 8) +
      rpad('Liq', 8) +
      '  Signal' +
      c.reset
    )
    console.log('  ' + c.dim + '─'.repeat(85) + c.reset)

    for (const item of unpositionedEdges.slice(0, 20)) {
      const e = item.edge
      const edgeSize: number = e.edge ?? e.edgeSize ?? 0
      const edgeColor = edgeSize > 10 ? c.green : edgeSize > 5 ? c.yellow : edgeSize > 0 ? c.dim : c.red
      const mktPrice: number = e.marketPrice ?? 0
      const thesisPrice: number = e.thesisPrice ?? e.thesisImpliedPrice ?? 0
      const title = (e.market || e.marketTitle || e.marketId || '?').slice(0, 29)

      // Orderbook: prefer server data, fallback to local fetch
      const serverOb = e.orderbook
      const localOb = localObMap.get(e.marketId)
      const ob = serverOb || localOb
      const spreadStr = ob ? `${ob.spread}¢` : '-'
      const liqStr = ob ? ob.liquidityScore : '-'
      const liqColor = ob?.liquidityScore === 'high' ? c.green : ob?.liquidityScore === 'medium' ? c.yellow : c.dim

      // Signal
      let signal = 'WATCH'
      if (edgeSize > 10 && ob?.liquidityScore !== 'low') {
        signal = 'CONSIDER'
      } else if (edgeSize > 5 && ob?.liquidityScore === 'high') {
        signal = 'CONSIDER'
      }
      const signalColor = signal === 'CONSIDER' ? c.green : c.dim

      console.log(
        '  ' +
        pad(title, 30) +
        rpad(`${mktPrice.toFixed(0)}¢`, 6) +
        rpad(`${thesisPrice.toFixed(0)}¢`, 8) +
        `${edgeColor}${rpad(`${edgeSize > 0 ? '+' : ''}${edgeSize.toFixed(0)}`, 7)}${c.reset}` +
        rpad(spreadStr, 8) +
        `${liqColor}${rpad(liqStr, 8)}${c.reset}` +
        `  ${signalColor}${signal}${c.reset}`
      )
    }
    console.log('')
  } else if (allEdges.length === 0) {
    console.log(`\n${c.dim}No thesis edges found.${c.reset}\n`)
  }
}
