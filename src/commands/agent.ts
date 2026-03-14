/**
 * sf agent — Interactive TUI agent powered by pi-tui + pi-agent-core.
 *
 * Layout:
 *   [Header overlay]  — thesis id, confidence, model
 *   [Spacer]          — room for header
 *   [Chat container]  — messages (user, assistant, tool, system)
 *   [Editor]          — multi-line input with slash command autocomplete
 *   [Spacer]          — room for footer
 *   [Footer overlay]  — tokens, cost, tool count, /help hint
 *
 * Slash commands (bypass LLM):
 *   /help   /tree   /edges   /pos   /eval   /model   /clear   /exit
 */

import fs from 'fs'
import path from 'path'
import os from 'os'
import { SFClient, kalshiFetchAllSeries, kalshiFetchMarketsBySeries, kalshiFetchMarket } from '../client.js'
import { getPositions, getMarketPrice } from '../kalshi.js'
import { loadConfig } from '../config.js'

// ─── Session persistence ─────────────────────────────────────────────────────

function getSessionDir(): string {
  return path.join(os.homedir(), '.sf', 'sessions')
}

function getSessionPath(thesisId: string): string {
  return path.join(getSessionDir(), `${thesisId}.json`)
}

function loadSession(thesisId: string): any | null {
  const p = getSessionPath(thesisId)
  try {
    if (fs.existsSync(p)) {
      return JSON.parse(fs.readFileSync(p, 'utf-8'))
    }
  } catch { /* corrupt file, ignore */ }
  return null
}

function saveSession(thesisId: string, model: string, messages: any[]): void {
  const dir = getSessionDir()
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(
    getSessionPath(thesisId),
    JSON.stringify({
      thesisId,
      model,
      updatedAt: new Date().toISOString(),
      messages,
    }, null, 2),
  )
}

// ─── ANSI 24-bit color helpers (no chalk dependency) ─────────────────────────

const rgb = (r: number, g: number, b: number) => (s: string) => `\x1b[38;2;${r};${g};${b}m${s}\x1b[39m`
const bgRgb = (r: number, g: number, b: number) => (s: string) => `\x1b[48;2;${r};${g};${b}m${s}\x1b[49m`
const bold = (s: string) => `\x1b[1m${s}\x1b[22m`
const dim = (s: string) => `\x1b[2m${s}\x1b[22m`
const italic = (s: string) => `\x1b[3m${s}\x1b[23m`
const underline = (s: string) => `\x1b[4m${s}\x1b[24m`
const strikethrough = (s: string) => `\x1b[9m${s}\x1b[29m`

const C = {
  emerald: rgb(16, 185, 129),       // #10b981
  zinc200: rgb(228, 228, 231),      // #e4e4e7
  zinc400: rgb(161, 161, 170),      // #a1a1aa
  zinc600: rgb(82, 82, 91),         // #52525b
  zinc800: rgb(39, 39, 42),         // #27272a
  red: rgb(239, 68, 68),            // #ef4444
  amber: rgb(245, 158, 11),         // #f59e0b
  white: rgb(255, 255, 255),
  bgZinc900: bgRgb(24, 24, 27),    // #18181b
  bgZinc800: bgRgb(39, 39, 42),    // #27272a
}

// ─── Custom components ───────────────────────────────────────────────────────

/** Mutable single-line component (TruncatedText is immutable) */
function createMutableLine(piTui: any) {
  const { truncateToWidth, visibleWidth } = piTui

  return class MutableLine {
    private text: string
    private cachedWidth?: number
    private cachedLines?: string[]

    constructor(text: string) {
      this.text = text
    }

    setText(text: string) {
      this.text = text
      this.cachedWidth = undefined
      this.cachedLines = undefined
    }

    invalidate() {
      this.cachedWidth = undefined
      this.cachedLines = undefined
    }

    render(width: number): string[] {
      if (this.cachedLines && this.cachedWidth === width) return this.cachedLines
      this.cachedWidth = width
      this.cachedLines = [truncateToWidth(this.text, width)]
      return this.cachedLines
    }
  }
}

/**
 * Header bar — trading terminal style.
 * Shows: thesis ID, confidence+delta, positions P&L, edge count, top edge
 */
function createHeaderBar(piTui: any) {
  const { truncateToWidth, visibleWidth } = piTui

  return class HeaderBar {
    thesisId = ''
    confidence = 0
    confidenceDelta = 0
    pnlDollars = 0
    positionCount = 0
    edgeCount = 0
    topEdge = ''           // e.g. "RECESSION +21¢"
    private cachedWidth?: number
    private cachedLines?: string[]

    setFromContext(ctx: any, positions?: any[]) {
      this.thesisId = (ctx.thesisId || '').slice(0, 8)
      this.confidence = typeof ctx.confidence === 'number'
        ? Math.round(ctx.confidence * 100)
        : (typeof ctx.confidence === 'string' ? Math.round(parseFloat(ctx.confidence) * 100) : 0)
      this.confidenceDelta = ctx.lastEvaluation?.confidenceDelta
        ? Math.round(ctx.lastEvaluation.confidenceDelta * 100)
        : 0
      this.edgeCount = (ctx.edges || []).length

      // Top edge by absolute size
      const edges = ctx.edges || []
      if (edges.length > 0) {
        const top = [...edges].sort((a: any, b: any) => Math.abs(b.edge || b.edgeSize || 0) - Math.abs(a.edge || a.edgeSize || 0))[0]
        const name = (top.market || top.marketTitle || top.marketId || '').slice(0, 20)
        const edge = top.edge || top.edgeSize || 0
        this.topEdge = `${name} ${edge > 0 ? '+' : ''}${Math.round(edge)}\u00A2`
      }

      // P&L from positions
      if (positions && positions.length > 0) {
        this.positionCount = positions.length
        this.pnlDollars = positions.reduce((sum: number, p: any) => {
          const pnl = p.unrealized_pnl || 0
          return sum + pnl
        }, 0) / 100 // cents → dollars
      }

      this.cachedWidth = undefined
      this.cachedLines = undefined
    }

    updateConfidence(newConf: number, delta: number) {
      this.confidence = Math.round(newConf * 100)
      this.confidenceDelta = Math.round(delta * 100)
      this.cachedWidth = undefined
      this.cachedLines = undefined
    }

    invalidate() {
      this.cachedWidth = undefined
      this.cachedLines = undefined
    }

    // Keep legacy update() for compatibility with /switch etc.
    update(left?: string, center?: string, right?: string) {
      this.cachedWidth = undefined
      this.cachedLines = undefined
    }

    render(width: number): string[] {
      if (this.cachedLines && this.cachedWidth === width) return this.cachedLines
      this.cachedWidth = width

      // Build segments
      const id = C.emerald(bold(this.thesisId))

      // Confidence with arrow
      const arrow = this.confidenceDelta > 0 ? '\u25B2' : this.confidenceDelta < 0 ? '\u25BC' : '\u2500'
      const arrowColor = this.confidenceDelta > 0 ? C.emerald : this.confidenceDelta < 0 ? C.red : C.zinc600
      const deltaStr = this.confidenceDelta !== 0 ? ` (${this.confidenceDelta > 0 ? '+' : ''}${this.confidenceDelta})` : ''
      const conf = arrowColor(`${arrow} ${this.confidence}%${deltaStr}`)

      // P&L
      let pnl = ''
      if (this.positionCount > 0) {
        const pnlStr = this.pnlDollars >= 0
          ? C.emerald(`+$${this.pnlDollars.toFixed(2)}`)
          : C.red(`-$${Math.abs(this.pnlDollars).toFixed(2)}`)
        pnl = C.zinc600(`${this.positionCount} pos `) + pnlStr
      }

      // Edges
      const edges = C.zinc600(`${this.edgeCount} edges`)

      // Top edge
      const top = this.topEdge ? C.zinc400(this.topEdge) : ''

      // Assemble with separators
      const sep = C.zinc600(' \u2502 ')
      const parts = [id, conf, pnl, edges, top].filter(Boolean)
      const content = parts.join(sep)

      let line = C.bgZinc900(' ' + truncateToWidth(content, width - 2, '') + ' ')
      const lineVw = visibleWidth(line)
      if (lineVw < width) {
        line = line + C.bgZinc900(' '.repeat(width - lineVw))
      }

      this.cachedLines = [line]
      return this.cachedLines
    }
  }
}

/** Footer bar: model | tokens | exchange status | trading status | /help */
function createFooterBar(piTui: any) {
  const { truncateToWidth, visibleWidth } = piTui

  return class FooterBar {
    tokens = 0
    cost = 0
    toolCount = 0
    modelName = ''
    tradingEnabled = false
    exchangeOpen: boolean | null = null  // null = unknown
    private cachedWidth?: number
    private cachedLines?: string[]

    invalidate() {
      this.cachedWidth = undefined
      this.cachedLines = undefined
    }

    update() {
      this.cachedWidth = undefined
      this.cachedLines = undefined
    }

    render(width: number): string[] {
      if (this.cachedLines && this.cachedWidth === width) return this.cachedLines
      this.cachedWidth = width

      const tokStr = this.tokens >= 1000
        ? `${(this.tokens / 1000).toFixed(1)}k`
        : `${this.tokens}`

      const model = C.zinc600(this.modelName.split('/').pop() || this.modelName)
      const tokens = C.zinc600(`${tokStr} tok`)
      const exchange = this.exchangeOpen === true
        ? C.emerald('OPEN')
        : this.exchangeOpen === false
        ? C.red('CLOSED')
        : C.zinc600('...')
      const trading = this.tradingEnabled
        ? C.amber('\u26A1 trading')
        : C.zinc600('\u26A1 read-only')
      const help = C.zinc600('/help')

      const sep = C.zinc600(' \u2502 ')
      const leftText = [model, tokens, exchange, trading].join(sep)
      const lw = visibleWidth(leftText)
      const rw = visibleWidth(help)
      const gap = Math.max(1, width - lw - rw - 2)

      let line = C.bgZinc900(' ' + leftText + ' '.repeat(gap) + help + ' ')
      const lineVw = visibleWidth(line)
      if (lineVw < width) {
        line = line + C.bgZinc900(' '.repeat(width - lineVw))
      }

      this.cachedLines = [line]
      return this.cachedLines
    }
  }
}

// ─── Formatted renderers ─────────────────────────────────────────────────────

function renderCausalTree(context: any, piTui: any): string {
  const tree = context.causalTree
  if (!tree?.nodes?.length) return C.zinc600('  No causal tree data')

  const lines: string[] = []
  for (const node of tree.nodes) {
    const id = node.id || ''
    const label = node.label || node.description || ''
    const prob = typeof node.probability === 'number'
      ? Math.round(node.probability * 100)
      : (typeof node.impliedProbability === 'number' ? Math.round(node.impliedProbability * 100) : null)

    const depth = (id.match(/\./g) || []).length
    const indent = '  '.repeat(depth + 1)

    if (prob !== null) {
      // Progress bar: 10 chars
      const filled = Math.round(prob / 10)
      const bar = '\u2588'.repeat(filled) + '\u2591'.repeat(10 - filled)
      const probColor = prob >= 70 ? C.emerald : prob >= 40 ? C.amber : C.red

      // Dots to pad between label and percentage
      const labelPart = `${indent}${C.zinc600(id)}  ${C.zinc400(label)} `
      const probPart = ` ${probColor(`${prob}%`)}  ${probColor(bar)}`
      lines.push(labelPart + probPart)
    } else {
      lines.push(`${indent}${C.zinc600(id)}  ${C.zinc400(label)}`)
    }
  }
  return lines.join('\n')
}

function renderEdges(context: any, piTui: any): string {
  const edges = context.edges
  if (!edges?.length) return C.zinc600('  No edge data')

  const positions = context._positions || []
  const lines: string[] = []

  for (const e of edges) {
    // Context API field names: market, marketId, thesisPrice, edge, orderbook.spread, orderbook.liquidityScore
    const name = (e.market || e.marketId || '').slice(0, 18).padEnd(18)
    const marketStr = typeof e.marketPrice === 'number' ? `${e.marketPrice}\u00A2` : '?'
    const thesisStr = typeof e.thesisPrice === 'number' ? `${e.thesisPrice}\u00A2` : '?'
    const edgeVal = typeof e.edge === 'number' ? (e.edge > 0 ? `+${e.edge}` : `${e.edge}`) : '?'
    const ob = e.orderbook || {}
    const spreadStr = typeof ob.spread === 'number' ? `${ob.spread}\u00A2` : '?'
    const liq = ob.liquidityScore || 'low'
    const liqBars = liq === 'high' ? '\u25A0\u25A0\u25A0' : liq === 'medium' ? '\u25A0\u25A0 ' : '\u25A0  '
    const liqColor = liq === 'high' ? C.emerald : liq === 'medium' ? C.amber : C.red

    // Check if we have a position on this edge (match by marketId prefix in ticker)
    const pos = positions.find((p: any) =>
      p.ticker === e.marketId ||
      (e.marketId && p.ticker?.includes(e.marketId))
    )
    let posStr = C.zinc600('\u2014')
    if (pos) {
      const side = pos.side?.toUpperCase() || 'YES'
      const pnl = typeof pos.unrealized_pnl === 'number'
        ? (pos.unrealized_pnl >= 0 ? C.emerald(`+$${(pos.unrealized_pnl / 100).toFixed(0)}`) : C.red(`-$${(Math.abs(pos.unrealized_pnl) / 100).toFixed(0)}`))
        : ''
      posStr = C.emerald(`${side} (${pos.quantity}@${pos.average_price_paid}\u00A2 ${pnl})`)
    }

    lines.push(
      `  ${C.zinc200(name)} ${C.zinc400(marketStr)} \u2192 ${C.zinc400(thesisStr)}  edge ${edgeVal.includes('+') ? C.emerald(edgeVal) : C.red(edgeVal)}  spread ${C.zinc600(spreadStr)}  ${liqColor(liqBars)} ${liqColor(liq.padEnd(4))}  ${posStr}`
    )
  }
  return lines.join('\n')
}

