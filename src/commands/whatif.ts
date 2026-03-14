/**
 * sf whatif — What-if scenario analysis.
 *
 * Pure computation, zero LLM cost. Answers:
 * "If node X drops to 10%, what happens to my edges and positions?"
 *
 * Usage:
 *   sf whatif f582bf76 --set "n1=0.1"
 *   sf whatif f582bf76 --set "n1=0.1" --set "n3.1=0.2"
 *   sf whatif f582bf76 --set "n1=0.1" --json
 */

import { SFClient } from '../client.js'
import { getPositions, getMarketPrice } from '../kalshi.js'
import { c } from '../utils.js'

// Inline what-if simulation (mirrors server-side logic, zero dependency)
function simulateWhatIf(ctx: any, overrides: Array<{ nodeId: string; newProbability: number }>) {
  const allNodes: any[] = []
  function flatten(nodes: any[]) {
    for (const n of nodes) {
      allNodes.push(n)
      if (n.children?.length) flatten(n.children)
    }
  }
  const rawNodes = ctx.causalTree?.nodes || []
  flatten(rawNodes)
  // Top-level nodes only (depth=0 or no depth field + no dot in id)
  const treeNodes = rawNodes.filter((n: any) => n.depth === 0 || (n.depth === undefined && !n.id.includes('.')))

  const overrideMap = new Map(overrides.map(o => [o.nodeId, o.newProbability]))
  const overrideDetails = overrides.map(o => {
    const node = allNodes.find((n: any) => n.id === o.nodeId)
    return {
      nodeId: o.nodeId,
      oldProb: node?.probability ?? 0,
      newProb: o.newProbability,
      label: node?.label || o.nodeId,
    }
  })

  // Confidence (only top-level nodes)
  const oldConf = treeNodes.reduce((s: number, n: any) => s + (n.probability || 0) * (n.importance || 0), 0)
  const newConf = treeNodes.reduce((s: number, n: any) => {
    const p = overrideMap.get(n.id) ?? n.probability ?? 0
    return s + p * (n.importance || 0)
  }, 0)

  // Per-node override ratios — only scale edges directly related to overridden nodes.
  // No global scale: edges unrelated to any override stay unchanged.
  // User must explicitly override each node they think is affected.
  const nodeScales = new Map<string, number>()
  for (const [nodeId, newProb] of overrideMap.entries()) {
    const node = allNodes.find((n: any) => n.id === nodeId)
    if (node && node.probability > 0) {
      nodeScales.set(nodeId, Math.max(0, Math.min(2, newProb / node.probability)))
    }
  }

  // Edges
  const edges = (ctx.edges || []).map((edge: any) => {
    const relNode = edge.relatedNodeId
    let scaleFactor = 1 // default: no change

    // Only scale if edge's related node (or its ancestor) was overridden
    if (relNode) {
      const candidates = [relNode, relNode.split('.').slice(0, -1).join('.'), relNode.split('.')[0]].filter(Boolean)
      for (const cid of candidates) {
        if (nodeScales.has(cid)) {
          scaleFactor = nodeScales.get(cid)!
          break
        }
      }
    }

    const mkt = edge.marketPrice || 0
    const oldTP = edge.thesisPrice || edge.thesisImpliedPrice || mkt
    const oldEdge = edge.edge || edge.edgeSize || 0
    const premium = oldTP - mkt
    const newTP = Math.round((mkt + premium * scaleFactor) * 100) / 100
    const dir = edge.direction || 'yes'
    const newEdge = Math.round((dir === 'yes' ? newTP - mkt : mkt - newTP) * 100) / 100
    const delta = Math.round((newEdge - oldEdge) * 100) / 100

    let signal = 'unchanged'
    if (Math.abs(delta) < 1) signal = 'unchanged'
    else if ((oldEdge > 0 && newEdge < 0) || (oldEdge < 0 && newEdge > 0)) signal = 'reversed'
    else if (Math.abs(newEdge) < 2) signal = 'gone'
    else if (Math.abs(newEdge) < Math.abs(oldEdge)) signal = 'reduced'

    return {
      marketId: edge.marketId,
      market: edge.market || edge.marketTitle || edge.marketId,
      venue: edge.venue,
      direction: dir,
      marketPrice: mkt,
      oldThesisPrice: oldTP,
      newThesisPrice: newTP,
      oldEdge,
      newEdge,
      delta,
      signal,
      relatedNodeId: relNode,
    }
  })

  edges.sort((a: any, b: any) => Math.abs(b.delta) - Math.abs(a.delta))

  return {
    overrides: overrideDetails,
    oldConfidence: oldConf,
    newConfidence: newConf,
    confidenceDelta: Math.round((newConf - oldConf) * 100) / 100,
    edges,
  }
}

