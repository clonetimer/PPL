#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
bash INSTALL_PRODUCT.sh >/dev/null
node --env-file-if-exists=.env tools/r4-qualify-execution.mjs "$@"
