# SimpleFunctions CLI (`sf`)

Prediction market intelligence CLI. Build causal thesis models, scan Kalshi/Polymarket for mispricings, detect edges, and trade — all from the terminal.

![demo](demo.gif)

## Quick Start

```bash
npm install -g @spfunctions/cli
sf setup                            # interactive config wizard
sf list                             # see your theses
sf context <id> --json              # get thesis state as JSON
```

## Setup

### Interactive (recommended)

```bash
sf setup
```

This walks you through:
1. **SF API key** (required) — get one at [simplefunctions.dev](https://simplefunctions.dev)
2. **Kalshi credentials** (optional) — for positions, trading, and orderbook data
3. **Trading mode** (optional) — enable `sf buy`/`sf sell` commands

Config is saved to `~/.sf/config.json`. Environment variables override config values.

### Manual

```bash
export SF_API_KEY=sf_live_xxx                    # required
export KALSHI_API_KEY_ID=xxx                     # optional, for positions/trading
export KALSHI_PRIVATE_KEY_PATH=~/.ssh/kalshi.pem # optional, for positions/trading
```

### Verify

```bash
sf setup --check     # show current config status
sf list              # should show your theses
```

## Commands

### Thesis Management

| Command | Description |
|---------|-------------|
| `sf list` | List all theses with status, confidence, and update time |
| `sf get <id>` | Full thesis details: causal tree, edges, positions, last evaluation |
| `sf context <id>` | Compact context snapshot (primary command for agents) |
| `sf create "thesis"` | Create a new thesis (waits for formation by default) |
| `sf signal <id> "text"` | Inject a signal (news, observation) for next evaluation |
| `sf evaluate <id>` | Trigger deep evaluation with heavy model |
| `sf publish <id>` | Make thesis publicly viewable |
| `sf unpublish <id>` | Remove from public view |

### Market Exploration (no auth required)

| Command | Description |
|---------|-------------|
| `sf scan "keywords"` | Search Kalshi markets by keyword |
| `sf scan --series KXWTIMAX` | List all markets in a series |
| `sf scan --market TICKER` | Get single market detail |
| `sf explore` | Browse public theses |

### Portfolio & Trading (requires Kalshi credentials)

| Command | Description |
|---------|-------------|
| `sf edges` | Top edges across all theses — what to trade now |
| `sf positions` | Current positions with P&L and edge overlay |
| `sf balance` | Account balance |
| `sf orders` | Resting (open) orders |
| `sf fills` | Recent trade fills |
| `sf performance` | P&L over time with thesis event annotations |
| `sf settlements` | Settled contracts with final P&L |
| `sf liquidity` | Market liquidity scanner by topic |

### Trading (requires `sf setup --enable-trading`)

| Command | Description |
|---------|-------------|
| `sf buy <ticker> <qty>` | Buy contracts |
| `sf sell <ticker> <qty>` | Sell contracts |
| `sf cancel [orderId]` | Cancel order(s) |
| `sf rfq <ticker> <qty>` | Request for quote on large orders |

### Analysis

| Command | Description |
|---------|-------------|
| `sf whatif <id>` | What-if scenario: "if node X drops to 10%..." |
| `sf feed` | Evaluation history stream |
| `sf forecast <event>` | Market distribution forecast (P50/P75/P90) |
| `sf dashboard` | Interactive TUI portfolio overview |

### Interactive Modes

| Command | Description |
|---------|-------------|
| `sf agent [id]` | Interactive agent with natural language + tool calling |
| `sf telegram` | Telegram bot for monitoring and trading |

## JSON Output

Most commands support `--json` for machine-readable output:

```bash
sf list --json
sf context f582bf76 --json
sf edges --json
sf scan "oil" --json
sf get f582bf76 --json
```

## For AI Agents

**If you are an AI coding agent (Claude, GPT, OpenClaw, Cursor, etc.), follow these steps:**

### Step 1: Install and configure

```bash
npm install -g @spfunctions/cli
sf setup --key sf_live_YOUR_KEY_HERE
```

If `sf setup` is not available or you cannot run interactive commands:
```bash
export SF_API_KEY=sf_live_YOUR_KEY_HERE
```

### Step 2: Verify it works

```bash
sf list
```

Expected output (table format):
```
ID          Status  Conf    Updated         Title
f582bf76    active   82%    Mar 12 11:13    Oil prices will exceed $100...
a1b2c3d4    active   65%    Mar 11 09:30    Fed will cut rates by June...
```

If you see theses, the CLI is working. If you see an error, check that `SF_API_KEY` is set correctly.

### Step 3: Get thesis context (most important command)

```bash
sf context <thesisId> --json
```

This returns a JSON object with the complete thesis state:

```json
{
  "thesisId": "f582bf76-3113-4208-b0c1-...",
  "thesis": "Oil prices will exceed $100 by end of 2026",
  "title": "Oil Bull Thesis",
  "status": "active",
  "confidence": 0.82,
  "causalTree": {
    "rootClaim": "Oil prices will exceed $100",
    "nodes": [
      {
        "id": "n1",
        "label": "Supply disruption",
        "probability": 0.75,
        "importance": 0.6,
        "depth": 0
      }
    ]
  },
  "edges": [
    {
      "marketId": "KXWTIMAX-26DEC31-T100",
      "market": "Will oil exceed $100 by Dec 2026?",
      "venue": "kalshi",
      "direction": "yes",
      "marketPrice": 35,
      "thesisPrice": 55,
      "edge": 20,
      "confidence": 0.8
    }
  ],
  "lastEvaluation": {
    "summary": "Supply concerns rising due to...",
    "newConfidence": 0.82,
    "confidenceDelta": 0.03
  }
}
```

**Key fields:**
- `confidence` — overall thesis probability (0 to 1)
- `edges[].edge` — mispricing size in cents (positive = market underpriced vs thesis)
- `edges[].marketPrice` — current market price in cents (0-100)
- `edges[].thesisPrice` — what the thesis model thinks the price should be
- `lastEvaluation.summary` — human-readable summary of latest analysis

### Step 4: Other useful commands

```bash
# Inject a signal for the thesis to consider in its next evaluation
sf signal <thesisId> "Breaking: OPEC announces production cut" --type news

# View top edges (mispricings) across all theses
sf edges --json

# Search Kalshi markets by keyword
sf scan "recession" --json

# Trigger a deep re-evaluation
sf evaluate <thesisId>

# What-if analysis: what happens if a node probability changes?
sf whatif <thesisId>
```

### Common patterns for agents

**Monitor a thesis:**
```bash
sf context <id> --json    # poll periodically, check confidence changes
```

**React to news:**
```bash
sf signal <id> "Reuters: Iran nuclear deal collapses" --type news
sf evaluate <id>          # trigger re-evaluation after injecting signal
sf context <id> --json    # read updated state
```

**Find trading opportunities:**
```bash
sf edges --json           # get top mispricings sorted by edge size
```

### Error handling

- **"API key required"** — set `SF_API_KEY` env var or run `sf setup --key <key>`
- **"Thesis not found"** — use `sf list` to get valid thesis IDs. IDs can be short prefixes (first 8 chars)
- **"Kalshi not configured"** — positions/trading commands need Kalshi credentials via `sf setup`
- **Exit code 0** — success. **Exit code 1** — error (message printed to stderr)

## Local Development

```bash
cd cli
npm install
npm run dev -- list          # run without building
npm run build                # compile to dist/
npm run test                 # run unit tests
npm link                     # install as global 'sf' command
```
