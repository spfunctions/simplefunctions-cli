import { getBalance } from '../kalshi.js'
import { c } from '../utils.js'

export async function balanceCommand(opts: { json?: boolean }): Promise<void> {
  const result = await getBalance()
  if (!result) throw new Error('Kalshi not configured. Set KALSHI_API_KEY_ID + KALSHI_PRIVATE_KEY_PATH.')

  if (opts.json) {
    console.log(JSON.stringify(result, null, 2))
    return
  }

  console.log(`${c.bold}${c.cyan}Kalshi Account${c.reset}`)
  console.log(`  Balance:         $${result.balance.toFixed(2)}`)
  console.log(`  Portfolio Value: $${result.portfolioValue.toFixed(2)}`)
}
