# SimpleFunctions CLI — Kalshi & Polymarket Trading Bot

[![npm version](https://img.shields.io/npm/v/@spfunctions/cli.svg)](https://www.npmjs.com/package/@spfunctions/cli)
[![npm downloads](https://img.shields.io/npm/dm/@spfunctions/cli.svg)](https://www.npmjs.com/package/@spfunctions/cli)
[![license](https://img.shields.io/npm/l/@spfunctions/cli.svg)](https://github.com/spfunctions/simplefunctions-cli/blob/main/LICENSE)

AI-powered prediction market trading bot and analysis CLI for [Kalshi](https://kalshi.com) and [Polymarket](https://polymarket.com). Scans 130,000+ markets, detects mispricings with causal thesis models, backtests strategies, makes markets with an automated quote engine, and executes trades — all from the terminal.

```bash
npm i -g @spfunctions/cli
sf setup
```

## What It Does

| Capability | Command | What other tools need |
|---|---|---|
| Scan 130K markets across Kalshi + Polymarket | `sf scan "topic"` | Separate API clients for each venue |
| Screen by 6 quantitative indicators (IY, CRI, OR, EE, LAS, tau) | `sf screen --iy-min 200 --tau-max 30` | Custom scripts, no standard indicators |
| Real-time Level 2 orderbook with depth + slippage | `sf book TICKER` | Kalshi WebSocket + custom parsing |
| Backtest entry/stop/TP strategies on historical data | `sf backtest TICKER --entry-below 35 --stop 20 --tp 60` | Build your own backtester |
| Causal thesis → probability → edge detection | `sf create "thesis" → sf edges` | Nothing comparable |
| What-if scenario analysis on causal tree nodes | `sf whatif ID --set "n1=0.9"` | Manual spreadsheets |
| Automated market making with inventory management | `sf quoteengine start` | Custom HFT infrastructure |
| Intent-based order execution with triggers | `sf intent buy TICKER 10 --trigger below:28` | Manual order placement |
| 24/7 autonomous monitoring (news + X + LLM eval) | `sf heartbeat ID` | Multiple tools stitched together |
| Real-time world state for AI agents (~800 tokens) | `sf world` | No equivalent |

## Quick Start

```bash
# Search for markets
sf scan "fed rate cuts 2026"

# Get the world state (what's happening right now)
sf world

# Inspect an orderbook
sf book KXCPI-26APR-T0.4

# Screen for high implied yield, tight spread markets
sf screen --iy-min 300 --las-max 0.03

# Backtest a strategy
sf backtest KXRECSSNBER-26 --entry-below 30 --stop 10 --tp 50

# Get AI-generated trade ideas
sf ideas
```

## Trading Bot Features

### Thesis-Driven Edge Detection

Unlike simple price-alert bots, SimpleFunctions builds causal probability models:

```bash
# Create a thesis → auto-generates causal tree
sf create "Iran conflict pushes oil above $130"

# See where markets are mispriced vs your thesis
sf edges

# Stress test: what if one assumption changes?
sf whatif ID --set "n1=0.9" --set "n4=0.5"
```

### Automated Market Making (QuoteEngine v2)

```bash
# Paper-trade market making with 2¢ spread
sf quote create KXCPICORE-26APR-T0.3 --paper --spread 2 --size 5

# Full engine with WebSocket, inventory skew, fade-after-fill
sf quoteengine start
sf quoteengine status
```

Features: multi-layer quoting, inventory-based skew, fade-after-fill, configurable stop loss, thesis-biased mode.

### Intent-Based Execution

```bash
# Buy when price drops below 28¢
sf intent buy KXRECSSNBER-26 50 --trigger below:28

# Buy at a specific time
sf intent buy TICKER 25 --trigger time:2026-04-15T14:00:00Z

# LLM-evaluated soft condition
sf intent buy TICKER 25 --soft "CPI comes in above consensus"

# Start the runtime daemon to evaluate triggers
sf runtime start --smart
```

### 24/7 Autonomous Monitoring

```bash
# Configure heartbeat: news every 4h, X scan every 4h, LLM eval every 15min
sf heartbeat ID --news-interval 240 --x-interval 240 --model cheap --budget 5

# Enable closed-loop trading (auto-entry from strategies)
sf heartbeat ID --closed-loop-entry --closed-loop-exit
```

## All Commands (42)

<details>
<summary>Expand full command reference</summary>

### Thesis Management
| Command | Description |
|---------|-------------|
| `sf list` | List all theses with confidence scores |
| `sf get <id>` | Full thesis details with causal tree |
| `sf context [id]` | Market snapshot (no id) or thesis context (with id) |
| `sf create "thesis"` | Create thesis with auto-generated causal tree |
| `sf signal <id> "news"` | Inject observation for next evaluation |
| `sf evaluate <id>` | Force deep re-evaluation |
| `sf augment <id>` | Evolve causal tree with new nodes |
| `sf heartbeat <id>` | Configure 24/7 monitoring |

### Market Data
| Command | Description |
|---------|-------------|
| `sf scan "keywords"` | Search Kalshi + Polymarket by keyword |
| `sf screen [filters]` | Screen 130K markets by IY, CRI, OR, EE, LAS, tau |
| `sf book <ticker>` | Level 2 orderbook with depth |
| `sf liquidity [topic]` | Orderbook liquidity scanner |
| `sf markets` | Traditional markets (SPY, VIX, TLT, GLD, USO, etc.) |
| `sf query "question"` | LLM-enhanced prediction market search |
| `sf forecast <event>` | P50/P75/P90 distribution over time |

### World Model
| Command | Description |
|---------|-------------|
| `sf world` | Real-time world state (~800 tokens) |
| `sf world --delta` | What changed since last check |
| `sf world --focus energy,geo` | Deep coverage on specific topics |
| `sf ideas` | S&T-style trade recommendations |

### Trading & Execution
| Command | Description |
|---------|-------------|
| `sf edges` | Top mispricings across all theses |
| `sf whatif <id>` | Scenario analysis with node overrides |
| `sf backtest <ticker>` | Strategy backtesting |
| `sf intent buy/sell` | Conditional order with triggers |
| `sf buy/sell <ticker> <qty>` | Direct order placement |
| `sf quote create <ticker>` | Market making quote |
| `sf quoteengine start/stop` | Automated market making engine |
| `sf runtime start` | Execution daemon for intents |

### Portfolio
| Command | Description |
|---------|-------------|
| `sf positions` | Kalshi + Polymarket positions |
| `sf balance` | Account balance |
| `sf orders` | Resting orders |
| `sf fills` | Recent trade fills |
| `sf settlements` | Settled contracts with P&L |
| `sf performance` | P&L over time |

</details>

## MCP Server — Connect to Claude, Cursor, or Any AI Agent

```bash
claude mcp add simplefunctions --url https://simplefunctions.dev/api/mcp/mcp
```

25 tools for prediction market data, thesis management, trading, and X/Twitter sentiment. Listed on the [MCP Registry](https://registry.modelcontextprotocol.io).

## Agent Integration

Every command supports `--json` for structured output. Pipe into any agent framework:

```bash
# LangChain / CrewAI / OpenAI Agents — use as a subprocess
sf scan "recession" --json | your-agent-script

# Or use the dedicated SDK packages
npm i prediction-market-context        # world state + context
npm i prediction-market-edge-detector  # edge scanning
npm i agent-world-awareness            # one-line world injection
```

Python: `pip install simplefunctions-ai`

## How It Compares

| | SimpleFunctions CLI | Kalshi API + scripts | Other trading bots |
|---|---|---|---|
| **Markets** | Kalshi + Polymarket unified | Kalshi only | Usually one venue |
| **Analysis** | Causal trees, 6 indicators, what-if | Raw prices | LLM opinion |
| **Execution** | Intents, quote engine, runtime daemon | Manual orders | Basic buy/sell |
| **Monitoring** | 24/7 heartbeat with news + X + LLM | None | Price alerts only |
| **Data** | 130K markets, Level 2 orderbook | Kalshi only | Limited |

## Documentation

Full docs, API reference, and guides: **[simplefunctions.dev/docs](https://simplefunctions.dev/docs)**

## License

MIT
