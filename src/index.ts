#!/usr/bin/env node
/**
 * SimpleFunctions CLI — sf
 *
 * Prediction market thesis agent CLI.
 * Zero heavy dependencies: commander + native fetch.
 *
 * Usage:
 *   sf setup                        — Interactive configuration wizard
 *   sf list                         — List all theses
 *   sf get <id>                     — Full thesis details
 *   sf context <id> [--json]        — Thesis context snapshot
 *   sf create "thesis text" [--async]
 *   sf signal <id> "content" [--type news|user_note|external]
 *   sf evaluate <id>
 *   sf scan "keywords" [--series TICKER] [--market TICKER] [--json]
 *   sf positions                    — Kalshi positions with edge overlay
 *   sf agent [thesisId]             — Interactive agent mode
 */

import { Command } from 'commander'
import { applyConfig, isConfigured } from './config.js'
import { listCommand } from './commands/list.js'
import { getCommand } from './commands/get.js'
import { contextCommand } from './commands/context.js'
import { createCommand } from './commands/create.js'
import { signalCommand } from './commands/signal.js'
import { evaluateCommand } from './commands/evaluate.js'
import { scanCommand } from './commands/scan.js'
import { positionsCommand } from './commands/positions.js'
import { edgesCommand } from './commands/edges.js'
import { agentCommand } from './commands/agent.js'
import { setupCommand } from './commands/setup.js'
import { publishCommand, unpublishCommand } from './commands/publish.js'
import { exploreCommand } from './commands/explore.js'
import { dashboardCommand } from './commands/dashboard.js'
import { registerStrategies } from './commands/strategies.js'
import { milestonesCommand } from './commands/milestones.js'
import { forecastCommand } from './commands/forecast.js'
import { settlementsCommand } from './commands/settlements.js'
import { balanceCommand } from './commands/balance.js'
import { ordersCommand } from './commands/orders.js'
import { fillsCommand } from './commands/fills.js'
import { feedCommand } from './commands/feed.js'
import { whatifCommand } from './commands/whatif.js'
import { buyCommand, sellCommand } from './commands/trade.js'
import { cancelCommand } from './commands/cancel.js'
import { scheduleCommand } from './commands/schedule.js'
import { rfqCommand } from './commands/rfq.js'
import { announcementsCommand } from './commands/announcements.js'
import { historyCommand } from './commands/history.js'
import { performanceCommand } from './commands/performance.js'
import { liquidityCommand } from './commands/liquidity.js'
import { bookCommand } from './commands/book.js'
import { telegramCommand } from './commands/telegram.js'
import { die } from './utils.js'

// ── Apply ~/.sf/config.json to process.env BEFORE any command ────────────────
// This means client.ts, kalshi.ts, agent.ts keep reading process.env and just work.
applyConfig()

const program = new Command()