function renderPositions(positions: any[]): string {
  if (!positions?.length) return C.zinc600('  No positions')

  const lines: string[] = []
  let totalPnl = 0

  for (const p of positions) {
    const ticker = (p.ticker || '').slice(0, 18).padEnd(18)
    const side = (p.side || 'yes').toUpperCase().padEnd(3)
    const qty = String(p.quantity || 0)
    const avg = `${p.average_price_paid || 0}\u00A2`
    const now = typeof p.current_value === 'number' && p.current_value > 0
      ? `${p.current_value}\u00A2`
      : '?\u00A2'
    const pnlCents = p.unrealized_pnl || 0
    totalPnl += pnlCents
    const pnlDollars = (pnlCents / 100).toFixed(2)
    const pnlStr = pnlCents >= 0
      ? C.emerald(`+$${pnlDollars}`)
      : C.red(`-$${Math.abs(parseFloat(pnlDollars)).toFixed(2)}`)
    const arrow = pnlCents >= 0 ? C.emerald('\u25B2') : C.red('\u25BC')

    lines.push(`  ${C.zinc200(ticker)} ${C.zinc400(side)}  ${C.zinc400(qty)} @ ${C.zinc400(avg)}  now ${C.zinc200(now)}  ${pnlStr}  ${arrow}`)
  }

  const totalDollars = (totalPnl / 100).toFixed(2)
  lines.push(C.zinc600('  ' + '\u2500'.repeat(40)))
  lines.push(
    totalPnl >= 0
      ? `  Total P&L: ${C.emerald(bold(`+$${totalDollars}`))}`
      : `  Total P&L: ${C.red(bold(`-$${Math.abs(parseFloat(totalDollars)).toFixed(2)}`))}`
  )

  return lines.join('\n')
}

// ─── Main command ────────────────────────────────────────────────────────────

