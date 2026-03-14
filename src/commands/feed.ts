/**
 * sf feed — Evaluation history stream.
 *
 * Shows what the heartbeat engine has been thinking.
 * One line per evaluation cycle, newest first.
 */

import { SFClient } from '../client.js'
import { c } from '../utils.js'

export async function feedCommand(opts: {
  hours?: string
  thesis?: string
  json?: boolean
  apiKey?: string
  apiUrl?: string
}): Promise<void> {
  const client = new SFClient(opts.apiKey, opts.apiUrl)
  const hours = parseInt(opts.hours || '24')

  const data = await client.getFeed(hours, 200)
  let feed: any[] = data.feed || []

  if (feed.length === 0) {
    console.log(`${c.dim}No evaluations in the last ${hours} hours.${c.reset}`)
    return
  }

  // Filter by thesis if specified
  if (opts.thesis) {
    feed = feed.filter((e: any) =>
      e.thesisId.startsWith(opts.thesis!) || e.thesisShortId === opts.thesis
    )
    if (feed.length === 0) {
      console.log(`${c.dim}No evaluations for ${opts.thesis} in the last ${hours} hours.${c.reset}`)
      return
    }
  }

  if (opts.json) {
    console.log(JSON.stringify(feed, null, 2))
    return
  }

  // Render feed
  console.log()
  console.log(`${c.bold}${c.cyan}Evaluation Feed${c.reset}${c.dim} — last ${hours}h, ${feed.length} cycles${c.reset}`)
  console.log(`${c.dim}${'─'.repeat(75)}${c.reset}`)

  for (const entry of feed) {
    const time = new Date(entry.evaluatedAt)
    const timeStr = time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

    // Confidence + delta
    const conf = Math.round(entry.confidence * 100)
    const delta = Math.round(entry.delta * 100)
    let deltaStr: string
    if (delta > 0) {
      deltaStr = `${c.green}+${delta}%${c.reset}`
    } else if (delta < 0) {
      deltaStr = `${c.red}${delta}%${c.reset}`
    } else {
      deltaStr = `${c.dim}0%${c.reset}`
    }

    // Thesis ID (short)
    const id = entry.thesisShortId || entry.thesisId?.slice(0, 8) || '?'

    // Summary — truncate to fit one line
    const summary = (entry.summary || 'No summary').replace(/\n/g, ' ').slice(0, 80)

    // Node changes
    const nodes = entry.updatedNodes as any[] || []
    const nodeStr = nodes.length > 0
      ? nodes.slice(0, 3).map((n: any) =>
          `${n.nodeId}→${Math.round((n.newProb || 0) * 100)}%`
        ).join(', ')
      : ''

    // Format line
    console.log(
      `${c.dim}[${timeStr}]${c.reset} ` +
      `${c.cyan}${id}${c.reset} ` +
      `${conf}% (${deltaStr})  ` +
      `${c.dim}${summary}${c.reset}`
    )
    if (nodeStr) {
      console.log(`${' '.repeat(9)} ${c.dim}nodes: ${nodeStr}${c.reset}`)
    }
  }

  console.log(`${c.dim}${'─'.repeat(75)}${c.reset}`)
  console.log()
}
