#!/usr/bin/env bash
# Bundles the worker into worker/dist (one ESM file plus the container's package.json).
set -euo pipefail
cd "$(dirname "$0")/.."
rm -rf worker/dist && mkdir -p worker/dist
npx esbuild worker/src/index.ts --bundle --platform=node --target=node24 --format=esm \
  --banner:js="import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" \
  --external:mediainfo.js --log-level=warning --outfile=worker/dist/worker.mjs
# mediainfo.js loads a WebAssembly file at runtime, so it is installed in the container
# (worker/package.json) instead of bundled; bundling picks its browser build.
cp worker/package.json worker/dist/
echo "Built worker/dist ($(du -sh worker/dist | cut -f1))"
