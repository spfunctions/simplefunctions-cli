import { SFClient } from '../client.js'
import { c, shortId } from '../utils.js'

export async function createCommand(
  thesis: string,
  opts: { async?: boolean; json?: boolean; timeout?: number; apiKey?: string; apiUrl?: string }
): Promise<void> {
  const client = new SFClient(opts.apiKey, opts.apiUrl)
  const sync = !opts.async

  if (!opts.json) {
    if (sync) {
      console.log(`${c.dim}Creating thesis (sync mode — waiting for formation)...${c.reset}`)
    } else {
      console.log(`${c.dim}Creating thesis (async mode)...${c.reset}`)
    }
  }

  const result = await client.createThesis(thesis, sync)
  const id = result.thesis?.id || result.thesisId || result.id || null

  if (opts.json) {
    console.log(JSON.stringify({ id, status: result.thesis?.status || result.status || 'forming', result }, null, 2))
    return
  }

  if (!id) {
    console.error(`${c.red}✗${c.reset} Thesis creation returned no ID.`)
    console.error(`${c.dim}Response: ${JSON.stringify(result).slice(0, 200)}${c.reset}`)
    process.exit(1)
  }

  console.log(`\n${c.green}✓${c.reset} Thesis created`)
  console.log(`  ${c.bold}ID:${c.reset}     ${id}`)
  console.log(`  ${c.bold}Status:${c.reset} ${result.thesis?.status || result.status}`)

  if (result.thesis?.confidence) {
    console.log(`  ${c.bold}Confidence:${c.reset} ${Math.round(parseFloat(result.thesis.confidence) * 100)}%`)
  }
  if (result.thesis?.causalTree?.nodes) {
    console.log(`  ${c.bold}Nodes:${c.reset}  ${result.thesis.causalTree.nodes.length}`)
  }
  if (result.thesis?.edgeAnalysis?.edges) {
    console.log(`  ${c.bold}Edges:${c.reset}  ${result.thesis.edgeAnalysis.edges.length}`)
  }

  console.log(`\n${c.dim}View: sf get ${shortId(id)}${c.reset}`)
  console.log(`${c.dim}Context: sf context ${shortId(id)}${c.reset}`)
}
