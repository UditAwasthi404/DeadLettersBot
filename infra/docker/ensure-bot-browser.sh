#!/usr/bin/env bash
set -euo pipefail

bot_id="${1:-}"
if [[ ! "$bot_id" =~ ^[0-9a-fA-F-]{36}$ ]]; then
  echo "invalid bot id" >&2
  exit 2
fi

state_dir="$HOME/.agentos/browsers"
mkdir -p "$state_dir" /tmp/.X11-unix
chmod 1777 /tmp/.X11-unix 2>/dev/null || true
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

# Modern Chromium only binds CDP to 127.0.0.1. Detect a 0.0.0.0 listener via /proc.
listening_on_all_interfaces() {
  local hex
  hex=$(printf '%04X' "$1")
  awk -v h="$hex" 'BEGIN{h=toupper(h)} $2 ~ ("^00000000:" h "$") { found=1 } END { exit !found }' /proc/net/tcp 2>/dev/null
}

display_alive() {
  local d="$1"
  [[ "$d" =~ ^[0-9]+$ ]] || return 1
  DISPLAY=":$d" xdpyinfo >/dev/null 2>&1
}

cdp_ready() {
  # Prefer curl so this works even when the VM image has no Node binary.
  local body=""
  if command -v curl >/dev/null 2>&1; then
    body=$(curl -fsS --max-time 1 "http://127.0.0.1:$1/json/version" 2>/dev/null || true)
  elif command -v node >/dev/null 2>&1; then
    body=$(node - "http://127.0.0.1:$1/json/version" <<'NODE' 2>/dev/null || true
const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 500);
fetch(process.argv[2], { signal: controller.signal })
  .then(async (response) => {
    const text = await response.text();
    clearTimeout(timeout);
    if (!response.ok) process.exit(1);
    process.stdout.write(text);
  })
  .catch(() => {
    clearTimeout(timeout);
    process.exit(1);
  });
NODE
)
  else
    # Chromium DevTools rejects HTTP/1.0; always speak HTTP/1.1.
    body=$(timeout 1 bash -c "exec 3<>/dev/tcp/127.0.0.1/$1; printf 'GET /json/version HTTP/1.1\r\nHost: 127.0.0.1:$1\r\nConnection: close\r\n\r\n' >&3; cat <&3" 2>/dev/null || true)
  fi
  [[ "$body" == *'"Browser"'* && "$body" == *'webSocketDebuggerUrl'* ]]
}

mapping_claims() {
  local value="$1"
  for file in "$state_dir"/[0-9a-fA-F-]*; do
    [[ -f "$file" ]] || continue
    [[ "$(basename "$file")" == *.* ]] && continue
    read -r mapped_port mapped_display < "$file" || true
    if [[ "$value" == "$mapped_port" || "$value" == "$mapped_display" ]]; then
      return 0
    fi
  done
  return 1
}

start_cdp_proxy() {
  local listen_port="$1"
  local target_port="$2"
  local pid_file="$state_dir/cdp-proxy-$bot_id.pid"
  if [[ -r "$pid_file" ]] && kill -0 "$(cat "$pid_file")" 2>/dev/null && listening_on_all_interfaces "$listen_port"; then
    return 0
  fi
  # Chromium 109+ ignores --remote-debugging-address and stays on localhost.
  # Expose CDP to the account bridge with a tiny Perl TCP proxy (perl is in the VM image).
  nohup perl - "$listen_port" "$target_port" <<'PERL' >"$state_dir/cdp-proxy-$bot_id.log" 2>&1 9>&- &
use strict;
use warnings;
use IO::Socket::INET;
use IO::Select;
$SIG{CHLD} = "IGNORE";
my ($listen_port, $target_port) = @ARGV;
my $server = IO::Socket::INET->new(
  LocalAddr => "0.0.0.0",
  LocalPort => $listen_port,
  Proto => "tcp",
  ReuseAddr => 1,
  Listen => 64,
) or die "listen $listen_port: $!";
while (my $client = $server->accept()) {
  my $pid = fork();
  if (!defined $pid) { close $client; next; }
  if ($pid == 0) {
    my $upstream = IO::Socket::INET->new(
      PeerAddr => "127.0.0.1",
      PeerPort => $target_port,
      Proto => "tcp",
      Timeout => 5,
    );
    exit 1 unless $upstream;
    my $sel = IO::Select->new($client, $upstream);
    while (1) {
      my @ready = $sel->can_read(30);
      last unless @ready;
      for my $sock (@ready) {
        my $other = $sock == $client ? $upstream : $client;
        my $buf = "";
        my $n = sysread($sock, $buf, 65536);
        exit 0 if !defined $n || $n == 0;
        syswrite($other, $buf) or exit 0;
      }
    }
    exit 0;
  }
  close $client;
}
PERL
  echo $! >"$pid_file"
  for _ in $(seq 1 50); do
    listening_on_all_interfaces "$listen_port" && return 0
    sleep 0.1
  done
  return 1
}

