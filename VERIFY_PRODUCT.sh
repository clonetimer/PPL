#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
bash INSTALL_PRODUCT.sh >/dev/null
NODE_NO_WARNINGS=1 node tools/verify-product.mjs
