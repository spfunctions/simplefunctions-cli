/**
 * sf setup — Interactive configuration wizard
 *
 * Walks user through:
 *   1. SF API key (required)
 *   2. OpenRouter API key (optional, for agent)
 *   3. Kalshi exchange credentials (optional, for positions)
 *   4. Tavily API key (optional, for web search)
 *   5. First thesis creation (if none exist)
 *
 * Each key is validated in real-time.
 * Config is saved to ~/.sf/config.json.
 */

import readline from 'readline'
import { exec } from 'child_process'
import { loadConfig, loadFileConfig, saveConfig, resetConfig, getConfigPath, type SFConfig } from '../config.js'
import { SFClient } from '../client.js'
import { isKalshiConfigured, getPositions } from '../kalshi.js'
import { agentCommand } from './agent.js'

// ─── ANSI helpers ────────────────────────────────────────────────────────────

const green = (s: string) => `\x1b[32m${s}\x1b[39m`
const red = (s: string) => `\x1b[31m${s}\x1b[39m`
const dim = (s: string) => `\x1b[2m${s}\x1b[22m`
const bold = (s: string) => `\x1b[1m${s}\x1b[22m`
const cyan = (s: string) => `\x1b[36m${s}\x1b[39m`

function ok(msg: string) { console.log(`  ${green('✓')} ${msg}`) }
function fail(msg: string) { console.log(`  ${red('✗')} ${msg}`) }
function info(msg: string) { console.log(`  ${msg}`) }
function blank() { console.log() }

// ─── Prompt helper ───────────────────────────────────────────────────────────

function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  })
  return new Promise(resolve => {
    rl.question(question, answer => {
      rl.close()
      resolve(answer.trim())
    })
  })
}

function promptYN(question: string, defaultYes = true): Promise<boolean> {
  return prompt(question).then(ans => {
    if (!ans) return defaultYes
    return ans.toLowerCase().startsWith('y')
  })
}

function openBrowser(url: string) {
  const cmd = process.platform === 'darwin' ? 'open' :
    process.platform === 'win32' ? 'start' : 'xdg-open'
  exec(`${cmd} ${url}`)
}

function mask(s: string): string {
  if (!s || s.length <= 12) return s
  return s.slice(0, 8) + '...' + s.slice(-4)
}

// ─── Validators ──────────────────────────────────────────────────────────────

async function validateSFKey(key: string, apiUrl: string): Promise<{ valid: boolean; msg: string }> {
  try {
    const res = await fetch(`${apiUrl}/api/thesis`, {
      headers: { 'Authorization': `Bearer ${key}` },
    })
    if (res.ok) return { valid: true, msg: `API key valid — connected to ${apiUrl.replace('https://', '')}` }
    if (res.status === 401) return { valid: false, msg: 'Invalid key, please try again' }
    return { valid: false, msg: `Server returned ${res.status}` }
  } catch (err: any) {
    return { valid: false, msg: `Connection failed: ${err.message}` }
  }
}

async function validateOpenRouterKey(key: string): Promise<{ valid: boolean; msg: string }> {
  try {
    const res = await fetch('https://openrouter.ai/api/v1/models', {
      headers: { 'Authorization': `Bearer ${key}` },
    })
    if (res.ok) return { valid: true, msg: 'OpenRouter connected — available model: claude-sonnet-4.6' }
    return { valid: false, msg: `OpenRouter returned ${res.status}` }
  } catch (err: any) {
    return { valid: false, msg: `Connection failed: ${err.message}` }
  }
}

async function validateKalshi(): Promise<{ valid: boolean; msg: string; posCount: number }> {
  try {
    const positions = await getPositions()
    if (positions === null) return { valid: false, msg: 'Kalshi authentication failed', posCount: 0 }
    return { valid: true, msg: `Kalshi authenticated — found ${positions.length} position(s)`, posCount: positions.length }
  } catch (err: any) {
    return { valid: false, msg: `Kalshi connection failed: ${err.message}`, posCount: 0 }
  }
}

async function validateTavily(key: string): Promise<{ valid: boolean; msg: string }> {
  try {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: key, query: 'test', max_results: 1 }),
    })
    if (res.ok) return { valid: true, msg: 'Tavily connected' }
    return { valid: false, msg: `Tavily returned ${res.status}` }
  } catch (err: any) {
    return { valid: false, msg: `Connection failed: ${err.message}` }
  }
}

