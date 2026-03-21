/**
 * Polymarket Public API Client (CLI-side)
 *
 * Three APIs:
 *   Gamma  (gamma-api.polymarket.com) — market discovery, events, search, tags
 *   CLOB   (clob.polymarket.com)      — orderbook, prices, OHLC, spreads
 *   Data   (data-api.polymarket.com)  — positions, trades, activity (public, address-based)
 *
 * All endpoints here are public (no auth required).
 * Trading endpoints (order placement) are NOT included — see P2 roadmap.
 */

const GAMMA = 'https://gamma-api.polymarket.com'
const CLOB  = 'https://clob.polymarket.com'
const DATA  = 'https://data-api.polymarket.com'

// ============================================================================
// TYPES
// ============================================================================

export interface PolymarketEvent {
  id: string
  slug: string
  title: string
  description: string
  startDate: string
  endDate: string
  active: boolean
  closed: boolean
  volume: number
  liquidity: number
  markets: PolymarketMarket[]
  negRisk: boolean
}

export interface PolymarketMarket {
  id: string
  question: string
  conditionId: string
  slug: string
  outcomes: string           // JSON: '["Yes","No"]'
  outcomePrices: string      // JSON: '[0.65, 0.35]'
  volume: string
  volume24hr: number
  volumeNum: number
  liquidityNum: number
  active: boolean
  closed: boolean
  endDateIso: string
  clobTokenIds: string       // JSON: '["tokenYes","tokenNo"]'
  bestBid: number
  bestAsk: number
  spread: number
  lastTradePrice: number
  oneDayPriceChange: number
  negRisk: boolean
  negRiskMarketID: string
  enableOrderBook: boolean
  orderPriceMinTickSize: number
  groupItemTitle: string
  acceptingOrders: boolean
}

export interface OrderbookLevel {
  price: string
  size: string
}

export interface RawOrderbook {
  market: string
  asset_id: string
  timestamp: string
  bids: OrderbookLevel[]
  asks: OrderbookLevel[]
  hash: string
}

export interface OrderbookDepth {
  bestBid: number            // cents 0-100
  bestAsk: number            // cents 0-100
  spread: number             // cents
  bidDepthTop3: number       // contracts on top 3 bid levels
  askDepthTop3: number       // contracts on top 3 ask levels
  totalBidDepth: number
  totalAskDepth: number
  liquidityScore: 'high' | 'medium' | 'low'
  levels: { bids: OrderbookLevel[]; asks: OrderbookLevel[] }
}

export interface OHLCCandle {
  t: number   // Unix timestamp (seconds)
  o: number   // open price (0-1)
  h: number   // high
  l: number   // low
  c: number   // close
  v: number   // volume
}

export interface PolymarketPosition {
  asset: string
  conditionId: string
  size: number
  avgPrice: number
  currentPrice: number
  initialValue: number
  currentValue: number
  percentPnl: number
  cashPnl: number
  outcome: string
  outcomeIndex: number
  title: string
  slug: string
  eventSlug: string
  curPrice: number
  endDate: string
  icon: string
}

// ============================================================================
// GAMMA API — Market Discovery
// ============================================================================

/**
 * Search markets and events by keyword.
 * Returns events with their markets (reduces API calls).
 */
export async function polymarketSearch(query: string, limit = 20): Promise<PolymarketEvent[]> {
  const params = new URLSearchParams({
    q: query,
    limit_per_type: limit.toString(),
  })
  const res = await fetch(`${GAMMA}/public-search?${params}`)
  if (!res.ok) throw new Error(`Polymarket search error: ${res.status}`)
  const data = await res.json()
  return data.events || []
}

/**
 * List active events with pagination.
 * Supports sorting by volume_24hr, volume, liquidity, etc.
 */
export async function polymarketListEvents(params?: {
  limit?: number
  offset?: number
  order?: string
  ascending?: boolean
  tag_id?: string
}): Promise<PolymarketEvent[]> {
  const sp = new URLSearchParams({
    active: 'true',
    closed: 'false',
    limit: (params?.limit || 50).toString(),
    offset: (params?.offset || 0).toString(),
  })
  if (params?.order) sp.set('order', params.order)
  if (params?.ascending !== undefined) sp.set('ascending', String(params.ascending))
  if (params?.tag_id) sp.set('tag_id', params.tag_id)

  const res = await fetch(`${GAMMA}/events?${sp}`)
  if (!res.ok) throw new Error(`Polymarket events error: ${res.status}`)
  return res.json()
}

/**
 * Get a single event by ID (includes full markets array).
 */
