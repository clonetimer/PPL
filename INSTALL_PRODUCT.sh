#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
node -e "const [major,minor]=process.versions.node.split('.').map(Number); if(major<22 || (major===22 && minor<16)){console.error('PPL dev.5 product suite requires Node >=22.16 for node:sqlite'); process.exit(2)}"
npm ci --offline --ignore-scripts --no-audit --no-fund
printf '\nPPL product dependencies installed. Run: ./VERIFY_PRODUCT.sh\n'
