import { c } from '../utils.js'

const KALSHI_API_BASE = 'https://api.elections.kalshi.com/trade-api/v2'

export async function scheduleCommand(opts: { json?: boolean }): Promise<void> {
  const statusRes = await fetch(`${KALSHI_API_BASE}/exchange/status`, {
    headers: { 'Accept': 'application/json' },
  })
  if (!statusRes.ok) throw new Error(`Exchange API ${statusRes.status}`)
  const status = await statusRes.json()

  let schedule: any = null
  try {
    const schedRes = await fetch(`${KALSHI_API_BASE}/exchange/schedule`, {
      headers: { 'Accept': 'application/json' },
    })
    if (schedRes.ok) schedule = await schedRes.json()
  } catch { /* schedule endpoint may not exist */ }

  if (opts.json) {
    console.log(JSON.stringify({ status, schedule }, null, 2))
    return
  }

  const trading = status.exchange_active ? `${c.green}OPEN${c.reset}` : `${c.red}CLOSED${c.reset}`
  console.log()
  console.log(`  ${c.bold}${c.cyan}Exchange Status${c.reset}`)
  console.log(`  ${c.dim}${'─'.repeat(30)}${c.reset}`)
  console.log(`  Trading: ${trading}`)
  if (status.trading_active !== undefined) {
    console.log(`  Trading Active: ${status.trading_active ? 'yes' : 'no'}`)
  }
  if (schedule?.schedule) {
    console.log(`  Schedule: ${JSON.stringify(schedule.schedule).slice(0, 100)}`)
  }
  console.log()
}