export async function polymarketGetEvent(id: string): Promise<PolymarketEvent> {
  const res = await fetch(`${GAMMA}/events/${id}`)
  if (!res.ok) throw new Error(`Polymarket event error: ${res.status}`)
  return res.json()
}

/**
 * Get a single market by ID or slug.
 */
export async function polymarketGetMarket(idOrSlug: string): Promise<PolymarketMarket> {
  const res = await fetch(`${GAMMA}/markets/${idOrSlug}`)
  if (!res.ok) throw new Error(`Polymarket market error: ${res.status}`)
  return res.json()
}

/**
 * List available tags for topic-based filtering.
 */
export async function polymarketListTags(): Promise<Array<{ id: string; label: string; slug: string }>> {
  const res = await fetch(`${GAMMA}/tags`)
  if (!res.ok) throw new Error(`Polymarket tags error: ${res.status}`)
  return res.json()
}

// ============================================================================
// CLOB API — Orderbook & Pricing
// ============================================================================

/**
 * Fetch raw orderbook for a token ID.
 * Returns bids and asks arrays with price/size at each level.
 */
export async function polymarketGetOrderbook(tokenId: string): Promise<RawOrderbook | null> {
  try {
    const res = await fetch(`${CLOB}/book?token_id=${tokenId}`)
    if (!res.ok) return null
    const data = await res.json()
    if (data.error) return null
    return data
  } catch {
    return null
  }
}

/**
 * Compute orderbook depth metrics from raw orderbook.
 * Converts Polymarket prices (0-1 dollars) to cents (0-100) for consistency with Kalshi.
 */
export function computeOrderbookDepth(raw: RawOrderbook): OrderbookDepth {
  const bids = (raw.bids || [])
    .map(l => ({ price: parseFloat(l.price), size: parseFloat(l.size) }))
    .sort((a, b) => b.price - a.price) // highest bid first

  const asks = (raw.asks || [])
    .map(l => ({ price: parseFloat(l.price), size: parseFloat(l.size) }))
    .sort((a, b) => a.price - b.price) // lowest ask first

  const bestBid = bids.length > 0 ? Math.round(bids[0].price * 100) : 0
  const bestAsk = asks.length > 0 ? Math.round(asks[0].price * 100) : 100
  const spread = bestAsk - bestBid

  const bidDepthTop3 = bids.slice(0, 3).reduce((sum, l) => sum + l.size, 0)
  const askDepthTop3 = asks.slice(0, 3).reduce((sum, l) => sum + l.size, 0)
  const totalBidDepth = bids.reduce((sum, l) => sum + l.size, 0)
  const totalAskDepth = asks.reduce((sum, l) => sum + l.size, 0)

  const liquidityScore = scoreLiquidity(spread, bidDepthTop3 + askDepthTop3)

  return {
    bestBid,
    bestAsk,
    spread,
    bidDepthTop3: Math.round(bidDepthTop3),
    askDepthTop3: Math.round(askDepthTop3),
    totalBidDepth: Math.round(totalBidDepth),
    totalAskDepth: Math.round(totalAskDepth),
    liquidityScore,
    levels: { bids: raw.bids, asks: raw.asks },
  }
}

/**
 * Fetch orderbook with computed depth metrics.
 * Convenience wrapper: fetch + compute in one call.
 */
export async function polymarketGetOrderbookWithDepth(tokenId: string): Promise<OrderbookDepth | null> {
  const raw = await polymarketGetOrderbook(tokenId)
  if (!raw) return null
  return computeOrderbookDepth(raw)
}

/**
 * Fetch midpoint price for a token.
 */
export async function polymarketGetMidpoint(tokenId: string): Promise<number | null> {
  try {
    const res = await fetch(`${CLOB}/midpoint?token_id=${tokenId}`)
    if (!res.ok) return null
    const data = await res.json()
    return data.mid ? parseFloat(data.mid) : null
  } catch {
    return null
  }
}

/**
 * Fetch spread for a token.
 */
export async function polymarketGetSpread(tokenId: string): Promise<number | null> {
  try {
    const res = await fetch(`${CLOB}/spread?token_id=${tokenId}`)
    if (!res.ok) return null
    const data = await res.json()
    return data.spread ? parseFloat(data.spread) : null
  } catch {
    return null
  }
}

/**
 * Batch midpoint query (up to 500 tokens).
 */
export async function polymarketGetMidpoints(tokenIds: string[]): Promise<Record<string, number>> {
  if (tokenIds.length === 0) return {}
  const res = await fetch(`${CLOB}/midpoints`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(tokenIds),
  })
  if (!res.ok) throw new Error(`Polymarket midpoints error: ${res.status}`)
  return res.json()
}

