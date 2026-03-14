import { SFClient } from '../client.js'
import { c } from '../utils.js'

const KALSHI_API_BASE = 'https://api.elections.kalshi.com/trade-api/v2'

export async function milestonesCommand(opts: {
  category?: string
  thesis?: string
  hours?: string
  json?: boolean
  apiKey?: string
  apiUrl?: string
}): Promise<void> {
  const hours = parseInt(opts.hours || '168')
  const now = new Date()
  const cutoff = new Date(now.getTime() + hours * 3600000)

  // Fetch milestones (public endpoint)
  const url = `${KALSHI_API_BASE}/milestones?limit=200&minimum_start_date=${now.toISOString()}` +
    (opts.category ? `&category=${opts.category}` : '')
  const res = await fetch(url, { headers: { 'Accept': 'application/json' } })
  if (!res.ok) throw new Error(`Kalshi API ${res.status}`)
  const data = await res.json()

  let milestones = (data.milestones || []).filter((m: any) =>
    new Date(m.start_date).getTime() <= cutoff.getTime()
  )

  // If thesis specified, filter to matching event tickers
  if (opts.thesis) {
    const client = new SFClient(opts.apiKey, opts.apiUrl)
    const ctx = await client.getContext(opts.thesis)
    const edgeEventTickers = new Set(
      (ctx.edges || []).map((e: any) => e.eventTicker).filter(Boolean)
    )
    // Also match by related_event_tickers overlap
    const edgeSeriesTickers = new Set(
      (ctx.edges || []).map((e: any) => e.seriesTicker).filter(Boolean)
    )

    milestones = milestones.filter((m: any) => {
      const related = m.related_event_tickers || m.primary_event_tickers || []
      return related.some((t: string) =>
        edgeEventTickers.has(t) || edgeSeriesTickers.has(t.split('-')[0])
      )
    })
  }

  if (opts.json) {
    console.log(JSON.stringify(milestones, null, 2))
    return
  }

  if (milestones.length === 0) {
    console.log(`${c.dim}No milestones in the next ${hours} hours.${c.reset}`)
    return
  }

  // Sort by date
  milestones.sort((a: any, b: any) => new Date(a.start_date).getTime() - new Date(b.start_date).getTime())

  console.log(`${c.bold}${c.cyan}Upcoming Milestones (next ${hours}h)${c.reset}`)
  console.log(`${c.dim}${'─'.repeat(80)}${c.reset}`)

  for (const m of milestones) {
    const date = new Date(m.start_date)
    const hoursUntil = Math.round((date.getTime() - now.getTime()) / 3600000)
    const timeStr = hoursUntil <= 24
      ? `${c.bold}${hoursUntil}h${c.reset}`
      : `${c.dim}${Math.round(hoursUntil / 24)}d${c.reset}`
    const cat = `${c.dim}[${m.category}]${c.reset}`
    const tickers = (m.related_event_tickers || []).slice(0, 3).join(', ')
    console.log(`  ${timeStr.padEnd(12)} ${cat.padEnd(25)} ${m.title}`)
    if (tickers) console.log(`  ${' '.repeat(10)} ${c.dim}${tickers}${c.reset}`)
  }
  console.log(`\n${c.dim}${milestones.length} milestone(s)${c.reset}`)
}
