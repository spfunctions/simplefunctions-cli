import { getForecastHistory } from '../kalshi.js'
import { c } from '../utils.js'

const KALSHI_API_BASE = 'https://api.elections.kalshi.com/trade-api/v2'

export async function forecastCommand(eventTicker: string, opts: {
  days?: string
  json?: boolean
}): Promise<void> {
  const days = parseInt(opts.days || '7')

  // Get series ticker from event
  const evtRes = await fetch(`${KALSHI_API_BASE}/events/${eventTicker}`, {
    headers: { 'Accept': 'application/json' },
  })
  if (!evtRes.ok) throw new Error(`Event not found: ${eventTicker}`)
  const evtData = await evtRes.json()
  const seriesTicker = evtData.event?.series_ticker
  if (!seriesTicker) throw new Error(`No series_ticker for ${eventTicker}`)

  // Align timestamps to midnight UTC — Kalshi API rejects unaligned/future timestamps
  const todayMidnight = new Date()
  todayMidnight.setUTCHours(0, 0, 0, 0)
  const endTs = Math.floor(todayMidnight.getTime() / 1000)
  const startTs = endTs - days * 86400

  const history = await getForecastHistory({
    seriesTicker,
    eventTicker,
    percentiles: [5000, 7500, 9000],
    startTs,
    endTs,
    periodInterval: 1440,
  })

  if (!history || history.length === 0) {
    console.log(`${c.dim}No forecast data for ${eventTicker}${c.reset}`)
    return
  }

  if (opts.json) {
    console.log(JSON.stringify(history, null, 2))
    return
  }

  console.log(`${c.bold}${c.cyan}Forecast: ${evtData.event?.title || eventTicker}${c.reset}`)
  console.log(`${c.dim}Series: ${seriesTicker} | ${days} days${c.reset}`)
  console.log()
  console.log(`${c.bold}${'Date'.padEnd(14)} ${'P50'.padEnd(12)} ${'P75'.padEnd(12)} P90${c.reset}`)
  console.log(`${c.dim}${'─'.repeat(52)}${c.reset}`)

  for (const point of history) {
    const date = new Date(point.end_period_ts * 1000).toISOString().slice(0, 10)
    const pts = point.percentile_points || []
    const p50 = pts.find((p: any) => p.percentile === 5000)?.formatted_forecast || '-'
    const p75 = pts.find((p: any) => p.percentile === 7500)?.formatted_forecast || '-'
    const p90 = pts.find((p: any) => p.percentile === 9000)?.formatted_forecast || '-'
    console.log(`  ${date.padEnd(14)} ${p50.padEnd(12)} ${p75.padEnd(12)} ${p90}`)
  }
}