// ─── Setup sub-commands ──────────────────────────────────────────────────────

interface SetupOpts {
  check?: boolean
  reset?: boolean
  key?: string
  enableTrading?: boolean
  disableTrading?: boolean
  kalshi?: boolean
  polymarket?: boolean
}

export async function setupCommand(opts: SetupOpts): Promise<void> {
  // ── sf setup --check ──────────────────────────────────────────────────────
  if (opts.check) {
    return showCheck()
  }

  // ── sf setup --reset ──────────────────────────────────────────────────────
  if (opts.reset) {
    resetConfig()
    ok('Config reset')
    blank()
    info('Run sf setup to reconfigure')
    blank()
    return
  }

  // ── sf setup --key <key> (non-interactive) ────────────────────────────────
  if (opts.key) {
    const apiUrl = process.env.SF_API_URL || 'https://simplefunctions.dev'
    const result = await validateSFKey(opts.key, apiUrl)
    if (!result.valid) {
      fail(result.msg)
      process.exit(1)
    }
    const existing = loadFileConfig()
    saveConfig({ ...existing, apiKey: opts.key, apiUrl })
    ok(result.msg)
    ok(`Saved to ${getConfigPath()}`)
    return
  }

  // ── sf setup --kalshi (reconfigure Kalshi credentials) ──────────────────
  if (opts.kalshi) {
    const existing = loadFileConfig()
    blank()
    console.log(`  ${bold('Reconfigure Kalshi Credentials')}`)
    blank()
    info('Go to https://kalshi.com/account/api-keys to generate a new API key.')
    info('If you need trading, make sure to enable read+write permissions.')
    blank()
    await promptForKalshi(existing)
    saveConfig(existing)
    if (existing.kalshiKeyId) {
      process.env.KALSHI_API_KEY_ID = existing.kalshiKeyId
      process.env.KALSHI_PRIVATE_KEY_PATH = existing.kalshiPrivateKeyPath!
    }
    blank()
    return
  }

  // ── sf setup --polymarket (reconfigure Polymarket credentials) ──────────
  if (opts.polymarket) {
    const existing = loadFileConfig()
    blank()
    console.log(`  ${bold('Reconfigure Polymarket Credentials')}`)
    blank()
    await promptForPolymarket(existing)
    saveConfig(existing)
    blank()
    return
  }

  // ── sf setup --enable-trading / --disable-trading ────────────────────────
  if (opts.enableTrading) {
    const existing = loadFileConfig()
    saveConfig({ ...existing, tradingEnabled: true })
    ok('Trading enabled. sf buy / sf sell / sf cancel now available.')
    blank()
    return
  }
  if (opts.disableTrading) {
    const existing = loadFileConfig()
    saveConfig({ ...existing, tradingEnabled: false })
    ok('Trading disabled.')
    blank()
    return
  }

  // ── Full interactive wizard ───────────────────────────────────────────────
  return runWizard()
}

// ─── Check command ───────────────────────────────────────────────────────────

async function showCheck(): Promise<void> {
  const config = loadConfig()
  blank()
  console.log(`  ${bold('SimpleFunctions Config Status')}`)
  console.log(`  ${dim('─'.repeat(35))}`)
  blank()

  // SF API Key
  if (config.apiKey) {
    ok(`SF_API_KEY        ${dim(mask(config.apiKey))}`)
  } else {
    fail('SF_API_KEY        not configured (required)')
  }

  // OpenRouter
  if (config.openrouterKey) {
    ok(`OPENROUTER_KEY    ${dim(mask(config.openrouterKey))}`)
  } else {
    fail(`OPENROUTER_KEY    not configured (agent unavailable)`)
  }

  // Kalshi
  if (config.kalshiKeyId && config.kalshiPrivateKeyPath) {
    ok(`KALSHI            ${dim(mask(config.kalshiKeyId))}`)
  } else {
    info(`${dim('○')} KALSHI            ${dim('skipped')}`)
  }

  // Polymarket
  if (config.polymarketWalletAddress) {
    ok(`POLYMARKET        ${dim(mask(config.polymarketWalletAddress))}`)
  } else {
    info(`${dim('○')} POLYMARKET        ${dim('skipped')}`)
  }

  // Tavily
  if (config.tavilyKey) {
    ok(`TAVILY            ${dim(mask(config.tavilyKey))}`)
  } else {
    info(`${dim('○')} TAVILY            ${dim('skipped')}`)
  }

  // Trading
  if (config.tradingEnabled) {
    ok('TRADING           enabled')
  } else {
    info(`${dim('○')} TRADING           ${dim('disabled — sf setup --enable-trading')}`)
  }

  blank()
  console.log(`  ${dim('Config file: ' + getConfigPath())}`)
  blank()
}

