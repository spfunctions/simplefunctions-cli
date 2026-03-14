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
    if (res.ok) return { valid: true, msg: `API Key 有效 — 连接到 ${apiUrl.replace('https://', '')}` }
    if (res.status === 401) return { valid: false, msg: '无效 key，请重试' }
    return { valid: false, msg: `服务器返回 ${res.status}` }
  } catch (err: any) {
    return { valid: false, msg: `连接失败: ${err.message}` }
  }
}

async function validateOpenRouterKey(key: string): Promise<{ valid: boolean; msg: string }> {
  try {
    const res = await fetch('https://openrouter.ai/api/v1/models', {
      headers: { 'Authorization': `Bearer ${key}` },
    })
    if (res.ok) return { valid: true, msg: 'OpenRouter 连接正常 — 可用模型: claude-sonnet-4.6' }
    return { valid: false, msg: `OpenRouter 返回 ${res.status}` }
  } catch (err: any) {
    return { valid: false, msg: `连接失败: ${err.message}` }
  }
}

async function validateKalshi(): Promise<{ valid: boolean; msg: string; posCount: number }> {
  try {
    const positions = await getPositions()
    if (positions === null) return { valid: false, msg: 'Kalshi 认证失败', posCount: 0 }
    return { valid: true, msg: `Kalshi 认证成功 — 发现 ${positions.length} 个持仓`, posCount: positions.length }
  } catch (err: any) {
    return { valid: false, msg: `Kalshi 连接失败: ${err.message}`, posCount: 0 }
  }
}

async function validateTavily(key: string): Promise<{ valid: boolean; msg: string }> {
  try {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: key, query: 'test', max_results: 1 }),
    })
    if (res.ok) return { valid: true, msg: 'Tavily 连接正常' }
    return { valid: false, msg: `Tavily 返回 ${res.status}` }
  } catch (err: any) {
    return { valid: false, msg: `连接失败: ${err.message}` }
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
}