export async function agentCommand(thesisId?: string, opts?: { model?: string; modelKey?: string; newSession?: boolean; noTui?: boolean }) {
  // ── Validate API keys ──────────────────────────────────────────────────────
  const openrouterKey = opts?.modelKey || process.env.OPENROUTER_API_KEY
  if (!openrouterKey) {
    console.error('Need OpenRouter API key to power the agent LLM.')
    console.error('')
    console.error('  1. Get a key at https://openrouter.ai/keys')
    console.error('  2. Then either:')
    console.error('     export OPENROUTER_API_KEY=sk-or-v1-...')
    console.error('     sf agent --model-key sk-or-v1-...')
    console.error('     sf setup  (saves to ~/.sf/config.json)')
    process.exit(1)
  }

  // Pre-flight: validate OpenRouter key
  try {
    const checkRes = await fetch('https://openrouter.ai/api/v1/auth/key', {
      headers: { 'Authorization': `Bearer ${openrouterKey}` },
      signal: AbortSignal.timeout(8000),
    })
    if (!checkRes.ok) {
      console.error('OpenRouter API key is invalid or expired.')
      console.error('Get a new key at https://openrouter.ai/keys')
      process.exit(1)
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (!msg.includes('timeout')) {
      console.warn(`Warning: Could not verify OpenRouter key (${msg}). Continuing anyway.`)
    }
  }

  const sfClient = new SFClient()

  // ── Resolve thesis ID ──────────────────────────────────────────────────────
  let resolvedThesisId = thesisId
  if (!resolvedThesisId) {
    const data = await sfClient.listTheses()
    const theses = data.theses || (data as any)
    const active = (theses as any[]).find((t: any) => t.status === 'active')
    if (!active) {
      console.error('No active thesis. Create one first: sf create "..."')
      process.exit(1)
    }
    resolvedThesisId = active.id
  }

  // ── Fetch initial context ──────────────────────────────────────────────────
  let latestContext = await sfClient.getContext(resolvedThesisId!)

  // ── Branch: plain-text mode ────────────────────────────────────────────────
  if (opts?.noTui) {
    return runPlainTextAgent({ openrouterKey, sfClient, resolvedThesisId: resolvedThesisId!, latestContext, opts })
  }

  // ── Dynamic imports (all ESM-only packages) ────────────────────────────────
  const piTui = await import('@mariozechner/pi-tui')
  const piAi = await import('@mariozechner/pi-ai')
  const piAgent = await import('@mariozechner/pi-agent-core')

  const {
    TUI, ProcessTerminal, Container, Text, Markdown, Editor, Loader, Spacer,
    CombinedAutocompleteProvider, truncateToWidth, visibleWidth,
  } = piTui
  const { getModel, streamSimple, Type } = piAi
  const { Agent } = piAgent

  // ── Component class factories (need piTui ref) ─────────────────────────────
  const MutableLine = createMutableLine(piTui)
  const HeaderBar = createHeaderBar(piTui)
  const FooterBar = createFooterBar(piTui)

  // ── Model setup ────────────────────────────────────────────────────────────
  const rawModelName = opts?.model || 'anthropic/claude-sonnet-4.6'
  let currentModelName = rawModelName.replace(/^openrouter\//, '')

  function resolveModel(name: string): any {
    try {
      return getModel('openrouter', name as any)
    } catch {
      return {
        modelId: name,
        provider: 'openrouter',
        api: 'openai-completions',
        baseUrl: 'https://openrouter.ai/api/v1',
        id: name,
        name: name,
        inputPrice: 0,
        outputPrice: 0,
        contextWindow: 200000,
        supportsImages: true,
        supportsTools: true,
      }
    }
  }

  let model = resolveModel(currentModelName)

  // ── Tracking state ─────────────────────────────────────────────────────────
  let totalTokens = 0
  let totalCost = 0
  let totalToolCalls = 0
  let isProcessing = false

  // Cache for positions (fetched by /pos or get_positions tool)
  let cachedPositions: any[] | null = null

  // ── Heartbeat polling state ───────────────────────────────────────────────
  // Background poll delta endpoint every 60s.
  // If confidence changed ≥ 3%, auto-trigger agent analysis.
  // If agent is busy (isProcessing), queue and deliver after agent finishes.
  let lastPollTimestamp = new Date().toISOString()
  let pendingHeartbeatDelta: any = null  // queued delta when agent is busy
  let heartbeatPollTimer: ReturnType<typeof setInterval> | null = null

  // ── Inline confirmation mechanism ─────────────────────────────────────────
  // Tools can call promptUser() during execution to ask the user a question.
  // This temporarily unlocks the editor, waits for input, then resumes.
  let pendingPrompt: { resolve: (answer: string) => void } | null = null

  // ── Setup TUI ──────────────────────────────────────────────────────────────
  const terminal = new ProcessTerminal()
  const tui = new TUI(terminal)

  // Markdown theme for assistant messages
  const mdTheme: any = {
    heading: (s: string) => C.zinc200(bold(s)),
    link: (s: string) => C.emerald(s),
    linkUrl: (s: string) => C.zinc600(s),
    code: (s: string) => C.zinc200(s),
    codeBlock: (s: string) => C.zinc400(s),
    codeBlockBorder: (s: string) => C.zinc600(s),
    quote: (s: string) => C.zinc400(s),
    quoteBorder: (s: string) => C.zinc600(s),
    hr: (s: string) => C.zinc600(s),
    listBullet: (s: string) => C.emerald(s),
    bold: (s: string) => bold(s),
    italic: (s: string) => italic(s),
    strikethrough: (s: string) => strikethrough(s),
    underline: (s: string) => underline(s),
  }

  const mdDefaultStyle = {
    color: (s: string) => C.zinc400(s),
  }

  // Editor theme — use dim zinc borders instead of default green
  const editorTheme = {
    borderColor: (s: string) => `\x1b[38;2;50;50;55m${s}\x1b[39m`,
    selectList: {
      selectedPrefix: (s: string) => C.emerald(s),
      selectedText: (s: string) => C.zinc200(s),
      description: (s: string) => C.zinc600(s),
      scrollInfo: (s: string) => C.zinc600(s),
      noMatch: (s: string) => C.zinc600(s),
    },
  }

  // ── Build components ───────────────────────────────────────────────────────
  const headerBar = new HeaderBar()

  // Fetch positions for header P&L (non-blocking, best-effort)
  let initialPositions: any[] | null = null
  try {
    initialPositions = await getPositions()
    if (initialPositions) {
      for (const pos of initialPositions) {
        const livePrice = await getMarketPrice(pos.ticker)
        if (livePrice !== null) {
          pos.current_value = livePrice
          pos.unrealized_pnl = Math.round((livePrice - pos.average_price_paid) * pos.quantity)
        }
      }
    }
  } catch { /* positions not available, fine */ }

  headerBar.setFromContext(latestContext, initialPositions || undefined)

  const footerBar = new FooterBar()
  footerBar.modelName = currentModelName
  footerBar.tradingEnabled = loadConfig().tradingEnabled || false

  // Fetch exchange status for footer (non-blocking)
  fetch('https://api.elections.kalshi.com/trade-api/v2/exchange/status', { headers: { 'Accept': 'application/json' } })
    .then(r => r.json())
    .then(d => { footerBar.exchangeOpen = !!d.exchange_active; footerBar.update(); tui.requestRender() })
    .catch(() => {})

  const topSpacer = new Spacer(1)
  const bottomSpacer = new Spacer(1)
  const chatContainer = new Container()

  const editor = new Editor(tui, editorTheme, { paddingX: 1 })

  // Slash command autocomplete
  const slashCommands = [
    { name: 'help', description: 'Show available commands' },
    { name: 'tree', description: 'Display causal tree' },
    { name: 'edges', description: 'Display edge/spread table' },
    { name: 'pos', description: 'Display Kalshi positions' },
    { name: 'eval', description: 'Trigger deep evaluation' },
    { name: 'switch', description: 'Switch thesis (e.g. /switch f582bf76)' },
    { name: 'compact', description: 'Compress conversation history' },
    { name: 'new', description: 'Start fresh session' },
    { name: 'model', description: 'Switch model (e.g. /model anthropic/claude-sonnet-4)' },
    { name: 'env', description: 'Show environment variable status' },
    { name: 'clear', description: 'Clear screen (keeps history)' },
    { name: 'exit', description: 'Exit agent (auto-saves)' },
  ]
  // Add trading commands if enabled
  if (loadConfig().tradingEnabled) {
    slashCommands.splice(-2, 0, // insert before /clear and /exit
      { name: 'buy', description: 'TICKER QTY PRICE — quick buy' },
      { name: 'sell', description: 'TICKER QTY PRICE — quick sell' },
      { name: 'cancel', description: 'ORDER_ID — cancel order' },
    )
  }
  const autocompleteProvider = new CombinedAutocompleteProvider(slashCommands, process.cwd())
  editor.setAutocompleteProvider(autocompleteProvider)

  // Assemble TUI tree
  tui.addChild(topSpacer)
  tui.addChild(chatContainer)
  tui.addChild(editor)
  tui.addChild(bottomSpacer)

  // Focus on editor
  tui.setFocus(editor)

  // ── Overlays (pinned header + footer) ──────────────────────────────────────
  const headerOverlay = tui.showOverlay(headerBar as any, {
    row: 0,
    col: 0,
    width: '100%' as any,
    nonCapturing: true,
  })

  const footerOverlay = tui.showOverlay(footerBar as any, {
    anchor: 'bottom-left',
    width: '100%' as any,
    nonCapturing: true,
  })

  // ── Helper: add system text to chat ────────────────────────────────────────
  function addSystemText(content: string) {
    const text = new Text(content, 1, 0)
    chatContainer.addChild(text)
    tui.requestRender()
  }

  function addSpacer() {
    chatContainer.addChild(new Spacer(1))
  }

  /**
   * Ask the user a question during tool execution.
   * Temporarily unlocks the editor, waits for input, then resumes.
   * Used for order confirmations and other dangerous operations.
   */
  function promptUser(question: string): Promise<string> {
    return new Promise(resolve => {
      addSystemText(C.amber(bold('\u26A0 ')) + C.zinc200(question))
      addSpacer()
      tui.requestRender()
      pendingPrompt = { resolve }
    })
  }

  // ── Define agent tools (same as before) ────────────────────────────────────

  const thesisIdParam = Type.Object({
    thesisId: Type.String({ description: 'Thesis ID (short or full UUID)' }),
  })

  const signalParams = Type.Object({
    thesisId: Type.String({ description: 'Thesis ID' }),
    content: Type.String({ description: 'Signal content' }),
    type: Type.Optional(Type.String({ description: 'Signal type: news, user_note, external. Default: user_note' })),
  })

  const scanParams = Type.Object({
    query: Type.Optional(Type.String({ description: 'Keyword search for Kalshi markets' })),
    series: Type.Optional(Type.String({ description: 'Kalshi series ticker (e.g. KXWTIMAX)' })),
    market: Type.Optional(Type.String({ description: 'Specific market ticker' })),
  })

  const webSearchParams = Type.Object({
    query: Type.String({ description: 'Search keywords' }),
  })

  const emptyParams = Type.Object({})

  const tools: any[] = [
    {
      name: 'get_context',
      label: 'Get Context',
      description: 'Get thesis snapshot: causal tree, edge prices, last evaluation, confidence',
      parameters: thesisIdParam,
      execute: async (_toolCallId: string, params: any) => {
        const ctx = await sfClient.getContext(params.thesisId)
        latestContext = ctx
        headerBar.setFromContext(ctx, initialPositions || undefined)
        tui.requestRender()
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(ctx, null, 2) }],
          details: {},
        }
      },
    },
    {
      name: 'inject_signal',
      label: 'Inject Signal',
      description: 'Inject a signal into the thesis (news, note, external event)',
      parameters: signalParams,
      execute: async (_toolCallId: string, params: any) => {
        const result = await sfClient.injectSignal(
          params.thesisId,
          params.type || 'user_note',
          params.content,
        )
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result) }],
          details: {},
        }
      },
    },
    {
      name: 'trigger_evaluation',
      label: 'Evaluate',
      description: 'Trigger a deep evaluation cycle (heavy model, takes longer)',
      parameters: thesisIdParam,
      execute: async (_toolCallId: string, params: any) => {
        const result = await sfClient.evaluate(params.thesisId)
        // Show confidence change prominently
        if (result.evaluation?.confidenceDelta && Math.abs(result.evaluation.confidenceDelta) >= 0.01) {
          const delta = result.evaluation.confidenceDelta
          const prev = Math.round((result.evaluation.previousConfidence || 0) * 100)
          const now = Math.round((result.evaluation.newConfidence || 0) * 100)
          const arrow = delta > 0 ? '\u25B2' : '\u25BC'
          const color = delta > 0 ? C.emerald : C.red
          addSystemText(color(`  ${arrow} Confidence ${prev}% \u2192 ${now}% (${delta > 0 ? '+' : ''}${Math.round(delta * 100)})`))
          addSpacer()
          // Update header
          headerBar.updateConfidence(result.evaluation.newConfidence, delta)
          tui.requestRender()
        }
        // Refresh context after eval
        try {
          latestContext = await sfClient.getContext(params.thesisId)
          headerBar.setFromContext(latestContext, initialPositions || undefined)
          tui.requestRender()
        } catch {}
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result) }],
          details: {},
        }
      },
    },
    {
      name: 'scan_markets',
      label: 'Scan Markets',
      description: 'Search Kalshi prediction markets. Provide exactly one of: query (keyword search), series (series ticker), or market (specific ticker). If multiple are provided, priority is: market > series > query.',
      parameters: scanParams,
      execute: async (_toolCallId: string, params: any) => {
        let result: any
        if (params.market) {
          result = await kalshiFetchMarket(params.market)
        } else if (params.series) {
          result = await kalshiFetchMarketsBySeries(params.series)
        } else if (params.query) {
          const series = await kalshiFetchAllSeries()
          const keywords = params.query.toLowerCase().split(/\s+/)
          const matched = series
            .filter((s: any) =>
              keywords.every(
                (kw: string) =>
                  (s.title || '').toLowerCase().includes(kw) ||
                  (s.ticker || '').toLowerCase().includes(kw),
              ),
            )
            .slice(0, 15)
          result = matched
        } else {
          result = { error: 'Provide query, series, or market parameter' }
        }
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
          details: {},
        }
      },
    },
    {
      name: 'list_theses',
      label: 'List Theses',
      description: 'List all theses for the current user',
      parameters: emptyParams,
      execute: async () => {
        const theses = await sfClient.listTheses()
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(theses, null, 2) }],
          details: {},
        }
      },
    },
    {
      name: 'get_positions',
      label: 'Get Positions',
      description: 'Get Kalshi exchange positions with live prices and PnL',
      parameters: emptyParams,
      execute: async () => {
        const positions = await getPositions()
        if (!positions) {
          return {
            content: [{ type: 'text' as const, text: 'Kalshi not configured. Set KALSHI_API_KEY_ID and KALSHI_PRIVATE_KEY_PATH.' }],
            details: {},
          }
        }
        for (const pos of positions) {
          const livePrice = await getMarketPrice(pos.ticker)
          if (livePrice !== null) {
            pos.current_value = livePrice
            pos.unrealized_pnl = Math.round((livePrice - pos.average_price_paid) * pos.quantity)
          }
        }
        cachedPositions = positions
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(positions, null, 2) }],
          details: {},
        }
      },
    },
    {
      name: 'web_search',
      label: 'Web Search',
      description: 'Search latest news and information. Use for real-time info not yet covered by the causal tree or heartbeat engine.',
      parameters: webSearchParams,
      execute: async (_toolCallId: string, params: any) => {
        const apiKey = process.env.TAVILY_API_KEY
        if (!apiKey) {
          return {
            content: [{ type: 'text' as const, text: 'Tavily not configured. Set TAVILY_API_KEY to enable web search. You can also manually inject a signal and let the heartbeat engine search.' }],
            details: {},
          }
        }

        const res = await fetch('https://api.tavily.com/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            api_key: apiKey,
            query: params.query,
            max_results: 5,
            search_depth: 'basic',
            include_answer: true,
          }),
        })

        if (!res.ok) {
          return {
            content: [{ type: 'text' as const, text: `Search failed: ${res.status}` }],
            details: {},
          }
        }

        const data = await res.json()

        const results = (data.results || []).map((r: any) =>
          `[${r.title}](${r.url})\n${r.content?.slice(0, 200)}`
        ).join('\n\n')

        const answer = data.answer ? `Summary: ${data.answer}\n\n---\n\n` : ''

        return {
          content: [{ type: 'text' as const, text: `${answer}${results}` }],
          details: {},
        }
      },
    },
    {
      name: 'explore_public',
      label: 'Explore Public Theses',
      description: 'Browse public theses from other users. No auth required. Pass a slug to get details, or omit to list all.',
      parameters: Type.Object({
        slug: Type.Optional(Type.String({ description: 'Specific thesis slug, or empty to list all' })),
      }),
      execute: async (_toolCallId: string, params: any) => {
        const base = 'https://simplefunctions.dev'
        if (params.slug) {
          const res = await fetch(`${base}/api/public/thesis/${params.slug}`)
          if (!res.ok) return { content: [{ type: 'text' as const, text: `Not found: ${params.slug}` }], details: {} }
          const data = await res.json()
          return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }], details: {} }
        }
        const res = await fetch(`${base}/api/public/theses`)
        if (!res.ok) return { content: [{ type: 'text' as const, text: 'Failed to fetch public theses' }], details: {} }
        const data = await res.json()
        return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }], details: {} }
      },
    },
    {
      name: 'create_strategy',
      label: 'Create Strategy',
      description: 'Create a trading strategy for a thesis. Extract hard conditions (entryBelow/stopLoss/takeProfit as cents) and soft conditions from conversation. Called when user mentions specific trade ideas.',
      parameters: Type.Object({
        thesisId: Type.String({ description: 'Thesis ID' }),
        marketId: Type.String({ description: 'Market ticker e.g. KXWTIMAX-26DEC31-T150' }),
        market: Type.String({ description: 'Human-readable market name' }),
        direction: Type.String({ description: 'yes or no' }),
        horizon: Type.Optional(Type.String({ description: 'short, medium, or long. Default: medium' })),
        entryBelow: Type.Optional(Type.Number({ description: 'Entry trigger: ask <= this value (cents)' })),
        entryAbove: Type.Optional(Type.Number({ description: 'Entry trigger: ask >= this value (cents, for NO direction)' })),
        stopLoss: Type.Optional(Type.Number({ description: 'Stop loss: bid <= this value (cents)' })),
        takeProfit: Type.Optional(Type.Number({ description: 'Take profit: bid >= this value (cents)' })),
        maxQuantity: Type.Optional(Type.Number({ description: 'Max total contracts. Default: 500' })),
        perOrderQuantity: Type.Optional(Type.Number({ description: 'Contracts per order. Default: 50' })),
        softConditions: Type.Optional(Type.String({ description: 'LLM-evaluated conditions e.g. "only enter when n3 > 60%"' })),
        rationale: Type.Optional(Type.String({ description: 'Full logic description' })),
      }),
      execute: async (_toolCallId: string, params: any) => {
        const result = await sfClient.createStrategyAPI(params.thesisId, {
          marketId: params.marketId,
          market: params.market,
          direction: params.direction,
          horizon: params.horizon,
          entryBelow: params.entryBelow,
          entryAbove: params.entryAbove,
          stopLoss: params.stopLoss,
          takeProfit: params.takeProfit,
          maxQuantity: params.maxQuantity,
          perOrderQuantity: params.perOrderQuantity,
          softConditions: params.softConditions,
          rationale: params.rationale,
          createdBy: 'agent',
        })
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }], details: {} }
      },
    },
    {
      name: 'list_strategies',
      label: 'List Strategies',
      description: 'List strategies for a thesis. Filter by status (active/watching/executed/cancelled/review) or omit for all.',
      parameters: Type.Object({
        thesisId: Type.String({ description: 'Thesis ID' }),
        status: Type.Optional(Type.String({ description: 'Filter by status. Omit for all.' })),
      }),
      execute: async (_toolCallId: string, params: any) => {
        const result = await sfClient.getStrategies(params.thesisId, params.status)
        return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }], details: {} }
      },
    },
    {
      name: 'update_strategy',
      label: 'Update Strategy',
      description: 'Update a strategy (change stop loss, take profit, status, priority, etc.)',
      parameters: Type.Object({
        thesisId: Type.String({ description: 'Thesis ID' }),
        strategyId: Type.String({ description: 'Strategy ID (UUID)' }),
        stopLoss: Type.Optional(Type.Number({ description: 'New stop loss (cents)' })),
        takeProfit: Type.Optional(Type.Number({ description: 'New take profit (cents)' })),
        entryBelow: Type.Optional(Type.Number({ description: 'New entry below trigger (cents)' })),
        entryAbove: Type.Optional(Type.Number({ description: 'New entry above trigger (cents)' })),
        status: Type.Optional(Type.String({ description: 'New status: active|watching|executed|cancelled|review' })),
        priority: Type.Optional(Type.Number({ description: 'New priority' })),
        softConditions: Type.Optional(Type.String({ description: 'Updated soft conditions' })),
        rationale: Type.Optional(Type.String({ description: 'Updated rationale' })),
      }),
      execute: async (_toolCallId: string, params: any) => {
        const { thesisId, strategyId, ...updates } = params
        const result = await sfClient.updateStrategyAPI(thesisId, strategyId, updates)
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }], details: {} }
      },
    },
    {
      name: 'get_milestones',
      label: 'Milestones',
      description: 'Get upcoming events from Kalshi calendar. Use to check economic releases, political events, or other catalysts coming up that might affect the thesis.',
      parameters: Type.Object({
        hours: Type.Optional(Type.Number({ description: 'Hours ahead to look (default 168 = 1 week)' })),
        category: Type.Optional(Type.String({ description: 'Filter by category (e.g. Economics, Politics, Sports)' })),
      }),
      execute: async (_toolCallId: string, params: any) => {
        const hours = params.hours || 168
        const now = new Date()
        const url = `https://api.elections.kalshi.com/trade-api/v2/milestones?limit=200&minimum_start_date=${now.toISOString()}` +
          (params.category ? `&category=${params.category}` : '')
        const res = await fetch(url, { headers: { 'Accept': 'application/json' } })
        if (!res.ok) return { content: [{ type: 'text' as const, text: `Milestones API error: ${res.status}` }], details: {} }
        const data = await res.json()
        const cutoff = now.getTime() + hours * 3600000
        const filtered = (data.milestones || [])
          .filter((m: any) => new Date(m.start_date).getTime() <= cutoff)
          .slice(0, 30)
          .map((m: any) => ({
            title: m.title,
            category: m.category,
            start_date: m.start_date,
            related_event_tickers: m.related_event_tickers,
            hours_until: Math.round((new Date(m.start_date).getTime() - now.getTime()) / 3600000),
          }))
        return { content: [{ type: 'text' as const, text: JSON.stringify(filtered, null, 2) }], details: {} }
      },
    },
    {
      name: 'get_forecast',
      label: 'Forecast',
      description: 'Get market distribution (P50/P75/P90 percentile history) for a Kalshi event. Shows how market consensus has shifted over time.',
      parameters: Type.Object({
        eventTicker: Type.String({ description: 'Kalshi event ticker (e.g. KXWTIMAX-26DEC31)' }),
        days: Type.Optional(Type.Number({ description: 'Days of history (default 7)' })),
      }),
      execute: async (_toolCallId: string, params: any) => {
        const { getForecastHistory } = await import('../kalshi.js')
        const days = params.days || 7
        // Get series ticker from event
        const evtRes = await fetch(`https://api.elections.kalshi.com/trade-api/v2/events/${params.eventTicker}`, { headers: { 'Accept': 'application/json' } })
        if (!evtRes.ok) return { content: [{ type: 'text' as const, text: `Event not found: ${params.eventTicker}` }], details: {} }
        const evtData = await evtRes.json()
        const seriesTicker = evtData.event?.series_ticker
        if (!seriesTicker) return { content: [{ type: 'text' as const, text: `No series_ticker for ${params.eventTicker}` }], details: {} }

        const history = await getForecastHistory({
          seriesTicker,
          eventTicker: params.eventTicker,
          percentiles: [5000, 7500, 9000],
          startTs: Math.floor((Date.now() - days * 86400000) / 1000),
          endTs: Math.floor(Date.now() / 1000),
          periodInterval: 1440,
        })
        if (!history || history.length === 0) return { content: [{ type: 'text' as const, text: 'No forecast data available' }], details: {} }
        return { content: [{ type: 'text' as const, text: JSON.stringify(history, null, 2) }], details: {} }
      },
    },
    {
      name: 'get_settlements',
      label: 'Settlements',
      description: 'Get settled (resolved) contracts with P&L. Shows which contracts won/lost and realized returns.',
      parameters: Type.Object({
        ticker: Type.Optional(Type.String({ description: 'Filter by market ticker' })),
      }),
      execute: async (_toolCallId: string, params: any) => {
        const { getSettlements } = await import('../kalshi.js')
        const result = await getSettlements({ limit: 100, ticker: params.ticker })
        if (!result) return { content: [{ type: 'text' as const, text: 'Kalshi not configured.' }], details: {} }
        return { content: [{ type: 'text' as const, text: JSON.stringify(result.settlements, null, 2) }], details: {} }
      },
    },
    {
      name: 'get_balance',
      label: 'Balance',
      description: 'Get Kalshi account balance and portfolio value.',
      parameters: emptyParams,
      execute: async () => {
        const { getBalance } = await import('../kalshi.js')
        const result = await getBalance()
        if (!result) return { content: [{ type: 'text' as const, text: 'Kalshi not configured.' }], details: {} }
        return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }], details: {} }
      },
    },
    {
      name: 'get_orders',
      label: 'Orders',
      description: 'Get current resting orders on Kalshi.',
      parameters: Type.Object({
        status: Type.Optional(Type.String({ description: 'Filter by status: resting, canceled, executed. Default: resting' })),
      }),
      execute: async (_toolCallId: string, params: any) => {
        const { getOrders } = await import('../kalshi.js')
        const result = await getOrders({ status: params.status || 'resting', limit: 100 })
        if (!result) return { content: [{ type: 'text' as const, text: 'Kalshi not configured.' }], details: {} }
        return { content: [{ type: 'text' as const, text: JSON.stringify(result.orders, null, 2) }], details: {} }
      },
    },
    {
      name: 'get_fills',
      label: 'Fills',
      description: 'Get recent trade fills (executed trades) on Kalshi.',
      parameters: Type.Object({
        ticker: Type.Optional(Type.String({ description: 'Filter by market ticker' })),
      }),
      execute: async (_toolCallId: string, params: any) => {
        const { getFills } = await import('../kalshi.js')
        const result = await getFills({ ticker: params.ticker, limit: 50 })
        if (!result) return { content: [{ type: 'text' as const, text: 'Kalshi not configured.' }], details: {} }
        return { content: [{ type: 'text' as const, text: JSON.stringify(result.fills, null, 2) }], details: {} }
      },
    },
    {
      name: 'get_schedule',
      label: 'Schedule',
      description: 'Get exchange status (open/closed) and trading hours. Use to check if low liquidity is due to off-hours.',
      parameters: emptyParams,
      execute: async () => {
        try {
          const res = await fetch('https://api.elections.kalshi.com/trade-api/v2/exchange/status', { headers: { 'Accept': 'application/json' } })
          if (!res.ok) return { content: [{ type: 'text' as const, text: `Exchange API error: ${res.status}` }], details: {} }
          const data = await res.json()
          return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }], details: {} }
        } catch (err: any) {
          return { content: [{ type: 'text' as const, text: `Failed: ${err.message}` }], details: {} }
        }
      },
    },
  ]

  // ── What-if tool (always available) ────────────────────────────────────────
  tools.push({
    name: 'what_if',
    label: 'What-If',
    description: 'Run a what-if scenario: override causal tree node probabilities and see how edges and confidence change. Zero LLM cost — pure computation. Use when user asks "what if X happens?" or "what if this node drops to Y%?".',
    parameters: Type.Object({
      overrides: Type.Array(Type.Object({
        nodeId: Type.String({ description: 'Causal tree node ID (e.g. n1, n3.1)' }),
        newProbability: Type.Number({ description: 'New probability 0-1' }),
      }), { description: 'Node probability overrides' }),
    }),
    execute: async (_toolCallId: string, params: any) => {
      // Inline what-if simulation
      const ctx = latestContext
      const allNodes: any[] = []
      function flatten(nodes: any[]) {
        for (const n of nodes) { allNodes.push(n); if (n.children?.length) flatten(n.children) }
      }
      const rawNodes = ctx.causalTree?.nodes || []
      flatten(rawNodes)
      const treeNodes = rawNodes.filter((n: any) => n.depth === 0 || (n.depth === undefined && !n.id.includes('.')))

      const overrideMap = new Map<string, number>(params.overrides.map((o: any) => [o.nodeId, o.newProbability]))

      const oldConf = treeNodes.reduce((s: number, n: any) => s + (n.probability || 0) * (n.importance || 0), 0)
      const newConf = treeNodes.reduce((s: number, n: any) => {
        const p = overrideMap.get(n.id) ?? n.probability ?? 0
        return s + p * (n.importance || 0)
      }, 0)

      const nodeScales = new Map<string, number>()
      for (const [nid, np] of overrideMap.entries()) {
        const nd = allNodes.find((n: any) => n.id === nid)
        if (nd && nd.probability > 0) nodeScales.set(nid, Math.max(0, Math.min(2, np / nd.probability)))
      }

      const edges = (ctx.edges || []).map((edge: any) => {
        const relNode = edge.relatedNodeId
        let scaleFactor = 1
        if (relNode) {
          const candidates = [relNode, relNode.split('.').slice(0, -1).join('.'), relNode.split('.')[0]].filter(Boolean)
          for (const cid of candidates) {
            if (nodeScales.has(cid)) { scaleFactor = nodeScales.get(cid)!; break }
          }
        }
        const mkt = edge.marketPrice || 0
        const oldTP = edge.thesisPrice || edge.thesisImpliedPrice || mkt
        const oldEdge = edge.edge || edge.edgeSize || 0
        const newTP = Math.round((mkt + (oldTP - mkt) * scaleFactor) * 100) / 100
        const dir = edge.direction || 'yes'
        const newEdge = Math.round((dir === 'yes' ? newTP - mkt : mkt - newTP) * 100) / 100
        return {
          market: edge.market || edge.marketTitle || edge.marketId,
          marketPrice: mkt,
          oldEdge,
          newEdge,
          delta: newEdge - oldEdge,
          signal: Math.abs(newEdge - oldEdge) < 1 ? 'unchanged' : (oldEdge > 0 && newEdge < 0) || (oldEdge < 0 && newEdge > 0) ? 'REVERSED' : Math.abs(newEdge) < 2 ? 'GONE' : 'reduced',
        }
      }).filter((e: any) => e.signal !== 'unchanged')

      const result = {
        overrides: params.overrides.map((o: any) => {
          const node = allNodes.find((n: any) => n.id === o.nodeId)
          return { nodeId: o.nodeId, label: node?.label || o.nodeId, oldProb: node?.probability, newProb: o.newProbability }
        }),
        confidence: { old: Math.round(oldConf * 100), new: Math.round(newConf * 100), delta: Math.round((newConf - oldConf) * 100) },
        affectedEdges: edges,
      }
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }], details: {} }
    },
  })

  // ── Trading tools (conditional on tradingEnabled) ──────────────────────────
  const config = loadConfig()
  if (config.tradingEnabled) {
    tools.push(
      {
        name: 'place_order',
        label: 'Place Order',
        description: 'Place a buy or sell order on Kalshi. Shows a preview and asks for user confirmation before executing. Use for limit or market orders.',
        parameters: Type.Object({
          ticker: Type.String({ description: 'Market ticker e.g. KXWTIMAX-26DEC31-T135' }),
          side: Type.String({ description: 'yes or no' }),
          action: Type.String({ description: 'buy or sell' }),
          type: Type.String({ description: 'limit or market' }),
          count: Type.Number({ description: 'Number of contracts' }),
          price_cents: Type.Optional(Type.Number({ description: 'Limit price in cents (1-99). Required for limit orders.' })),
        }),
        execute: async (_toolCallId: string, params: any) => {
          const { createOrder } = await import('../kalshi.js')
          const priceDollars = params.price_cents ? (params.price_cents / 100).toFixed(2) : undefined
          const maxCost = ((params.price_cents || 99) * params.count / 100).toFixed(2)

          // Show preview
          const preview = [
            C.zinc200(bold('ORDER PREVIEW')),
            `  Ticker:   ${params.ticker}`,
            `  Side:     ${params.side === 'yes' ? C.emerald('YES') : C.red('NO')}`,
            `  Action:   ${params.action.toUpperCase()}`,
            `  Quantity: ${params.count}`,
            `  Type:     ${params.type}`,
            params.price_cents ? `  Price:    ${params.price_cents}\u00A2` : '',
            `  Max cost: $${maxCost}`,
          ].filter(Boolean).join('\n')

          addSystemText(preview)
          addSpacer()
          tui.requestRender()

          // Ask for confirmation via promptUser
          const answer = await promptUser('Execute this order? (y/n)')
          if (!answer.toLowerCase().startsWith('y')) {
            return { content: [{ type: 'text' as const, text: 'Order cancelled by user.' }], details: {} }
          }

          try {
            const result = await createOrder({
              ticker: params.ticker,
              side: params.side,
              action: params.action,
              type: params.type,
              count: params.count,
              ...(priceDollars ? { yes_price: priceDollars } : {}),
            })
            const order = result.order || result
            return {
              content: [{ type: 'text' as const, text: `Order placed: ${order.order_id || 'OK'}\nStatus: ${order.status || '-'}\nFilled: ${order.fill_count_fp || 0}/${order.initial_count_fp || params.count}` }],
              details: {},
            }
          } catch (err: any) {
            const msg = err.message || String(err)
            if (msg.includes('403')) {
              return { content: [{ type: 'text' as const, text: '403 Forbidden \u2014 your Kalshi key lacks write permission. Get a read+write key at kalshi.com/account/api-keys' }], details: {} }
            }
            return { content: [{ type: 'text' as const, text: `Order failed: ${msg}` }], details: {} }
          }
        },
      },
      {
        name: 'cancel_order',
        label: 'Cancel Order',
        description: 'Cancel a resting order by order ID.',
        parameters: Type.Object({
          order_id: Type.String({ description: 'Order ID to cancel' }),
        }),
        execute: async (_toolCallId: string, params: any) => {
          const { cancelOrder } = await import('../kalshi.js')
          const answer = await promptUser(`Cancel order ${params.order_id}? (y/n)`)
          if (!answer.toLowerCase().startsWith('y')) {
            return { content: [{ type: 'text' as const, text: 'Cancel aborted by user.' }], details: {} }
          }
          try {
            await cancelOrder(params.order_id)
            return { content: [{ type: 'text' as const, text: `Order ${params.order_id} cancelled.` }], details: {} }
          } catch (err: any) {
            return { content: [{ type: 'text' as const, text: `Cancel failed: ${err.message}` }], details: {} }
          }
        },
      },
    )
  }

  // ── System prompt builder ──────────────────────────────────────────────────
  function buildSystemPrompt(ctx: any): string {
    const edgesSummary = ctx.edges
      ?.sort((a: any, b: any) => Math.abs(b.edge) - Math.abs(a.edge))
      .slice(0, 5)
      .map((e: any) => `  ${(e.market || '').slice(0, 40)} | ${e.venue || 'kalshi'} | mkt ${e.marketPrice}\u00A2 \u2192 thesis ${e.thesisPrice}\u00A2 | edge ${e.edge > 0 ? '+' : ''}${e.edge} | ${e.orderbook?.liquidityScore || '?'}`)
      .join('\n') || '  (no edge data)';

    const nodesSummary = ctx.causalTree?.nodes
      ?.filter((n: any) => n.depth === 0)
      .map((n: any) => `  ${n.id} ${(n.label || '').slice(0, 40)} \u2014 ${Math.round(n.probability * 100)}%`)
      .join('\n') || '  (no causal tree)';

    const conf = typeof ctx.confidence === 'number'
      ? Math.round(ctx.confidence * 100)
      : (typeof ctx.confidence === 'string' ? parseInt(ctx.confidence) : 0)

    return `You are a prediction market trading assistant. Your job is not to please the user \u2014 it is to help them see reality clearly and make correct trading decisions.

## Your analytical framework

Each thesis has a causal tree. Every node is a causal hypothesis with a probability. Nodes have causal relationships \u2014 when upstream nodes change, downstream nodes follow.

Edge = thesis-implied price - actual market price. Positive edge means the market underprices this event. Negative edge means overpriced. Contracts with large edges AND good liquidity are the most tradeable.

executableEdge is the real edge after subtracting the bid-ask spread. A contract with a big theoretical edge but wide spread may not be worth entering.

Short-term markets (weekly/monthly contracts) settle into hard data that calibrates the long-term thesis. Don't use them to bet (outcomes are nearly known) \u2014 use them to verify whether causal tree node probabilities are accurate.

## Your behavioral rules

- Think before calling tools. If the data is already in context, don't re-fetch.
- If the user asks about positions, check if Kalshi is configured first. If not, say so directly.
- If the user says "note this" or mentions a news event, inject a signal. Don't ask "should I note this?"
- If the user says "evaluate" or "run it", trigger immediately. Don't confirm.
- Don't end every response with "anything else?" \u2014 the user will ask when they want to.
- If the user asks about latest news or real-time events, use web_search first, then answer based on results. If you find important information, suggest injecting it as a signal.
- If you notice an edge narrowing or disappearing, say so proactively. Don't only report good news.
- If a causal tree node probability seriously contradicts the market price, point it out.
- Use Chinese if the user writes in Chinese, English if they write in English.
- For any question about prices, positions, or P&L, ALWAYS call a tool to get fresh data first. Never answer price-related questions using the cached data in this system prompt.
- Align tables. Be precise with numbers to the cent.

## Strategy rules

When the conversation produces a concrete trade idea (specific contract, direction, price conditions), use create_strategy to record it immediately. Don't wait for the user to say "record this."
- Extract hard conditions (specific prices in cents) into entryBelow/stopLoss/takeProfit.
- Put fuzzy conditions into softConditions (e.g. "only if n3 > 60%", "spread < 3¢").
- Put the full reasoning into rationale.
- After creating, confirm the strategy details and mention that sf runtime --dangerous can execute it.
- If the user says "change the stop loss on T150 to 30", use update_strategy.

## Current thesis state

Thesis: ${ctx.thesis || ctx.rawThesis || 'N/A'}
ID: ${ctx.thesisId || resolvedThesisId}
Confidence: ${conf}%
Status: ${ctx.status}

Top-level causal tree nodes:
${nodesSummary}

Top 5 edges by magnitude:
${edgesSummary}

${ctx.lastEvaluation?.summary ? `Latest evaluation summary: ${ctx.lastEvaluation.summary.slice(0, 300)}` : ''}`
  }

  const systemPrompt = buildSystemPrompt(latestContext)

  // ── Create Agent ───────────────────────────────────────────────────────────
  const agent = new Agent({
    initialState: {
      systemPrompt,
      model,
      tools,
      thinkingLevel: 'off' as any,
    },
    streamFn: streamSimple,
    getApiKey: (provider: string) => {
      if (provider === 'openrouter') return openrouterKey
      return undefined
    },
  })

  // ── Session restore ────────────────────────────────────────────────────────
  let sessionRestored = false
  if (!opts?.newSession) {
    const saved = loadSession(resolvedThesisId!)
    if (saved?.messages?.length > 0) {
      try {
        agent.replaceMessages(saved.messages)
        // Always update system prompt with fresh context
        agent.setSystemPrompt(systemPrompt)
        sessionRestored = true
      } catch { /* corrupt session, start fresh */ }
    }
  }

  // Helper to persist session after each turn
  function persistSession() {
    try {
      const msgs = agent.state.messages
      if (msgs.length > 0) {
        saveSession(resolvedThesisId!, currentModelName, msgs)
      }
    } catch { /* best-effort save */ }
  }

  // ── Subscribe to agent events → update TUI ────────────────────────────────
  let currentAssistantMd: InstanceType<typeof Markdown> | null = null
  let currentAssistantText = ''
  let currentLoader: InstanceType<typeof Loader> | null = null
  const toolStartTimes = new Map<string, number>()
  const toolLines = new Map<string, InstanceType<typeof MutableLine>>()

  // Throttle renders during streaming to prevent flicker (max ~15fps)
  let renderTimer: ReturnType<typeof setTimeout> | null = null
  function throttledRender() {
    if (renderTimer) return
    renderTimer = setTimeout(() => {
      renderTimer = null
      tui.requestRender()
    }, 66)
  }
  function flushRender() {
    if (renderTimer) {
      clearTimeout(renderTimer)
      renderTimer = null
    }
    tui.requestRender()
  }

  agent.subscribe((event: any) => {
    if (event.type === 'message_start') {
      // Show loader while waiting for first text
      currentAssistantText = ''
      currentAssistantMd = null
      currentLoader = new Loader(tui, (s: string) => C.emerald(s), (s: string) => C.zinc600(s), 'thinking...')
      currentLoader.start()
      chatContainer.addChild(currentLoader)
      tui.requestRender()
    }

    if (event.type === 'message_update') {
      const e = event.assistantMessageEvent
      if (e.type === 'text_delta') {
        // Remove loader on first text delta
        if (currentLoader) {
          currentLoader.stop()
          chatContainer.removeChild(currentLoader)
          currentLoader = null
          // Create markdown component for assistant response
          currentAssistantMd = new Markdown('', 1, 0, mdTheme, mdDefaultStyle)
          chatContainer.addChild(currentAssistantMd)
        }
        currentAssistantText += e.delta
        if (currentAssistantMd) {
          currentAssistantMd.setText(currentAssistantText)
        }
        // Throttled render to prevent flicker during fast token streaming
        throttledRender()
      }
    }

    if (event.type === 'message_end') {
      // Clean up loader if still present (no text was generated)
      if (currentLoader) {
        currentLoader.stop()
        chatContainer.removeChild(currentLoader)
        currentLoader = null
      }
      // Final render of the complete message
      if (currentAssistantMd && currentAssistantText) {
        currentAssistantMd.setText(currentAssistantText)
      }
      addSpacer()
      currentAssistantMd = null
      currentAssistantText = ''
      flushRender()
    }

    if (event.type === 'agent_end') {
      // Agent turn fully complete — safe to accept new input
      isProcessing = false
      persistSession()
      flushRender()

      // Deliver queued heartbeat notification if any
      if (pendingHeartbeatDelta) {
        const delta = pendingHeartbeatDelta
        pendingHeartbeatDelta = null
        handleHeartbeatDelta(delta)
      }
    }

    if (event.type === 'tool_execution_start') {
      const toolLine = new MutableLine(C.zinc600(`  \u26A1 ${event.toolName}...`))
      toolStartTimes.set(event.toolCallId || event.toolName, Date.now())
      toolLines.set(event.toolCallId || event.toolName, toolLine)
      chatContainer.addChild(toolLine)
      totalToolCalls++
      footerBar.toolCount = totalToolCalls
      footerBar.update()
      tui.requestRender()
    }

    if (event.type === 'tool_execution_end') {
      const key = event.toolCallId || event.toolName
      const startTime = toolStartTimes.get(key)
      const elapsed = startTime ? ((Date.now() - startTime) / 1000).toFixed(1) : '?'
      const line = toolLines.get(key)
      if (line) {
        if (event.isError) {
          line.setText(C.red(`  \u2717 ${event.toolName} (${elapsed}s) error`))
        } else {
          line.setText(C.zinc600(`  \u26A1 ${event.toolName}`) + C.emerald(` \u2713`) + C.zinc600(` (${elapsed}s)`))
        }
      }
      toolStartTimes.delete(key)
      toolLines.delete(key)
      tui.requestRender()
    }
  })

  // ── Slash command handlers ─────────────────────────────────────────────────

  async function handleSlashCommand(cmd: string): Promise<boolean> {
    const parts = cmd.trim().split(/\s+/)
    const command = parts[0].toLowerCase()

    switch (command) {
      case '/help': {
        addSpacer()
        addSystemText(
          C.zinc200(bold('Commands')) + '\n' +
          C.emerald('/help      ') + C.zinc400('Show this help') + '\n' +
          C.emerald('/tree      ') + C.zinc400('Display causal tree') + '\n' +
          C.emerald('/edges     ') + C.zinc400('Display edge/spread table') + '\n' +
          C.emerald('/pos       ') + C.zinc400('Display Kalshi positions') + '\n' +
          C.emerald('/eval      ') + C.zinc400('Trigger deep evaluation') + '\n' +
          C.emerald('/switch <id>') + C.zinc400(' Switch thesis') + '\n' +
          C.emerald('/compact   ') + C.zinc400('Compress conversation history') + '\n' +
          C.emerald('/new       ') + C.zinc400('Start fresh session') + '\n' +
          C.emerald('/model <m> ') + C.zinc400('Switch model') + '\n' +
          C.emerald('/env       ') + C.zinc400('Show environment variable status') + '\n' +
          (config.tradingEnabled ? (
            C.zinc600('\u2500'.repeat(30)) + '\n' +
            C.emerald('/buy       ') + C.zinc400('TICKER QTY PRICE \u2014 quick buy') + '\n' +
            C.emerald('/sell      ') + C.zinc400('TICKER QTY PRICE \u2014 quick sell') + '\n' +
            C.emerald('/cancel    ') + C.zinc400('ORDER_ID \u2014 cancel order') + '\n' +
            C.zinc600('\u2500'.repeat(30)) + '\n'
          ) : '') +
          C.emerald('/clear     ') + C.zinc400('Clear screen (keeps history)') + '\n' +
          C.emerald('/exit      ') + C.zinc400('Exit (auto-saves)')
        )
        addSpacer()
        return true
      }

      case '/tree': {
        addSpacer()
        // Refresh context first
        try {
          latestContext = await sfClient.getContext(resolvedThesisId!)
          addSystemText(C.zinc200(bold('Causal Tree')) + '\n' + renderCausalTree(latestContext, piTui))
        } catch (err: any) {
          addSystemText(C.red(`Error: ${err.message}`))
        }
        addSpacer()
        return true
      }

      case '/edges': {
        addSpacer()
        try {
          latestContext = await sfClient.getContext(resolvedThesisId!)
          // Attach cached positions for display
          if (cachedPositions) {
            latestContext._positions = cachedPositions
          }
          addSystemText(C.zinc200(bold('Edges')) + '\n' + renderEdges(latestContext, piTui))
        } catch (err: any) {
          addSystemText(C.red(`Error: ${err.message}`))
        }
        addSpacer()
        return true
      }

      case '/pos': {
        addSpacer()
        try {
          const positions = await getPositions()
          if (!positions) {
            addSystemText(C.zinc600('Kalshi not configured'))
            return true
          }
          for (const pos of positions) {
            const livePrice = await getMarketPrice(pos.ticker)
            if (livePrice !== null) {
              pos.current_value = livePrice
              pos.unrealized_pnl = Math.round((livePrice - pos.average_price_paid) * pos.quantity)
            }
          }
          cachedPositions = positions
          addSystemText(C.zinc200(bold('Positions')) + '\n' + renderPositions(positions))
        } catch (err: any) {
          addSystemText(C.red(`Error: ${err.message}`))
        }
        addSpacer()
        return true
      }

      case '/eval': {
        addSpacer()
        addSystemText(C.zinc600('Triggering evaluation...'))
        tui.requestRender()
        try {
          const result = await sfClient.evaluate(resolvedThesisId!)
          addSystemText(C.emerald('Evaluation complete') + '\n' + C.zinc400(JSON.stringify(result, null, 2)))
        } catch (err: any) {
          addSystemText(C.red(`Error: ${err.message}`))
        }
        addSpacer()
        return true
      }

      case '/model': {
        const newModel = parts.slice(1).join(' ').trim()
        if (!newModel) {
          addSystemText(C.zinc400(`Current model: ${currentModelName}`))
          return true
        }
        addSpacer()
        currentModelName = newModel.replace(/^openrouter\//, '')
        model = resolveModel(currentModelName)
        // Update agent model
        agent.setModel(model)
        footerBar.modelName = currentModelName
        footerBar.update()
        addSystemText(C.emerald(`Model switched to ${currentModelName}`))
        addSpacer()
        tui.requestRender()
        return true
      }

      case '/switch': {
        const newId = parts[1]?.trim()
        if (!newId) {
          addSystemText(C.zinc400('Usage: /switch <thesisId>'))
          return true
        }
        addSpacer()
        try {
          // Save current session
          persistSession()
          // Load new thesis context
          const newContext = await sfClient.getContext(newId)
          resolvedThesisId = newContext.thesisId || newId
          latestContext = newContext
          // Build new system prompt using the rich builder
          const newSysPrompt = buildSystemPrompt(newContext)
          const newConf = typeof newContext.confidence === 'number'
            ? Math.round(newContext.confidence * 100) : 0

          // CRITICAL: Always clearMessages() first to reset agent internal state.
          // replaceMessages() on a mid-conversation agent corrupts pi-agent-core's
          // state machine, causing the TUI to freeze.
          agent.clearMessages()

          // Load saved session or start fresh
          const saved = loadSession(resolvedThesisId!)
          if (saved?.messages?.length > 0) {
            agent.replaceMessages(saved.messages)
            agent.setSystemPrompt(newSysPrompt)
            addSystemText(C.emerald(`Switched to ${resolvedThesisId!.slice(0, 8)}`) + C.zinc400(` (resumed ${saved.messages.length} messages)`))
          } else {
            agent.setSystemPrompt(newSysPrompt)
            addSystemText(C.emerald(`Switched to ${resolvedThesisId!.slice(0, 8)}`) + C.zinc400(' (new session)'))
          }
          // Update header
          headerBar.setFromContext(newContext, initialPositions || undefined)
          chatContainer.clear()
          addSystemText(buildWelcomeDashboard(newContext, initialPositions)
          )
        } catch (err: any) {
          addSystemText(C.red(`Switch failed: ${err.message}`))
        }
        addSpacer()
        // Force re-focus editor so input stays responsive
        tui.setFocus(editor)
        tui.requestRender()
        return true
      }

      case '/compact': {
        addSpacer()
        try {
          const msgs = agent.state.messages as any[]
          if (msgs.length <= 10) {
            addSystemText(C.zinc400('Conversation too short to compact'))
            addSpacer()
            tui.setFocus(editor)
            return true
          }

          // ── Find clean cut point ──────────────────────────────────────
          // Walk backwards counting user messages as turn starts.
          // Keep 3 complete turns. Never split a tool_call/tool_result pair.
          const turnsToKeep = 3
          let turnsSeen = 0
          let cutIndex = msgs.length

          for (let i = msgs.length - 1; i >= 0; i--) {
            if (msgs[i].role === 'user') {
              turnsSeen++
              if (turnsSeen >= turnsToKeep) {
                cutIndex = i
                break
              }
            }
          }

          if (cutIndex <= 2) {
            addSystemText(C.zinc400('Not enough complete turns to compact'))
            addSpacer()
            tui.setFocus(editor)
            return true
          }

          const toCompress = msgs.slice(0, cutIndex)
          const toKeep = msgs.slice(cutIndex)

          // ── Show loader ───────────────────────────────────────────────
          const compactLoader = new Loader(
            tui,
            (s: string) => C.emerald(s),
            (s: string) => C.zinc600(s),
            'compacting with LLM...',
          )
          compactLoader.start()
          chatContainer.addChild(compactLoader)
          tui.requestRender()

          // ── Serialize messages for the summarizer ─────────────────────
          // Strip tool results to raw text, cap total length to ~12k chars
          const serialized: string[] = []
          let totalLen = 0
          const MAX_CHARS = 12000

          for (const m of toCompress) {
            if (totalLen >= MAX_CHARS) break
            let text = ''
            if (typeof m.content === 'string') {
              text = m.content
            } else if (Array.isArray(m.content)) {
              // OpenAI format: content blocks
              text = m.content
                .filter((b: any) => b.type === 'text')
                .map((b: any) => b.text)
                .join('\n')
            }
            if (!text) continue

            const role = (m.role || 'unknown').toUpperCase()
            const truncated = text.slice(0, 800)
            const line = `[${role}]: ${truncated}`
            serialized.push(line)
            totalLen += line.length
          }

          const conversationDump = serialized.join('\n\n')

          // ── Call OpenRouter for LLM summary ───────────────────────────
          // Use a cheap/fast model — gemini flash
          const summaryModel = 'google/gemini-2.0-flash-001'
          const summarySystemPrompt = `You are a conversation compressor. Given a conversation between a user and a prediction-market trading assistant, produce a dense summary that preserves:
1. All factual conclusions, numbers, prices, and probabilities mentioned
2. Key trading decisions, positions taken or discussed
3. Signals injected, evaluations triggered, and their outcomes
4. Any action items or pending questions

Output a structured summary. Be concise but preserve every important detail — this summary replaces the original messages for continued conversation. Do NOT add commentary or meta-text. Just the summary.`

          let summaryText: string

          try {
            const orRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${openrouterKey}`,
                'HTTP-Referer': 'https://simplefunctions.com',
                'X-Title': 'SF Agent Compact',
              },
              body: JSON.stringify({
                model: summaryModel,
                messages: [
                  { role: 'system', content: summarySystemPrompt },
                  { role: 'user', content: `Summarize this conversation (${toCompress.length} messages):\n\n${conversationDump}` },
                ],
                max_tokens: 2000,
                temperature: 0.2,
              }),
            })

            if (!orRes.ok) {
              const errText = await orRes.text().catch(() => '')
              throw new Error(`OpenRouter ${orRes.status}: ${errText.slice(0, 200)}`)
            }

            const orData = await orRes.json()
            summaryText = orData.choices?.[0]?.message?.content || ''

            if (!summaryText) {
              throw new Error('Empty summary from LLM')
            }
          } catch (llmErr: any) {
            // LLM failed — fall back to bullet-point extraction
            const bulletPoints: string[] = []
            for (const m of toCompress) {
              const content = typeof m.content === 'string' ? m.content : ''
              if (m.role === 'user' && content) {
                bulletPoints.push(`- User: ${content.slice(0, 100)}`)
              } else if (m.role === 'assistant' && content) {
                bulletPoints.push(`- Assistant: ${content.slice(0, 150)}`)
              }
            }
            summaryText = `[LLM summary failed: ${llmErr.message}. Fallback bullet points:]\n\n${bulletPoints.slice(-20).join('\n')}`
          }

          // ── Remove loader ─────────────────────────────────────────────
          compactLoader.stop()
          chatContainer.removeChild(compactLoader)

          // ── Build compacted message array ──────────────────────────────
          // user(summary) → assistant(ack) → ...toKeep
          // This maintains valid user→assistant alternation.
          // toKeep starts with a user message (guaranteed by our cut logic).
          const compactedMessages: any[] = [
            {
              role: 'user',
              content: `[Conversation summary — ${toCompress.length} messages compressed]\n\n${summaryText}`,
            },
            {
              role: 'assistant',
              content: 'Understood. I have the full conversation context from the summary above. Continuing from where we left off.',
            },
            ...toKeep,
          ]

          // ── Replace agent state ───────────────────────────────────────
          // Clear first to reset internal state, then load compacted messages
          agent.clearMessages()
          agent.replaceMessages(compactedMessages)
          agent.setSystemPrompt(systemPrompt)
          persistSession()

          addSystemText(
            C.emerald(`Compacted: ${toCompress.length} messages \u2192 summary + ${toKeep.length} recent`) +
            C.zinc600(` (via ${summaryModel.split('/').pop()})`)
          )
          addSpacer()

          // Force re-focus and render so editor stays responsive
          tui.setFocus(editor)
          tui.requestRender()
        } catch (err: any) {
          addSystemText(C.red(`Compact failed: ${err.message || err}`))
          addSpacer()
          tui.setFocus(editor)
          tui.requestRender()
        }
        return true
      }

      case '/new': {
        addSpacer()
        persistSession() // save current before clearing
        agent.clearMessages()
        agent.setSystemPrompt(systemPrompt)
        chatContainer.clear()
        addSystemText(C.emerald('Session cleared') + C.zinc400(' \u2014 fresh start'))
        addSpacer()
        tui.requestRender()
        return true
      }

      case '/env': {
        addSpacer()
        const envVars = [
          { name: 'SF_API_KEY', key: 'SF_API_KEY', required: true, mask: true },
          { name: 'SF_API_URL', key: 'SF_API_URL', required: false, mask: false },
          { name: 'OPENROUTER_KEY', key: 'OPENROUTER_API_KEY', required: true, mask: true },
          { name: 'KALSHI_KEY_ID', key: 'KALSHI_API_KEY_ID', required: false, mask: true },
          { name: 'KALSHI_PEM_PATH', key: 'KALSHI_PRIVATE_KEY_PATH', required: false, mask: false },
          { name: 'TAVILY_API_KEY', key: 'TAVILY_API_KEY', required: false, mask: true },
        ]

        const lines = envVars.map(v => {
          const val = process.env[v.key]
          if (val) {
            const display = v.mask
              ? val.slice(0, Math.min(8, val.length)) + '...' + val.slice(-4)
              : val
            return `  ${v.name.padEnd(18)} ${C.emerald('\u2713')} ${C.zinc400(display)}`
          } else {
            const note = v.required ? '\u5FC5\u987B' : '\u53EF\u9009'
            return `  ${v.name.padEnd(18)} ${C.red('\u2717')} ${C.zinc600(`\u672A\u914D\u7F6E\uFF08${note}\uFF09`)}`
          }
        })

        addSystemText(C.zinc200(bold('Environment')) + '\n' + lines.join('\n'))
        addSpacer()
        return true
      }

      case '/clear': {
        chatContainer.clear()
        tui.requestRender()
        return true
      }

      case '/buy': {
        // /buy TICKER QTY PRICE — quick trade without LLM
        const [, ticker, qtyStr, priceStr] = parts
        if (!ticker || !qtyStr || !priceStr) {
          addSystemText(C.zinc400('Usage: /buy TICKER QTY PRICE_CENTS  (e.g. /buy KXWTIMAX-26DEC31-T135 100 50)'))
          return true
        }
        if (!config.tradingEnabled) {
          addSystemText(C.red('Trading disabled. Run: sf setup --enable-trading'))
          return true
        }
        addSpacer()
        const answer = await promptUser(`BUY ${qtyStr}x ${ticker} YES @ ${priceStr}\u00A2 — execute? (y/n)`)
        if (answer.toLowerCase().startsWith('y')) {
          try {
            const { createOrder } = await import('../kalshi.js')
            const result = await createOrder({
              ticker, side: 'yes', action: 'buy', type: 'limit',
              count: parseInt(qtyStr),
              yes_price: (parseInt(priceStr) / 100).toFixed(2),
            })
            addSystemText(C.emerald('\u2713 Order placed: ' + ((result.order || result).order_id || 'OK')))
          } catch (err: any) {
            addSystemText(C.red('\u2717 ' + err.message))
          }
        } else {
          addSystemText(C.zinc400('Cancelled.'))
        }
        addSpacer()
        return true
      }

      case '/sell': {
        const [, ticker, qtyStr, priceStr] = parts
        if (!ticker || !qtyStr || !priceStr) {
          addSystemText(C.zinc400('Usage: /sell TICKER QTY PRICE_CENTS'))
          return true
        }
        if (!config.tradingEnabled) {
          addSystemText(C.red('Trading disabled. Run: sf setup --enable-trading'))
          return true
        }
        addSpacer()
        const answer = await promptUser(`SELL ${qtyStr}x ${ticker} YES @ ${priceStr}\u00A2 — execute? (y/n)`)
        if (answer.toLowerCase().startsWith('y')) {
          try {
            const { createOrder } = await import('../kalshi.js')
            const result = await createOrder({
              ticker, side: 'yes', action: 'sell', type: 'limit',
              count: parseInt(qtyStr),
              yes_price: (parseInt(priceStr) / 100).toFixed(2),
            })
            addSystemText(C.emerald('\u2713 Order placed: ' + ((result.order || result).order_id || 'OK')))
          } catch (err: any) {
            addSystemText(C.red('\u2717 ' + err.message))
          }
        } else {
          addSystemText(C.zinc400('Cancelled.'))
        }
        addSpacer()
        return true
      }

      case '/cancel': {
        const [, orderId] = parts
        if (!orderId) {
          addSystemText(C.zinc400('Usage: /cancel ORDER_ID'))
          return true
        }
        if (!config.tradingEnabled) {
          addSystemText(C.red('Trading disabled. Run: sf setup --enable-trading'))
          return true
        }
        addSpacer()
        try {
          const { cancelOrder } = await import('../kalshi.js')
          await cancelOrder(orderId)
          addSystemText(C.emerald(`\u2713 Order ${orderId} cancelled.`))
        } catch (err: any) {
          addSystemText(C.red('\u2717 ' + err.message))
        }
        addSpacer()
        return true
      }

      case '/exit':
      case '/quit': {
        cleanup()
        return true
      }

      default:
        return false
    }
  }

  // ── Editor submit handler ──────────────────────────────────────────────────
  editor.onSubmit = async (input: string) => {
    const trimmed = input.trim()
    if (!trimmed) return

    // If a tool is waiting for user confirmation, resolve it
    if (pendingPrompt) {
      const { resolve } = pendingPrompt
      pendingPrompt = null
      const userResponse = new Text(C.zinc400('  > ') + C.zinc200(trimmed), 1, 0)
      chatContainer.addChild(userResponse)
      addSpacer()
      tui.requestRender()
      resolve(trimmed)
      return
    }

    if (isProcessing) return

    // Add to editor history
    editor.addToHistory(trimmed)

    // Check for slash commands
    if (trimmed.startsWith('/')) {
      const handled = await handleSlashCommand(trimmed)
      if (handled) return
    }

    // Regular message → send to agent
    isProcessing = true

    // Add user message to chat
    const userMsg = new Text(C.emerald(bold('>')) + ' ' + C.white(trimmed), 1, 0)
    chatContainer.addChild(userMsg)
    addSpacer()
    tui.requestRender()

    try {
      await agent.prompt(trimmed)
    } catch (err: any) {
      // Remove loader if present
      if (currentLoader) {
        currentLoader.stop()
        chatContainer.removeChild(currentLoader)
        currentLoader = null
      }
      addSystemText(C.red(`Error: ${err.message}`))
      addSpacer()
      isProcessing = false
    }
  }

  // ── Ctrl+C handler ─────────────────────────────────────────────────────────
  function cleanup() {
    if (heartbeatPollTimer) clearInterval(heartbeatPollTimer)
    if (currentLoader) currentLoader.stop()
    persistSession()
    tui.stop()
    process.exit(0)
  }

  // Listen for Ctrl+C at the TUI level
  tui.addInputListener((data: string) => {
    // Ctrl+C = \x03
    if (data === '\x03') {
      cleanup()
      return { consume: true }
    }
    return undefined
  })

  // Also handle SIGINT
  process.on('SIGINT', cleanup)
  process.on('SIGTERM', cleanup)

  // ── Welcome dashboard builder ────────────────────────────────────────────
  function buildWelcomeDashboard(ctx: any, positions?: any[] | null): string {
    const lines: string[] = []
    const thesisText = ctx.thesis || ctx.rawThesis || 'N/A'
    const truncated = thesisText.length > 100 ? thesisText.slice(0, 100) + '...' : thesisText
    const conf = typeof ctx.confidence === 'number'
      ? Math.round(ctx.confidence * 100)
      : (typeof ctx.confidence === 'string' ? Math.round(parseFloat(ctx.confidence) * 100) : 0)
    const delta = ctx.lastEvaluation?.confidenceDelta
      ? Math.round(ctx.lastEvaluation.confidenceDelta * 100)
      : 0
    const deltaStr = delta !== 0 ? ` (${delta > 0 ? '+' : ''}${delta})` : ''
    const evalAge = ctx.lastEvaluation?.evaluatedAt
      ? Math.round((Date.now() - new Date(ctx.lastEvaluation.evaluatedAt).getTime()) / 3600000)
      : null

    lines.push(C.zinc600('\u2500'.repeat(55)))
    lines.push(' ' + C.zinc200(bold(truncated)))
    lines.push(' ' + C.zinc600(`${ctx.status || 'active'}  ${conf}%${deltaStr}`) +
      (evalAge !== null ? C.zinc600(`  \u2502  last eval: ${evalAge < 1 ? '<1' : evalAge}h ago`) : ''))
    lines.push(C.zinc600('\u2500'.repeat(55)))

    // Positions section
    if (positions && positions.length > 0) {
      lines.push(' ' + C.zinc400(bold('POSITIONS')))
      let totalPnl = 0
      for (const p of positions) {
        const pnlCents = p.unrealized_pnl || 0
        totalPnl += pnlCents
        const pnlStr = pnlCents >= 0
          ? C.emerald(`+$${(pnlCents / 100).toFixed(2)}`)
          : C.red(`-$${(Math.abs(pnlCents) / 100).toFixed(2)}`)
        const ticker = (p.ticker || '').slice(0, 28).padEnd(28)
        const qty = String(p.quantity || 0).padStart(5)
        const side = p.side === 'yes' ? C.emerald('Y') : C.red('N')
        lines.push(`  ${C.zinc400(ticker)} ${qty} ${side}  ${pnlStr}`)
      }
      const totalStr = totalPnl >= 0
        ? C.emerald(bold(`+$${(totalPnl / 100).toFixed(2)}`))
        : C.red(bold(`-$${(Math.abs(totalPnl) / 100).toFixed(2)}`))
      lines.push(`  ${''.padEnd(28)} ${C.zinc600('Total')} ${totalStr}`)
    }

    // Top edges section
    const edges = ctx.edges || []
    if (edges.length > 0) {
      const sorted = [...edges].sort((a: any, b: any) =>
        Math.abs(b.edge || b.edgeSize || 0) - Math.abs(a.edge || a.edgeSize || 0)
      ).slice(0, 5)

      lines.push(C.zinc600('\u2500'.repeat(55)))
      lines.push(' ' + C.zinc400(bold('TOP EDGES')) + C.zinc600('                          mkt   edge  liq'))
      for (const e of sorted) {
        const name = (e.market || e.marketTitle || e.marketId || '').slice(0, 30).padEnd(30)
        const mkt = String(Math.round(e.marketPrice || 0)).padStart(3) + '\u00A2'
        const edge = e.edge || e.edgeSize || 0
        const edgeStr = (edge > 0 ? '+' : '') + Math.round(edge)
        const liq = e.orderbook?.liquidityScore || (e.venue === 'polymarket' ? '-' : '?')
        const edgeColor = Math.abs(edge) >= 15 ? C.emerald : Math.abs(edge) >= 8 ? C.amber : C.zinc400
        lines.push(`  ${C.zinc400(name)} ${C.zinc400(mkt)}  ${edgeColor(edgeStr.padStart(4))}  ${C.zinc600(liq)}`)
      }
    }

    lines.push(C.zinc600('\u2500'.repeat(55)))
    return lines.join('\n')
  }

  // ── Show initial welcome ───────────────────────────────────────────────────
  const sessionStatus = sessionRestored
    ? C.zinc600(`resumed (${agent.state.messages.length} messages)`)
    : C.zinc600('new session')

  addSystemText(buildWelcomeDashboard(latestContext, initialPositions))
  addSystemText(' ' + sessionStatus)
  addSpacer()

  // ── Heartbeat delta handler ───────────────────────────────────────────────
  const HEARTBEAT_CONFIDENCE_THRESHOLD = 0.03 // 3%

  function handleHeartbeatDelta(delta: any) {
    const absDelta = Math.abs(delta.confidenceDelta || 0)
    const confPct = Math.round((delta.confidence || 0) * 100)
    const deltaPct = Math.round((delta.confidenceDelta || 0) * 100)
    const sign = deltaPct > 0 ? '+' : ''

    if (absDelta >= HEARTBEAT_CONFIDENCE_THRESHOLD) {
      // Big change → auto-trigger agent analysis
      const arrow = deltaPct > 0 ? '\u25B2' : '\u25BC'
      const color = deltaPct > 0 ? C.emerald : C.red
      addSystemText(color(`  ${arrow} Heartbeat: confidence ${sign}${deltaPct}% → ${confPct}%`))
      if (delta.latestSummary) {
        addSystemText(C.zinc400(`  ${delta.latestSummary.slice(0, 100)}`))
      }
      addSpacer()

      // Update header
      headerBar.setFromContext({ ...latestContext, confidence: delta.confidence, lastEvaluation: { confidenceDelta: delta.confidenceDelta } }, initialPositions || undefined)
      tui.requestRender()

      // Auto-trigger agent
      isProcessing = true
      const prompt = `[HEARTBEAT ALERT] Confidence just changed ${sign}${deltaPct}% to ${confPct}%. ${delta.evaluationCount} evaluation(s) since last check. Latest: "${(delta.latestSummary || '').slice(0, 150)}". Briefly analyze what happened and whether any action is needed. Be concise.`
      agent.prompt(prompt).catch((err: any) => {
        addSystemText(C.red(`Error: ${err.message}`))
        isProcessing = false
      })
    } else if (absDelta > 0) {
      // Small change → silent notification line only
      addSystemText(C.zinc600(`  \u2500 heartbeat: ${confPct}% (${sign}${deltaPct}%) \u2014 ${delta.evaluationCount || 0} eval(s)`))
      tui.requestRender()
    }
    // absDelta === 0: truly nothing changed, stay silent
  }

  // ── Start heartbeat polling ───────────────────────────────────────────────
  heartbeatPollTimer = setInterval(async () => {
    try {
      const delta = await sfClient.getChanges(resolvedThesisId!, lastPollTimestamp)
      lastPollTimestamp = new Date().toISOString()

      if (!delta.changed) return

      if (isProcessing || pendingPrompt) {
        // Agent is busy — queue for delivery after agent_end
        pendingHeartbeatDelta = delta
      } else {
        handleHeartbeatDelta(delta)
      }
    } catch {
      // Silent — don't spam errors from background polling
    }
  }, 60_000) // every 60 seconds

  // ── Start TUI ──────────────────────────────────────────────────────────────
  tui.start()
}

// ============================================================================
// PLAIN-TEXT MODE (--no-tui)
// ============================================================================

async function runPlainTextAgent(params: {
  openrouterKey: string
  sfClient: SFClient
  resolvedThesisId: string
  latestContext: any
  opts?: { model?: string; modelKey?: string; newSession?: boolean }
}) {
  const { openrouterKey, sfClient, resolvedThesisId, opts } = params
  let latestContext = params.latestContext
  const readline = await import('readline')

  const piAi = await import('@mariozechner/pi-ai')
  const piAgent = await import('@mariozechner/pi-agent-core')
  const { getModel, streamSimple, Type } = piAi
  const { Agent } = piAgent

  const rawModelName = opts?.model || 'anthropic/claude-sonnet-4.6'
  let currentModelName = rawModelName.replace(/^openrouter\//, '')

  function resolveModel(name: string): any {
    try {
      return getModel('openrouter', name as any)
    } catch {
      return {
        modelId: name, provider: 'openrouter', api: 'openai-completions',
        baseUrl: 'https://openrouter.ai/api/v1', id: name, name,
        inputPrice: 0, outputPrice: 0, contextWindow: 200000,
        supportsImages: true, supportsTools: true,
      }
    }
  }

  let model = resolveModel(currentModelName)

  // ── Tools (same definitions as TUI mode) ──────────────────────────────────
  const thesisIdParam = Type.Object({ thesisId: Type.String({ description: 'Thesis ID' }) })
  const signalParams = Type.Object({
    thesisId: Type.String({ description: 'Thesis ID' }),
    content: Type.String({ description: 'Signal content' }),
    type: Type.Optional(Type.String({ description: 'Signal type: news, user_note, external' })),
  })
  const scanParams = Type.Object({
    query: Type.Optional(Type.String({ description: 'Keyword search' })),
    series: Type.Optional(Type.String({ description: 'Series ticker' })),
    market: Type.Optional(Type.String({ description: 'Market ticker' })),
  })
  const webSearchParams = Type.Object({ query: Type.String({ description: 'Search keywords' }) })
  const emptyParams = Type.Object({})

  const tools: any[] = [
    {
      name: 'get_context', label: 'Get Context',
      description: 'Get thesis snapshot: causal tree, edge prices, last evaluation, confidence',
      parameters: thesisIdParam,
      execute: async (_id: string, p: any) => {
        const ctx = await sfClient.getContext(p.thesisId)
        latestContext = ctx
        return { content: [{ type: 'text' as const, text: JSON.stringify(ctx, null, 2) }], details: {} }
      },
    },
    {
      name: 'inject_signal', label: 'Inject Signal',
      description: 'Inject a signal into the thesis',
      parameters: signalParams,
      execute: async (_id: string, p: any) => {
        const result = await sfClient.injectSignal(p.thesisId, p.type || 'user_note', p.content)
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }], details: {} }
      },
    },
    {
      name: 'trigger_evaluation', label: 'Evaluate',
      description: 'Trigger a deep evaluation cycle',
      parameters: thesisIdParam,
      execute: async (_id: string, p: any) => {
        const result = await sfClient.evaluate(p.thesisId)
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }], details: {} }
      },
    },
    {
      name: 'scan_markets', label: 'Scan Markets',
      description: 'Search Kalshi prediction markets',
      parameters: scanParams,
      execute: async (_id: string, p: any) => {
        let result: any
        if (p.market) { result = await kalshiFetchMarket(p.market) }
        else if (p.series) { result = await kalshiFetchMarketsBySeries(p.series) }
        else if (p.query) {
          const series = await kalshiFetchAllSeries()
          const kws = p.query.toLowerCase().split(/\s+/)
          result = series.filter((s: any) => kws.every((k: string) => ((s.title||'')+(s.ticker||'')).toLowerCase().includes(k))).slice(0, 15)
        } else { result = { error: 'Provide query, series, or market' } }
        return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }], details: {} }
      },
    },
    {
      name: 'list_theses', label: 'List Theses',
      description: 'List all theses',
      parameters: emptyParams,
      execute: async () => {
        const theses = await sfClient.listTheses()
        return { content: [{ type: 'text' as const, text: JSON.stringify(theses, null, 2) }], details: {} }
      },
    },
    {
      name: 'get_positions', label: 'Get Positions',
      description: 'Get Kalshi positions with live prices',
      parameters: emptyParams,
      execute: async () => {
        const positions = await getPositions()
        if (!positions) return { content: [{ type: 'text' as const, text: 'Kalshi not configured.' }], details: {} }
        for (const pos of positions) {
          const livePrice = await getMarketPrice(pos.ticker)
          if (livePrice !== null) {
            pos.current_value = livePrice
            pos.unrealized_pnl = Math.round((livePrice - pos.average_price_paid) * pos.quantity)
          }
        }
        return { content: [{ type: 'text' as const, text: JSON.stringify(positions, null, 2) }], details: {} }
      },
    },
    {
      name: 'web_search', label: 'Web Search',
      description: 'Search latest news and information',
      parameters: webSearchParams,
      execute: async (_id: string, p: any) => {
        const apiKey = process.env.TAVILY_API_KEY
        if (!apiKey) return { content: [{ type: 'text' as const, text: 'Tavily not configured. Set TAVILY_API_KEY.' }], details: {} }
        const res = await fetch('https://api.tavily.com/search', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ api_key: apiKey, query: p.query, max_results: 5, search_depth: 'basic', include_answer: true }),
        })
        if (!res.ok) return { content: [{ type: 'text' as const, text: `Search failed: ${res.status}` }], details: {} }
        const data = await res.json()
        const results = (data.results || []).map((r: any) => `[${r.title}](${r.url})\n${r.content?.slice(0, 200)}`).join('\n\n')
        const answer = data.answer ? `Summary: ${data.answer}\n\n---\n\n` : ''
        return { content: [{ type: 'text' as const, text: `${answer}${results}` }], details: {} }
      },
    },
    {
      name: 'get_milestones', label: 'Milestones',
      description: 'Get upcoming events from Kalshi calendar. Use to check economic releases, political events, or other catalysts.',
      parameters: Type.Object({
        hours: Type.Optional(Type.Number({ description: 'Hours ahead to look (default 168 = 1 week)' })),
        category: Type.Optional(Type.String({ description: 'Filter by category (e.g. Economics, Politics, Sports)' })),
      }),
      execute: async (_id: string, p: any) => {
        const hours = p.hours || 168
        const now = new Date()
        const url = `https://api.elections.kalshi.com/trade-api/v2/milestones?limit=200&minimum_start_date=${now.toISOString()}` +
          (p.category ? `&category=${p.category}` : '')
        const res = await fetch(url, { headers: { 'Accept': 'application/json' } })
        if (!res.ok) return { content: [{ type: 'text' as const, text: `Milestones API error: ${res.status}` }], details: {} }
        const data = await res.json()
        const cutoff = now.getTime() + hours * 3600000
        const filtered = (data.milestones || [])
          .filter((m: any) => new Date(m.start_date).getTime() <= cutoff)
          .slice(0, 30)
          .map((m: any) => ({
            title: m.title, category: m.category, start_date: m.start_date,
            related_event_tickers: m.related_event_tickers,
            hours_until: Math.round((new Date(m.start_date).getTime() - now.getTime()) / 3600000),
          }))
        return { content: [{ type: 'text' as const, text: JSON.stringify(filtered, null, 2) }], details: {} }
      },
    },
    {
      name: 'get_forecast', label: 'Forecast',
      description: 'Get market distribution (P50/P75/P90 percentile history) for a Kalshi event.',
      parameters: Type.Object({
        eventTicker: Type.String({ description: 'Kalshi event ticker (e.g. KXWTIMAX-26DEC31)' }),
        days: Type.Optional(Type.Number({ description: 'Days of history (default 7)' })),
      }),
      execute: async (_id: string, p: any) => {
        const { getForecastHistory } = await import('../kalshi.js')
        const days = p.days || 7
        const evtRes = await fetch(`https://api.elections.kalshi.com/trade-api/v2/events/${p.eventTicker}`, { headers: { 'Accept': 'application/json' } })
        if (!evtRes.ok) return { content: [{ type: 'text' as const, text: `Event not found: ${p.eventTicker}` }], details: {} }
        const evtData = await evtRes.json()
        const seriesTicker = evtData.event?.series_ticker
        if (!seriesTicker) return { content: [{ type: 'text' as const, text: `No series_ticker for ${p.eventTicker}` }], details: {} }
        const history = await getForecastHistory({
          seriesTicker, eventTicker: p.eventTicker, percentiles: [5000, 7500, 9000],
          startTs: Math.floor((Date.now() - days * 86400000) / 1000),
          endTs: Math.floor(Date.now() / 1000), periodInterval: 1440,
        })
        if (!history || history.length === 0) return { content: [{ type: 'text' as const, text: 'No forecast data available' }], details: {} }
        return { content: [{ type: 'text' as const, text: JSON.stringify(history, null, 2) }], details: {} }
      },
    },
    {
      name: 'get_settlements', label: 'Settlements',
      description: 'Get settled (resolved) contracts with P&L.',
      parameters: Type.Object({ ticker: Type.Optional(Type.String({ description: 'Filter by market ticker' })) }),
      execute: async (_id: string, p: any) => {
        const { getSettlements } = await import('../kalshi.js')
        const result = await getSettlements({ limit: 100, ticker: p.ticker })
        if (!result) return { content: [{ type: 'text' as const, text: 'Kalshi not configured.' }], details: {} }
        return { content: [{ type: 'text' as const, text: JSON.stringify(result.settlements, null, 2) }], details: {} }
      },
    },
    {
      name: 'get_balance', label: 'Balance',
      description: 'Get Kalshi account balance and portfolio value.',
      parameters: emptyParams,
      execute: async () => {
        const { getBalance } = await import('../kalshi.js')
        const result = await getBalance()
        if (!result) return { content: [{ type: 'text' as const, text: 'Kalshi not configured.' }], details: {} }
        return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }], details: {} }
      },
    },
    {
      name: 'get_orders', label: 'Orders',
      description: 'Get current resting orders on Kalshi.',
      parameters: Type.Object({ status: Type.Optional(Type.String({ description: 'Filter by status: resting, canceled, executed. Default: resting' })) }),
      execute: async (_id: string, p: any) => {
        const { getOrders } = await import('../kalshi.js')
        const result = await getOrders({ status: p.status || 'resting', limit: 100 })
        if (!result) return { content: [{ type: 'text' as const, text: 'Kalshi not configured.' }], details: {} }
        return { content: [{ type: 'text' as const, text: JSON.stringify(result.orders, null, 2) }], details: {} }
      },
    },
    {
      name: 'get_fills', label: 'Fills',
      description: 'Get recent trade fills (executed trades) on Kalshi.',
      parameters: Type.Object({ ticker: Type.Optional(Type.String({ description: 'Filter by market ticker' })) }),
      execute: async (_id: string, p: any) => {
        const { getFills } = await import('../kalshi.js')
        const result = await getFills({ ticker: p.ticker, limit: 50 })
        if (!result) return { content: [{ type: 'text' as const, text: 'Kalshi not configured.' }], details: {} }
        return { content: [{ type: 'text' as const, text: JSON.stringify(result.fills, null, 2) }], details: {} }
      },
    },
    {
      name: 'get_schedule',
      label: 'Schedule',
      description: 'Get exchange status (open/closed) and trading hours. Use to check if low liquidity is due to off-hours.',
      parameters: emptyParams,
      execute: async () => {
        try {
          const res = await fetch('https://api.elections.kalshi.com/trade-api/v2/exchange/status', { headers: { 'Accept': 'application/json' } })
          if (!res.ok) return { content: [{ type: 'text' as const, text: `Exchange API error: ${res.status}` }], details: {} }
          const data = await res.json()
          return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }], details: {} }
        } catch (err: any) {
          return { content: [{ type: 'text' as const, text: `Failed: ${err.message}` }], details: {} }
        }
      },
    },
  ]

  // ── System prompt ─────────────────────────────────────────────────────────
  const ctx = latestContext
  const edgesSummary = ctx.edges
    ?.sort((a: any, b: any) => Math.abs(b.edge) - Math.abs(a.edge))
    .slice(0, 5)
    .map((e: any) => `  ${(e.market || '').slice(0, 40)} | ${e.venue || 'kalshi'} | mkt ${e.marketPrice}\u00A2 | edge ${e.edge > 0 ? '+' : ''}${e.edge}`)
    .join('\n') || '  (no edges)'

  const nodesSummary = ctx.causalTree?.nodes
    ?.filter((n: any) => n.depth === 0)
    .map((n: any) => `  ${n.id} ${(n.label || '').slice(0, 40)} \u2014 ${Math.round(n.probability * 100)}%`)
    .join('\n') || '  (no causal tree)'

  const conf = typeof ctx.confidence === 'number' ? Math.round(ctx.confidence * 100) : 0

  const systemPrompt = `You are a prediction market trading assistant. Help the user make correct trading decisions.

Current thesis: ${ctx.thesis || ctx.rawThesis || 'N/A'}
ID: ${resolvedThesisId}
Confidence: ${conf}%
Status: ${ctx.status}

Causal tree nodes:
${nodesSummary}

Top edges:
${edgesSummary}

${ctx.lastEvaluation?.summary ? `Latest evaluation: ${ctx.lastEvaluation.summary.slice(0, 300)}` : ''}

Rules: Be concise. Use tools when needed. Don't ask "anything else?".`

  // ── Create agent ──────────────────────────────────────────────────────────
  const agent = new Agent({
    initialState: { systemPrompt, model, tools, thinkingLevel: 'off' as any },
    streamFn: streamSimple,
    getApiKey: (provider: string) => provider === 'openrouter' ? openrouterKey : undefined,
  })

  // ── Session restore ───────────────────────────────────────────────────────
  if (!opts?.newSession) {
    const saved = loadSession(resolvedThesisId)
    if (saved?.messages?.length > 0) {
      try {
        agent.replaceMessages(saved.messages)
        agent.setSystemPrompt(systemPrompt)
      } catch { /* start fresh */ }
    }
  }

  // ── Subscribe to agent events → plain stdout ──────────────────────────────
  let currentText = ''
  agent.subscribe((event: any) => {
    if (event.type === 'message_update') {
      const e = event.assistantMessageEvent
      if (e.type === 'text_delta') {
        process.stdout.write(e.delta)
        currentText += e.delta
      }
    }
    if (event.type === 'message_end') {
      if (currentText) {
        process.stdout.write('\n')
        currentText = ''
      }
    }
    if (event.type === 'tool_execution_start') {
      process.stderr.write(`  \u26A1 ${event.toolName}...\n`)
    }
    if (event.type === 'tool_execution_end') {
      const status = event.isError ? '\u2717' : '\u2713'
      process.stderr.write(`  ${status} ${event.toolName}\n`)
    }
  })

  // ── Welcome ───────────────────────────────────────────────────────────────
  const thesisText = ctx.thesis || ctx.rawThesis || 'N/A'
  console.log(`SF Agent — ${resolvedThesisId.slice(0, 8)} | ${conf}% | ${currentModelName}`)
  console.log(`Thesis: ${thesisText.length > 100 ? thesisText.slice(0, 100) + '...' : thesisText}`)
  console.log(`Edges: ${(ctx.edges || []).length} | Status: ${ctx.status}`)
  console.log('Type /help for commands, /exit to quit.\n')

  // ── REPL loop ─────────────────────────────────────────────────────────────
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: '> ' })

  rl.prompt()

  for await (const line of rl) {
    const trimmed = (line as string).trim()
    if (!trimmed) { rl.prompt(); continue }

    if (trimmed === '/exit' || trimmed === '/quit') {
      try { saveSession(resolvedThesisId, currentModelName, agent.state.messages) } catch {}
      rl.close()
      return
    }

    if (trimmed === '/help') {
      console.log('Commands: /help /exit /tree /edges /eval /model <name>')
      rl.prompt()
      continue
    }

    if (trimmed === '/tree') {
      latestContext = await sfClient.getContext(resolvedThesisId)
      const nodes = latestContext.causalTree?.nodes || []
      for (const n of nodes) {
        const indent = '  '.repeat(n.depth || 0)
        console.log(`${indent}${n.id} ${(n.label || '').slice(0, 60)} — ${Math.round(n.probability * 100)}%`)
      }
      rl.prompt()
      continue
    }

    if (trimmed === '/edges') {
      latestContext = await sfClient.getContext(resolvedThesisId)
      const edges = (latestContext.edges || []).sort((a: any, b: any) => Math.abs(b.edge) - Math.abs(a.edge)).slice(0, 15)
      for (const e of edges) {
        const sign = e.edge > 0 ? '+' : ''
        console.log(`  ${(e.market || '').slice(0, 45).padEnd(45)} ${e.marketPrice}¢  edge ${sign}${e.edge}  ${e.venue}`)
      }
      rl.prompt()
      continue
    }

    if (trimmed === '/eval') {
      console.log('Triggering evaluation...')
      const result = await sfClient.evaluate(resolvedThesisId)
      console.log(`Confidence: ${result.previousConfidence} → ${result.newConfidence}`)
      if (result.summary) console.log(result.summary)
      rl.prompt()
      continue
    }

    if (trimmed.startsWith('/model')) {
      const newModel = trimmed.slice(6).trim()
      if (!newModel) { console.log(`Current: ${currentModelName}`); rl.prompt(); continue }
      currentModelName = newModel.replace(/^openrouter\//, '')
      model = resolveModel(currentModelName)
      agent.setModel(model)
      console.log(`Model: ${currentModelName}`)
      rl.prompt()
      continue
    }

    // Regular message → agent
    try {
      await agent.prompt(trimmed)
    } catch (err: any) {
      console.error(`Error: ${err.message}`)
    }

    // Save after each turn
    try { saveSession(resolvedThesisId, currentModelName, agent.state.messages) } catch {}
    rl.prompt()
  }
}
