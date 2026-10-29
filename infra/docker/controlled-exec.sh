#!/usr/bin/env bash
set -euo pipefail

execution_id="${1:-}"
shift || true
if [[ ! "$execution_id" =~ ^[0-9a-fA-F-]{36}$ || "$#" -eq 0 ]]; then
  echo "invalid controlled execution request" >&2
  exit 2
fi

pid_file="/tmp/agentos-exec-$execution_id.pgid"
child_pid=""

stop_process_group() {
  trap - TERM INT HUP
  if [[ -s "$pid_file" ]]; then
    read -r process_group < "$pid_file" || true
    if [[ "$process_group" =~ ^[0-9]+$ ]]; then
      kill -TERM -- "-$process_group" 2>/dev/null || true
    fi
  elif [[ "$child_pid" =~ ^[0-9]+$ ]]; then
    kill -TERM "$child_pid" 2>/dev/null || true
  fi
  if [[ "$child_pid" =~ ^[0-9]+$ ]]; then wait "$child_pid" 2>/dev/null || true; fi
  rm -f "$pid_file"
  exit 143
}

trap stop_process_group TERM INT HUP
setsid bash -c 'pid_file="$1"; shift; printf "%s\n" "$$" > "$pid_file"; exec "$@"' \
  agentos-exec "$pid_file" "$@" &
child_pid=$!

for _ in $(seq 1 100); do
  [[ -s "$pid_file" ]] && break
  sleep 0.01
done

set +e
wait "$child_pid"
exit_code=$?
set -e
rm -f "$pid_file"
exit "$exit_code"
