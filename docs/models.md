# Available Models

## Claude Models

| Model ID                     | Description                              |
| ----------------------------- | ---------------------------------------- |
| `claude-sonnet-4-6-thinking`  | Claude Sonnet 4.6 with extended thinking |
| `claude-opus-4-6-thinking`    | Claude Opus 4.6 with extended thinking   |
| `claude-sonnet-4-6`           | Claude Sonnet 4.6 without thinking       |

## Gemini Models

```bash
curl http://localhost:8080/v1/models
```

`/v1/models` hides Gemini generations below 3.5 (`2.5-*`, `3-flash`, `3.1-*`) and the
unversioned duplicate aliases `gemini-pro-agent` / `gemini-3-flash-agent`. Hidden ids
still work if configured explicitly (e.g. `ANTHROPIC_MODEL=gemini-3.1-pro-low`).

Gemini models include full thinking support with `thoughtSignature` handling for multi-turn conversations.
