#!/bin/sh
set -eu

if [ "${AGENTOS_EGRESS_FIREWALL_HELPER:-0}" = "1" ]; then
  rm -f /run/agentos-egress-ready
fi

# Drop stale X11 sockets left from a previous container lifecycle so ensure-browser
# does not treat a dead socket as a live Xvfb display after Docker restarts.
mkdir -p /tmp/.X11-unix
chmod 1777 /tmp/.X11-unix 2>/dev/null || true
rm -f /tmp/.X11-unix/X* 2>/dev/null || true

exec node /usr/local/bin/agentos-vm-entrypoint.mjs "$@"
