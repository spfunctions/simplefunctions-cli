# SimpleFunctions CLI (`sf`)

Prediction market thesis agent CLI. Pure HTTP client — no project dependencies.

## Install

```bash
npm install -g @spfunctions/cli
```

## Configuration

```bash
export SF_API_KEY=sf_live_xxx           # required
export SF_API_URL=https://simplefunctions.dev  # optional, defaults to production
```

Or pass inline:
```bash
sf --api-key sf_live_xxx list
```

## Commands

### `sf list`
List all theses.
```
ID          Status  Conf    Updated         Title
f582bf76    active   82%    Mar 12 11:13    Trump cannot exit the Iran war...
```

### `sf get <id>`
Full thesis details: causal tree, edge analysis, positions, last evaluation.
```bash
sf get f582bf76
sf get f582bf76 --json
```

### `sf context <id>`
**Primary command for agents.** Returns a compact context snapshot: thesis, confidence, causal tree nodes, top edges, positions, last evaluation summary.
```bash
sf context f582bf76
sf context f582bf76 --json   # machine-readable for agent parsing
```

### `sf create "thesis text"`
Create a new thesis. Sync by default (waits for formation agent to complete).
```bash
sf create "Trump cannot exit the Iran war gracefully before 2027"
sf create "..." --async   # return immediately
```

### `sf signal <id> "content"`
Inject a signal into the thesis queue. Queued for next monitor cycle.
```bash
sf signal f582bf76 "Oil closes at $95 today"
sf signal f582bf76 "Iran closes Strait of Hormuz" --type news
sf signal f582bf76 "My read: escalation likely" --type user_note
```
Signal types: `news` | `user_note` | `external` (default: `user_note`)

### `sf evaluate <id>`
Trigger a deep evaluation using the heavy model (Claude Opus).
```bash
sf evaluate f582bf76
```

### `sf scan "keywords"`
Explore Kalshi markets directly (no auth required).
```bash
sf scan "oil recession iran"
sf scan --series KXWTIMAX
sf scan --market KXWTIMAX-26DEC31-T140
sf scan "oil" --json
```

## For AI Agents (OpenClaw etc.)

After `npm install -g simplefunctions` and setting `SF_API_KEY`:

```
You can use the sf CLI to interact with SimpleFunctions:
- sf context <id> --json    Get current thesis state (JSON)
- sf signal <id> "content"  Inject an observation note
- sf list                   List all theses
- sf scan "keywords"        Explore Kalshi markets
```

Agents should call `sf context <id> --json` periodically to get the latest state, then decide whether to inject signals or alert the user.

## Local Development

```bash
cd cli
npm install
npm run dev -- list          # run without building
npm run build                # compile to dist/
npm link                     # install as global 'sf' command
sf list
```
