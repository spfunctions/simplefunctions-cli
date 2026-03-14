import { SFClient } from '../client.js'
import { c, pct, delta, shortDate, header, hr } from '../utils.js'

export async function getCommand(
  id: string,
  opts: { json?: boolean; apiKey?: string; apiUrl?: string }
): Promise<void> {
  const client = new SFClient(opts.apiKey, opts.apiUrl)
  // GET /api/thesis/:id returns { ...thesisRow, positions: [] }
  // Fields are spread at top-level (NOT nested under .thesis)
  const data = await client.getThesis(id)

  if (opts.json) {
    console.log(JSON.stringify(data, null, 2))
    return
  }

  // data is the flat thesis row + positions array
  const t = data              // thesis fields are at top level
  const positions: any[] = data.positions || []

  header(`Thesis: ${(t.id || id).slice(0, 8)}`)
  hr()
  console.log(`${c.bold}Status:${c.reset}     ${t.status || '-'}`)
  const conf = t.confidence ? pct(parseFloat(t.confidence)) : '-'
  console.log(`${c.bold}Confidence:${c.reset} ${conf}`)
  const createdAt = t.createdAt instanceof Date ? t.createdAt.toISOString() : t.createdAt
  const updatedAt = t.updatedAt instanceof Date ? t.updatedAt.toISOString() : t.updatedAt
  console.log(`${c.bold}Created:${c.reset}    ${shortDate(createdAt)}`)
  console.log(`${c.bold}Updated:${c.reset}    ${shortDate(updatedAt)}`)
  if (t.title) {
    console.log(`${c.bold}Title:${c.reset}      ${t.title}`)
  }
  console.log(`${c.bold}Thesis:${c.reset}     ${t.rawThesis || '-'}`)
  if (t.webhookUrl) {
    console.log(`${c.bold}Webhook:${c.reset}    ${t.webhookUrl}`)
  }

  // Causal tree
  const causalTree = t.causalTree
  if (causalTree && causalTree.nodes) {
    header('Causal Tree')
    printNodes(causalTree.nodes, 0)
  }

  // Edge analysis
  const edgeAnalysis = t.edgeAnalysis
  if (edgeAnalysis && edgeAnalysis.edges) {
    header('Edge Analysis')
    console.log(`${c.dim}Analyzed: ${shortDate(edgeAnalysis.analyzedAt)}${c.reset}`)
    if (edgeAnalysis.lastRescanAt) {
      console.log(`${c.dim}Last rescan: ${shortDate(edgeAnalysis.lastRescanAt)}${c.reset}`)
    }
    for (const edge of edgeAnalysis.edges) {
      const edgeSize: number = edge.edgeSize ?? 0
      const edgeColor = edgeSize > 10 ? c.green : edgeSize > 0 ? c.yellow : c.red
      console.log(
        `  ${edge.marketTitle || edge.marketId}` +
        `  ${c.dim}${edge.venue}${c.reset}` +
        `  price: ${(edge.marketPrice ?? 0).toFixed(0)}¢` +
        `  ${edgeColor}edge: ${edgeSize > 0 ? '+' : ''}${edgeSize.toFixed(1)}${c.reset}`
      )
    }
  }

  // Positions
  if (positions.length > 0) {
    header('Positions')
    for (const p of positions) {
      if (!p) continue
      const statusIcon = p.status === 'open' ? c.green + '●' : c.dim + '○'
      console.log(
        `  ${statusIcon}${c.reset} [${(p.id || '?').slice(0, 8)}] "${p.marketTitle || '?'}" ` +
        `${p.direction || '?'}@${p.entryPrice || '?'}→${p.currentPrice || p.entryPrice || '?'} ` +
        `${c.dim}(${p.venue || '?'})${c.reset}`
      )
    }
  }

  // Last evaluation
  const lastEval = t.lastEvaluation
  if (lastEval) {
    header('Last Evaluation')
    const evalAt = lastEval.evaluatedAt instanceof Date ? lastEval.evaluatedAt.toISOString() : lastEval.evaluatedAt
    console.log(`${c.dim}${shortDate(evalAt)} | model: ${lastEval.model || '-'}${c.reset}`)
    if (lastEval.confidenceDelta !== undefined) {
      const d = lastEval.confidenceDelta
      const dColor = d > 0 ? c.green : d < 0 ? c.red : c.dim
      console.log(`Confidence: ${pct(lastEval.previousConfidence)} → ${pct(lastEval.newConfidence)} ${dColor}(${delta(d)})${c.reset}`)
    }
    if (lastEval.summary) {
      console.log(`\n${lastEval.summary}`)
    }
  }

  console.log('')
}

function printNodes(nodes: any[], depth: number): void {
  for (const node of nodes) {
    if (!node) continue
    const indent = '  '.repeat(depth + 1)
    const prob = node.probability !== undefined ? pct(node.probability) : '-'
    const imp = node.importance !== undefined ? ` imp:${node.importance}` : ''
    console.log(`${indent}${c.cyan}${node.id}${c.reset}  ${node.label}  ${c.dim}(${prob}${imp})${c.reset}`)
    if (node.children && node.children.length > 0) {
      printNodes(node.children, depth + 1)
    }
  }
}
