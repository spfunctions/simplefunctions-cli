import { getSettlements } from '../kalshi.js'
import { SFClient } from '../client.js'
import { c } from '../utils.js'

export async function settlementsCommand(opts: {
  thesis?: string
  json?: boolean
  apiKey?: string
  apiUrl?: string
}): Promise<void> {
  // Paginate through all settlements
  const all: any[] = []
  let cursor = ''
  do {
    const result = await getSettlements({ limit: 200, cursor: cursor || undefined })
    if (!result) throw new Error('Kalshi not configured. Set KALSHI_API_KEY_ID + KALSHI_PRIVATE_KEY_PATH.')
    all.push(...result.settlements)
    cursor = result.cursor
  } while (cursor)

  let filtered = all

  if (opts.thesis) {
    const client = new SFClient(opts.apiKey, opts.apiUrl)
    const ctx = await client.getContext(opts.thesis)
    const edgeTickers = new Set((ctx.edges || []).map((e: any) => e.marketId))
    filtered = all.filter((s: any) => edgeTickers.has(s.ticker))
  }

  if (opts.json) {
    console.log(JSON.stringify(filtered, null, 2))
    return
  }

  if (filtered.length === 0) {
    console.log(`${c.dim}No settlements found.${c.reset}`)
    return
  }

  console.log(`${c.bold}${c.cyan}Settlements${c.reset}`)
  console.log(`${c.dim}${'─'.repeat(80)}${c.reset}`)
  console.log(`${c.bold}${'Ticker'.padEnd(35)} ${'Result'.padEnd(8)} ${'Revenue'.padEnd(10)} ${'Cost'.padEnd(10)} P&L${c.reset}`)

  let totalPnl = 0
  for (const s of filtered.slice(0, 50)) {
    const revenue = parseFloat(s.revenue || s.revenue_dollars || '0')
    const cost = parseFloat(s.yes_total_cost || s.yes_total_cost_dollars || '0') +
                 parseFloat(s.no_total_cost || s.no_total_cost_dollars || '0')
    const pnl = revenue - cost
    totalPnl += pnl
    const pnlStr = pnl >= 0 ? `${c.green}+$${pnl.toFixed(2)}${c.reset}` : `${c.red}-$${Math.abs(pnl).toFixed(2)}${c.reset}`
    const result = s.market_result || '-'
    console.log(`  ${(s.ticker || '').slice(0, 33).padEnd(35)} ${result.padEnd(8)} $${revenue.toFixed(2).padEnd(9)} $${cost.toFixed(2).padEnd(9)} ${pnlStr}`)
  }
  console.log(`${c.dim}${'─'.repeat(80)}${c.reset}`)
  const totalStr = totalPnl >= 0 ? `${c.green}+$${totalPnl.toFixed(2)}${c.reset}` : `${c.red}-$${Math.abs(totalPnl).toFixed(2)}${c.reset}`
  console.log(`  Total: ${totalStr}  (${filtered.length} settlements)`)
}