// ─── Interactive Wizard ──────────────────────────────────────────────────────

async function runWizard(): Promise<void> {
  blank()
  console.log(`  ${bold('SimpleFunctions Setup')}`)
  console.log(`  ${dim('─'.repeat(25))}`)
  blank()

  const config: SFConfig = loadFileConfig()
  const apiUrl = config.apiUrl || 'https://simplefunctions.dev'

  // ════════════════════════════════════════════════════════════════════════════
  // Step 1: SF API Key
  // ════════════════════════════════════════════════════════════════════════════
  console.log(`  ${bold('Step 1: API Key')}`)
  blank()

  const existingSfKey = process.env.SF_API_KEY || config.apiKey
  if (existingSfKey) {
    const result = await validateSFKey(existingSfKey, apiUrl)
    if (result.valid) {
      ok(`Detected SF_API_KEY — ${dim(mask(existingSfKey))}`)
      info(dim('Skipping.'))
      config.apiKey = existingSfKey
      blank()
    } else {
      fail(`Existing key invalid: ${result.msg}`)
      config.apiKey = await promptForSFKey(apiUrl)
    }
  } else {
    config.apiKey = await promptForSFKey(apiUrl)
  }

  // Save after each step (so partial progress is preserved)
  config.apiUrl = apiUrl
  saveConfig(config)
  // Also apply so subsequent validation calls can use it
  process.env.SF_API_KEY = config.apiKey

  // ════════════════════════════════════════════════════════════════════════════
  // Step 2: OpenRouter API Key
  // ════════════════════════════════════════════════════════════════════════════
  console.log(`  ${bold('Step 2: AI Model (for sf agent)')}`)
  blank()

  const existingOrKey = process.env.OPENROUTER_API_KEY || config.openrouterKey
  if (existingOrKey) {
    const result = await validateOpenRouterKey(existingOrKey)
    if (result.valid) {
      ok(`Detected OPENROUTER_API_KEY — ${dim(mask(existingOrKey))}`)
      info(dim('Skipping.'))
      config.openrouterKey = existingOrKey
      blank()
    } else {
      fail(`Existing key invalid: ${result.msg}`)
      config.openrouterKey = await promptForOpenRouterKey()
    }
  } else {
    config.openrouterKey = await promptForOpenRouterKey()
  }

  saveConfig(config)
  if (config.openrouterKey) process.env.OPENROUTER_API_KEY = config.openrouterKey

  // ════════════════════════════════════════════════════════════════════════════
  // Step 3: Kalshi Exchange
  // ════════════════════════════════════════════════════════════════════════════
  console.log(`  ${bold('Step 3: Kalshi Exchange (optional)')}`)
  blank()

  const existingKalshiId = process.env.KALSHI_API_KEY_ID || config.kalshiKeyId
  const existingKalshiPath = process.env.KALSHI_PRIVATE_KEY_PATH || config.kalshiPrivateKeyPath
  if (existingKalshiId && existingKalshiPath) {
    // Temporarily apply for validation
    process.env.KALSHI_API_KEY_ID = existingKalshiId
    process.env.KALSHI_PRIVATE_KEY_PATH = existingKalshiPath
    const result = await validateKalshi()
    if (result.valid) {
      ok(`Detected Kalshi — ${dim(mask(existingKalshiId))} (${result.posCount} position(s))`)
      info(dim('Skipping.'))
      config.kalshiKeyId = existingKalshiId
      config.kalshiPrivateKeyPath = existingKalshiPath
      blank()
    } else {
      fail(`Existing credentials invalid: ${result.msg}`)
      await promptForKalshi(config)
    }
  } else {
    await promptForKalshi(config)
  }

  saveConfig(config)

  // ════════════════════════════════════════════════════════════════════════════
  // Step 4: Polymarket
  // ════════════════════════════════════════════════════════════════════════════
  console.log(`  ${bold('Step 4: Polymarket (optional)')}`)
  blank()

  const existingPolyWallet = process.env.POLYMARKET_WALLET_ADDRESS || config.polymarketWalletAddress
  if (existingPolyWallet) {
    ok(`Detected wallet — ${dim(mask(existingPolyWallet))}`)
    info(dim('Skipping.'))
    config.polymarketWalletAddress = existingPolyWallet
    blank()
  } else {
    await promptForPolymarket(config)
  }

  saveConfig(config)
  if (config.polymarketWalletAddress) process.env.POLYMARKET_WALLET_ADDRESS = config.polymarketWalletAddress

  // ════════════════════════════════════════════════════════════════════════════
  // Step 5: Tavily
  // ════════════════════════════════════════════════════════════════════════════
  console.log(`  ${bold('Step 5: News Search (optional)')}`)
  blank()

  const existingTavily = process.env.TAVILY_API_KEY || config.tavilyKey
  if (existingTavily) {
    const result = await validateTavily(existingTavily)
    if (result.valid) {
      ok(`Detected TAVILY_API_KEY — ${dim(mask(existingTavily))}`)
      info(dim('Skipping.'))
      config.tavilyKey = existingTavily
      blank()
    } else {
      fail(`Existing key invalid: ${result.msg}`)
      config.tavilyKey = await promptForTavily()
    }
  } else {
    config.tavilyKey = await promptForTavily()
  }

  saveConfig(config)
  if (config.tavilyKey) process.env.TAVILY_API_KEY = config.tavilyKey

  // ════════════════════════════════════════════════════════════════════════════
  // Step 5: Trading
  // ════════════════════════════════════════════════════════════════════════════
  if (config.kalshiKeyId) {
    console.log(`  ${bold('Step 6: Trading (optional)')}`)
    blank()
    info('Warning: enabling this unlocks sf buy / sf sell / sf cancel.')
    info('Your Kalshi API key must have read+write permissions.')
    blank()
    const enableTrading = await promptYN('  Enable trading? (y/N) ', false)
    config.tradingEnabled = enableTrading
    if (enableTrading) {
      ok('Trading enabled')
    } else {
      info(dim('Skipped. You can enable later with sf setup --enable-trading.'))
    }
    blank()
    saveConfig(config)
  }

  // ════════════════════════════════════════════════════════════════════════════
  // Summary
  // ════════════════════════════════════════════════════════════════════════════
  console.log(`  ${dim('─'.repeat(25))}`)
  info(`Config saved to ${dim(getConfigPath())}`)
  blank()

  if (config.apiKey) ok('SF_API_KEY        configured')
  else fail('SF_API_KEY        not configured')

  if (config.openrouterKey) ok('OPENROUTER_KEY    configured')
  else fail('OPENROUTER_KEY    skipped')

  if (config.kalshiKeyId) ok('KALSHI            configured')
  else info(`${dim('○')} KALSHI            skipped`)

  if (config.tavilyKey) ok('TAVILY            configured')
  else info(`${dim('○')} TAVILY            skipped`)

  blank()

  // ════════════════════════════════════════════════════════════════════════════
  // Step 5: Thesis creation
  // ════════════════════════════════════════════════════════════════════════════
  if (config.apiKey) {
    await handleThesisStep(config)
  }
}

