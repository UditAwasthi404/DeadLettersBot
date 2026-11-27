#!/bin/sh
set -eu

if [ "${AGENTOS_EGRESS_FIREWALL_HELPER:-0}" = "1" ]; then
  rm -f /run/agentos-egress-ready
fi

exec node /usr/local/bin/agentos-vm-entrypoint.mjs "$@"
