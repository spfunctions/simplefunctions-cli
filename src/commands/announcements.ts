import { getExchangeAnnouncements } from '../kalshi.js'
import { c } from '../utils.js'

export async function announcementsCommand(opts: { json?: boolean }): Promise<void> {
  const announcements = await getExchangeAnnouncements()

  if (opts.json) {
    console.log(JSON.stringify(announcements, null, 2))
    return
  }

  if (announcements.length === 0) {
    console.log(`${c.dim}No announcements.${c.reset}`)
    return
  }

  console.log(`${c.bold}${c.cyan}Exchange Announcements${c.reset}`)
  console.log(`${c.dim}${'─'.repeat(70)}${c.reset}`)

  for (const a of announcements.slice(0, 20)) {
    const time = a.created_time ? new Date(a.created_time).toLocaleDateString() : ''
    const type = a.type ? `[${a.type}]` : ''
    console.log(`  ${c.dim}${time}${c.reset}  ${type} ${a.title || a.message || ''}`)
    if (a.body) {
      const body = String(a.body).slice(0, 120)
      console.log(`    ${c.dim}${body}${c.reset}`)
    }
  }
  console.log(`\n${c.dim}${announcements.length} announcement(s)${c.reset}`)
}