// ─── Step prompt helpers ─────────────────────────────────────────────────────

async function promptForSFKey(apiUrl: string): Promise<string> {
  info(`Don't have a key? Sign up at ${cyan('https://simplefunctions.dev/dashboard')}.`)
  info('Press Enter to open browser, or paste your key:')
  blank()

  while (true) {
    const answer = await prompt('  > ')

    if (!answer) {
      // Open browser
      openBrowser('https://simplefunctions.dev/dashboard')
      info(dim('Browser opened. Paste your key here once you have it:'))
      continue
    }

    info(dim('Validating...'))
    const result = await validateSFKey(answer, apiUrl)
    if (result.valid) {
      ok(result.msg)
      blank()
      return answer
    } else {
      fail(result.msg)
    }
  }
}

async function promptForOpenRouterKey(): Promise<string | undefined> {
  info(`Requires an OpenRouter API key. Get one at ${cyan('https://openrouter.ai/settings/keys')}.`)
  info('Press Enter to skip (agent unavailable), or paste key:')
  blank()

  const answer = await prompt('  > ')
  if (!answer) {
    info(dim('Skipped.'))
    blank()
    return undefined
  }

  info(dim('Validating...'))
  const result = await validateOpenRouterKey(answer)
  if (result.valid) {
    ok(result.msg)
  } else {
    fail(result.msg)
    info(dim('Saved. You can re-run sf setup later to fix this.'))
  }
  blank()
  return answer
}

