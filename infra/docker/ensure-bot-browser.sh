#!/usr/bin/env bash
set -euo pipefail

bot_id="${1:-}"
if [[ ! "$bot_id" =~ ^[0-9a-fA-F-]{36}$ ]]; then
  echo "invalid bot id" >&2
  exit 2
fi

state_dir="$HOME/.agentos/browsers"
mkdir -p "$state_dir"
exec 9>"$state_dir/allocate.lock"
flock 9

mapping="$state_dir/$bot_id"
port=""
display=""
if [[ -r "$mapping" ]]; then
  read -r port display < "$mapping"
fi

port_open() {
  (exec 3<>"/dev/tcp/127.0.0.1/$1") >/dev/null 2>&1
}

mapping_claims() {
  local value="$1"
  for file in "$state_dir"/[0-9a-fA-F-]*; do
    [[ -f "$file" ]] || continue
    read -r mapped_port mapped_display < "$file" || true
    if [[ "$value" == "$mapped_port" || "$value" == "$mapped_display" ]]; then
      return 0
    fi
  done
  return 1
}

if [[ ! "$port" =~ ^[0-9]+$ || ! "$display" =~ ^[0-9]+$ ]]; then
  for candidate in $(seq 9223 9999); do
    if ! port_open "$candidate" && ! mapping_claims "$candidate"; then
      port="$candidate"
      break
    fi
  done
  if [[ -z "$port" ]]; then
    echo "no free browser debugging ports" >&2
    exit 1
  fi
  for candidate in $(seq 100 899); do
    if [[ ! -e "/tmp/.X11-unix/X$candidate" ]] && ! mapping_claims "$candidate"; then
      display="$candidate"
      break
    fi
  done
  if [[ -z "$display" ]]; then
    echo "no free Xvfb displays" >&2
    exit 1
  fi
  printf '%s %s\n' "$port" "$display" > "$mapping"
fi

flock -u 9
exec 9>&-

if [[ ! -e "/tmp/.X11-unix/X$display" ]]; then
  nohup Xvfb ":$display" -screen 0 1280x800x24 -nolisten tcp \
    >"$state_dir/xvfb-$bot_id.log" 2>&1 9>&- &
fi

if ! port_open "$port"; then
  nohup env DISPLAY=":$display" chromium \
    --no-sandbox \
    --disable-dev-shm-usage \
    --disable-gpu \
    --remote-debugging-port="$port" \
    --remote-debugging-address=0.0.0.0 \
    --user-data-dir="$state_dir/profile-$bot_id" \
    about:blank >"$state_dir/chromium-$bot_id.log" 2>&1 9>&- &
fi

for _ in $(seq 1 100); do
  if port_open "$port"; then
    printf '%s\n' "$port"
    exit 0
  fi
  sleep 0.1
done

echo "Chromium did not open its CDP port $port" >&2
exit 1