export async function setupCommand(opts: SetupOpts): Promise<void> {
  // ── sf setup --check ──────────────────────────────────────────────────────
  if (opts.check) {
    return showCheck()
  }

  // ── sf setup --reset ──────────────────────────────────────────────────────
  if (opts.reset) {
    resetConfig()
    ok('配置已重置')
    blank()
    info('运行 sf setup 重新配置')
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
    ok(`保存到 ${getConfigPath()}`)
    return
  }

  // ── sf setup --kalshi (reconfigure Kalshi credentials) ──────────────────
  if (opts.kalshi) {
    const existing = loadFileConfig()
    blank()
    console.log(`  ${bold('重新配置 Kalshi 凭证')}`)
    blank()
    info('去 https://kalshi.com/account/api-keys 生成新的 API key。')
    info('如果需要交易功能，确保勾选 read+write 权限。')
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
  console.log(`  ${bold('SimpleFunctions 配置状态')}`)
  console.log(`  ${dim('─'.repeat(35))}`)
  blank()

  // SF API Key
  if (config.apiKey) {
    ok(`SF_API_KEY        ${dim(mask(config.apiKey))}`)
  } else {
    fail('SF_API_KEY        未配置（必须）')
  }

  // OpenRouter
  if (config.openrouterKey) {
    ok(`OPENROUTER_KEY    ${dim(mask(config.openrouterKey))}`)
  } else {
    fail(`OPENROUTER_KEY    未配置（agent 不可用）`)
  }

  // Kalshi
  if (config.kalshiKeyId && config.kalshiPrivateKeyPath) {
    ok(`KALSHI            ${dim(mask(config.kalshiKeyId))}`)
  } else {
    info(`${dim('○')} KALSHI            ${dim('跳过')}`)
  }

  // Tavily
  if (config.tavilyKey) {
    ok(`TAVILY            ${dim(mask(config.tavilyKey))}`)
  } else {
    info(`${dim('○')} TAVILY            ${dim('跳过')}`)
  }

  // Trading
  if (config.tradingEnabled) {
    ok('TRADING           已启用')
  } else {
    info(`${dim('○')} TRADING           ${dim('未启用 — sf setup --enable-trading')}`)
  }

  blank()
  console.log(`  ${dim('配置文件: ' + getConfigPath())}`)
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
  console.log(`  ${bold('第 1 步：API Key')}`)
  blank()

  const existingSfKey = process.env.SF_API_KEY || config.apiKey
  if (existingSfKey) {
    const result = await validateSFKey(existingSfKey, apiUrl)
    if (result.valid) {
      ok(`已检测到 SF_API_KEY — ${dim(mask(existingSfKey))}`)
      info(dim('跳过。'))
      config.apiKey = existingSfKey
      blank()
    } else {
      fail(`已有 key 无效: ${result.msg}`)
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
  console.log(`  ${bold('第 2 步：AI 模型（用于 sf agent）')}`)
  blank()

  const existingOrKey = process.env.OPENROUTER_API_KEY || config.openrouterKey
  if (existingOrKey) {
    const result = await validateOpenRouterKey(existingOrKey)
    if (result.valid) {
      ok(`已检测到 OPENROUTER_API_KEY — ${dim(mask(existingOrKey))}`)
      info(dim('跳过。'))
      config.openrouterKey = existingOrKey
      blank()
    } else {
      fail(`已有 key 无效: ${result.msg}`)
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
  console.log(`  ${bold('第 3 步：Kalshi 交易所（可选）')}`)
  blank()

  const existingKalshiId = process.env.KALSHI_API_KEY_ID || config.kalshiKeyId
  const existingKalshiPath = process.env.KALSHI_PRIVATE_KEY_PATH || config.kalshiPrivateKeyPath
  if (existingKalshiId && existingKalshiPath) {
    // Temporarily apply for validation
    process.env.KALSHI_API_KEY_ID = existingKalshiId
    process.env.KALSHI_PRIVATE_KEY_PATH = existingKalshiPath
    const result = await validateKalshi()
    if (result.valid) {
      ok(`已检测到 Kalshi — ${dim(mask(existingKalshiId))} (${result.posCount} 个持仓)`)
      info(dim('跳过。'))
      config.kalshiKeyId = existingKalshiId
      config.kalshiPrivateKeyPath = existingKalshiPath
      blank()
    } else {
      fail(`已有凭证无效: ${result.msg}`)
      await promptForKalshi(config)
    }
  } else {
    await promptForKalshi(config)
  }

  saveConfig(config)

  // ════════════════════════════════════════════════════════════════════════════
  // Step 4: Tavily
  // ════════════════════════════════════════════════════════════════════════════
  console.log(`  ${bold('第 4 步：新闻搜索（可选）')}`)
  blank()

  const existingTavily = process.env.TAVILY_API_KEY || config.tavilyKey
  if (existingTavily) {
    const result = await validateTavily(existingTavily)
    if (result.valid) {
      ok(`已检测到 TAVILY_API_KEY — ${dim(mask(existingTavily))}`)
      info(dim('跳过。'))
      config.tavilyKey = existingTavily
      blank()
    } else {
      fail(`已有 key 无效: ${result.msg}`)
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
    console.log(`  ${bold('第 5 步：交易功能（可选）')}`)
    blank()
    info('⚠️  启用后 sf buy / sf sell / sf cancel 可用。')
    info('你的 Kalshi API key 必须有 read+write 权限。')
    blank()
    const enableTrading = await promptYN('  启用交易功能？(y/N) ', false)
    config.tradingEnabled = enableTrading
    if (enableTrading) {
      ok('交易功能已启用')
    } else {
      info(dim('跳过。之后可以 sf setup --enable-trading 启用。'))
    }
    blank()
    saveConfig(config)
  }

  // ════════════════════════════════════════════════════════════════════════════
  // Summary
  // ════════════════════════════════════════════════════════════════════════════
  console.log(`  ${dim('─'.repeat(25))}`)
  info(`配置保存到 ${dim(getConfigPath())}`)
  blank()

  if (config.apiKey) ok('SF_API_KEY        已配置')
  else fail('SF_API_KEY        未配置')

  if (config.openrouterKey) ok('OPENROUTER_KEY    已配置')
  else fail('OPENROUTER_KEY    跳过')

  if (config.kalshiKeyId) ok('KALSHI            已配置')
  else info(`${dim('○')} KALSHI            跳过`)

  if (config.tavilyKey) ok('TAVILY            已配置')
  else info(`${dim('○')} TAVILY            跳过`)

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
  info(`还没有 key？去 ${cyan('https://simplefunctions.dev/dashboard')} 注册获取。`)
  info('按 Enter 打开浏览器，或直接粘贴你的 key：')
  blank()

  while (true) {
    const answer = await prompt('  > ')

    if (!answer) {
      // Open browser
      openBrowser('https://simplefunctions.dev/dashboard')
      info(dim('浏览器已打开。获取 key 后粘贴到这里：'))
      continue
    }

    info(dim('验证中...'))
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
  info(`需要 OpenRouter API key。去 ${cyan('https://openrouter.ai/settings/keys')} 获取。`)
  info('按 Enter 跳过（agent 功能不可用），或粘贴 key：')
  blank()

  const answer = await prompt('  > ')
  if (!answer) {
    info(dim('跳过。'))
    blank()
    return undefined
  }

  info(dim('验证中...'))
  const result = await validateOpenRouterKey(answer)
  if (result.valid) {
    ok(result.msg)
  } else {
    fail(result.msg)
    info(dim('已保存，之后可以重新运行 sf setup 修正。'))
  }
  blank()
  return answer
}

async function promptForKalshi(config: SFConfig): Promise<void> {
  info(`连接 Kalshi 查看你的持仓和盈亏。`)
  info(`需要 API Key ID 和私钥文件。`)
  info(`${cyan('https://kalshi.com/account/api-keys')} 获取。`)
  info('按 Enter 跳过，或粘贴 Key ID：')
  blank()

  const keyId = await prompt('  > ')
  if (!keyId) {
    info(dim('跳过。'))
    blank()
    return
  }

  info('私钥文件路径（默认 ~/.kalshi/private.pem）：')
  const keyPathInput = await prompt('  > ')
  const keyPath = keyPathInput || '~/.kalshi/private.pem'

  config.kalshiKeyId = keyId
  config.kalshiPrivateKeyPath = keyPath

  // Temporarily set for validation
  process.env.KALSHI_API_KEY_ID = keyId
  process.env.KALSHI_PRIVATE_KEY_PATH = keyPath

  info(dim('验证中...'))
  const result = await validateKalshi()
  if (result.valid) {
    ok(result.msg)
  } else {
    fail(result.msg)
    info(dim('已保存，之后可以重新运行 sf setup 修正。'))
  }
  blank()
}

async function promptForTavily(): Promise<string | undefined> {
  info(`Tavily API 用于 agent 的 web_search 功能。`)
  info(`${cyan('https://tavily.com')} 获取免费 key。`)
  info('按 Enter 跳过：')
  blank()

  const answer = await prompt('  > ')
  if (!answer) {
    info(dim('跳过。'))
    blank()
    return undefined
  }

  info(dim('验证中...'))
  const result = await validateTavily(answer)
  if (result.valid) {
    ok(result.msg)
  } else {
    fail(result.msg)
    info(dim('已保存，之后可以重新运行 sf setup 修正。'))
  }
  blank()
  return answer
}

// ─── Step 6: Thesis ──────────────────────────────────────────────────────────

async function handleThesisStep(config: SFConfig): Promise<void> {
  try {
    const client = new SFClient(config.apiKey, config.apiUrl)
    const data = await client.listTheses()
    const theses = data.theses || []
    const activeTheses = theses.filter((t: any) => t.status === 'active')

    if (activeTheses.length > 0) {
      console.log(`  ${bold('第 6 步：论文')}`)
      blank()
      ok(`已有 ${activeTheses.length} 个活跃论文：`)
      for (const t of activeTheses.slice(0, 5)) {
        const conf = typeof t.confidence === 'number' ? Math.round(t.confidence * 100) : 0
        const thesis = (t.rawThesis || t.thesis || t.title || '').slice(0, 60)
        info(`  ${dim(t.id.slice(0, 8))} — ${thesis} — ${conf}%`)
      }
      info(dim('跳过创建。'))
      blank()

      // Offer to launch agent
      if (config.openrouterKey) {
        console.log(`  ${dim('─'.repeat(25))}`)
        console.log(`  ${bold('全部就绪！')}`)
        blank()
        info(`  ${cyan('sf agent')}             和你的论文对话`)
        info(`  ${cyan('sf context <id>')}      查看论文快照`)
        info(`  ${cyan('sf positions')}         查看持仓`)
        info(`  ${cyan('sf setup --check')}     检查配置`)
        blank()

        const shouldLaunch = await promptYN(`  要不要现在启动 agent？(Y/n) `)
        if (shouldLaunch) {
          blank()
          info('启动中...')
          blank()
          await agentCommand(activeTheses[0].id, { model: config.model })
        }
      } else {
        blank()
        console.log(`  ${bold('全部就绪！')}`)
        blank()
        info(`  ${cyan('sf list')}              查看所有论文`)
        info(`  ${cyan('sf context <id>')}      查看论文快照`)
        info(`  ${cyan('sf positions')}         查看持仓`)
        info(`  ${cyan('sf setup --check')}     检查配置`)
        blank()
      }
      return
    }

    // No theses — offer to create one
    console.log(`  ${bold('第 6 步：创建你的第一个论文')}`)
    blank()
    info('论文是你对市场的一个核心判断。系统会基于它构建因果模型，')
    info('然后持续扫描预测市场寻找被错误定价的合约。')
    blank()
    info('比如：')
    info(`  ${dim('"美联储2026年不会降息，通胀因油价持续高企"')}`)
    info(`  ${dim('"AI裁员潮导致消费萎缩，标普年底跌20%"')}`)
    info(`  ${dim('"Trump无法退出伊朗战争，油价维持$100以上六个月"')}`)
    blank()

    const thesis = await prompt('  输入你的论文（按 Enter 跳过，之后用 sf create）：\n  > ')

    if (!thesis) {
      blank()
      info(dim('跳过。之后用 sf create "你的论文" 创建。'))
      blank()
      showFinalHints(config)
      return
    }

    blank()
    info('构建因果模型中...（约30秒）')
    blank()

    try {
      const result = await client.createThesis(thesis, true)

      if (result.id) {
        const nodeCount = result.causalTree?.nodes?.length || 0
        const edgeCount = result.edgeAnalysis?.edges?.length || 0
        const totalMarkets = result.edgeAnalysis?.totalMarketsAnalyzed || 0
        const confidence = Math.round((parseFloat(result.confidence) || 0.5) * 100)

        ok(`因果树：${nodeCount} 个节点`)
        ok(`扫描 ${totalMarkets} 个市场，找到 ${edgeCount} 个有边际的合约`)
        ok(`置信度：${confidence}%`)
        ok(`论文 ID：${result.id.slice(0, 8)}`)
        blank()

        // Offer to launch agent
        if (config.openrouterKey) {
          console.log(`  ${dim('─'.repeat(25))}`)
          console.log(`  ${bold('全部就绪！')}`)
          blank()

          const shouldLaunch = await promptYN(`  要不要现在启动 agent？(Y/n) `)
          if (shouldLaunch) {
            blank()
            info('启动中...')
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
        fail(`创建失败：${result.error || '未知错误'}`)
        info(dim('之后可以用 sf create "你的论文" 重试'))
        blank()
        showFinalHints(config)
      }
    } catch (err: any) {
      fail(`创建失败：${err.message}`)
      info(dim('之后可以用 sf create "你的论文" 重试'))
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
  console.log(`  ${bold('全部就绪！')}`)
  blank()
  info(`  ${cyan('sf agent')}             和你的论文对话`)
  info(`  ${cyan('sf list')}              查看所有论文`)
  info(`  ${cyan('sf context <id>')}      查看论文快照`)
  info(`  ${cyan('sf positions')}         查看持仓`)
  info(`  ${cyan('sf setup --check')}     检查配置`)
  blank()
}
