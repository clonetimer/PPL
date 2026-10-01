#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
bash INSTALL_PRODUCT.sh >/dev/null
: "${PPL_EXECUTION_ENABLED:=1}"
export PPL_EXECUTION_ENABLED
node platform/execution/bin/live-probe.mjs
