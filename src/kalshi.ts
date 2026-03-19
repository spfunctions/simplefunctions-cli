/**
 * Kalshi Authenticated Client (CLI-side only)
 *
 * Uses the kalshi-typescript SDK with RSA-PSS private key auth.
 * Credentials NEVER leave the user's machine — they are read from env vars
 * pointing to a local PEM file.
 *
 * Required env vars:
 *   KALSHI_API_KEY_ID       — Key ID from Kalshi dashboard
 *   KALSHI_PRIVATE_KEY_PATH — Path to RSA private key PEM file (e.g. ~/.kalshi/private.pem)
 */

import fs from 'fs'
import path from 'path'
import crypto from 'crypto'

const KALSHI_API_BASE = 'https://api.elections.kalshi.com/trade-api/v2'

// ============================================================================
// AUTH
// ============================================================================

/**
 * Check if Kalshi credentials are configured locally.
 */
export function isKalshiConfigured(): boolean {
  return !!(process.env.KALSHI_API_KEY_ID && process.env.KALSHI_PRIVATE_KEY_PATH)
}

/**
 * Load the RSA private key from disk.
 */
function loadPrivateKey(): crypto.KeyObject | null {
  const keyPath = process.env.KALSHI_PRIVATE_KEY_PATH
  if (!keyPath) return null

  const resolved = keyPath.startsWith('~')
    ? path.join(process.env.HOME || '', keyPath.slice(1))
    : path.resolve(keyPath)

  try {
    const pem = fs.readFileSync(resolved, 'utf-8')
    return crypto.createPrivateKey(pem)
  } catch (err) {
    console.warn(`[Kalshi] Failed to load private key from ${resolved}:`, err)
    return null
  }
}

/**
 * Sign a request using RSA-PSS (Kalshi's auth scheme).
 *
 * Kalshi expects:
 *   Header: KALSHI-ACCESS-KEY = API key ID
 *   Header: KALSHI-ACCESS-SIGNATURE = base64(RSA-PSS-sign(timestamp_ms + method + path))
 *   Header: KALSHI-ACCESS-TIMESTAMP = milliseconds since epoch (string)
 */
function signRequest(
  method: string,
  urlPath: string,
  privateKey: crypto.KeyObject
): { headers: Record<string, string> } {
  const keyId = process.env.KALSHI_API_KEY_ID!
  const timestampMs = Date.now().toString()

  // Kalshi signing payload: timestamp_ms + method + path (no body)
  const payload = timestampMs + method.toUpperCase() + urlPath
  const signature = crypto.sign('sha256', Buffer.from(payload), {
    key: privateKey,
    padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
    saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST,
  })

  return {
    headers: {
      'KALSHI-ACCESS-KEY': keyId,
      'KALSHI-ACCESS-SIGNATURE': signature.toString('base64'),
      'KALSHI-ACCESS-TIMESTAMP': timestampMs,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
  }
}

/**
 * Make an authenticated Kalshi API request.
 */
async function kalshiAuthGet<T = any>(apiPath: string): Promise<T> {
  const privateKey = loadPrivateKey()
  if (!privateKey) {
    throw new Error('Kalshi private key not loaded. Check KALSHI_PRIVATE_KEY_PATH.')
  }

  const url = `${KALSHI_API_BASE}${apiPath}`
  // Kalshi signing MUST exclude query params — sign only the path portion
  const pathOnly = apiPath.split('?')[0]
  const { headers } = signRequest('GET', `/trade-api/v2${pathOnly}`, privateKey)

  const res = await fetch(url, { method: 'GET', headers })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Kalshi API ${res.status}: ${text}`)
  }

  return res.json() as Promise<T>
}

async function kalshiAuthPost<T = any>(apiPath: string, body: Record<string, any>): Promise<T> {
  const privateKey = loadPrivateKey()
  if (!privateKey) {
    throw new Error('Kalshi private key not loaded. Check KALSHI_PRIVATE_KEY_PATH.')
  }

  const url = `${KALSHI_API_BASE}${apiPath}`
  const pathOnly = apiPath.split('?')[0]
  const { headers } = signRequest('POST', `/trade-api/v2${pathOnly}`, privateKey)

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Kalshi API ${res.status}: ${text}`)
  }

  return res.json() as Promise<T>
}

