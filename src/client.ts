/**
 * SimpleFunctions HTTP Client
 *
 * Pure fetch-based client. Zero project dependencies.
 * Talks to the SF API (authenticated) and Kalshi public API (no auth).
 */

const DEFAULT_API_URL = 'https://simplefunctions.dev'
const KALSHI_BASE = 'https://api.elections.kalshi.com/trade-api/v2'

// ===== SF API Client =====

export class SFClient {
  private apiKey: string
  private baseUrl: string

  constructor(apiKey?: string, baseUrl?: string) {
    this.apiKey = apiKey || process.env.SF_API_KEY || ''
    this.baseUrl = (baseUrl || process.env.SF_API_URL || DEFAULT_API_URL).replace(/\/$/, '')
    if (!this.apiKey) {
      throw new Error('API key required. Set SF_API_KEY or use --api-key')
    }
  }

  private async request<T = any>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${this.baseUrl}${path}`
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
    }

    const res = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    })

    if (!res.ok) {
      const text = await res.text()
      throw new Error(`API error ${res.status}: ${text}`)
    }

    return res.json() as Promise<T>
  }

  // ── Thesis operations ──

  async listTheses(): Promise<{ theses: any[] }> {
    return this.request('GET', '/api/thesis')
  }

  // GET /api/thesis/:id returns { ...thesisRow, positions: [] } — flat, NOT { thesis, positions }
  async getThesis(id: string): Promise<any> {
    return this.request('GET', `/api/thesis/${id}`)
  }

  async getContext(id: string): Promise<any> {
    return this.request('GET', `/api/thesis/${id}/context`)
  }

  async createThesis(rawThesis: string, sync = true): Promise<any> {
    return this.request('POST', `/api/thesis/create?sync=${sync}`, { rawThesis })
  }

  async injectSignal(id: string, type: string, content: string, source = 'cli'): Promise<any> {
    return this.request('POST', `/api/thesis/${id}/signal`, { type, content, source })
  }

  async evaluate(id: string): Promise<any> {
    return this.request('POST', `/api/thesis/${id}/evaluate`)
  }

  async getFeed(hours = 24, limit = 200): Promise<any> {
    return this.request('GET', `/api/feed?hours=${hours}&limit=${limit}`)
  }

  async getChanges(id: string, since: string): Promise<any> {
    return this.request('GET', `/api/thesis/${id}/changes?since=${encodeURIComponent(since)}`)
  }

  async updateThesis(id: string, data: Record<string, unknown>): Promise<any> {
    return this.request('PATCH', `/api/thesis/${id}`, data)
  }

  async publish(id: string, slug: string, description?: string): Promise<any> {
    return this.request('POST', `/api/thesis/${id}/publish`, { slug, description })
  }

  async unpublish(id: string): Promise<any> {
    return this.request('DELETE', `/api/thesis/${id}/publish`)
  }

  // ── Strategy operations ──

  async getStrategies(id: string, status?: string): Promise<any> {
    const qs = status ? `?status=${status}` : ''
    return this.request('GET', `/api/thesis/${id}/strategies${qs}`)
  }

  async createStrategyAPI(id: string, data: Record<string, unknown>): Promise<any> {
    return this.request('POST', `/api/thesis/${id}/strategies`, data)
  }

  async updateStrategyAPI(thesisId: string, strategyId: string, data: Record<string, unknown>): Promise<any> {
    return this.request('PATCH', `/api/thesis/${thesisId}/strategies/${strategyId}`, data)
  }

  async deleteStrategyAPI(thesisId: string, strategyId: string): Promise<any> {
    return this.request('DELETE', `/api/thesis/${thesisId}/strategies/${strategyId}`)
  }
}

// ===== Kalshi Public API (no auth) =====

async function kalshiGet<T = any>(path: string, params?: Record<string, string>): Promise<T> {
  const url = new URL(`${KALSHI_BASE}${path}`)
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== '') url.searchParams.set(k, v)
    }
  }
  const res = await fetch(url.toString())
  if (!res.ok) {
    throw new Error(`Kalshi API ${res.status}: ${await res.text()}`)
  }
  return res.json() as Promise<T>
}

export async function kalshiFetchAllSeries(): Promise<any[]> {
  const data = await kalshiGet<{ series: any[] }>('/series', { include_volume: 'true' })
  return data.series || []
}

export async function kalshiFetchEvents(seriesTicker: string): Promise<any[]> {
  const data = await kalshiGet<{ events: any[] }>('/events', {
    series_ticker: seriesTicker,
    status: 'open',
    with_nested_markets: 'true',
    limit: '200',
  })
  return data.events || []
}

export async function kalshiFetchMarket(ticker: string): Promise<any> {
  const data = await kalshiGet<{ market: any }>(`/markets/${ticker}`)
  return data.market || data
}

export async function kalshiFetchMarketsBySeries(seriesTicker: string): Promise<any[]> {
  const data = await kalshiGet<{ markets: any[] }>('/markets', {
    series_ticker: seriesTicker,
    status: 'open',
    limit: '200',
  })
  return data.markets || []
}

export async function kalshiFetchMarketsByEvent(eventTicker: string): Promise<any[]> {
  const data = await kalshiGet<{ markets: any[] }>('/markets', {
    event_ticker: eventTicker,
    status: 'open',
    limit: '1000',
  })
  return data.markets || []
}
