/**
 * CLI formatting utilities
 *
 * ANSI escape codes only — no chalk dependency.
 */

// ===== ANSI Colors =====

export const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  gray: '\x1b[90m',
} as const

// ===== Formatting helpers =====

/** Format a number as volume string: 1234567 → "1.2M", 12345 → "12K" */
export function vol(n: number | string | null | undefined): string {
  if (n === null || n === undefined) return '-'
  const v = typeof n === 'string' ? parseFloat(n) : n
  if (isNaN(v)) return '-'
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`
  if (v >= 1_000) return `${(v / 1_000).toFixed(0)}K`
  return v.toString()
}

/** Format a dollar amount as cents: 0.55 → "55¢" */
export function cents(n: number | string | null | undefined): string {
  if (n === null || n === undefined) return '-'
  const v = typeof n === 'string' ? parseFloat(n) : n
  if (isNaN(v)) return '-'
  return `${Math.round(v * 100)}¢`
}

/** Format a probability as percentage: 0.82 → "82%" */
export function pct(n: number | string | null | undefined): string {
  if (n === null || n === undefined) return '-'
  const v = typeof n === 'string' ? parseFloat(n) : n
  if (isNaN(v)) return '-'
  return `${Math.round(v * 100)}%`
}

/** Format a confidence delta with arrow: +0.10 → "↑ +10%", -0.05 → "↓ -5%" */
export function delta(n: number): string {
  const arrow = n > 0 ? '↑' : n < 0 ? '↓' : '→'
  const sign = n > 0 ? '+' : ''
  return `${arrow} ${sign}${Math.round(n * 100)}%`
}

/** Format ISO date string to short form: "2026-03-12T11:13:00Z" → "Mar 12 11:13" */
export function shortDate(iso: string | null | undefined): string {
  if (!iso) return '-'
  try {
    const d = new Date(iso)
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    const month = months[d.getMonth()]
    const day = d.getDate()
    const hours = d.getHours().toString().padStart(2, '0')
    const mins = d.getMinutes().toString().padStart(2, '0')
    return `${month} ${day} ${hours}:${mins}`
  } catch {
    return iso.slice(0, 16)
  }
}

/** Pad/truncate a string to exact width */
export function pad(s: string, width: number): string {
  if (s.length >= width) return s.slice(0, width)
  return s + ' '.repeat(width - s.length)
}

/** Right-align a string to exact width */
export function rpad(s: string, width: number): string {
  if (s.length >= width) return s.slice(0, width)
  return ' '.repeat(width - s.length) + s
}

/** Print a horizontal rule */
export function hr(width = 80): void {
  console.log(c.dim + '─'.repeat(width) + c.reset)
}

/** Print an error and exit */
export function die(msg: string): never {
  console.error(`${c.red}Error:${c.reset} ${msg}`)
  process.exit(1)
}

/** Print a section header */
export function header(title: string): void {
  console.log(`\n${c.bold}${c.cyan}${title}${c.reset}`)
}

/** Truncate a string with ellipsis */
export function trunc(s: string, maxLen: number): string {
  if (s.length <= maxLen) return s
  return s.slice(0, maxLen - 1) + '…'
}

/** Short ID: first 8 chars of a UUID */
export function shortId(id: string): string {
  return id.slice(0, 8)
}
