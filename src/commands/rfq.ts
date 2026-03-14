import { createRFQ } from '../kalshi.js'
import { requireTrading } from '../config.js'
import { c } from '../utils.js'

export async function rfqCommand(
  ticker: string,
  qty: string,
  opts: { targetCost?: string; restRemainder?: boolean; json?: boolean }
): Promise<void> {
  requireTrading()
  const quantity = parseInt(qty)
  if (isNaN(quantity) || quantity <= 0) throw new Error('Quantity must be a positive integer')

  console.log()
  console.log(`  ${c.bold}${c.cyan}Request for Quote${c.reset}`)
  console.log(`  ${c.dim}${'─'.repeat(30)}${c.reset}`)
  console.log(`  Market:          ${ticker}`)
  console.log(`  Contracts:       ${quantity}`)
  if (opts.targetCost) console.log(`  Target cost:     ${opts.targetCost}¢/contract`)
  console.log(`  Rest remainder:  ${opts.restRemainder ? 'yes' : 'no'}`)
  console.log()

  try {
    const result = await createRFQ({
      market_ticker: ticker,
      contracts: quantity,
      rest_remainder: opts.restRemainder || false,
      ...(opts.targetCost ? { target_cost_centi_cents: parseInt(opts.targetCost) * 100 } : {}),
    })

    console.log(`  ${c.green}✓${c.reset} RFQ created: ${(result as any).id || (result as any).rfq_id || 'OK'}`)
    console.log()
  } catch (err: any) {
    console.error(`\n  ${c.red}✗${c.reset} ${err.message}\n`)
    process.exit(1)
  }
}
