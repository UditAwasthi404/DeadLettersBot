#!/usr/bin/env bash
# Move the X cursor for one bot display. The browser click still comes from CDP.
set -euo pipefail

bot_id="${1:-}"
action="${2:-}"
x="${3:-}"
y="${4:-}"

if [[ ! "$bot_id" =~ ^[0-9a-fA-F-]{36}$ ]]; then
  echo "invalid bot id" >&2
  exit 2
fi
if [[ "$action" != "mousemove" ]]; then
  echo "unsupported pointer action" >&2
  exit 2
fi
if [[ ! "$x" =~ ^[0-9]+$ || ! "$y" =~ ^[0-9]+$ ]]; then
  echo "invalid pointer coordinates" >&2
  exit 2
fi
if (( x > 7680 || y > 4320 )); then
  echo "pointer coordinates are out of range" >&2
  exit 2
fi

mapping="${HOME}/.agentos/browsers/${bot_id}"
if [[ ! -r "$mapping" ]]; then
  echo "browser display is not running" >&2
  exit 1
fi
read -r _ display < "$mapping"
if [[ ! "$display" =~ ^[0-9]+$ ]]; then
  echo "browser display is not running" >&2
  exit 1
fi
if ! command -v xdotool >/dev/null 2>&1; then
  echo "xdotool is not installed" >&2
  exit 1
fi

export DISPLAY=":${display}"
exec xdotool mousemove --sync "$x" "$y"
