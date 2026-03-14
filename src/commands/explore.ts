/**
 * sf explore [slug]
 *
 * Browse public theses. No authentication required.
 *
 * Usage:
 *   sf explore                     — List all public theses
 *   sf explore us-iran-war         — View a specific public thesis
 *   sf explore us-iran-war --json  — JSON output (for agents)
 */

const BASE_URL = 'https://simplefunctions.dev'

export async function exploreCommand(
  slug?: string,
  opts?: { json?: boolean }
) {
  if (!slug) {
    // List all public theses
    const res = await fetch(`${BASE_URL}/api/public/theses`)
    if (!res.ok) {
      console.error(`  Error: ${res.status} ${await res.text()}`)
      return
    }
    const { theses } = await res.json()

    if (opts?.json) {
      console.log(JSON.stringify(theses, null, 2))
      return
    }

    console.log('\n  Public Theses\n')
    if (theses.length === 0) {
      console.log('  No public theses yet.\n')
      return
    }

    for (const t of theses) {
      const conf = t.confidence != null ? Math.round(t.confidence * 100) : '?'
      const ret = t.impliedReturn != null ? `${t.impliedReturn > 0 ? '+' : ''}${t.impliedReturn}%` : ''
      console.log(`  ${(t.slug || '').padEnd(35)} ${String(conf).padStart(3)}%  ${ret.padStart(8)}  ${(t.status || '').padEnd(8)} ${(t.title || '').slice(0, 45)}`)
    }
    console.log(`\n  ${theses.length} public theses. Use: sf explore <slug>\n`)
    return
  }

  // View a specific public thesis
  const res = await fetch(`${BASE_URL}/api/public/thesis/${slug}`)
  if (!res.ok) {
    if (res.status === 404) {
      console.error(`  Not found: ${slug}`)
    } else {
      console.error(`  Error: ${res.status} ${await res.text()}`)
    }
    return
  }
  const data = await res.json()

  if (opts?.json) {
    console.log(JSON.stringify(data, null, 2))
    return
  }

  // Formatted output
  const t = data.thesis
  const ir = data.impliedReturns

  console.log(`\n  ${t.title}`)
  console.log(`  ${t.slug} | ${t.confidence != null ? Math.round(t.confidence * 100) : '?'}% | ${t.status} | published ${t.publishedAt?.slice(0, 10) || '?'}`)
  if (t.description) console.log(`  ${t.description}`)
  console.log('')

  // Causal tree
  if (data.causalTree?.nodes?.length) {
    console.log('  Causal Tree')
    for (const n of data.causalTree.nodes) {
      const bar = '█'.repeat(Math.round((n.probability || 0) * 10)) + '░'.repeat(10 - Math.round((n.probability || 0) * 10))
      console.log(`    ${n.id} ${(n.label || '').slice(0, 35).padEnd(35)} ${Math.round((n.probability || 0) * 100)}% ${bar}`)
      if (n.children) {
        for (const c of n.children) {
          const cbar = '█'.repeat(Math.round((c.probability || 0) * 10)) + '░'.repeat(10 - Math.round((c.probability || 0) * 10))
          console.log(`      ${c.id} ${(c.label || '').slice(0, 33).padEnd(33)} ${Math.round((c.probability || 0) * 100)}% ${cbar}`)
        }
      }
    }
    console.log('')
  }

  // Implied returns
  if (ir && ir.edges?.length > 0) {
    console.log(`  Implied Returns (equal-weight, since ${ir.trackedSince?.slice(0, 10) || '?'})`)
    console.log(`  Avg: ${ir.avgReturnPct > 0 ? '+' : ''}${ir.avgReturnPct}% | Win rate: ${ir.winRate}% (${ir.winners}W ${ir.losers}L)`)
    console.log('')

    for (const e of ir.edges.slice(0, 10)) {
      const ret = e.returnPct > 0 ? `+${e.returnPct}%` : `${e.returnPct}%`
      console.log(`    ${(e.market || '').slice(0, 35).padEnd(35)} ${e.entryPrice}¢ → ${e.currentPrice}¢  ${ret}`)
    }
    console.log('')
  }

  // Recent evaluations
  if (data.confidenceHistory?.length > 0) {
    console.log('  Recent Evaluations')
    for (const h of data.confidenceHistory.slice(-5)) {
      const d = h.delta > 0 ? `+${Math.round(h.delta * 100)}` : `${Math.round(h.delta * 100)}`
      console.log(`    ${(h.evaluatedAt || '').slice(0, 16)} ${Math.round(h.confidence * 100)}% (${d}) ${(h.summary || '').slice(0, 60)}`)
    }
    console.log('')
  }

  // Top edges
  if (data.edges?.length > 0) {
    console.log('  Top Edges')
    const sorted = [...data.edges].sort((a: any, b: any) => Math.abs(b.edge) - Math.abs(a.edge)).slice(0, 10)
    for (const e of sorted) {
      const liq = e.orderbook?.liquidityScore || '?'
      console.log(`    ${(e.market || '').slice(0, 35).padEnd(35)} ${e.marketPrice}¢ → ${e.thesisPrice}¢  edge ${e.edge > 0 ? '+' : ''}${e.edge}  ${liq}`)
    }
    console.log('')
  }
}