# Drop stale mapping left after a Docker/VM restart (socket file can outlive Xvfb).
if [[ "$port" =~ ^[0-9]+$ && "$display" =~ ^[0-9]+$ ]] && ! display_alive "$display"; then
  rm -f "/tmp/.X11-unix/X$display"
  port=""
  display=""
fi

if [[ ! "$port" =~ ^[0-9]+$ || ! "$display" =~ ^[0-9]+$ ]]; then
  for candidate in $(seq 9223 9999); do
    if ! port_open "$candidate" && ! port_open "$((candidate + 10000))" && ! mapping_claims "$candidate"; then
      port="$candidate"
      break
    fi
  done
  if [[ -z "$port" ]]; then
    echo "no free browser debugging ports" >&2
    exit 1
  fi
  for candidate in $(seq 100 899); do
    if { [[ ! -e "/tmp/.X11-unix/X$candidate" ]] || ! display_alive "$candidate"; } && ! mapping_claims "$candidate"; then
      display="$candidate"
      rm -f "/tmp/.X11-unix/X$candidate"
      break
    fi
  done
  if [[ -z "$display" ]]; then
    echo "no free Xvfb displays" >&2
    exit 1
  fi
  printf '%s %s\n' "$port" "$display" > "$mapping"
fi

# Chromium stays on localhost; the returned port is the LAN-facing proxy.
local_port=$((port + 10000))

flock -u 9
exec 9>&-
exec 8>"$state_dir/$bot_id.lock"
flock 8

if ! display_alive "$display"; then
  rm -f "/tmp/.X11-unix/X$display"
  nohup Xvfb ":$display" -screen 0 1280x800x24 -nolisten tcp \
    >"$state_dir/xvfb-$bot_id.log" 2>&1 9>&- &
  for _ in $(seq 1 50); do
    display_alive "$display" && break
    sleep 0.1
  done
fi

if ! display_alive "$display"; then
  echo "Xvfb did not open display :$display" >&2
  exit 1
fi

chromium_bin="chromium"
if [[ -x /usr/lib/chromium/chromium ]]; then
  chromium_bin=/usr/lib/chromium/chromium
elif [[ -x /usr/local/bin/chromium ]]; then
  chromium_bin=/usr/local/bin/chromium
fi

if ! cdp_ready "$local_port"; then
  # If an older ensure left Chromium on the public port, free it before proxying.
  if cdp_ready "$port" && ! cdp_ready "$local_port"; then
    pkill -f "--remote-debugging-port=$port" 2>/dev/null || true
    sleep 0.3
  fi
  nohup env DISPLAY=":$display" "$chromium_bin" \
    --no-sandbox \
    --disable-dev-shm-usage \
    --disable-gpu \
    --remote-debugging-port="$local_port" \
    --remote-allow-origins='*' \
    --user-data-dir="$state_dir/profile-$bot_id" \
    about:blank >"$state_dir/chromium-$bot_id.log" 2>&1 9>&- &
fi

for _ in $(seq 1 100); do
  cdp_ready "$local_port" && break
  sleep 0.1
done

if ! cdp_ready "$local_port"; then
  echo "Chromium did not open its CDP port $local_port" >&2
  exit 1
fi

if ! start_cdp_proxy "$port" "$local_port"; then
  echo "CDP proxy did not listen on 0.0.0.0:$port" >&2
  exit 1
fi

flock -u 8
exec 8>&-
printf '%s\n' "$port"
exit 0
