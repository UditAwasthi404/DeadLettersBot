#!/usr/bin/env bash
set -euo pipefail

bot_id="${1:-}"
if [[ ! "$bot_id" =~ ^[0-9a-fA-F-]{36}$ ]]; then
  echo "invalid bot id" >&2
  exit 2
fi

state_dir="$HOME/.agentos/browsers"
mapping="$state_dir/$bot_id"
if [[ ! -r "$mapping" ]]; then
  echo "browser display is not running" >&2
  exit 1
fi
read -r _ display < "$mapping"
if [[ ! "$display" =~ ^[0-9]+$ ]]; then
  echo "browser display is not running" >&2
  exit 1
fi

vnc_port=$((6900 + display))
port_open() {
  (exec 3<>"/dev/tcp/127.0.0.1/$1") >/dev/null 2>&1
}

# shortcut: no VNC password; the gateway authenticates and the port stays on the account bridge.
if ! port_open "$vnc_port"; then
  nohup x11vnc -display ":$display" -rfbport "$vnc_port" -nopw -shared -forever -noxdamage \
    >"$state_dir/vnc-$bot_id.log" 2>&1 9>&- &
fi

for _ in $(seq 1 50); do
  if port_open "$vnc_port"; then
    echo "$vnc_port"
    exit 0
  fi
  sleep 0.1
done
echo "vnc did not start" >&2
exit 1
