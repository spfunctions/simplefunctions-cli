import { SFClient } from '../client.js'
import { c } from '../utils.js'

export async function signalCommand(
  id: string,
  content: string,
  opts: { type?: string; apiKey?: string; apiUrl?: string }
): Promise<void> {
  const client = new SFClient(opts.apiKey, opts.apiUrl)
  const type = opts.type || 'user_note'

  const result = await client.injectSignal(id, type, content, 'cli')

  console.log(`${c.green}✓${c.reset} Signal injected`)
  console.log(`  ${c.bold}Type:${c.reset}    ${type}`)
  console.log(`  ${c.bold}Source:${c.reset}  cli`)
  console.log(`  ${c.bold}Content:${c.reset} ${content}`)
  if (result.signalId) {
    console.log(`  ${c.bold}ID:${c.reset}      ${result.signalId}`)
  }
  // Calculate minutes until next 15-min cron cycle (runs at :00, :15, :30, :45)
  const now = new Date()
  const minute = now.getMinutes()
  const nextCycleMin = Math.ceil((minute + 1) / 15) * 15
  const minutesUntil = nextCycleMin - minute
  const nextRun = new Date(now)
  nextRun.setMinutes(nextCycleMin % 60, 0, 0)
  if (nextCycleMin >= 60) nextRun.setHours(nextRun.getHours() + 1)
  const timeStr = nextRun.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  console.log(`\n${c.dim}Signal queued. Next monitor cycle in ~${minutesUntil}min (${timeStr}).${c.reset}`)
  console.log(`${c.dim}Or run ${c.reset}sf evaluate ${id}${c.dim} to consume immediately.${c.reset}`)
}