async function promptForKalshi(config: SFConfig): Promise<void> {
  info(`Connect Kalshi to view your positions and P&L.`)
  info(`Requires an API Key ID and private key file.`)
  info(`Get them at ${cyan('https://kalshi.com/account/api-keys')}.`)
  info('Press Enter to skip, or paste Key ID:')
  blank()

  const keyId = await prompt('  > ')
  if (!keyId) {
    info(dim('Skipped.'))
    blank()
    return
  }

  info('Private key file path (default ~/.kalshi/private.pem):')
  const keyPathInput = await prompt('  > ')
  const keyPath = keyPathInput || '~/.kalshi/private.pem'

  config.kalshiKeyId = keyId
  config.kalshiPrivateKeyPath = keyPath

  // Temporarily set for validation
  process.env.KALSHI_API_KEY_ID = keyId
  process.env.KALSHI_PRIVATE_KEY_PATH = keyPath

  info(dim('Validating...'))
  const result = await validateKalshi()
  if (result.valid) {
    ok(result.msg)
  } else {
    fail(result.msg)
    info(dim('Saved. You can re-run sf setup later to fix this.'))
  }
  blank()
}

async function promptForTavily(): Promise<string | undefined> {
  info(`Tavily API powers the agent's web_search tool.`)
  info(`Get a free key at ${cyan('https://tavily.com')}.`)
  info('Press Enter to skip:')
  blank()

  const answer = await prompt('  > ')
  if (!answer) {
    info(dim('Skipped.'))
    blank()
    return undefined
  }

  info(dim('Validating...'))
  const result = await validateTavily(answer)
  if (result.valid) {
    ok(result.msg)
  } else {
    fail(result.msg)
    info(dim('Saved. You can re-run sf setup later to fix this.'))
  }
  blank()
  return answer
}

async function promptForPolymarket(config: SFConfig): Promise<void> {
  info('Connect Polymarket to view positions and scan orderbooks.')
  info('Your Polygon wallet address is needed (starts with 0x...).')
  info(`Find it at ${cyan('https://polymarket.com')} → Settings → Profile.`)
  info('Press Enter to skip:')
  blank()

  const walletAddress = await prompt('  Wallet address > ')
  if (!walletAddress) {
    info(dim('Skipped.'))
    blank()
    return
  }

  if (!walletAddress.startsWith('0x') || walletAddress.length < 40) {
    fail('Invalid wallet address (must start with 0x and be 42 characters)')
    info(dim('Saved anyway. You can fix it later with sf setup.'))
  } else {
    ok(`Wallet: ${mask(walletAddress)}`)
  }

  config.polymarketWalletAddress = walletAddress

  // Optionally configure private key for future trading
  info(dim('Private key (for future trading) — press Enter to skip:'))
  const keyPath = await prompt('  Key path > ')
  if (keyPath) {
    config.polymarketPrivateKeyPath = keyPath
    ok(`Private key path: ${dim(keyPath)}`)
  }
  blank()
}

// ─── Step 7: Thesis ──────────────────────────────────────────────────────────

