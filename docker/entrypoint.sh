#!/bin/sh
# The web server refuses the wildcard address, so bind the container's own address.
set -eu

address="$(hostname -i | awk '{print $1}')"
set -- --host "$address" --port 3080 --no-open
if [ -n "${CODO_PUBLIC_HOST:-}" ]; then
  set -- "$@" --trusted-host "$CODO_PUBLIC_HOST" --public-url "https://$CODO_PUBLIC_HOST/"
fi

exec node --import tsx/esm apps/cli/src/bin.ts web "$@"
