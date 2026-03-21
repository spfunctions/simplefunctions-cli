import { SFClient } from '../client.js'
import { c, pad, rpad, pct, shortId, shortDate, trunc, hr } from '../utils.js'

export async function listCommand(opts: { json?: boolean; apiKey?: string; apiUrl?: string }): Promise<void> {
  const client = new SFClient(opts.apiKey, opts.apiUrl)
  const { theses } = await client.listTheses()

  if (opts.json) {
    console.log(JSON.stringify(theses, null, 2))
    return
  }

  if (theses.length === 0) {
    console.log(`${c.dim}No theses found.${c.reset}`)
    return
  }

  console.log(
    `\n${c.bold}` +
    pad('ID', 12) +
    pad('Status', 10) +
    rpad('Conf', 6) +
    '  ' +
    pad('Updated', 14) +
    '  Title' +
    c.reset
  )
  hr(90)

  for (const t of theses) {
    const statusColor = t.status === 'active' ? c.green : t.status === 'forming' ? c.yellow : c.dim
    const conf = t.confidence ? pct(parseFloat(t.confidence)) : '-'

    console.log(
      pad(shortId(t.id), 12) +
      statusColor + pad(t.status, 10) + c.reset +
      rpad(conf, 6) +
      '  ' +
      c.dim + pad(shortDate(t.updatedAt), 14) + c.reset +
      '  ' +
      trunc(t.title || t.rawThesis.slice(0, 60), 50)
    )
  }

  console.log(`\n${c.dim}${theses.length} thesis(es)${c.reset}`)
}