async function kalshiAuthDelete<T = any>(apiPath: string): Promise<T> {
  const privateKey = loadPrivateKey()
  if (!privateKey) {
    throw new Error('Kalshi private key not loaded. Check KALSHI_PRIVATE_KEY_PATH.')
  }

  const url = `${KALSHI_API_BASE}${apiPath}`
  const pathOnly = apiPath.split('?')[0]
  const { headers } = signRequest('DELETE', `/trade-api/v2${pathOnly}`, privateKey)

  const res = await fetch(url, { method: 'DELETE', headers })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Kalshi API ${res.status}: ${text}`)
  }

  const contentType = res.headers.get('content-type')
  if (contentType?.includes('application/json')) {
    return res.json() as Promise<T>
  }
  return {} as T
}

// ============================================================================
// PORTFOLIO
// ============================================================================

export interface KalshiPosition {
  ticker: string
  event_ticker: string
  market_title: string
  side: 'yes' | 'no'
  quantity: number
  average_price_paid: number       // cents
  current_value: number            // cents
  realized_pnl: number             // cents
  unrealized_pnl: number           // cents
  total_cost: number               // cents
  settlement_value?: number
  // Kalshi may include more fields; we keep the important ones
  [key: string]: unknown
}

export interface KalshiPortfolio {
  positions: KalshiPosition[]
}

/**
 * Get user's live positions from Kalshi.
 * Returns null if Kalshi is not configured.
 */
export async function getPositions(): Promise<KalshiPosition[] | null> {
  if (!isKalshiConfigured()) return null

  try {
    const data = await kalshiAuthGet<{ market_positions: any[] }>('/portfolio/positions')
    // Kalshi returns { market_positions: [...] } or { positions: [...] }
    const raw = data.market_positions || (data as any).positions || []

    return raw.map((p: any) => {
      // Kalshi actual fields:
      //   position_fp: "795.00" (string, contract count — positive=YES, negative=NO)
      //   total_traded_dollars: "453.1500" (string, total cost in dollars)
      //   ticker: "KXWTIMAX-26DEC31-T135"
      //   event_ticker: "KXWTIMAX-26DEC31"
      //   market_result: "", resting_orders_count: 0, etc.
      const positionFp = parseFloat(p.position_fp || '0')
      const totalTradedDollars = parseFloat(p.total_traded_dollars || '0')
      const quantity = Math.abs(positionFp)
      const side: 'yes' | 'no' = positionFp >= 0 ? 'yes' : 'no'
      // avg price in cents = (total_traded_dollars / quantity) * 100
      const avgPriceCents = quantity > 0 ? Math.round((totalTradedDollars / quantity) * 100) : 0

      return {
        ticker: p.ticker || p.market_ticker || '',
        event_ticker: p.event_ticker || '',
        market_title: p.market_title || p.title || '',
        side,
        quantity,
        average_price_paid: avgPriceCents,
        current_value: 0, // will be enriched by live price lookup if needed
        realized_pnl: Math.round(parseFloat(p.realized_pnl || '0') * 100),
        unrealized_pnl: 0, // Kalshi doesn't give this directly, needs live price
        total_cost: Math.round(totalTradedDollars * 100), // dollars → cents
      }
    })
  } catch (err) {
    console.warn(`[Kalshi] Failed to fetch positions:`, err)
    return null
  }
}

/**
 * Extract price in cents (0-100) from a Kalshi market object.
 * Dollars fields first (Kalshi API returns null for integer cents fields).
 */
export function kalshiPriceCents(market: any): number {
  if (market.last_price_dollars) {
    const p = parseFloat(market.last_price_dollars)
    if (!isNaN(p) && p > 0) return Math.round(p * 100)
  }
  if (market.yes_bid_dollars) {
    const p = parseFloat(market.yes_bid_dollars)
    if (!isNaN(p) && p > 0) return Math.round(p * 100)
  }
  if (market.yes_ask_dollars) {
    const p = parseFloat(market.yes_ask_dollars)
    if (!isNaN(p) && p > 0) return Math.round(p * 100)
  }
  if (market.last_price != null && market.last_price > 0) return market.last_price
  if (market.yes_bid != null && market.yes_bid > 0) return market.yes_bid
  return 50
}

/**
 * Get the current market price for a given ticker (public, no auth).
 * Returns price in cents (0-100) or null.
 */
export async function getMarketPrice(ticker: string): Promise<number | null> {
  try {
    const url = `https://api.elections.kalshi.com/trade-api/v2/markets/${ticker}`
    const res = await fetch(url, { headers: { 'Accept': 'application/json' } })
    if (!res.ok) return null
    const data = await res.json()
    const m = data.market || data
    const price = kalshiPriceCents(m)
    return price === 50 && !m.last_price_dollars && !m.yes_bid_dollars ? null : price
  } catch {
    return null
  }
}

