#!/usr/bin/env bash
# Create the free-tier Cloudflare resources this app expects.
# Requires `npx wrangler login` (or CLOUDFLARE_API_TOKEN) on your machine.
# This script does not embed or print secret values.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "Creating D1 database 'doc-library'..."
npx wrangler d1 create doc-library
echo
echo "Copy the printed database_id into wrangler.jsonc (d1_databases[0].database_id)."
echo "The committed id is a placeholder and will not deploy."
echo

echo "Creating Vectorize index 'doc-chunks' (1536 dimensions, cosine)..."
echo "1536 matches OpenRouter model openai/text-embedding-3-small."
npx wrangler vectorize create doc-chunks \
  --dimensions=1536 \
  --metric=cosine \
  --description "Internal document chunk embeddings"
echo


echo "Creating optional R2 bucket 'doc-library' for raw text blobs..."
echo "Skip this command if you do not want R2, and remove r2_buckets from wrangler.jsonc."
npx wrangler r2 bucket create doc-library
echo
echo "Next:"
echo "  npx wrangler d1 migrations apply DB --remote"
echo "  npx wrangler secret put OPENROUTER_API_KEY"
echo "  npm run deploy"
