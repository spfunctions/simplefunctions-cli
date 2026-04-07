#!/usr/bin/env node

/**
 * SimpleFunctions MCP Server (stdio transport)
 *
 * Thin stdio wrapper for Glama inspection + local MCP clients.
 * All tools proxy to https://simplefunctions.dev/api/*
 *
 * Usage:
 *   SF_API_KEY=sf_live_xxx node mcp-server.mjs
 *
 * Or connect to the hosted Streamable HTTP endpoint directly:
 *   https://simplefunctions.dev/api/mcp/mcp
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const BASE = 'https://simplefunctions.dev';

async function api(path, opts = {}) {
  const apiKey = process.env.SF_API_KEY;
  const headers = { 'Content-Type': 'application/json', ...opts.headers };
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
  const res = await fetch(`${BASE}${path}`, { ...opts, headers });
  return res.json();
}

const server = new McpServer({
  name: 'SimpleFunctions',
  version: '1.0.0',
});

// ── Public tools (no auth) ─────────────────────────────────

server.tool(
  'get_context',
  'START HERE — single entry point that returns either a global market snapshot or a thesis-specific context bundle. Global mode (no args): top mispriced edges, 24h price movers, highlights, traditional markets. Thesis mode (thesisId + apiKey): adds causal tree, signal log, and evaluation history for that thesis. Read-only, no rate limit. Use this first; only call get_edges / get_changes / get_world_state if you need that single slice in isolation.',
  {
    thesisId: z.string().optional().describe('Thesis ID (uuid or slug). Omit for global snapshot. If set, apiKey is required.'),
    apiKey: z.string().optional().describe('SF API key (sf_live_...). Required when thesisId is set; ignored otherwise.'),
  },
  async ({ thesisId, apiKey: key }) => {
    if (!thesisId) {
      const data = await api('/api/public/context');
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
    const data = await fetch(`${BASE}/api/thesis/${thesisId}/context`, {
      headers: { 'Authorization': `Bearer ${key || process.env.SF_API_KEY}` },
    }).then(r => r.json());
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool(
  'get_world_state',
  'Calibrated world model: ~9,700 live prediction markets distilled into ~800 tokens of real-money probabilities across geopolitics, economics, tech, and policy. Read-only, no auth, no rate limit. Use when you need a compact snapshot of "what the market believes right now"; use get_changes for deltas only, or get_context for the broader bundle including edges and movers.',
  {
    focus: z.string().optional().describe('Comma-separated topic filter. Allowed values: energy, geo, tech, policy, crypto, finance. Omit for all topics.'),
    format: z.enum(['markdown', 'json']).optional().describe('Output format. Default: markdown (human-readable). Use json for programmatic parsing.'),
  },
  async ({ focus, format }) => {
    const params = new URLSearchParams();
    if (focus) params.set('focus', focus);
    if (format) params.set('format', format);
    const qs = params.toString();
    const data = await fetch(`${BASE}/api/agent/world${qs ? '?' + qs : ''}`).then(r => r.text());
    return { content: [{ type: 'text', text: data }] };
  }
);

server.tool(
  'get_world_delta',
  'Incremental diff of the world model since a given timestamp — only the markets whose probability moved. ~30-50 tokens vs ~800 for the full state from get_world_state. Read-only, no auth. Use this for cheap polling loops; use get_world_state for an absolute snapshot.',
  {
    since: z.string().describe('Lookback window. Either a relative duration (30m, 1h, 6h, 24h) or an ISO-8601 timestamp. Required.'),
    format: z.enum(['markdown', 'json']).optional().describe('Output format. Default: markdown.'),
  },
  async ({ since, format }) => {
    let url = `${BASE}/api/agent/world/delta?since=${encodeURIComponent(since)}`;
    if (format) url += `&format=${format}`;
    const data = await fetch(url).then(r => r.text());
    return { content: [{ type: 'text', text: data }] };
  }
);

server.tool(
  'get_markets',
  'List live prediction market contracts with current YES/NO prices, 24h volume, and metadata. Read-only, no auth. Use for deep dives on a specific topic; use search_markets if you have a keyword instead of a topic, or get_context for a high-level overview.',
  {
    topic: z.string().optional().describe('Topic filter. Allowed values: energy, rates, fx, equities, crypto, volatility. Omit for all topics.'),
    limit: z.number().int().positive().optional().describe('Max contracts to return. Default 50. Hard cap 500.'),
  },
  async ({ topic, limit }) => {
    const params = new URLSearchParams();
    if (topic) params.set('topic', topic);
    if (limit) params.set('limit', String(limit));
    const data = await api(`/api/public/markets?${params}`);
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool(
  'search_markets',
  'Full-text search prediction market contracts by keyword across question text and resolution criteria. Read-only, no auth. Use when you have a free-form term ("OPEC", "Powell", "TSMC"); use get_markets if you only want to filter by predefined topic.',
  {
    query: z.string().min(1).describe('Search keyword or phrase. Required, non-empty. Matches question text and resolution criteria.'),
  },
  async ({ query }) => {
    const data = await api(`/api/public/markets?q=${encodeURIComponent(query)}`);
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool(
  'get_changes',
  'What moved in the last 24 hours: incremental delta of probability changes across all tracked prediction markets, returned as compact markdown (~30-50 tokens). Read-only, no auth, no parameters. Thin wrapper over get_world_delta with since="24h"; use get_world_delta directly if you need a different lookback window or JSON output, or get_context for movers bundled with edges and highlights.',
  {},
  async () => {
    const data = await fetch(`${BASE}/api/agent/world/delta?since=24h`).then(r => r.text());
    return { content: [{ type: 'text', text: data }] };
  }
);

server.tool(
  'get_edges',
  'Current mispricings (edges) detected across all public theses — contracts where the platform\'s causal model disagrees with market price. Read-only, no auth, no parameters. Returns *only* the edge list; use get_context for edges bundled with movers, highlights, and world state.',
  {},
  async () => {
    const data = await api('/api/edges');
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool(
  'get_trade_ideas',
  'AI-generated trade ideas derived from active theses and current market data, each with rationale and target contract. Read-only, no auth, no parameters. Use when you want pre-packaged actionable suggestions; use get_edges for raw mispricings without commentary.',
  {},
  async () => {
    const data = await api('/api/public/ideas');
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool(
  'enrich_content',
  'Cross-reference arbitrary text against live prediction markets: paste an article or note, get back the markets relevant to its claims plus an LLM digest. POSTs content to the server; no auth required, no persistence. Use for one-off article enrichment; use monitor_the_situation for scheduled URL scraping with webhook delivery.',
  {
    content: z.string().min(1).max(50000).describe('Raw text to analyze. Required. Max 50,000 characters.'),
    topics: z.array(z.string()).min(1).describe('Topic hints used to narrow the market search. Required, at least one. Free-form strings like "oil", "fed rates", "tsmc".'),
    model: z.string().optional().describe('LLM model id for the digest step. Default: gemini-2.5-flash.'),
  },
  async ({ content, topics, model }) => {
    const data = await fetch(`${BASE}/api/monitor-the-situation/enrich`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content, topics, model }),
    }).then(r => r.json());
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
  }
);

// ── Auth-required tools ────────────────────────────────────

server.tool(
  'list_theses',
  'List every thesis owned by the authenticated user, with id, title, status, and last evaluation timestamp. Read-only. Requires SF API key. Use to discover thesisId values needed by get_context, trigger_evaluation, inject_signal, and fork_thesis.',
  {
    apiKey: z.string().describe('SF API key (sf_live_...). Required.'),
  },
  async ({ apiKey: key }) => {
    const data = await fetch(`${BASE}/api/thesis`, {
      headers: { 'Authorization': `Bearer ${key}` },
    }).then(r => r.json());
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool(
  'inject_signal',
  'Append an external observation (news headline, user note, data point) to a thesis. Stored in the thesis signal log and consumed on the next evaluation cycle — does NOT trigger evaluation by itself; call trigger_evaluation afterward if you need an immediate update. Writes state. Requires SF API key.',
  {
    thesisId: z.string().describe('Target thesis ID. Required. Get one from list_theses.'),
    apiKey: z.string().describe('SF API key (sf_live_...). Required.'),
    content: z.string().min(1).describe('Signal text. Required, non-empty. Free-form natural language.'),
    type: z.enum(['news', 'user_note', 'external']).optional().describe('Signal classification. Default: external.'),
  },
  async ({ thesisId, apiKey: key, content, type }) => {
    const data = await fetch(`${BASE}/api/thesis/${thesisId}/signal`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, content, source: 'mcp' }),
    }).then(r => r.json());
    return { content: [{ type: 'text', text: JSON.stringify(data) }] };
  }
);

server.tool(
  'trigger_evaluation',
  'Force an immediate thesis evaluation: consumes pending signals, re-scans edges, and updates confidence scores. Side-effectful and LLM-billed (typically 5-30s, may be rate-limited per plan). Requires SF API key. Use after inject_signal when you need fresh output now; otherwise theses re-evaluate on their own schedule.',
  {
    thesisId: z.string().describe('Target thesis ID. Required. Get one from list_theses.'),
    apiKey: z.string().describe('SF API key (sf_live_...). Required.'),
  },
  async ({ thesisId, apiKey: key }) => {
    const data = await fetch(`${BASE}/api/thesis/${thesisId}/evaluate`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    }).then(r => r.json());
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool(
  'create_thesis',
  'Create a new thesis from a natural-language statement. The platform parses it, builds a causal tree, and schedules recurring evaluation. Side-effectful. Requires SF API key. Use fork_thesis instead if you want to start from an existing public thesis.',
  {
    apiKey: z.string().describe('SF API key (sf_live_...). Required.'),
    title: z.string().min(1).describe('Thesis statement in natural language. Required. Example: "Brent crude closes above $90 by end of Q2 2026".'),
    metadata: z.record(z.string(), z.any()).optional().describe('Optional free-form metadata object (tags, source, notes). Stored verbatim.'),
  },
  async ({ apiKey: key, title, metadata }) => {
    const data = await fetch(`${BASE}/api/thesis/create`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, metadata }),
    }).then(r => r.json());
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool(
  'fork_thesis',
  'Clone a public thesis (by id or slug) into the authenticated user\'s account, copying its causal tree as a starting point. Side-effectful. Requires SF API key. Use when you want to iterate on someone else\'s thesis; use create_thesis to start from scratch.',
  {
    apiKey: z.string().describe('SF API key (sf_live_...). Required.'),
    idOrSlug: z.string().min(1).describe('Source thesis ID (uuid) or public slug. Required.'),
  },
  async ({ apiKey: key, idOrSlug }) => {
    const data = await fetch(`${BASE}/api/thesis/${idOrSlug}/fork`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    }).then(r => r.json());
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool(
  'monitor_the_situation',
  'End-to-end pipeline: scrape one or more URLs (or run a search/crawl/map/extract), optionally analyze with an LLM against a prompt + JSON schema, optionally cross-reference with prediction markets, and return the bundle. Side-effectful (calls Firecrawl + LLM, billed). Requires SF API key. Use for scheduled or one-shot URL ingestion; use enrich_content if you already have the text in hand.',
  {
    apiKey: z.string().describe('SF API key (sf_live_...). Required.'),
    source: z.object({
      action: z.enum(['scrape', 'crawl', 'search', 'map', 'extract', 'batch_scrape']).describe('Firecrawl action. Required. "scrape"=single url, "batch_scrape"=multiple urls, "crawl"=follow links, "search"=web search by query, "map"=site map, "extract"=structured extraction.'),
      url: z.string().optional().describe('Single URL. Required for action=scrape/crawl/map/extract.'),
      urls: z.array(z.string()).optional().describe('URL list. Required for action=batch_scrape.'),
      query: z.string().optional().describe('Search query. Required for action=search.'),
      options: z.record(z.string(), z.any()).optional().describe('Pass-through options forwarded to Firecrawl.'),
    }).describe('Source configuration. Exactly one of url/urls/query must be set, matching the chosen action.'),
    analysis: z.object({
      enabled: z.boolean().describe('Set true to run LLM analysis on scraped content.'),
      prompt: z.string().describe('LLM prompt. Required when enabled.'),
      model: z.string().optional().describe('LLM model id. Default: gemini-2.5-flash.'),
      schema: z.record(z.string(), z.any()).optional().describe('Optional JSON schema for structured output.'),
    }).optional().describe('LLM analysis step. Omit to skip.'),
    enrich: z.object({
      enabled: z.boolean().describe('Set true to cross-reference scraped content with prediction markets.'),
      topics: z.array(z.string()).describe('Topic hints for the market search. Required when enabled.'),
    }).optional().describe('Market enrichment step. Omit to skip.'),
  },
  async ({ apiKey: key, source, analysis, enrich }) => {
    const data = await fetch(`${BASE}/api/monitor-the-situation`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ source, analysis, enrich }),
    }).then(r => r.json());
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool(
  'query_databento',
  'Fetch real-time and historical market data from Databento (CME futures, US equities, crypto). Read-only, billed per Databento usage. Use for OHLCV / trades / quotes on traditional instruments; use get_markets or search_markets for prediction-market contracts instead.',
  {
    symbols: z.array(z.string()).min(1).describe('Symbol list. Required, at least one. Examples: ["CL.c.0"] (front-month WTI), ["ES.c.0"] (S&P e-mini), ["AAPL"]. Continuous-contract suffix .c.0 means front month.'),
    dataset: z.string().optional().describe('Databento dataset code. Default: GLBX.MDP3 (CME Globex). Must match the venue of the requested symbols.'),
    schema: z.string().optional().describe('Databento schema. Default: trades. Other common values: ohlcv-1m, ohlcv-1d, mbp-1, tbbo, statistics.'),
    start: z.string().optional().describe('ISO-8601 start timestamp (inclusive). Omit for most recent data.'),
    end: z.string().optional().describe('ISO-8601 end timestamp (exclusive). Must be after start if both set.'),
    limit: z.number().int().positive().optional().describe('Max records returned. Default 100. Hard cap 10000.'),
  },
  async ({ symbols, dataset, schema, start, end, limit }) => {
    const params = new URLSearchParams();
    symbols.forEach(s => params.append('symbols', s));
    if (dataset) params.set('dataset', dataset);
    if (schema) params.set('schema', schema);
    if (start) params.set('start', start);
    if (end) params.set('end', end);
    if (limit) params.set('limit', String(limit));
    const data = await api(`/api/public/databento?${params}`);
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
  }
);

// ── Start ──────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
