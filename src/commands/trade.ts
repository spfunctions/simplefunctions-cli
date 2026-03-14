import { createOrder } from '../kalshi.js'
import { requireTrading } from '../config.js'
import { c } from '../utils.js'

export async function buyCommand(
  ticker: string,
  qty: string,
  opts: { price?: string; market?: boolean; side?: string; yesIAmSure?: boolean }
): Promise<void> {
  requireTrading()
  await executeOrder(ticker, qty, 'buy', opts)
}

export async function sellCommand(
  ticker: string,
  qty: string,
  opts: { price?: string; market?: boolean; side?: string; yesIAmSure?: boolean }
): Promise<void> {
  requireTrading()
  await executeOrder(ticker, qty, 'sell', opts)
}

async function executeOrder(
  ticker: string,
  qty: string,
  action: 'buy' | 'sell',
  opts: { price?: string; market?: boolean; side?: string; yesIAmSure?: boolean }
): Promise<void> {
  const quantity = parseInt(qty)
  if (isNaN(quantity) || quantity <= 0) throw new Error('Quantity must be a positive integer')

  const side = (opts.side || 'yes') as 'yes' | 'no'
  const orderType = opts.market ? 'market' : 'limit'

  if (orderType === 'limit' && !opts.price) {
    throw new Error('Limit order requires --price <cents>. Use --market for market orders.')
  }

  const priceCents = opts.price ? parseInt(opts.price) : undefined
  if (priceCents !== undefined && (priceCents < 1 || priceCents > 99)) {
    throw new Error('Price must be 1-99 cents.')
  }
  const maxCost = ((priceCents || 99) * quantity / 100).toFixed(2)

  console.log()
  console.log(`  ${c.bold}${c.cyan}${action.toUpperCase()} Order${c.reset}`)
  console.log(`  ${c.dim}${'─'.repeat(35)}${c.reset}`)
  console.log(`  Ticker:    ${ticker}`)
  console.log(`  Side:      ${side === 'yes' ? c.green + 'YES' + c.reset : c.red + 'NO' + c.reset}`)
  console.log(`  Quantity:  ${quantity}`)
  console.log(`  Type:      ${orderType}`)
  if (priceCents) console.log(`  Price:     ${priceCents}¢`)
  console.log(`  Max cost:  $${maxCost}`)
  console.log()

  if (!opts.yesIAmSure) {
    for (let i = 3; i > 0; i--) {
      process.stdout.write(`  Executing in ${i}...  (Ctrl+C to cancel)\r`)
      await new Promise(r => setTimeout(r, 1000))
    }
    process.stdout.write('  Executing...                              \n')
  }

  try {
    const result = await createOrder({
      ticker,
      side,
      action,
      type: orderType,
      count: quantity,
      ...(priceCents ? { yes_price: priceCents } : {}),
    })

    const order = result.order || result
    console.log()
    console.log(`  ${c.green}✓${c.reset} Order placed: ${order.order_id || 'OK'}`)
    if (order.status) console.log(`  Status: ${order.status}`)
    if (order.fill_count_fp) console.log(`  Filled: ${order.fill_count_fp}/${order.initial_count_fp || quantity}`)
    console.log()
  } catch (err: any) {
    const msg = err.message || String(err)
    if (msg.includes('403')) {
      console.error(`\n  ${c.red}✗${c.reset} 403 Forbidden — your Kalshi key lacks write permission.`)
      console.error(`  Get a read+write key at https://kalshi.com/account/api-keys\n`)
    } else {
      console.error(`\n  ${c.red}✗${c.reset} ${msg}\n`)
    }
    process.exit(1)
  }
}