export async function whatifCommand(
  thesisId: string,
  opts: {
    set?: string[]
    json?: boolean
    apiKey?: string
    apiUrl?: string
  }
): Promise<void> {
  if (!opts.set || opts.set.length === 0) {
    throw new Error('Usage: sf whatif <thesisId> --set "n1=0.1" [--set "n3=0.5"]')
  }

  // Parse overrides
  const overrides = opts.set.map(s => {
    const [nodeId, valStr] = s.split('=')
    if (!nodeId || !valStr) throw new Error(`Invalid override: "${s}". Format: nodeId=probability`)
    const prob = parseFloat(valStr)
    if (isNaN(prob) || prob < 0 || prob > 1) throw new Error(`Invalid probability: "${valStr}". Must be 0-1.`)
    return { nodeId: nodeId.trim(), newProbability: prob }
  })

  const client = new SFClient(opts.apiKey, opts.apiUrl)
  const ctx = await client.getContext(thesisId)

  const result = simulateWhatIf(ctx, overrides)

  if (opts.json) {
    console.log(JSON.stringify(result, null, 2))
    return
  }

  // Render
  console.log()
  console.log(`${c.bold}${c.cyan}WHAT-IF Scenario${c.reset}`)
  console.log(`${c.dim}${'─'.repeat(65)}${c.reset}`)

  // Overrides
  for (const o of result.overrides) {
    const oldPct = Math.round(o.oldProb * 100)
    const newPct = Math.round(o.newProb * 100)
    const arrow = newPct > oldPct ? c.green + '↑' + c.reset : c.red + '↓' + c.reset
    console.log(`  ${c.cyan}${o.nodeId}${c.reset} ${o.label.slice(0, 40)}`)
    console.log(`    ${oldPct}% ${arrow} ${c.bold}${newPct}%${c.reset}`)
  }

  // Confidence
  const oldPct = Math.round(result.oldConfidence * 100)
  const newPct = Math.round(result.newConfidence * 100)
  const deltaSign = result.confidenceDelta > 0 ? '+' : ''
  const confColor = result.confidenceDelta >= 0 ? c.green : c.red
  console.log()
  console.log(`  Confidence: ${oldPct}% → ${confColor}${c.bold}${newPct}%${c.reset} (${confColor}${deltaSign}${Math.round(result.confidenceDelta * 100)}${c.reset})`)
  console.log()

  // Edges
  const affected = result.edges.filter((e: any) => e.signal !== 'unchanged')
  if (affected.length === 0) {
    console.log(`  ${c.dim}No edges affected.${c.reset}`)
  } else {
    console.log(`  ${c.bold}Edges Affected${c.reset}`)
    console.log(`  ${'Market'.padEnd(35)} ${'Now'.padEnd(6)} ${'Edge'.padEnd(8)} ${'→'.padEnd(3)} ${'New Edge'.padEnd(8)} Signal`)
    console.log(`  ${c.dim}${'─'.repeat(65)}${c.reset}`)

    for (const e of affected) {
      const name = (e.market || e.marketId).slice(0, 33).padEnd(35)
      const mkt = `${Math.round(e.marketPrice)}¢`.padEnd(6)
      const oldE = `${e.oldEdge > 0 ? '+' : ''}${Math.round(e.oldEdge)}`.padEnd(8)
      const newE = `${e.newEdge > 0 ? '+' : ''}${Math.round(e.newEdge)}`.padEnd(8)
      let signalStr: string
      switch (e.signal) {
        case 'reversed': signalStr = `${c.red}${c.bold}REVERSED${c.reset}`; break
        case 'gone': signalStr = `${c.red}GONE${c.reset}`; break
        case 'reduced': signalStr = `${c.dim}reduced${c.reset}`; break
        default: signalStr = `${c.dim}-${c.reset}`
      }
      console.log(`  ${c.dim}${name}${c.reset} ${mkt} ${oldE} → ${newE} ${signalStr}`)
    }
  }

  // Position risk (if positions available)
  try {
    const positions = await getPositions()
    if (positions && positions.length > 0) {
      const edgeMap = new Map<string, any>(result.edges.map((e: any) => [e.marketId, e]))
      const atRisk = positions.filter((p: any) => {
        const e: any = edgeMap.get(p.ticker)
        return e && (e.signal === 'reversed' || e.signal === 'gone')
      })

      if (atRisk.length > 0) {
        console.log()
        console.log(`  ${c.red}${c.bold}⚠ Positions at Risk${c.reset}`)
        for (const p of atRisk) {
          const e: any = edgeMap.get(p.ticker)!
          const livePrice = await getMarketPrice(p.ticker)
          const currentPnl = livePrice !== null
            ? ((livePrice - p.average_price_paid) * p.quantity / 100).toFixed(2)
            : '?'
          console.log(`  ${c.red}${p.ticker}${c.reset}  ${p.quantity} ${p.side}  P&L $${currentPnl}  edge ${e.oldEdge > 0 ? '+' : ''}${Math.round(e.oldEdge)} → ${c.red}${e.newEdge > 0 ? '+' : ''}${Math.round(e.newEdge)}${c.reset}`)
        }
      }
    }
  } catch { /* positions not available, skip */ }

  console.log()
}