async function handleThesisStep(config: SFConfig): Promise<void> {
  try {
    const client = new SFClient(config.apiKey, config.apiUrl)
    const data = await client.listTheses()
    const theses = data.theses || []
    const activeTheses = theses.filter((t: any) => t.status === 'active')

    if (activeTheses.length > 0) {
      console.log(`  ${bold('Step 7: Theses')}`)
      blank()
      ok(`Found ${activeTheses.length} active thesis(es):`)
      for (const t of activeTheses.slice(0, 5)) {
        const conf = typeof t.confidence === 'number' ? Math.round(t.confidence * 100) : 0
        const thesis = (t.rawThesis || t.thesis || t.title || '').slice(0, 60)
        info(`  ${dim(t.id.slice(0, 8))} — ${thesis} — ${conf}%`)
      }
      info(dim('Skipping creation.'))
      blank()

      // Offer to launch agent
      if (config.openrouterKey) {
        console.log(`  ${dim('─'.repeat(25))}`)
        console.log(`  ${bold('All set!')}`)
        blank()
        info(`  ${cyan('sf agent')}             Chat with your thesis`)
        info(`  ${cyan('sf context <id>')}      View thesis snapshot`)
        info(`  ${cyan('sf positions')}         View positions`)
        info(`  ${cyan('sf setup --check')}     Check config`)
        blank()

        const shouldLaunch = await promptYN(`  Launch agent now? (Y/n) `)
        if (shouldLaunch) {
          blank()
          info('Launching...')
          blank()
          await agentCommand(activeTheses[0].id, { model: config.model })
        }
      } else {
        blank()
        console.log(`  ${bold('All set!')}`)
        blank()
        info(`  ${cyan('sf list')}              List all theses`)
        info(`  ${cyan('sf context <id>')}      View thesis snapshot`)
        info(`  ${cyan('sf positions')}         View positions`)
        info(`  ${cyan('sf setup --check')}     Check config`)
        blank()
      }
      return
    }

    // No theses — offer to create one
    console.log(`  ${bold('Step 7: Create Your First Thesis')}`)
    blank()
    info('A thesis is your core market conviction. The system builds a causal model')
    info('from it, then continuously scans prediction markets for mispriced contracts.')
    blank()
    info('Examples:')
    info(`  ${dim('"The Fed won\'t cut rates in 2026 — inflation stays elevated due to oil prices"')}`)
    info(`  ${dim('"AI-driven layoffs cause consumer spending to contract, S&P drops 20% by year-end"')}`)
    info(`  ${dim('"Trump can\'t exit the Iran conflict — oil stays above $100 for six months"')}`)
    blank()

    const thesis = await prompt('  Enter your thesis (press Enter to skip, use sf create later):\n  > ')

    if (!thesis) {
      blank()
      info(dim('Skipped. Use sf create "your thesis" to create one later.'))
      blank()
      showFinalHints(config)
      return
    }

    blank()
    info('Building causal model... (~30s)')
    blank()

    try {
      const result = await client.createThesis(thesis, true)

      if (result.id) {
        const nodeCount = result.causalTree?.nodes?.length || 0
        const edgeCount = result.edgeAnalysis?.edges?.length || 0
        const totalMarkets = result.edgeAnalysis?.totalMarketsAnalyzed || 0
        const confidence = Math.round((parseFloat(result.confidence) || 0.5) * 100)

        ok(`Causal tree: ${nodeCount} node(s)`)
        ok(`Scanned ${totalMarkets} markets, found ${edgeCount} contract(s) with edge`)
        ok(`Confidence: ${confidence}%`)
        ok(`Thesis ID: ${result.id.slice(0, 8)}`)
        blank()

        // Offer to launch agent
        if (config.openrouterKey) {
          console.log(`  ${dim('─'.repeat(25))}`)
          console.log(`  ${bold('All set!')}`)
          blank()

          const shouldLaunch = await promptYN(`  Launch agent now? (Y/n) `)
          if (shouldLaunch) {
            blank()
            info('Launching...')
            blank()
            await agentCommand(result.id, { model: config.model })
          } else {
            blank()
            showFinalHints(config)
          }
        } else {
          showFinalHints(config)
        }
      } else {
        fail(`Creation failed: ${result.error || 'unknown error'}`)
        info(dim('You can retry later with sf create "your thesis"'))
        blank()
        showFinalHints(config)
      }
    } catch (err: any) {
      fail(`Creation failed: ${err.message}`)
      info(dim('You can retry later with sf create "your thesis"'))
      blank()
      showFinalHints(config)
    }
  } catch {
    // Can't connect to API, skip thesis step
    blank()
    showFinalHints(config)
  }
}

function showFinalHints(config: SFConfig) {
  console.log(`  ${dim('─'.repeat(25))}`)
  console.log(`  ${bold('All set!')}`)
  blank()
  info(`  ${cyan('sf agent')}             Chat with your thesis`)
  info(`  ${cyan('sf list')}              List all theses`)
  info(`  ${cyan('sf context <id>')}      View thesis snapshot`)
  info(`  ${cyan('sf positions')}         View positions`)
  info(`  ${cyan('sf setup --check')}     Check config`)
  blank()
}
