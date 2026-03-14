import { getFills } from '../kalshi.js'
import { c } from '../utils.js'

export async function fillsCommand(opts: {
  ticker?: string
  json?: boolean
}): Promise<void> {
  const result = await getFills({ ticker: opts.ticker, limit: 50 })
  if (!result) throw new Error('Kalshi not configured. Set KALSHI_API_KEY_ID + KALSHI_PRIVATE_KEY_PATH.')

  if (opts.json) {
    console.log(JSON.stringify(result.fills, null, 2))
    return
  }

  if (result.fills.length === 0) {
    console.log(`${c.dim}No fills.${c.reset}`)
    return
  }

  console.log(`${c.bold}${c.cyan}Recent Fills${c.reset}`)
  console.log(`${c.dim}${'─'.repeat(80)}${c.reset}`)

  for (const f of result.fills) {
    const price = f.yes_price_dollars ? `${parseFloat(f.yes_price_dollars) * 100}¢` : `${f.yes_price || '?'}¢`
    const side = f.side === 'yes' ? `${c.green}YES${c.reset}` : `${c.red}NO${c.reset}`
    const action = f.action || 'buy'
    const count = f.count_fp || f.count || '?'
    const time = f.created_time ? new Date(f.created_time).toLocaleString() : ''
    console.log(`  ${(f.ticker || '').padEnd(35)} ${action.padEnd(5)} ${side} ${price.padEnd(8)} x${count}  ${c.dim}${time}${c.reset}`)
  }
  console.log(`\n${c.dim}${result.fills.length} fill(s)${c.reset}`)
}
