# CLAUDE.md

Node.js proxy that exposes an Anthropic-compatible API backed by Google's Cloud Code service, letting Claude Code CLI use Gemini (and Claude) models via Google accounts with multi-account quota management.

Request flow: `Claude Code CLI → Express (server.js) → CloudCode client → Antigravity Cloud Code API`

## Architecture

Server entry is `src/index.js`, which starts `src/server.js` (all routes + request handling) and initializes the `AccountManager`. All code is ESM (`"type": "module"`).

- **`src/server.js`** — Express app; routes include `POST /v1/messages`, `/v1/models`, `/health`, `/account-limits`, `/refresh-token`, and the WebUI. Translates Anthropic requests into the internal flow and streams responses back.
- **`src/format/`** — the core conversion layer. `request-converter.js` (`convertAnthropicToGoogle`) and `response-converter.js` (`convertGoogleToAnthropic`) sit at the boundaries; `content-converter.js` handles block conversion, `schema-sanitizer.js` scrubs tool schemas, `thinking-utils.js` + `signature-cache.js` manage cross-model thinking signatures. `format/index.js` re-exports the public API.
- **`src/cloudcode/`** — client for Google's Cloud Code API. `message-handler.js` (non-streaming) and `streaming-handler.js` (SSE) do the actual transport via `request-builder.js`, `sse-parser.js`, `sse-streamer.js`, `model-api.js`, and the rate-limit modules.
- **`src/account-manager/`** — multi-account quota management. `index.js` (AccountManager) picks accounts via a strategy (`strategies/`: sticky / round-robin / hybrid) and tracks rate limits (`rate-limits.js`, `trackers/`), token/project caches (`credentials.js`), and on-disk state (`storage.js`).
- **`src/auth/`** — Google OAuth (`oauth.js`), token extraction (`token-extractor.js`), and auth DB (`database.js`, better-sqlite3).
- **`src/utils/`** — config, logger, `claude-config.js`, `server-presets.js`, `version-detector.js`, and `proxy.js` (must be imported first to enable HTTP_PROXY before any fetch).
- **`src/webui/index.js`** — the status/account dashboard UI; static assets in `public/`.
- **`src/modules/usage-stats.js`** — request/usage accounting. `src/constants.js` holds shared enums (strategy names, quota defaults); `src/config.js` reads env vars (API_KEY, WEBUI_PASSWORD, DEBUG, DEV_MODE).

Account data, tokens, and settings persist in `~/.antigravity-claude-proxy/` (config path `ACCOUNT_CONFIG_PATH` in `constants.js`).

## Commands

```bash
npm install          # installs deps and builds CSS (prepare hook)
npm start            # port 8080
npm run dev          # watch server files
npm run dev:full     # watch CSS + server files

npm start -- --strategy=sticky       # cache-optimized (default is hybrid)
npm start -- --strategy=round-robin  # load-balanced
npm start -- --fallback              # fall back to alternate model on quota exhaustion
npm start -- --dev-mode              # enables debug logging + dev tools (--debug is a legacy alias)

npm run build:css    # compile Tailwind once
npm run watch:css    # watch CSS

npm run accounts:add                 # add Google account via OAuth
npm run accounts:add -- --no-browser # headless/manual code input
npm run accounts:list
npm run accounts:verify

npm test                             # requires server running on port 8080
node tests/run-all.cjs <filter>      # run matching tests only (filter matches file name or test title)
node tests/test-strategies.cjs       # strategy unit tests (no server needed)

# Individual integration tests also have dedicated npm scripts, e.g.:
npm run test:signatures             # thinking signatures
npm run test:multiturn              # multi-turn tools (non-streaming)
npm run test:caching                # prompt caching
npm run test:crossmodel             # cross-model thinking
npm run test:sanitizer              # schema sanitizer
```

## Non-obvious things

**CSS**: Source is `public/css/src/input.css` (Tailwind + `@apply`). Compiled output is `public/css/style.css` — don't edit the compiled file.

**Quota thresholds** are stored as fractions (0–0.99) but displayed as percentages in the UI. Three-tier resolution: per-model > per-account > global.

**`cache_control` stripping**: Claude Code CLI sends `cache_control` on content blocks; Cloud Code API rejects them. Stripped at the start of `convertAnthropicToGoogle()` before any other processing.

**Cross-model thinking signatures**: Claude and Gemini signatures are incompatible. When switching models mid-conversation, mismatched signatures are dropped. Gemini targets: strict (drop unknown). Claude targets: lenient (let Claude validate).

**`CLAUDE_CONFIG_PATH` env var**: Set this when running as a systemd service — `os.homedir()` returns the service user's home, not the real user's.

**`WEBUI_PASSWORD` env var**: Enables password protection on the web UI.

**Native module rebuild**: On Node.js version mismatch, `better-sqlite3` is auto-rebuilt via `npm rebuild`. If reload still fails after rebuild, a server restart is required.

**Dev mode sub-toggles** are client-side only (localStorage in `settings-store.js`): screenshot/redact mode, debug logging, log export, health inspector, placeholder data. No backend involvement.

**`/api/strategy/health`** returns 403 unless dev mode is on.
