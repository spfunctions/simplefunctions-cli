import { getOrders } from '../kalshi.js'
import { c } from '../utils.js'

export async function ordersCommand(opts: {
  status?: string
  json?: boolean
}): Promise<void> {
  const status = opts.status || 'resting'
  const result = await getOrders({ status, limit: 100 })
  if (!result) throw new Error('Kalshi not configured. Set KALSHI_API_KEY_ID + KALSHI_PRIVATE_KEY_PATH.')

  if (opts.json) {
    console.log(JSON.stringify(result.orders, null, 2))
    return
  }

  if (result.orders.length === 0) {
    console.log(`${c.dim}No ${status} orders.${c.reset}`)
    return
  }

  console.log(`${c.bold}${c.cyan}Orders (${status})${c.reset}`)
  console.log(`${c.dim}${'─'.repeat(80)}${c.reset}`)

  for (const o of result.orders) {
    const price = o.yes_price_dollars ? `${parseFloat(o.yes_price_dollars) * 100}¢` : `${o.yes_price || '?'}¢`
    const side = o.side === 'yes' ? `${c.green}YES${c.reset}` : `${c.red}NO${c.reset}`
    const remaining = o.remaining_count_fp || o.remaining_count || '?'
    console.log(`  ${(o.ticker || '').padEnd(35)} ${side} ${price.padEnd(8)} qty ${remaining}`)
  }
  console.log(`\n${c.dim}${result.orders.length} order(s)${c.reset}`)
}