const GROUPED_HELP = `
\x1b[1mSimpleFunctions CLI\x1b[22m — prediction market thesis agent

\x1b[1mUsage:\x1b[22m  sf <command> [options]
        sf <command> --help for detailed options

\x1b[1mSetup\x1b[22m
  \x1b[36msetup\x1b[39m                     Interactive config wizard
  \x1b[36msetup --check\x1b[39m              Show config status
  \x1b[36msetup --polymarket\x1b[39m         Configure Polymarket wallet

\x1b[1mThesis\x1b[22m
  \x1b[36mlist\x1b[39m                       List all theses
  \x1b[36mget\x1b[39m <id>                   Full thesis details
  \x1b[36mcontext\x1b[39m <id> [--json]      Thesis snapshot \x1b[2m(primary for agents)\x1b[22m
  \x1b[36mcreate\x1b[39m "thesis"            Create a new thesis
  \x1b[36msignal\x1b[39m <id> "content"      Inject a signal
  \x1b[36mevaluate\x1b[39m <id>              Trigger deep evaluation
  \x1b[36mpublish\x1b[39m / \x1b[36munpublish\x1b[39m <id>  Manage public visibility

\x1b[1mMarkets\x1b[22m
  \x1b[36mscan\x1b[39m "keywords"            Search Kalshi + Polymarket
  \x1b[36mscan\x1b[39m --series TICKER       Browse a Kalshi series
  \x1b[36medges\x1b[39m [--json]             Top edges across all theses
  \x1b[36mwhatif\x1b[39m <id>                What-if scenario analysis
  \x1b[36mliquidity\x1b[39m [topic]          Orderbook liquidity scanner
  \x1b[36mbook\x1b[39m <ticker> [ticker2...]  Orderbook depth for specific markets
  \x1b[36mexplore\x1b[39m [slug]             Browse public theses
  \x1b[36mforecast\x1b[39m <event>           Market distribution (P50/P75/P90)

\x1b[1mPortfolio\x1b[22m
  \x1b[36mpositions\x1b[39m                  Kalshi + Polymarket positions
  \x1b[36mbalance\x1b[39m                    Account balance
  \x1b[36morders\x1b[39m                     Resting orders
  \x1b[36mfills\x1b[39m                      Recent trade fills
  \x1b[36msettlements\x1b[39m                Settled contracts with P&L
  \x1b[36mperformance\x1b[39m                P&L over time
  \x1b[36mdashboard\x1b[39m                  Interactive TUI overview

\x1b[1mTrading\x1b[22m  \x1b[2m(requires sf setup --enable-trading)\x1b[22m
  \x1b[36mbuy\x1b[39m <ticker> <qty>         Buy contracts
  \x1b[36msell\x1b[39m <ticker> <qty>        Sell contracts
  \x1b[36mcancel\x1b[39m [orderId]           Cancel order(s)
  \x1b[36mrfq\x1b[39m <ticker> <qty>        Request for quote

\x1b[1mInteractive\x1b[22m
  \x1b[36magent\x1b[39m [id]                 Agent with natural language + tools
  \x1b[36mtelegram\x1b[39m                   Telegram bot for monitoring

\x1b[1mInfo\x1b[22m
  \x1b[36mfeed\x1b[39m                       Evaluation history stream
  \x1b[36mmilestones\x1b[39m                 Upcoming Kalshi events
  \x1b[36mschedule\x1b[39m                   Exchange status
  \x1b[36mannouncements\x1b[39m              Exchange announcements
  \x1b[36mhistory\x1b[39m <ticker>           Historical market data
`

program
  .name('sf')
  .description('SimpleFunctions CLI — prediction market thesis agent')
  .version('0.1.0')
  .option('--api-key <key>', 'API key (or set SF_API_KEY env var)')
  .option('--api-url <url>', 'API base URL (or set SF_API_URL env var)')
  .configureHelp({
    formatHelp: (cmd, helper) => {
      // For subcommands, use default help
      if (cmd.parent) return helper.formatHelp(cmd, helper)
      // For main program, show grouped help
      return GROUPED_HELP
    },
  })

// ── Pre-action guard: check configuration ────────────────────────────────────
const NO_CONFIG_COMMANDS = new Set(['setup', 'help', 'scan', 'explore', 'milestones', 'forecast', 'settlements', 'balance', 'orders', 'fills', 'schedule', 'announcements', 'history', 'liquidity'])

program.hook('preAction', (thisCommand, actionCommand) => {
  const cmdName = actionCommand.name()
  if (NO_CONFIG_COMMANDS.has(cmdName)) return

  // --api-key flag overrides config check
  const g = thisCommand.optsWithGlobals?.() || thisCommand.opts()
  if (g.apiKey) return

  if (!isConfigured()) {
    console.log()
    console.log('  SimpleFunctions 未配置。运行 \x1b[36msf setup\x1b[39m 开始。')
    console.log()
    process.exit(1)
  }
})

// ── sf setup ──────────────────────────────────────────────────────────────────
program
  .command('setup')
  .description('Interactive configuration wizard')
  .option('--check', 'Show current configuration status')
  .option('--reset', 'Delete config and start over')
  .option('--key <key>', 'Set SF API key (non-interactive, for CI)')
  .option('--enable-trading', 'Enable trading (sf buy/sell/cancel)')
  .option('--disable-trading', 'Disable trading')
  .option('--kalshi', 'Reconfigure Kalshi API credentials')
  .option('--polymarket', 'Reconfigure Polymarket wallet address')
  .action(async (opts) => {
    await run(() => setupCommand({ check: opts.check, reset: opts.reset, key: opts.key, enableTrading: opts.enableTrading, disableTrading: opts.disableTrading, kalshi: opts.kalshi, polymarket: opts.polymarket }))
  })

