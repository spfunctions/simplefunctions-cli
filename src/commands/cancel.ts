import { cancelOrder, batchCancelOrders, getOrders } from '../kalshi.js'
import { requireTrading } from '../config.js'
import { c } from '../utils.js'

export async function cancelCommand(
  orderId: string | undefined,
  opts: { all?: boolean; ticker?: string; yesIAmSure?: boolean }
): Promise<void> {
  requireTrading()

  if (opts.all) {
    const result = await getOrders({ status: 'resting', limit: 200 })
    if (!result) throw new Error('Kalshi not configured.')

    let toCancel = result.orders
    if (opts.ticker) {
      toCancel = toCancel.filter((o: any) => (o.ticker || '').startsWith(opts.ticker!))
    }

    if (toCancel.length === 0) {
      console.log(`\n  ${c.dim}No resting orders to cancel.${c.reset}\n`)
      return
    }

    console.log(`\n  Cancelling ${toCancel.length} order(s)...`)

    if (!opts.yesIAmSure) {
      for (let i = 3; i > 0; i--) {
        process.stdout.write(`  Executing in ${i}...  (Ctrl+C to cancel)\r`)
        await new Promise(r => setTimeout(r, 1000))
      }
      process.stdout.write('  Executing...                              \n')
    }

    for (let i = 0; i < toCancel.length; i += 20) {
      const batch = toCancel.slice(i, i + 20).map((o: any) => o.order_id)
      await batchCancelOrders(batch)
    }

    console.log(`\n  ${c.green}✓${c.reset} Cancelled ${toCancel.length} order(s).\n`)
    return
  }

  if (!orderId) {
    throw new Error('Usage: sf cancel <orderId> or sf cancel --all')
  }

  await cancelOrder(orderId)
  console.log(`\n  ${c.green}✓${c.reset} Order ${orderId} cancelled.\n`)
}
