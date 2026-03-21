/**
 * CLI Configuration — ~/.sf/config.json
 *
 * Priority: env vars > config file > defaults
 *
 * After `sf setup`, all keys are stored in config.json.
 * `applyConfig()` sets process.env from config so all existing code
 * (client.ts, kalshi.ts, agent.ts) keeps working without changes.
 */

import fs from 'fs'
import path from 'path'
import os from 'os'

export interface SFConfig {
  apiKey?: string
  apiUrl?: string
  openrouterKey?: string
  kalshiKeyId?: string
  kalshiPrivateKeyPath?: string
  polymarketWalletAddress?: string
  polymarketPrivateKeyPath?: string
  tavilyKey?: string
  model?: string
  tradingEnabled?: boolean
  telegramBotToken?: string
  configuredAt?: string
}

const CONFIG_DIR = path.join(os.homedir(), '.sf')
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json')
const DEFAULT_API_URL = 'https://simplefunctions.dev'
const DEFAULT_MODEL = 'anthropic/claude-sonnet-4.6'

/**
 * Load config from file. Does NOT apply env overrides — use resolveConfig() for that.
 */
export function loadFileConfig(): SFConfig {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'))
    }
  } catch { /* corrupt file, ignore */ }
  return {}
}

/**
 * Resolve final config: env vars > config file > defaults.
 */
export function loadConfig(): SFConfig {
  const file = loadFileConfig()
  return {
    apiKey: process.env.SF_API_KEY || file.apiKey,
    apiUrl: process.env.SF_API_URL || file.apiUrl || DEFAULT_API_URL,
    openrouterKey: process.env.OPENROUTER_API_KEY || file.openrouterKey,
    kalshiKeyId: process.env.KALSHI_API_KEY_ID || file.kalshiKeyId,
    kalshiPrivateKeyPath: process.env.KALSHI_PRIVATE_KEY_PATH || file.kalshiPrivateKeyPath,
    polymarketWalletAddress: process.env.POLYMARKET_WALLET_ADDRESS || file.polymarketWalletAddress,
    polymarketPrivateKeyPath: process.env.POLYMARKET_PRIVATE_KEY_PATH || file.polymarketPrivateKeyPath,
    tavilyKey: process.env.TAVILY_API_KEY || file.tavilyKey,
    model: process.env.SF_MODEL || file.model || DEFAULT_MODEL,
    tradingEnabled: file.tradingEnabled || false,
    telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || file.telegramBotToken,
  }
}

/**
 * Save config to ~/.sf/config.json.
 */
export function saveConfig(config: SFConfig): void {
  fs.mkdirSync(CONFIG_DIR, { recursive: true })
  fs.writeFileSync(
    CONFIG_PATH,
    JSON.stringify({ ...config, configuredAt: new Date().toISOString() }, null, 2),
  )
}

/**
 * Delete config file (for --reset).
 */
export function resetConfig(): void {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      fs.unlinkSync(CONFIG_PATH)
    }
  } catch { /* ignore */ }
}

/**
 * Apply config to process.env.
 *
 * Call this ONCE at CLI startup, before any command runs.
 * This means client.ts, kalshi.ts, agent.ts etc. keep reading process.env
 * and just work — no code changes needed in those files.
 *
 * Env vars already set by the user take priority (we only fill gaps).
 */
export function applyConfig(): void {
  const file = loadFileConfig()

  // Only set process.env if not already set (env vars > config file)
  if (!process.env.SF_API_KEY && file.apiKey) {
    process.env.SF_API_KEY = file.apiKey
  }
  if (!process.env.SF_API_URL && file.apiUrl) {
    process.env.SF_API_URL = file.apiUrl
  }
  if (!process.env.OPENROUTER_API_KEY && file.openrouterKey) {
    process.env.OPENROUTER_API_KEY = file.openrouterKey
  }
  if (!process.env.KALSHI_API_KEY_ID && file.kalshiKeyId) {
    process.env.KALSHI_API_KEY_ID = file.kalshiKeyId
  }
  if (!process.env.KALSHI_PRIVATE_KEY_PATH && file.kalshiPrivateKeyPath) {
    process.env.KALSHI_PRIVATE_KEY_PATH = file.kalshiPrivateKeyPath
  }
  if (!process.env.POLYMARKET_WALLET_ADDRESS && file.polymarketWalletAddress) {
    process.env.POLYMARKET_WALLET_ADDRESS = file.polymarketWalletAddress
  }
  if (!process.env.POLYMARKET_PRIVATE_KEY_PATH && file.polymarketPrivateKeyPath) {
    process.env.POLYMARKET_PRIVATE_KEY_PATH = file.polymarketPrivateKeyPath
  }
  if (!process.env.TAVILY_API_KEY && file.tavilyKey) {
    process.env.TAVILY_API_KEY = file.tavilyKey
  }
  if (!process.env.SF_MODEL && file.model) {
    process.env.SF_MODEL = file.model
  }
}

/**
 * Check if SF API key is configured (from any source).
 */
export function isConfigured(): boolean {
  const config = loadConfig()
  return !!config.apiKey
}

export function requireTrading(): void {
  const config = loadConfig()
  if (!config.tradingEnabled) {
    console.error('\n  ⚠️  Trading is disabled. Run: sf setup --enable-trading\n')
    process.exit(1)
  }
  if (!config.kalshiKeyId && !process.env.KALSHI_API_KEY_ID) {
    console.error('\n  ⚠️  Kalshi API key not configured. Run: sf setup\n')
    process.exit(1)
  }
}

export function getConfigPath(): string {
  return CONFIG_PATH
}