/**
 * Fetch orderbook for a ticker using local Kalshi auth credentials.
 * Returns simplified spread/depth info or null.
 */
export interface LocalOrderbook {
  bestBid: number
  bestAsk: number
  spread: number
  bidDepth: number
  askDepth: number
  liquidityScore: 'high' | 'medium' | 'low'
}

export async function getOrderbook(ticker: string): Promise<LocalOrderbook | null> {
  if (!isKalshiConfigured()) return null

  try {
    const data = await kalshiAuthGet<Record<string, any>>(`/markets/${ticker}/orderbook`)
    const ob = data.orderbook_fp || data.orderbook
    if (!ob) return null

    // Kalshi orderbook_fp uses yes_dollars/no_dollars: [["0.57", "100"], ...]
    // Fallback to yes/no (cents format)
    const rawYes: Array<[string, string]> = ob.yes_dollars || ob.yes || []
    const rawNo: Array<[string, string]> = ob.no_dollars || ob.no || []
    const isDollar = !!(ob.yes_dollars || ob.no_dollars)

    // Parse to cents
    const parsedYes = rawYes.map(l => ({
      price: isDollar ? Math.round(parseFloat(l[0]) * 100) : Number(l[0]),
      qty: parseFloat(l[1]),
    })).filter(l => l.price > 0)

    const parsedNo = rawNo.map(l => ({
      price: isDollar ? Math.round(parseFloat(l[0]) * 100) : Number(l[0]),
      qty: parseFloat(l[1]),
    })).filter(l => l.price > 0)

    // Sort descending by price
    parsedYes.sort((a, b) => b.price - a.price)
    parsedNo.sort((a, b) => b.price - a.price)

    const bestBid = parsedYes.length > 0 ? parsedYes[0].price : 0
    const bestAsk = parsedNo.length > 0 ? (100 - parsedNo[0].price) : 100
    const spread = bestAsk - bestBid

    const bidDepth = parsedYes.slice(0, 3).reduce((sum, l) => sum + l.qty, 0)
    const askDepth = parsedNo.slice(0, 3).reduce((sum, l) => sum + l.qty, 0)
    const minDepth = Math.min(bidDepth, askDepth)

    let liquidityScore: 'high' | 'medium' | 'low' = 'low'
    if (spread <= 2 && minDepth >= 500) liquidityScore = 'high'
    else if (spread <= 5 && minDepth >= 100) liquidityScore = 'medium'

    return { bestBid, bestAsk, spread, bidDepth, askDepth, liquidityScore }
  } catch {
    return null
  }
}

// ============================================================================
// PUBLIC ORDERBOOK (no auth)
// ============================================================================

export interface PublicOrderbook {
  yes_dollars: Array<[string, string]>
  no_dollars: Array<[string, string]>
}

/**
 * Fetch orderbook for a ticker using the public (unauthenticated) endpoint.
 * Returns raw yes_dollars/no_dollars arrays or null on failure.
 */
export async function getPublicOrderbook(ticker: string, depth = 20): Promise<PublicOrderbook | null> {
  try {
    const url = `${KALSHI_API_BASE}/markets/${ticker}/orderbook?depth=${depth}`
    const res = await fetch(url, { headers: { 'Accept': 'application/json' } })
    if (!res.ok) return null
    const data = await res.json()
    const ob = data.orderbook_fp || data.orderbook || data
    return {
      yes_dollars: ob.yes_dollars || ob.yes || [],
      no_dollars: ob.no_dollars || ob.no || [],
    }
  } catch {
    return null
  }
}