// ── sf list ──────────────────────────────────────────────────────────────────
program
  .command('list')
  .description('List all theses')
  .option('--json', 'JSON output')
  .action(async (opts, cmd) => {
    const g = cmd.optsWithGlobals()
    await run(() => listCommand({ json: opts.json, apiKey: g.apiKey, apiUrl: g.apiUrl }))
  })

// ── sf get <id> ───────────────────────────────────────────────────────────────
program
  .command('get <id>')
  .description('Get full thesis details')
  .option('--json', 'Output raw JSON')
  .action(async (id, opts, cmd) => {
    const g = cmd.optsWithGlobals()
    await run(() => getCommand(id, { json: opts.json, apiKey: g.apiKey, apiUrl: g.apiUrl }))
  })

// ── sf context <id> ───────────────────────────────────────────────────────────
program
  .command('context <id>')
  .description('Get thesis context snapshot (primary command for agents)')
  .option('--json', 'Output raw JSON')
  .action(async (id, opts, cmd) => {
    const g = cmd.optsWithGlobals()
    await run(() => contextCommand(id, { json: opts.json, apiKey: g.apiKey, apiUrl: g.apiUrl }))
  })

// ── sf create <thesis> ────────────────────────────────────────────────────────
program
  .command('create <thesis>')
  .description('Create a new thesis (sync by default — waits for formation)')
  .option('--async', 'Async mode — return immediately without waiting')
  .option('--json', 'JSON output')
  .action(async (thesis, opts, cmd) => {
    const g = cmd.optsWithGlobals()
    await run(() => createCommand(thesis, { async: opts.async, json: opts.json, apiKey: g.apiKey, apiUrl: g.apiUrl }))
  })

// ── sf signal <id> <content> ──────────────────────────────────────────────────
program
  .command('signal <id> <content>')
  .description('Inject a signal into the thesis queue')
  .option('--type <type>', 'Signal type: news | user_note | external', 'user_note')
  .action(async (id, content, opts, cmd) => {
    const g = cmd.optsWithGlobals()
    await run(() => signalCommand(id, content, { type: opts.type, apiKey: g.apiKey, apiUrl: g.apiUrl }))
  })

// ── sf evaluate <id> ──────────────────────────────────────────────────────────
program
  .command('evaluate <id>')
  .description('Trigger a deep evaluation (heavy model, force-heavy mode)')
  .action(async (id, _opts, cmd) => {
    const g = cmd.optsWithGlobals()
    await run(() => evaluateCommand(id, { apiKey: g.apiKey, apiUrl: g.apiUrl }))
  })

// ── sf scan [query] ───────────────────────────────────────────────────────────
program
  .command('scan [query]')
  .description('Explore Kalshi + Polymarket markets')
  .option('--series <ticker>', 'List events + markets for a series (e.g. KXWTIMAX)')
  .option('--market <ticker>', 'Get single market detail (e.g. KXWTIMAX-26DEC31-T140)')
  .option('--venue <venue>', 'Filter by venue: kalshi, polymarket, or all (default: all)')
  .option('--json', 'Output raw JSON')
  .action(async (query, opts, cmd) => {
    const g = cmd.optsWithGlobals()
    const q = query || ''
    if (!q && !opts.series && !opts.market) {
      console.error('Usage: sf scan "keywords"  OR  sf scan --series TICKER  OR  sf scan --market TICKER')
      process.exit(1)
    }
    await run(() => scanCommand(q, {
      series: opts.series,
      market: opts.market,
      venue: opts.venue,
      json: opts.json,
      apiKey: g.apiKey,
      apiUrl: g.apiUrl,
    }))
  })

