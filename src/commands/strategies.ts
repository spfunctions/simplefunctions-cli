/**
 * sf strategies — List strategies across theses
 *
 * Usage:
 *   sf strategies                    — all active strategies across all theses
 *   sf strategies f582bf76           — strategies for a specific thesis
 *   sf strategies --status executed  — filter by status
 *   sf strategies --all              — all statuses
 */

import { Command } from 'commander'
import { SFClient } from '../client.js'

const STATUS_COLORS: Record<string, string> = {
  active: '\x1b[32m',     // green
  watching: '\x1b[33m',   // yellow
  executed: '\x1b[36m',   // cyan
  cancelled: '\x1b[90m',  // gray
  review: '\x1b[31m',     // red
}
const RESET = '\x1b[0m'
const DIM = '\x1b[2m'
const BOLD = '\x1b[1m'

function formatStrategy(s: any, showThesis = false): string {
  const statusColor = STATUS_COLORS[s.status] || ''
  const lines: string[] = []

  // Header line
  const thesisPrefix = showThesis ? `${DIM}${s.thesisTitle || s.thesisId?.slice(0, 8)}${RESET}  ` : ''
  lines.push(
    `  ${thesisPrefix}${statusColor}[${s.status}]${RESET}  ${BOLD}${s.marketId}${RESET} ${s.direction.toUpperCase()}  ${DIM}${s.horizon}${RESET}  priority ${s.priority || 0}`
  )

  // Entry conditions
  const entryParts: string[] = []
  if (s.entryBelow != null) entryParts.push(`ask ≤ ${s.entryBelow}¢`)
  if (s.entryAbove != null) entryParts.push(`ask ≥ ${s.entryAbove}¢`)
  const stopPart = s.stopLoss != null ? `Stop: ${s.stopLoss}¢` : ''
  const tpPart = s.takeProfit != null ? `TP: ${s.takeProfit}¢` : ''
  const maxPart = `Max: ${s.maxQuantity || 500}`
  const filledPart = `Filled: ${s.executedQuantity || 0}/${s.maxQuantity || 500}`

  const conditionLine = [
    entryParts.length > 0 ? `Entry: ${entryParts.join(', ')}` : null,
    stopPart || null,
    tpPart || null,
    maxPart,
    filledPart,
  ].filter(Boolean).join('  |  ')

  lines.push(`    ${conditionLine}`)

  // Soft conditions
  if (s.softConditions) {
    lines.push(`    ${DIM}Soft: ${s.softConditions}${RESET}`)
  }

  // Review warning
  if (s.status === 'review') {
    lines.push(`    \x1b[31m⚠️  Needs review${RESET}`)
  }

  // Rationale (truncated)
  if (s.rationale) {
    const truncated = s.rationale.length > 120 ? s.rationale.slice(0, 117) + '...' : s.rationale
    lines.push(`    ${DIM}${truncated}${RESET}`)
  }

  // Footer
  const createdBy = s.createdBy || 'user'
  const date = s.createdAt ? new Date(s.createdAt).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''
  lines.push(`    ${DIM}created by ${createdBy} · ${date}${RESET}`)

  return lines.join('\n')
}

export function registerStrategies(program: Command) {
  program
    .command('strategies')
    .argument('[thesisId]', 'thesis ID or prefix (omit for all theses)')
    .option('--status <status>', 'filter by status (active|watching|executed|cancelled|review)')
    .option('--all', 'show all statuses (default: active only)')
    .description('List strategies across theses')
    .action(async (thesisId?: string, opts?: { status?: string; all?: boolean }) => {
      try {
        const client = new SFClient()

        if (thesisId) {
          // Strategies for a specific thesis
          const statusParam = opts?.all ? '' : (opts?.status || 'active')
          const url = statusParam
            ? `/api/thesis/${thesisId}/strategies?status=${statusParam}`
            : `/api/thesis/${thesisId}/strategies`

          const data = await client.getStrategies(thesisId, opts?.all ? undefined : (opts?.status || 'active'))
          const strategies = data.strategies || []

          if (strategies.length === 0) {
            console.log(`\n  No strategies found for thesis ${thesisId}`)
            if (!opts?.all && !opts?.status) {
              console.log(`  ${DIM}Try --all to see all statuses${RESET}`)
            }
            console.log()
            return
          }

          console.log(`\n  Strategies for ${thesisId}\n`)
          for (const s of strategies) {
            console.log(formatStrategy(s))
            console.log()
          }
        } else {
          // All strategies across all theses
          const { theses } = await client.listTheses()

          let totalStrategies = 0
          for (const thesis of theses) {
            const statusFilter = opts?.all ? undefined : (opts?.status || 'active')
            const data = await client.getStrategies(thesis.id, statusFilter)
            const strategies = data.strategies || []

            if (strategies.length === 0) continue

            totalStrategies += strategies.length
            console.log(`\n  ${BOLD}${thesis.title}${RESET}  ${DIM}(${thesis.id.slice(0, 8)})${RESET}\n`)
            for (const s of strategies) {
              console.log(formatStrategy(s))
              console.log()
            }
          }

          if (totalStrategies === 0) {
            console.log(`\n  No strategies found`)
            if (!opts?.all && !opts?.status) {
              console.log(`  ${DIM}Try --all to see all statuses${RESET}`)
            }
            console.log()
          }
        }
      } catch (err: any) {
        console.error(`\x1b[31mError:\x1b[0m ${err.message}`)
        process.exit(1)
      }
    })
}