// ============================================================================
// SETTLEMENTS (Authenticated)
// ============================================================================

export async function getSettlements(params?: {
  limit?: number
  cursor?: string
  ticker?: string
}): Promise<{ settlements: any[]; cursor: string } | null> {
  if (!isKalshiConfigured()) return null
  try {
    const searchParams = new URLSearchParams()
    if (params?.limit) searchParams.set('limit', params.limit.toString())
    if (params?.cursor) searchParams.set('cursor', params.cursor)
    if (params?.ticker) searchParams.set('ticker', params.ticker)
    const data = await kalshiAuthGet<{ settlements: any[]; cursor: string }>(`/portfolio/settlements?${searchParams.toString()}`)
    return { settlements: data.settlements || [], cursor: data.cursor || '' }
  } catch (err) {
    console.warn('[Kalshi] Failed to fetch settlements:', err)
    return null
  }
}

// ============================================================================
// BALANCE (Authenticated)
// ============================================================================

export async function getBalance(): Promise<{ balance: number; portfolioValue: number } | null> {
  if (!isKalshiConfigured()) return null
  try {
    const data = await kalshiAuthGet<Record<string, any>>('/portfolio/balance')
    // API returns cents integers; convert to dollars
    const balance = (data.balance || 0) / 100
    const portfolioValue = (data.portfolio_value || 0) / 100
    return { balance, portfolioValue }
  } catch (err) {
    console.warn('[Kalshi] Failed to fetch balance:', err)
    return null
  }
}

// ============================================================================
// ORDERS (Authenticated)
// ============================================================================

export async function getOrders(params?: {
  status?: string
  ticker?: string
  limit?: number
  cursor?: string
}): Promise<{ orders: any[]; cursor: string } | null> {
  if (!isKalshiConfigured()) return null
  try {
    const searchParams = new URLSearchParams()
    if (params?.status) searchParams.set('status', params.status)
    if (params?.ticker) searchParams.set('ticker', params.ticker)
    if (params?.limit) searchParams.set('limit', params.limit.toString())
    if (params?.cursor) searchParams.set('cursor', params.cursor)
    const data = await kalshiAuthGet<{ orders: any[]; cursor: string }>(`/portfolio/orders?${searchParams.toString()}`)
    return { orders: data.orders || [], cursor: data.cursor || '' }
  } catch (err) {
    console.warn('[Kalshi] Failed to fetch orders:', err)
    return null
  }
}

// ============================================================================
// FILLS (Authenticated)
// ============================================================================

export async function getFills(params?: {
  ticker?: string
  limit?: number
  cursor?: string
}): Promise<{ fills: any[]; cursor: string } | null> {
  if (!isKalshiConfigured()) return null
  try {
    const searchParams = new URLSearchParams()
    if (params?.ticker) searchParams.set('ticker', params.ticker)
    if (params?.limit) searchParams.set('limit', params.limit.toString())
    if (params?.cursor) searchParams.set('cursor', params.cursor)
    const data = await kalshiAuthGet<{ fills: any[]; cursor: string }>(`/portfolio/fills?${searchParams.toString()}`)
    return { fills: data.fills || [], cursor: data.cursor || '' }
  } catch (err) {
    console.warn('[Kalshi] Failed to fetch fills:', err)
    return null
  }
}

// ============================================================================
// FORECAST PERCENTILE HISTORY (Authenticated)
// ============================================================================

