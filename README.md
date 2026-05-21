# Google Trends MCP

[![npm](https://img.shields.io/npm/v/@den.dance/google-trends-mcp)](https://www.npmjs.com/package/@den.dance/google-trends-mcp)

The Google Trends MCP server that actually works under Google's anti-bot. Connect Claude to live Google Trends data — keyword interest, related queries, regional popularity.

Most Google Trends MCP packages crash with `Unexpected token 'l'` the moment Google blocks them (which is often). Free public proxy lists don't help — we tested 64 proxies from a popular "high-quality" list and 0 worked. This one uses your own rotating proxy with auto-retry, so blocked requests transparently retry on a fresh IP.

Built by [Denis Maleev](https://den.dance/).

---

## Why this one

| What's fixed | Detail |
|---|---|
| Free public proxies don't work | We tested 64 — 0 survived. Bring your own rotating residential (Webshare/IPRoyal/Smartproxy free tier = ~46k requests on 1 GB) |
| Auto-retry on Google blocks | When Google returns HTML, we retry up to 3 times with a fresh proxy from the pool. End-to-end success rate in our tests: 5/5 |
| HTML-detection at the wrapper level | Other MCPs let `JSON.parse` crash with cryptic errors. We detect HTML before parsing |
| Honest about what doesn't work | `get_trending_searches` is intentionally not exposed — Google blocks `dailyTrends`/`realTimeTrends` aggressively without residential proxies. We don't pretend otherwise |
| Pool with fail-tracking | Proxies that fail 3 times get dropped automatically. Random rotation per request |
| Per-request rotation | Each request picks a random proxy from the pool — Google can't accumulate per-IP rate limits |

---

## Quick Start

```bash
npx @den.dance/google-trends-mcp
```

Works out-of-the-box from non-flagged IPs, but Google rate-limits datacenter ranges aggressively. For reliable use, set up a proxy (see below).

---

## Setup

### 1. Get a rotating proxy account

Recommended (all have free tiers / pay-per-GB):
- **Webshare** — free 1 GB residential (~46k Google Trends requests)
- **IPRoyal** — $1.75/GB, lowest price
- **Smartproxy / Decodo** — $4-7/GB, large pool
- **Bright Data / Oxylabs** — $5-8/GB, enterprise grade

Make sure the provider allows `*.google.com` in their ToS (most majors do).

### 2. Configure Claude Desktop

Edit your Claude Desktop config file:
- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
- **Linux**: `~/.config/Claude/claude_desktop_config.json`

Single rotating endpoint (recommended — provider rotates IPs internally):

```json
{
  "mcpServers": {
    "google-trends": {
      "command": "npx",
      "args": ["@den.dance/google-trends-mcp"],
      "env": {
        "PROXY_URL": "http://USER:PASS@gate.smartproxy.com:7000"
      }
    }
  }
}
```

Or an explicit list (useful for Webshare-style per-port proxies):

```json
{
  "mcpServers": {
    "google-trends": {
      "command": "npx",
      "args": ["@den.dance/google-trends-mcp"],
      "env": {
        "PROXY_LIST": "http://user:pass@host1:6114,http://user:pass@host2:6014,http://user:pass@host3:5863"
      }
    }
  }
}
```

For longer lists, put proxies in a file (one per line, `#` comments allowed) and point to it:

```json
{
  "mcpServers": {
    "google-trends": {
      "command": "npx",
      "args": ["@den.dance/google-trends-mcp"],
      "env": {
        "PROXY_LIST_FILE": "/home/you/.config/google-trends/proxies.txt"
      }
    }
  }
}
```

```
# ~/.config/google-trends/proxies.txt
http://user:pass@host1:6114
http://user:pass@host2:6014
http://user:pass@host3:5863
```

`chmod 600` the file — credentials live there. Run `proxy_refresh` from Claude to hot-reload after editing.

Restart Claude Desktop after saving the JSON config.

### 3. Configure Claude Code

```bash
claude mcp add google-trends \
  -e PROXY_URL="http://USER:PASS@gate.smartproxy.com:7000" \
  -- npx @den.dance/google-trends-mcp
```

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `PROXY_URL` | recommended | Single rotating proxy endpoint. Provider handles IP rotation internally. No validation, no fallback |
| `PROXY_LIST` | alternative | Comma-separated list of proxies (`http://user:pass@host:port,...`). Validated on startup, bad ones auto-dropped |
| `PROXY_LIST_FILE` | alternative | Path to a file with one proxy per line (`#` comments and blank lines allowed). Validated on startup. Re-read on `proxy_refresh` |
| `PROXIES_ENABLED` | no | Set to `false` to disable all proxy logic (direct requests). Default: enabled |

Priority: `PROXY_URL` > `PROXY_LIST` > `PROXY_LIST_FILE`. If none are set, requests go direct (no proxy) — works only from non-flagged IPs.

---

## Tools

### Data tools

- `compare_keywords` — search interest over time for up to 5 keywords. Returns a timeline of relative scores.
- `get_related_queries` — top + rising related queries for a keyword. Powered by Google's `relatedQueries` endpoint.
- `get_interest_by_region` — top 20 regions by interest in a keyword.

### Admin tools

- `proxy_status` — show source (`single` / `env-list` / `env-file` / `none` / `disabled`), working count, age, freshness, validation progress.
- `proxy_refresh` — force re-validation of the current proxy source. No-op in `PROXY_URL` mode.

### Intentionally not exposed

- `get_trending_searches` (daily / real-time trends) — Google blocks these endpoints aggressively. Even with residential proxies the success rate is too low to ship. We'd rather not lie about it.

---

## Known limitations

- Google sometimes blocks multi-keyword requests (2 or 4 keywords) more aggressively than single. Our auto-retry handles this — but if all 3 attempts hit blocks, the request fails. Increase `MAX_ATTEMPTS` in `trends-client.js` if you need higher tolerance.
- The underlying `google-trends-api` library scrapes Google's internal endpoints, which are undocumented and can change. If the library breaks, this MCP breaks too.
- For very heavy use (>10k req/day) consider a managed service like SerpAPI or DataForSEO — at that scale the price difference vs your own proxy is marginal and the operational burden disappears.

---

## Example prompts for Claude

- "Compare search interest for 'claude ai', 'chatgpt', and 'gemini' over the last 12 months"
- "What are people searching for related to 'sourdough bread'?"
- "Which regions have highest interest in 'electric vehicle'?"
- "Show me the proxy pool status"

---

## Architecture notes

- ~450 lines total across `server.js` (MCP handlers), `proxy-manager.js` (pool/cache), `trends-client.js` (retry logic with DI)
- Validation: parallel workers (concurrency 50) check each proxy against `trends.google.com/api/autocomplete/test`, looking for the anti-XSSI prefix `)]}'` in the response
- Cache: working proxies persisted to `proxies.json` (gitignored), keyed by SHA1 of input list — automatically invalidated when source changes
- TTL: 4 hours; background re-validation when cache is stale
- Fail tracking: proxies drop from rotation after 3 failures per session
- Retry: every tool call retries up to 3 times with fresh `getAgent()` on HTML response or exception

---

## Development

### Tests

```bash
# Unit only (fast, offline, no network)
npm test

# With coverage report (html in coverage/)
npm run test:coverage

# Integration (real Google hit, gated)
RUN_INTEGRATION=1 npm run test:integration

# E2E (spawns server.js, JSON-RPC over stdio)
RUN_E2E=1 npm run test:e2e

# Everything
npm run test:all
```

### Project structure

- `server.js` — MCP server entrypoint (stdio transport)
- `trends-client.js` — Google Trends API wrapper with retry-on-HTML
- `proxy-manager.js` — proxy pool, validation, cache, source priority
- `tests/unit/` — pure unit tests, no network (~40 tests, runs in ~2s)
- `tests/integration/` — real Google endpoint tests (gated by `RUN_INTEGRATION=1`)
- `tests/e2e/` — full MCP protocol tests via spawn (gated by `RUN_E2E=1`)

---

## Security

- Never commit proxy credentials to version control. Use `PROXY_LIST_FILE` pointing to a `chmod 600` file outside the repo, or your secrets manager
- `proxies.json` cache (built from validated proxies) is gitignored and never published — re-generated on first run after install

---

## License

MIT