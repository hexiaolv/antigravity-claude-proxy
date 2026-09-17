# Using with OpenCode

[OpenCode](https://opencode.ai/) is a terminal-based AI coding assistant similar to Claude Code. You can configure it to use this proxy, which unlocks both Claude and Gemini models in a single interactive session.

## The Problem with Claude Code

The proxy exposes both Claude and Gemini models via `/v1/models`. However, Claude Code's `/model` picker is hardcoded by Anthropic to only show Claude variants. Gemini models are effectively invisible in the UI.

The only workaround within Claude Code is hardcoding a single Gemini model in `settings.json` — no interactive switching, no mid-session changes.

## What OpenCode Solves

OpenCode supports custom providers via a config file. Once pointed at this proxy, all models (Claude and Gemini) appear in one interactive picker and can be switched freely at any time.

| Feature | Claude Code | OpenCode (with this proxy) |
|---|---|---|
| Claude models | yes | yes |
| Gemini models | hardcoded only | interactive picker |
| Switch models mid-session | no | yes |
| Multi-account load balancing | yes (via proxy) | yes (via proxy) |

## Prerequisites

- OpenCode installed (`npm install -g opencode-ai@latest`)
- Antigravity Claude Proxy running on port 8080
- At least one Google account linked to the proxy

## Global Configuration

```bash
mkdir -p ~/.config/opencode

cat > ~/.config/opencode/opencode.json <<'EOF'
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "antigravity": {
      "npm": "@ai-sdk/anthropic",
      "name": "Antigravity Local",
      "options": {
        "baseURL": "http://localhost:8080/v1",
        "apiKey": "{env:ANTHROPIC_API_KEY}"
      },
      "models": {
        "claude-sonnet-4-6": { "id": "claude-sonnet-4-6", "name": "Claude Sonnet 4.6" },
        "claude-opus-4-6-thinking": { "id": "claude-opus-4-6-thinking", "name": "Claude Opus 4.6 Thinking" },
        "gemini-3.8-flash-tiered": { "id": "gemini-3.8-flash-tiered", "name": "Gemini 3.8 Flash" },
        "gemini-3.6-flash-high": { "id": "gemini-3.6-flash-high", "name": "Gemini 3.6 Flash (High)" },
        "gemini-3.5-flash-low": { "id": "gemini-3.5-flash-low", "name": "Gemini 3.5 Flash" }
      }
    }
  },
  "model": "antigravity/claude-sonnet-4-6",
  "small_model": "antigravity/gemini-3.5-flash-low"
}
EOF
```

This config is global and applies automatically every time you run `opencode` from any folder.

## Shell Environment

```bash
grep -q 'ANTHROPIC_API_KEY=' ~/.zshrc || echo 'export ANTHROPIC_API_KEY="dummy"' >> ~/.zshrc
grep -q 'ANTHROPIC_BASE_URL=' ~/.zshrc || echo 'export ANTHROPIC_BASE_URL="http://localhost:8080/v1"' >> ~/.zshrc
source ~/.zshrc
```

The `ANTHROPIC_API_KEY` value can be anything — the proxy does not validate it. Authentication is handled via your linked Google accounts.

## Start Both Services

```bash
# Terminal 1: Start the proxy
antigravity-claude-proxy start

# Terminal 2: Open OpenCode from any project folder
opencode
```

## Switching Models

Inside OpenCode, all registered models appear as `antigravity/<model-id>`. The `small_model` field handles background operations — setting it to a Gemini Flash model conserves your Claude quota, the same way `ANTHROPIC_DEFAULT_HAIKU_MODEL` works in Claude Code.

## Available Models

| Model ID | Type | Best For |
|---|---|---|
| `claude-sonnet-4-6` | Claude | Coding, refactoring |
| `claude-opus-4-6-thinking` | Claude | Architecture, deep reasoning |
| `gemini-3.8-flash-tiered` | Gemini | Latest Flash tier, fast general tasks |
| `gemini-3.6-flash-high` | Gemini | Stronger reasoning, agentic workflows |
| `gemini-3.5-flash-low` | Gemini | Fast tasks, `small_model` recommended |

## Verify Configuration

```bash
curl "http://localhost:8080/v1/messages" 
  -H "content-type: application/json" 
  -H "anthropic-version: 2023-06-01" 
  -H "x-api-key: dummy" 
  -d '{"model": "claude-sonnet-4-6", "max_tokens": 100, "messages": [{"role":"user","content":"say hi"}]}'
```

## Troubleshooting

### `Endpoint POST /messages not found`

Your `baseURL` is missing `/v1`. Set it to `http://localhost:8080/v1`, not `http://localhost:8080`.

### Model returns `400 INVALID_ARGUMENT`

The model is rejected by Google's backend. Remove it from your `models` block.

### Models not appearing in picker

1. Check the config is valid JSON: `cat ~/.config/opencode/opencode.json`
2. Check the env var is set: `echo $ANTHROPIC_API_KEY`
3. Open a fresh terminal after config changes

### Connection refused

```bash
acc status
curl http://localhost:8080/health
```

## Further Reading

- [OpenCode Documentation](https://opencode.ai/docs/)
- [OpenCode Providers](https://opencode.ai/docs/providers/)
- [Proxy Load Balancing](load-balancing.md)
- [Proxy Configuration](configuration.md)
- [Available Models](models.md)
