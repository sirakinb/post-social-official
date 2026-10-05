#!/usr/bin/env bash
# Bundles the CLI into one file with no dependencies: cli/dist/postsocial.mjs
set -euo pipefail
cd "$(dirname "$0")/.."
rm -rf cli/dist && mkdir -p cli/dist
npx esbuild cli/src/main.ts --bundle --platform=node --target=node20 --format=esm \
  --banner:js="#!/usr/bin/env node" --log-level=warning --outfile=cli/dist/postsocial.mjs
chmod +x cli/dist/postsocial.mjs
echo "Built cli/dist/postsocial.mjs ($(wc -c < cli/dist/postsocial.mjs | tr -d ' ') bytes)"
