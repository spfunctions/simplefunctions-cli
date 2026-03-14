import { SFClient } from '../client.js'
import { c, pct, delta, shortDate } from '../utils.js'

export async function evaluateCommand(
  id: string,
  opts: { apiKey?: string; apiUrl?: string }
): Promise<void> {
  const client = new SFClient(opts.apiKey, opts.apiUrl)
  console.log(`${c.dim}Triggering deep evaluation (heavy model)...${c.reset}`)

  const result = await client.evaluate(id)

  console.log(`\n${c.green}✓${c.reset} Evaluation complete`)
  if (result.evaluation) {
    const ev = result.evaluation
    if (ev.confidenceDelta !== undefined) {
      const d = ev.confidenceDelta
      const dColor = d > 0 ? c.green : d < 0 ? c.red : c.dim
      console.log(`  ${c.bold}Confidence:${c.reset} ${pct(ev.previousConfidence)} → ${pct(ev.newConfidence)} ${dColor}(${delta(d)})${c.reset}`)
    }
    if (ev.summary) {
      console.log(`\n  ${ev.summary}`)
    }
    if (ev.positionUpdates && ev.positionUpdates.length > 0) {
      console.log(`\n  ${c.bold}Position Recommendations:${c.reset}`)
      for (const pu of ev.positionUpdates) {
        const recColor = pu.recommendation === 'hold' ? c.dim : pu.recommendation === 'close' ? c.red : c.yellow
        console.log(`    [${pu.positionId.slice(0, 8)}] ${recColor}${pu.recommendation}${c.reset} — ${pu.reason}`)
      }
    }
  }
  console.log('')
}