export async function getForecastHistory(params: {
  seriesTicker: string
  eventTicker: string
  percentiles: number[]
  startTs: number
  endTs: number
  periodInterval: number
}): Promise<any[] | null> {
  if (!isKalshiConfigured()) return null
  try {
    const searchParams = new URLSearchParams()
    for (const p of params.percentiles) searchParams.append('percentiles', p.toString())
    searchParams.set('start_ts', params.startTs.toString())
    // Kalshi returns 400 if end_ts is past the latest available forecast data.
    // Clamp to start of today UTC to avoid hitting future timestamps.
    const todayMidnight = Math.floor(new Date().setUTCHours(0, 0, 0, 0) / 1000)
    const clampedEnd = Math.min(params.endTs, todayMidnight)
    searchParams.set('end_ts', clampedEnd.toString())
    searchParams.set('period_interval', params.periodInterval.toString())
    const apiPath = `/series/${params.seriesTicker}/events/${params.eventTicker}/forecast_percentile_history?${searchParams.toString()}`
    const data = await kalshiAuthGet<{ forecast_history: any[] }>(apiPath)
    return data.forecast_history || []
  } catch (err) {
    console.warn('[Kalshi] Failed to fetch forecast:', err)
    return null
  }
}

// ============================================================================
// EXCHANGE (Public, no auth)
// ============================================================================

export async function getExchangeAnnouncements(): Promise<any[]> {
  try {
    const res = await fetch(`${KALSHI_API_BASE}/exchange/announcements`, { headers: { 'Accept': 'application/json' } })
    if (!res.ok) return []
    const data = await res.json()
    return data.announcements || []
  } catch {
    return []
  }
}

export async function getHistoricalMarket(ticker: string): Promise<any | null> {
  try {
    const res = await fetch(`${KALSHI_API_BASE}/historical/markets/${ticker}`, { headers: { 'Accept': 'application/json' } })
    if (!res.ok) return null
    const data = await res.json()
    return data.market || data || null
  } catch {
    return null
  }
}

// ============================================================================
// TRADING — ORDER MANAGEMENT (Authenticated, requires write key)
// ============================================================================

export async function createOrder(params: {
  ticker: string
  side: 'yes' | 'no'
  action: 'buy' | 'sell'
  type: 'limit' | 'market'
  count: number
  yes_price?: number        // cents integer e.g. 5
  client_order_id?: string
}): Promise<{ order: any }> {
  return kalshiAuthPost('/portfolio/orders', params)
}

export async function cancelOrder(orderId: string): Promise<void> {
  await kalshiAuthDelete(`/portfolio/orders/${orderId}`)
}

export async function batchCancelOrders(orderIds: string[]): Promise<void> {
  await kalshiAuthPost('/portfolio/orders/batched', {
    orders: orderIds.map(id => ({ action: 'cancel', order_id: id })),
  })
}

export async function amendOrder(orderId: string, params: {
  price?: string
  count?: number
}): Promise<{ order: any }> {
  // PATCH - need to implement kalshiAuthPatch or use POST
  const privateKey = loadPrivateKey()
  if (!privateKey) throw new Error('Kalshi private key not loaded.')

  const apiPath = `/portfolio/orders/${orderId}`
  const url = `${KALSHI_API_BASE}${apiPath}`
  const { headers } = signRequest('PATCH', `/trade-api/v2${apiPath}`, privateKey)

  const res = await fetch(url, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(params),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Kalshi API ${res.status}: ${text}`)
  }
  return res.json()
}

// ============================================================================
// CANDLESTICKS (Authenticated)
// ============================================================================

export async function getBatchCandlesticks(params: {
  tickers: string[]
  startTs: number  // unix seconds
  endTs: number    // unix seconds
  periodInterval?: number  // default 1440 (daily)
}): Promise<{ market_ticker: string; candlesticks: any[] }[]> {
  if (!isKalshiConfigured()) return []
  try {
    const searchParams = new URLSearchParams()
    searchParams.set('tickers', params.tickers.join(','))
    searchParams.set('start_ts', params.startTs.toString())
    searchParams.set('end_ts', params.endTs.toString())
    searchParams.set('period_interval', (params.periodInterval ?? 1440).toString())
    const data = await kalshiAuthGet<{ candlesticks: { market_ticker: string; candlesticks: any[] }[] }>(
      `/markets/candlesticks?${searchParams.toString()}`
    )
    return data.candlesticks || []
  } catch (err) {
    console.warn('[Kalshi] Failed to fetch candlesticks:', err)
    return []
  }
}

export async function createRFQ(params: {
  market_ticker: string
  contracts: number
  rest_remainder: boolean
  target_cost_centi_cents?: number
}): Promise<{ id: string }> {
  return kalshiAuthPost('/communications/rfqs', params)
}
