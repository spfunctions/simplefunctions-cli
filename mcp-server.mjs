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
  'START HERE. Global market snapshot: top edges (mispriced contracts), price movers, highlights, traditional markets. With thesisId + apiKey: thesis-specific context including causal tree and evaluation history.',
  {
    thesisId: z.string().optional().describe('Thesis ID. Omit for global market snapshot.'),
    apiKey: z.string().optional().describe('SF API key. Required for thesis-specific context.'),
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
  'Calibrated world model: 9,706 prediction markets distilled into 800 tokens. Real-money probabilities on geopolitics, economics, tech, policy.',
  {
    focus: z.string().optional().describe('Comma-separated topics: energy,geo,tech,policy,crypto,finance'),
    format: z.enum(['markdown', 'json']).default('markdown').optional(),
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
  'What changed since a timestamp. ~30-50 tokens vs 800 for full state.',
  {
    since: z.string().describe('Relative (30m, 1h, 6h, 24h) or ISO timestamp'),
    format: z.enum(['markdown', 'json']).default('markdown').optional(),
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
  'Live prediction market contracts with prices, volume, and metadata. Filter by topic for deep dives.',
  {
    topic: z.string().optional().describe('Filter: energy, rates, fx, equities, crypto, volatility'),
    limit: z.number().default(20).optional(),
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
  'Search prediction market contracts by keyword.',
  { query: z.string().describe('Search query') },
  async ({ query }) => {
    const data = await api(`/api/public/markets?q=${encodeURIComponent(query)}`);
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool(
  'get_changes',
  'Biggest price movers in the last 24h across all prediction markets.',
  {},
  async () => {
    const data = await api('/api/public/changes');
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool(
  'get_edges',
  'Current mispricings detected across all public theses.',
  {},
  async () => {
    const data = await api('/api/edges');
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool(
  'get_trade_ideas',
  'AI-generated trade ideas based on thesis analysis and market data.',
  {},
  async () => {
    const data = await api('/api/public/ideas');
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool(
  'enrich_content',
  'Free: paste any text, get prediction market cross-reference. No auth needed.',
  {
    content: z.string().describe('Text content to analyze (max 50,000 chars)'),
    topics: z.array(z.string()).describe('Topics to search for in prediction markets'),
    model: z.string().optional().describe('LLM model for digest (default: gemini-2.5-flash)'),
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
  'List all theses for the authenticated user.',
  { apiKey: z.string().describe('SF API key') },
  async ({ apiKey: key }) => {
    const data = await fetch(`${BASE}/api/thesis`, {
      headers: { 'Authorization': `Bearer ${key}` },
    }).then(r => r.json());
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool(
  'inject_signal',
  'Feed an observation into a thesis for next evaluation cycle.',
  {
    thesisId: z.string(),
    apiKey: z.string(),
    content: z.string().describe('Signal content'),
    type: z.enum(['news', 'user_note', 'external']).default('user_note'),
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
  'Force immediate thesis evaluation: consume signals, re-scan edges, update confidence.',
  {
    thesisId: z.string(),
    apiKey: z.string(),
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
  'Create a new thesis with a natural language statement.',
  {
    apiKey: z.string(),
    title: z.string().describe('Thesis statement'),
    metadata: z.record(z.unknown()).optional(),
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
  'Fork a public thesis to your account.',
  {
    apiKey: z.string(),
    idOrSlug: z.string().describe('Thesis ID or public slug'),
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
  'Scrape any URL, analyze with LLM, cross-reference with prediction markets, push to webhook.',
  {
    apiKey: z.string(),
    source: z.object({
      action: z.enum(['scrape', 'crawl', 'search', 'map', 'extract', 'batch_scrape']),
      url: z.string().optional(),
      urls: z.array(z.string()).optional(),
      query: z.string().optional(),
      options: z.record(z.unknown()).optional(),
    }),
    analysis: z.object({
      enabled: z.boolean(),
      prompt: z.string(),
      model: z.string().optional(),
      schema: z.record(z.unknown()).optional(),
    }).optional(),
    enrich: z.object({
      enabled: z.boolean(),
      topics: z.array(z.string()),
    }).optional(),
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
  'Query real-time and historical market data from Databento (CME futures, equities, crypto).',
  {
    symbols: z.array(z.string()).describe('Symbols like CL.c.0, ES.c.0, AAPL'),
    dataset: z.string().default('GLBX.MDP3').optional(),
    schema: z.string().default('trades').optional(),
    start: z.string().optional().describe('ISO date'),
    end: z.string().optional().describe('ISO date'),
    limit: z.number().default(100).optional(),
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
