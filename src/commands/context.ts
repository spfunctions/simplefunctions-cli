import { SFClient } from '../client.js'
import { isKalshiConfigured, getPositions, type KalshiPosition } from '../kalshi.js'
import { c, pct, delta, shortDate, header, pad, rpad } from '../utils.js'

export async function contextCommand(
  id: string,
  opts: { json?: boolean; apiKey?: string; apiUrl?: string }
): Promise<void> {
  const client = new SFClient(opts.apiKey, opts.apiUrl)
  const ctx = await client.getContext(id)

  if (opts.json) {
    console.log(JSON.stringify(ctx, null, 2))
    return
  }

  // Context API shape:
  // { thesisId, thesis, title, status, confidence (number|null),
  //   causalTree: { nodes: FlatNode[] }, edges: Edge[], edgeMeta,
  //   lastEvaluation: { summary, confidenceDelta, ... }, updatedAt, ... }

  // Thesis header
  console.log(`\n${c.bold}Thesis:${c.reset} ${ctx.thesis || ctx.rawThesis || '(unknown)'}`)

  const confStr = ctx.confidence !== null && ctx.confidence !== undefined ? pct(ctx.confidence) : '-'
  const confDelta = ctx.lastEvaluation?.confidenceDelta
  const deltaStr = confDelta ? ` (${delta(confDelta)} since last eval)` : ''
  console.log(`${c.bold}Confidence:${c.reset} ${confStr}${deltaStr}`)
  console.log(`${c.bold}Status:${c.reset} ${ctx.status}`)
  console.log(`${c.bold}Last Updated:${c.reset} ${shortDate(ctx.updatedAt)}`)

  // Causal tree nodes (flat array from API)
  const nodes = ctx.causalTree?.nodes
  if (nodes && nodes.length > 0) {
    header('Causal Tree')
    for (const node of nodes) {
      const indent = '  '.repeat((node.depth || 0) + 1)
      const prob = node.probability !== undefined ? pct(node.probability) : '-'
      const label = node.label || node.id
      console.log(`${indent}${c.cyan}${node.id}${c.reset}  ${pad(label, 40)} ${rpad(prob, 5)}`)
    }
  }

  // Fetch positions if Kalshi is configured (local only, no server)
  let positions: KalshiPosition[] | null = null
  if (isKalshiConfigured()) {
    try {
      positions = await getPositions()
    } catch {
      // silently skip — positions are optional
    }
  }
  const posMap = new Map<string, KalshiPosition>()
  if (positions) {
    for (const p of positions) {
      posMap.set(p.ticker, p)
    }
  }

  // Top edges (sorted by absolute edge size)
  const edges = ctx.edges
  if (edges && edges.length > 0) {
    header('Top Edges (by edge size)')
    const sorted = [...edges].sort((a: any, b: any) => Math.abs(b.edge ?? b.edgeSize ?? 0) - Math.abs(a.edge ?? a.edgeSize ?? 0))
    for (const edge of sorted.slice(0, 10)) {
      const edgeSize: number = edge.edge ?? edge.edgeSize ?? 0
      const edgeColor = edgeSize > 10 ? c.green : edgeSize > 0 ? c.yellow : c.red
      const mktPrice: number = edge.marketPrice ?? edge.currentPrice ?? 0
      const title = edge.market || edge.marketTitle || edge.marketId || '?'

      // Orderbook info (if enriched by rescan)
      const ob = edge.orderbook
      const obStr = ob ? `  ${c.dim}spread ${ob.spread}¢ ${ob.liquidityScore}${c.reset}` : ''

      // Position overlay (if user has Kalshi positions)
      const pos = posMap.get(edge.marketId)
      let posStr = ''
      if (pos) {
        const pnl = pos.unrealized_pnl || 0
        const pnlColor = pnl > 0 ? c.green : pnl < 0 ? c.red : c.dim
        const pnlFmt = pnl >= 0 ? `+$${(pnl / 100).toFixed(0)}` : `-$${(Math.abs(pnl) / 100).toFixed(0)}`
        posStr = `  ${c.cyan}← ${pos.quantity}张 @ ${pos.average_price_paid}¢  ${pnlColor}${pnlFmt}${c.reset}`
      }

      console.log(
        `  ${pad(title, 35)}` +
        `  ${rpad(mktPrice.toFixed(0) + '¢', 5)}` +
        `  ${edgeColor}edge ${edgeSize > 0 ? '+' : ''}${edgeSize.toFixed(1)}${c.reset}` +
        `  ${c.dim}${edge.venue || ''}${c.reset}` +
        obStr +
        posStr
      )
    }
  }

  // Last evaluation summary
  if (ctx.lastEvaluation?.summary) {
    header('Last Evaluation')
    console.log(`  ${c.dim}${shortDate(ctx.lastEvaluation.evaluatedAt)} | model: ${ctx.lastEvaluation.model || ''}${c.reset}`)
    console.log(`  ${ctx.lastEvaluation.summary}`)
    if (ctx.lastEvaluation.positionRecommendations?.length > 0) {
      console.log(`\n  ${c.bold}Position Recommendations:${c.reset}`)
      for (const pr of ctx.lastEvaluation.positionRecommendations) {
        const recColor = pr.recommendation === 'hold' ? c.dim : pr.recommendation === 'close' ? c.red : c.yellow
        console.log(`    [${(pr.positionId || '').slice(0, 8)}] ${recColor}${pr.recommendation}${c.reset} — ${pr.reason}`)
      }
    }
  }

  // Edge meta (last rescan time)
  if (ctx.edgeMeta?.lastRescanAt) {
    console.log(`\n${c.dim}Last rescan: ${shortDate(ctx.edgeMeta.lastRescanAt)}${c.reset}`)
  }

  console.log('')
}
