# SimpleFunctions CLI

Thesis engine for prediction market agents. Scan Kalshi + Polymarket, detect edges, monitor autonomously.

![demo](./demo.gif)

## Install

```bash
curl -fsSL https://simplefunctions.dev/install.sh | sh
```

Or with npm directly:

```bash
npm install -g @spfunctions/cli
sf setup
```

`sf setup` walks you through API key configuration with real-time validation. Get your key at [simplefunctions.dev/dashboard/keys](https://simplefunctions.dev/dashboard/keys).

## Quick Start

```bash
# No API key needed — try right now
sf scan "recession 2026"
sf schedule
sf explore

# With API key
sf create "Oil stays above $100 through 2026"
sf context <id> --json
sf agent
```

## What It Does

You express a macro thesis. The engine decomposes it into a causal tree of testable sub-claims, scans Kalshi and Polymarket for contracts where market prices diverge from thesis-implied prices (edges), and monitors everything autonomously every 15 minutes.

```
Thesis → Causal Tree → Market Scan → Edges
                                       ↓
Heartbeat (15 min): News + Prices + Milestones → Updated Confidence
                                                   ↓
                                       Webhook / Delta API / Feed
```

## Commands

### Free (no API key)

| Command | Description |
|---------|-------------|
| `sf scan "keywords"` | Search Kalshi markets |
| `sf scan --series KXWTIMAX` | Browse series events + live prices |
| `sf schedule` | Exchange status (open/closed) |
| `sf announcements` | Exchange announcements |
| `sf explore [slug]` | Browse public theses |

### Thesis

| Command | Description |
|---------|-------------|
| `sf create "thesis"` | Create new thesis |
| `sf list` | List all theses |
| `sf context <id> [--json]` | Thesis snapshot — causal tree, edges, evaluation |
| `sf get <id>` | Full thesis details |
| `sf signal <id> "content"` | Inject signal |
| `sf evaluate <id>` | Trigger deep evaluation |
| `sf edges [--json]` | Top edges across all theses |
| `sf dashboard` | Portfolio overview |
| `sf feed [--hours 24]` | Evaluation history stream |
| `sf whatif <id> --set "n1=0.1"` | Scenario analysis (zero LLM cost) |

### Markets

| Command | Description |
|---------|-------------|
| `sf milestones [--thesis <id>]` | Upcoming Kalshi calendar events |
| `sf forecast <eventTicker>` | P50/P75/P90 percentile distribution |
| `sf history <ticker>` | Settled market data |

### Portfolio

| Command | Description |
|---------|-------------|
| `sf positions` | Kalshi positions with edge overlay |
| `sf balance` | Account balance |
| `sf orders` | Current orders |
| `sf fills` | Recent fills |
| `sf settlements` | Settled contracts with P&L |

### Trading

Requires `sf setup --enable-trading`. All orders have a 3-second countdown.

| Command | Description |
|---------|-------------|
| `sf buy <ticker> <qty> --price <cents>` | Buy contracts |
| `sf sell <ticker> <qty> --price <cents>` | Sell contracts |
| `sf cancel <orderId>` | Cancel order |
| `sf cancel --all` | Cancel all resting orders |

## Interactive Agent

```bash
sf agent                  # continue last session
sf agent <id> --new       # fresh session for specific thesis
sf agent --plain          # plain text mode (pipe-friendly)
```

Natural language interface with 15+ tools. Analyzes edges, suggests trades, monitors positions. Slash commands: `/tree`, `/edges`, `/pos`, `/eval`, `/buy`, `/sell`, `/cancel`, `/switch`.

## MCP Server

Connect any MCP-compatible client — Claude Code, Cursor, Cline, Roo Code.

```bash
claude mcp add simplefunctions --url https://simplefunctions.dev/api/mcp/mcp
```

15 tools: `get_context`, `list_theses`, `inject_signal`, `trigger_evaluation`, `create_thesis`, `what_if`, `scan_markets`, `get_milestones`, `get_forecast`, `get_settlements`, `get_balance`, `get_orders`, `get_fills`, `get_schedule`, `explore_public`.

## Agent Integration

Your agent only needs three operations:

```bash
# 1. Read — get current thesis state
sf context <id> --json

# 2. Write — inject observations
sf signal <id> "breaking: Hormuz blockade confirmed" --type news

# 3. React — trigger analysis when something big happens
sf evaluate <id>
```

The heartbeat engine handles news scanning, price monitoring, and routine evaluation automatically. For efficient polling, use the delta API:

```bash
curl "https://simplefunctions.dev/api/thesis/<id>/changes?since=<ISO timestamp>" \
  -H "Authorization: Bearer sf_live_xxx"
# Nothing changed: {"changed": false} — 50 bytes
```

## REST API

Base URL: `https://simplefunctions.dev`

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/thesis/create` | Create thesis (`?sync=true` to wait) |
| `GET` | `/api/thesis/:id/context` | Thesis snapshot |
| `GET` | `/api/thesis/:id/changes?since=` | Lightweight delta check |
| `POST` | `/api/thesis/:id/signal` | Inject signal |
| `POST` | `/api/thesis/:id/evaluate` | Trigger evaluation |
| `GET` | `/api/thesis` | List theses |
| `GET` | `/api/feed?hours=24` | Evaluation history |

Auth: `Authorization: Bearer sf_live_xxx`

## Links

- [Website](https://simplefunctions.dev)
- [Documentation](https://simplefunctions.dev/docs)
- [Agent Guide](https://simplefunctions.dev/docs/guide)
- [API Keys](https://simplefunctions.dev/dashboard/keys)
- [Public Theses](https://simplefunctions.dev/theses)

## License

MIT
