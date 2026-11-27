# Load tests

`turns.js` is a k6 script for mock-inference WebSocket turns.

## Setup

1. Start Compose with `INFERENCE_MOCK=1`.
2. Bootstrap an account and create a bot.
3. Export `TOKEN` and `BOT_ID`.

## Run

```bash
k6 run -e BASE_URL=http://127.0.0.1:8787 -e TOKEN="$TOKEN" -e BOT_ID="$BOT_ID" \
  -e VUS=100 infra/load/turns.js
```

The script asserts WebSocket acceptance and settlement, and fails if turn P95 exceeds 10 seconds.
