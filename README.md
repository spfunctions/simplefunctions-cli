# SimpleFunctions CLI

[![npm version](https://img.shields.io/npm/v/@spfunctions/cli.svg)](https://www.npmjs.com/package/@spfunctions/cli)
[![license](https://img.shields.io/npm/l/@spfunctions/cli.svg)](https://github.com/spfunctions/simplefunctions-cli/blob/main/LICENSE)

Prediction market intelligence from the terminal. Build causal thesis models, scan Kalshi & Polymarket for mispricings, and trade.

## Install

```bash
npm i -g @spfunctions/cli
sf setup
```

## Key Commands

| Command | What it does |
|---------|-------------|
| `sf list` | List your theses with confidence scores and status |
| `sf context <id> --json` | Full thesis state as structured JSON (for agents) |
| `sf scan "topic"` | Search Kalshi/Polymarket markets by keyword |
| `sf edges` | Top mispricings across all your theses |
| `sf signal <id> "news"` | Inject a signal for the next evaluation cycle |
| `sf agent` | Interactive agent with natural language + tool calling |

All commands support `--json` for machine-readable output.

## MCP Server

Connect SimpleFunctions to Claude, Cursor, or any MCP-compatible client:

```bash
claude mcp add simplefunctions --url https://simplefunctions.dev/api/mcp/mcp
```

Listed on the [MCP Registry](https://registry.modelcontextprotocol.io).

## Documentation

Full docs, API reference, and guides: **[simplefunctions.dev/docs](https://simplefunctions.dev/docs)**

## License

MIT