/**
 * Fetch OHLC candlestick data.
 *
 * @param tokenId - CLOB token ID (asset_id)
 * @param fidelity - Candle interval: '1m','5m','15m','30m','1h','4h','1d','1w'
 * @param startTs - Start Unix timestamp (seconds)
 * @param endTs - End Unix timestamp (seconds, optional)
 * @param limit - Max candles (up to 1000)
 */
export async function polymarketGetOHLC(params: {
  tokenId: string
  fidelity?: string
  startTs: number
  endTs?: number
  limit?: number
}): Promise<OHLCCandle[]> {
  const sp = new URLSearchParams({
    asset_id: params.tokenId,
    startTs: params.startTs.toString(),
    fidelity: params.fidelity || '1h',
  })
  if (params.endTs) sp.set('endTs', params.endTs.toString())
  if (params.limit) sp.set('limit', params.limit.toString())

  const res = await fetch(`${CLOB}/ohlc?${sp}`)
  if (!res.ok) {
    // OHLC endpoint may not exist on all deployments — fall back gracefully
    return []
  }
  const data = await res.json()
  return Array.isArray(data) ? data : (data.candles || data.data || [])
}

/**
 * Fetch price history (simple time series, no OHLC).
 * Supports relative intervals or absolute timestamp ranges.
 *
 * @param tokenId - CLOB token ID
 * @param interval - Relative: 'max','1w','1d','6h','1h'
 * @param startTs - Absolute start (mutually exclusive with interval)
 * @param endTs - Absolute end
 * @param fidelity - Data point frequency in minutes (default: 60)
 */
export async function polymarketGetPriceHistory(params: {
  tokenId: string
  interval?: string
  startTs?: number
  endTs?: number
  fidelity?: number
}): Promise<Array<{ t: number; p: number }>> {
  const sp = new URLSearchParams({ market: params.tokenId })
  if (params.interval) sp.set('interval', params.interval)
  if (params.startTs) sp.set('startTs', params.startTs.toString())
  if (params.endTs) sp.set('endTs', params.endTs.toString())
  if (params.fidelity) sp.set('fidelity', params.fidelity.toString())

  const res = await fetch(`${CLOB}/prices-history?${sp}`)
  if (!res.ok) return []
  const data = await res.json()
  return data.history || []
}

// ============================================================================
// DATA API — Positions & Activity (public, address-based)
// ============================================================================

/**
 * Fetch current open positions for a wallet address.
 * No auth required — positions are public on-chain data.
 */
export async function polymarketGetPositions(walletAddress: string): Promise<PolymarketPosition[]> {
  const res = await fetch(`${DATA}/positions?user=${walletAddress}`)
  if (!res.ok) return []
  const data = await res.json()
  return Array.isArray(data) ? data : []
}

/**
 * Fetch closed positions for a wallet address.
 */
export async function polymarketGetClosedPositions(walletAddress: string): Promise<PolymarketPosition[]> {
  const res = await fetch(`${DATA}/closed-positions?user=${walletAddress}`)
  if (!res.ok) return []
  const data = await res.json()
  return Array.isArray(data) ? data : []
}

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Score liquidity based on spread and depth.
 * Matches Kalshi's scoring for consistency:
 *   high:   spread ≤ 2¢ AND depth ≥ 500
 *   medium: spread ≤ 5¢ AND depth ≥ 100
 *   low:    everything else
 */
export function scoreLiquidity(spreadCents: number, totalDepth: number): 'high' | 'medium' | 'low' {
  if (spreadCents <= 2 && totalDepth >= 500) return 'high'
  if (spreadCents <= 5 && totalDepth >= 100) return 'medium'
  return 'low'
}

/**
 * Parse clobTokenIds JSON string into [yesTokenId, noTokenId].
 */
export function parseClobTokenIds(clobTokenIds: string): [string, string] | null {
  try {
    const ids = JSON.parse(clobTokenIds)
    if (Array.isArray(ids) && ids.length >= 2) return [ids[0], ids[1]]
    return null
  } catch {
    return null
  }
}

/**
 * Parse outcomes JSON string.
 */
export function parseOutcomes(outcomes: string): string[] {
  try {
    return JSON.parse(outcomes)
  } catch {
    return []
  }
}

/**
 * Parse outcomePrices JSON string into numbers.
 */
export function parseOutcomePrices(outcomePrices: string): number[] {
  try {
    return JSON.parse(outcomePrices)
  } catch {
    return []
  }
}

/**
 * Convert Polymarket price (0-1 dollars) to cents (0-100).
 */
export function toCents(price: number): number {
  return Math.round(price * 100)
}

/**
 * Build a Polymarket URL for a market.
 */
export function polymarketUrl(eventSlug: string): string {
  return `https://polymarket.com/event/${eventSlug}`
}
