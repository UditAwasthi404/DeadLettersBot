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

cdp_ready() {
  node - "http://127.0.0.1:$1/json/version" <<'NODE'
const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 500);
fetch(process.argv[2], { signal: controller.signal })
  .then(async (response) => {
    const body = await response.json();
    clearTimeout(timeout);
    process.exit(response.ok && typeof body.Browser === "string" &&
      typeof body.webSocketDebuggerUrl === "string" ? 0 : 1);
  })
  .catch(() => {
    clearTimeout(timeout);
    process.exit(1);
  });
NODE
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
exec 8>"$state_dir/$bot_id.lock"
flock 8

if [[ ! -e "/tmp/.X11-unix/X$display" ]]; then
  nohup Xvfb ":$display" -screen 0 1280x800x24 -nolisten tcp \
    >"$state_dir/xvfb-$bot_id.log" 2>&1 9>&- &
  for _ in $(seq 1 50); do
    [[ -S "/tmp/.X11-unix/X$display" ]] && break
    sleep 0.1
  done
fi

if [[ ! -S "/tmp/.X11-unix/X$display" ]]; then
  echo "Xvfb did not open display socket $display" >&2
  exit 1
fi

if ! cdp_ready "$port"; then
  nohup env DISPLAY=":$display" chromium \
    --no-sandbox \
    --disable-dev-shm-usage \
    --disable-gpu \
    --force-device-scale-factor=1 \
    --window-position=0,0 \
    --window-size=1280,800 \
    --start-maximized \
    --ozone-platform=x11 \
    --disable-background-networking \
    --disable-sync \
    --disable-default-apps \
    --disable-extensions \
    --disable-renderer-backgrounding \
    --mute-audio \
    --no-first-run \
    --no-default-browser-check \
    --remote-debugging-port="$port" \
    --remote-debugging-address=0.0.0.0 \
    --user-data-dir="$state_dir/profile-$bot_id" \
    about:blank >"$state_dir/chromium-$bot_id.log" 2>&1 9>&- &
fi

for _ in $(seq 1 100); do
  if cdp_ready "$port"; then
    flock -u 8
    exec 8>&-
    printf '%s\n' "$port"
    exit 0
  fi
  sleep 0.1
done

echo "Chromium did not open its CDP port $port" >&2
exit 1
