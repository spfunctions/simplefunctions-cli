# SimpleFunctions CLI (`sf`)

Reference and issue mirror for `@spfunctions/cli`, the supported SimpleFunctions command-line interface for prediction-market infrastructure.

The current CLI is distributed through npm. Install the package and treat the installed `sf` binary as the source of truth:

```bash
npm i -g @spfunctions/cli
sf login
sf status --json
sf world --json
sf describe --all --json
```

`sf` is the primary local surface for SimpleFunctions. It queries live Kalshi + Polymarket state, inspects markets and orderbooks, exports structured JSON for coding agents, runs thesis and portfolio workflows, and keeps execution commands explicit and permission-gated.

## What this repository is

- Public reference page for the npm package.
- Issue tracker for `@spfunctions/cli`.
- Installation, support, and discovery pointer for the current `sf` surface.

## What this repository is not

- It is not the current full operator-runtime source tree.
- It is not the canonical command inventory.
- It should not be used to infer current command counts, market counts, or execution behavior.

Use `sf describe --all --json` for the installed command manifest. Use `https://simplefunctions.dev/api/internal/statistics` for current public surface counts.

## First useful workflow

```bash
sf status --json
sf world --json
sf discover --quality --json
sf inspect <ticker> --json
```

If a command is unavailable in your installed version, run:

```bash
npm i -g @spfunctions/cli@latest
sf describe --all --json
```

## Product surface order

1. CLI: primary local control plane for humans, shell scripts, cron, Claude Code, Codex, and other coding agents.
2. HTTP/Data API: network surface for services, dashboards, notebooks, and remote workers.
3. SDKs and agent runtime: planned wrappers over stable CLI/API object contracts.
4. MCP: compatibility adapter for MCP-only hosts, not the canonical product center.

## Links

- CLI product page: https://simplefunctions.dev/cli
- npm package: https://www.npmjs.com/package/@spfunctions/cli
- Docs: https://docs.simplefunctions.dev
- llms.txt: https://simplefunctions.dev/llms.txt
- Public package catalog: https://simplefunctions.dev/opensource

## License

The public mirror is MIT-licensed. The supported npm distribution may include private SimpleFunctions runtime code.