// ── sf edges ──────────────────────────────────────────────────────────────────
program
  .command('edges')
  .description('Top edges across all theses — what to trade now')
  .option('--json', 'JSON output for agents')
  .option('--limit <n>', 'Max edges to show', '20')
  .action(async (opts, cmd) => {
    const g = cmd.optsWithGlobals()
    await run(() => edgesCommand({
      json: opts.json,
      limit: opts.limit,
      apiKey: g.apiKey,
      apiUrl: g.apiUrl,
    }))
  })

// ── sf positions ──────────────────────────────────────────────────────────────
program
  .command('positions')
  .description('Show Kalshi positions with thesis edge overlay (requires KALSHI_API_KEY_ID + KALSHI_PRIVATE_KEY_PATH)')
  .option('--json', 'JSON output for agents')
  .option('--thesis <id>', 'Filter by thesis ID')
  .action(async (opts, cmd) => {
    const g = cmd.optsWithGlobals()
    await run(() => positionsCommand({
      json: opts.json,
      thesis: opts.thesis,
      apiKey: g.apiKey,
      apiUrl: g.apiUrl,
    }))
  })

// ── sf agent [thesisId] ───────────────────────────────────────────────────────
program
  .command('agent [thesisId]')
  .description('Interactive agent mode — natural language interface to SimpleFunctions')
  .option('--model <model>', 'Model via OpenRouter (default: anthropic/claude-sonnet-4.6)')
  .option('--model-key <key>', 'OpenRouter API key (or set OPENROUTER_API_KEY)')
  .option('--new', 'Start a fresh session (default: continue last session)')
  .option('--plain', 'Plain text mode (no TUI, works in pipes and scripts)')
  .action(async (thesisId, opts, cmd) => {
    const g = cmd.optsWithGlobals()
    await run(() => agentCommand(thesisId, { model: opts.model, modelKey: opts.modelKey, newSession: opts.new, noTui: opts.plain }))
  })

// ── sf publish <thesisId> ─────────────────────────────────────────────────────
program
  .command('publish <thesisId>')
  .description('Publish a thesis for public viewing')
  .requiredOption('--slug <slug>', 'URL slug (lowercase, hyphens, 3-60 chars)')
  .option('--description <desc>', 'Short description')
  .action(async (thesisId, opts, cmd) => {
    const g = cmd.optsWithGlobals()
    await run(() => publishCommand(thesisId, { slug: opts.slug, description: opts.description, apiKey: g.apiKey, apiUrl: g.apiUrl }))
  })

// ── sf unpublish <thesisId> ───────────────────────────────────────────────────
program
  .command('unpublish <thesisId>')
  .description('Remove a thesis from public viewing')
  .action(async (thesisId, _opts, cmd) => {
    const g = cmd.optsWithGlobals()
    await run(() => unpublishCommand(thesisId, { apiKey: g.apiKey, apiUrl: g.apiUrl }))
  })

// ── sf explore [slug] ─────────────────────────────────────────────────────────
program
  .command('explore [slug]')
  .description('Browse public theses (no auth required)')
  .option('--json', 'JSON output')
  .action(async (slug, opts) => {
    await run(() => exploreCommand(slug, { json: opts.json }))
  })

// ── sf dashboard ──────────────────────────────────────────────────────────────
program
  .command('dashboard')
  .description('Portfolio overview — interactive TUI (default), or one-shot with --once/--json')
  .option('--json', 'JSON output')
  .option('--once', 'One-time print (no interactive mode)')
  .action(async (opts, cmd) => {
    const g = cmd.optsWithGlobals()
    await run(() => dashboardCommand({ json: opts.json, once: opts.once, apiKey: g.apiKey, apiUrl: g.apiUrl }))
  })

// ── sf milestones ────────────────────────────────────────────────────────────
program
  .command('milestones')
  .description('Upcoming events from Kalshi calendar')
  .option('--category <cat>', 'Filter by category')
  .option('--thesis <id>', 'Show milestones matching thesis edges')
  .option('--hours <n>', 'Hours ahead (default 168)', '168')
  .option('--json', 'JSON output')
  .action(async (opts, cmd) => {
    const g = cmd.optsWithGlobals()
    await run(() => milestonesCommand({ ...opts, apiKey: g.apiKey, apiUrl: g.apiUrl }))
  })

// ── sf forecast <eventTicker> ────────────────────────────────────────────────
program
  .command('forecast <eventTicker>')
  .description('Market distribution forecast (P50/P75/P90 history)')
  .option('--days <n>', 'Days of history (default 7)', '7')
  .option('--json', 'JSON output')
  .action(async (eventTicker, opts) => {
    await run(() => forecastCommand(eventTicker, opts))
  })

// ── sf settlements ───────────────────────────────────────────────────────────
program
  .command('settlements')
  .description('Settled (resolved) contracts with P&L')
  .option('--thesis <id>', 'Filter to thesis edge tickers')
  .option('--json', 'JSON output')
  .action(async (opts, cmd) => {
    const g = cmd.optsWithGlobals()
    await run(() => settlementsCommand({ ...opts, apiKey: g.apiKey, apiUrl: g.apiUrl }))
  })

// ── sf balance ───────────────────────────────────────────────────────────────
program
  .command('balance')
  .description('Kalshi account balance')
  .option('--json', 'JSON output')
  .action(async (opts) => {
    await run(() => balanceCommand(opts))
  })

// ── sf orders ────────────────────────────────────────────────────────────────
program
  .command('orders')
  .description('Kalshi resting orders')
  .option('--status <status>', 'Order status filter (default: resting)', 'resting')
  .option('--json', 'JSON output')
  .action(async (opts) => {
    await run(() => ordersCommand(opts))
  })

// ── sf fills ─────────────────────────────────────────────────────────────────
program
  .command('fills')
  .description('Recent trade fills')
  .option('--ticker <ticker>', 'Filter by market ticker')
  .option('--json', 'JSON output')
  .action(async (opts) => {
    await run(() => fillsCommand(opts))
  })

// ── sf feed ──────────────────────────────────────────────────────────────────
program
  .command('feed')
  .description('Evaluation history stream — what the heartbeat engine has been thinking')
  .option('--hours <n>', 'Hours to look back (default 24)', '24')
  .option('--thesis <id>', 'Filter by thesis')
  .option('--json', 'JSON output')
  .action(async (opts, cmd) => {
    const g = cmd.optsWithGlobals()
    await run(() => feedCommand({ ...opts, apiKey: g.apiKey, apiUrl: g.apiUrl }))
  })

// ── sf whatif <thesisId> ──────────────────────────────────────────────────────
program
  .command('whatif <thesisId>')
  .description('What-if scenario — "if node X drops to 10%, what happens to my edges?"')
  .option('--set <override>', 'Node override: nodeId=probability (0-1). Repeatable.', (val: string, prev: string[]) => [...prev, val], [] as string[])
  .option('--json', 'JSON output')
  .action(async (thesisId, opts, cmd) => {
    const g = cmd.optsWithGlobals()
    await run(() => whatifCommand(thesisId, { set: opts.set, json: opts.json, apiKey: g.apiKey, apiUrl: g.apiUrl }))
  })

// ── sf schedule ──────────────────────────────────────────────────────────────
program
  .command('schedule')
  .description('Exchange status and trading hours')
  .option('--json', 'JSON output')
  .action(async (opts) => {
    await run(() => scheduleCommand(opts))
  })

// ── sf buy <ticker> <qty> ───────────────────────────────────────────────────
program
  .command('buy <ticker> <qty>')
  .description('Buy contracts (requires --enable-trading)')
  .option('--price <cents>', 'Limit price in cents (required for limit orders)')
  .option('--market', 'Market order (no price needed)')
  .option('--side <s>', 'yes or no', 'yes')
  .option('--yes-i-am-sure', 'Skip 3-second countdown')
  .action(async (ticker, qty, opts) => {
    await run(() => buyCommand(ticker, qty, opts))
  })

// ── sf sell <ticker> <qty> ───────────────────────────────────────────────────
program
  .command('sell <ticker> <qty>')
  .description('Sell contracts (requires --enable-trading)')
  .option('--price <cents>', 'Limit price in cents')
  .option('--market', 'Market order')
  .option('--side <s>', 'yes or no', 'yes')
  .option('--yes-i-am-sure', 'Skip 3-second countdown')
  .action(async (ticker, qty, opts) => {
    await run(() => sellCommand(ticker, qty, opts))
  })

// ── sf cancel [orderId] ─────────────────────────────────────────────────────
program
  .command('cancel [orderId]')
  .description('Cancel order(s) (requires --enable-trading)')
  .option('--all', 'Cancel all resting orders')
  .option('--ticker <t>', 'Cancel orders matching ticker prefix (with --all)')
  .option('--yes-i-am-sure', 'Skip countdown')
  .action(async (orderId, opts) => {
    await run(() => cancelCommand(orderId, opts))
  })

// ── sf rfq <ticker> <qty> ───────────────────────────────────────────────────
program
  .command('rfq <ticker> <qty>')
  .description('Request for quote — large order pricing (requires --enable-trading)')
  .option('--target-cost <cents>', 'Target cost per contract in cents')
  .option('--rest-remainder', 'Rest unfilled portion as limit order')
  .option('--json', 'JSON output')
  .action(async (ticker, qty, opts) => {
    await run(() => rfqCommand(ticker, qty, opts))
  })

// ── sf announcements ─────────────────────────────────────────────────────────
program
  .command('announcements')
  .description('Exchange announcements (rule changes, maintenance)')
  .option('--json', 'JSON output')
  .action(async (opts) => {
    await run(() => announcementsCommand(opts))
  })

// ── sf history <ticker> ──────────────────────────────────────────────────────
program
  .command('history <ticker>')
  .description('Historical market data (settled/closed)')
  .option('--json', 'JSON output')
  .action(async (ticker, opts) => {
    await run(() => historyCommand(ticker, opts))
  })

// ── sf performance ───────────────────────────────────────────────────────────
program
  .command('performance')
  .description('Portfolio P&L over time with thesis event annotations')
  .option('--ticker <ticker>', 'Filter by ticker (fuzzy match)')
  .option('--since <date>', 'Start date (ISO, e.g. 2026-03-01)')
  .option('--json', 'JSON output')
  .action(async (opts) => {
    await run(() => performanceCommand(opts))
  })

// ── sf liquidity ─────────────────────────────────────────────────────────────
program
  .command('liquidity [topic]')
  .description('Market liquidity scanner — run without args to see topics')
  .option('--all', 'Scan all topics')
  .option('--venue <venue>', 'Filter venue: kalshi, polymarket, all (default: all)')
  .option('--horizon <horizon>', 'Filter horizon (weekly, monthly, long-term)')
  .option('--min-depth <depth>', 'Minimum bid+ask depth', parseInt)
  .option('--json', 'JSON output')
  .action(async (topic, opts) => {
    await run(() => liquidityCommand({ ...opts, topic }))
  })

// ── sf book ──────────────────────────────────────────────────────────────────
program
  .command('book [tickers...]')
  .description('Orderbook depth, spread, and liquidity for specific markets')
  .option('--poly <query>', 'Search Polymarket markets by keyword')
  .option('--history', 'Include 7-day price history sparkline')
  .option('--json', 'JSON output')
  .action(async (tickers, opts) => {
    if (tickers.length === 0 && !opts.poly) {
      console.error('Usage: sf book <ticker> [ticker2...]  OR  sf book --poly "oil price"')
      process.exit(1)
    }
    await run(() => bookCommand(tickers, opts))
  })

// ── sf telegram ──────────────────────────────────────────────────────────────
program
  .command('telegram')
  .description('Start Telegram bot for monitoring and trading')
  .option('--token <token>', 'Telegram bot token (or set TELEGRAM_BOT_TOKEN)')
  .option('--chat-id <id>', 'Restrict to specific chat ID')
  .option('--daemon', 'Run in background')
  .option('--stop', 'Stop background bot')
  .option('--status', 'Check if bot is running')
  .action(async (opts) => {
    await run(() => telegramCommand(opts))
  })

// ── sf strategies ─────────────────────────────────────────────────────────────
registerStrategies(program)

// ── Error wrapper ─────────────────────────────────────────────────────────────
async function run(fn: () => Promise<void>): Promise<void> {
  try {
    await fn()
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    die(msg)
  }
}

program.parse()
