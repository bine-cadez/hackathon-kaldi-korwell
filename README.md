# Document library

Hackathon v1 of an internal document library. Someone pastes or uploads a text or markdown note. On save the app chunks it, calls OpenRouter for embeddings, stores the document and chunks in Cloudflare D1, and stores the vectors in Cloudflare Vectorize. Search embeds the query and returns the closest chunks with the source document title.

Chat is not in this version. Nothing is embedded until a person uploads it.

This build has **no authentication**. `public/robots.txt` disallows every crawler, and every response sends `X-Robots-Tag: noindex, nofollow`. That only asks crawlers to stay away. Production should sit behind [Cloudflare Access](https://developers.cloudflare.com/workers/configuration/cloudflare-access/) before anyone shares the URL. A `workers.dev` hostname is public until Access is on.

## Stack

- Nuxt 4 (current stable) on Nitro's `cloudflare_module` preset (Cloudflare Workers)
- D1 (`DB`) for documents and chunks
- Vectorize (`VECTORIZE`) for chunk vectors
- R2 (`BLOB`) optional, for a raw copy of the uploaded text
- Embeddings: OpenRouter [`openai/text-embedding-3-small`](https://openrouter.ai/openai/text-embedding-3-small), 1536 dimensions, cosine distance ([Embeddings API](https://openrouter.ai/docs/api/api-reference/embeddings/submit-an-embedding-request))

Wrangler config lives in `wrangler.jsonc` (same bindings you would put in `wrangler.toml`). Nuxt's Cloudflare preset merges that file at build time.

## Local run

```bash
npm install
cp .env.example .env
# put your OpenRouter key in .env (and the same line in .dev.vars if you use wrangler dev)
npm run dev
```

Open `http://localhost:3000`.

Without a key, save and search return 503. For a click-through of chunking and search only, set `EMBEDDINGS_FIXTURE=1` in `.env` and restart `npm run dev`. That flag is ignored in the production build. It does not call OpenRouter. Real embeddings require `OPENROUTER_API_KEY`.

`npm run dev` uses Nitro's Cloudflare dev emulation (Miniflare). D1 and R2 are local. **Vectorize has no local simulator** in current Wrangler (the binding is remote-only), so dev search ranks the embedding JSON stored on each D1 chunk. The deployed Worker upserts and queries Vectorize. Set `VECTORIZE_REMOTE=true` in `.env` only when you want `nuxt dev` to call your real index as well (requires `wrangler login` and the index from the next section).

The first request creates tables if they are missing. You can also apply the migration explicitly:

```bash
npm run db:migrate:local
```

Preview the production Worker bundle locally (after a build):

```bash
cp .dev.vars.example .dev.vars
npm run build
npm run preview
```

Tests (chunking, embedding response parsing, schema drift):

```bash
npm test
```

## Required secret

| Name | Where |
| --- | --- |
| `OPENROUTER_API_KEY` | `.env` for `npm run dev`. `.dev.vars` for `wrangler dev`. Production: `npx wrangler secret put OPENROUTER_API_KEY` |

Do not commit the key. Do not put it in `wrangler.jsonc`. Placeholders only live in `.env.example` and `.dev.vars.example`.

`NUXT_OPENROUTER_API_KEY` is also read if you set it, but the Worker secret should be named `OPENROUTER_API_KEY`.

## Create D1, Vectorize, and optional R2

Log in once: `npx wrangler login`.

One-shot helper (stops if a create command fails, for example if the name already exists):

```bash
npm run cf:provision
```

Or run the commands yourself:

```bash
npx wrangler d1 create doc-library
npx wrangler vectorize create doc-chunks --dimensions=1536 --metric=cosine
npx wrangler r2 bucket create doc-library
```

After `d1 create`, copy the printed `database_id` into `wrangler.jsonc` → `d1_databases[0].database_id`. The committed value `00000000-0000-0000-0000-000000000000` is a placeholder so the repo does not invent an account id.

Vectorize dimensions must stay **1536**. That is the default size of `openai/text-embedding-3-small` and the maximum Vectorize dimension. The index is cosine, which matches the model's normalized embeddings.

R2 is optional. The raw markdown is always stored on the D1 `documents.body` column. If the `BLOB` binding is missing, or the bucket put fails, the upload still keeps the D1 rows and vectors. To skip R2 entirely, remove the `r2_buckets` entry from `wrangler.jsonc`.

Apply the remote migration before the first deploy (the Worker also runs `CREATE TABLE IF NOT EXISTS` on demand):

```bash
npm run db:migrate:remote
```

## Cloudflare Access

Put the deployed Worker behind Access. This repo does not turn Access on in code. There is no account-agnostic Access setting in `wrangler.jsonc` (a comment there points at the dashboard).

After the Worker is deployed (`npm run deploy` or the GitHub Action):

1. In the Cloudflare dashboard, open **Workers & Pages** and select the `doc-library` Worker.
2. Open the **Access** tab, or **Settings** → **Domains & Routes**.
3. Protect this Worker and choose **all traffic** (production and previews).
4. Allow your team (Cloudflare account membership, specific emails, or an email domain).

Zero Trust has to be enabled on the account first. Access runs before the Worker, so the app does not validate a JWT.

`public/robots.txt` is `Disallow: /` for every user agent. Worker responses (pages, API, errors) set `X-Robots-Tag: noindex, nofollow` in `server/middleware/robots-tag.ts` and in Nuxt `routeRules`. Static files such as the favicon and built assets are served by Cloudflare without entering the Worker, so `public/_headers` sets the same header on those responses.

## Deploy

`.github/workflows/ci.yml` installs, tests, and builds on every push and pull request. It does not deploy.

`.github/workflows/deploy.yml` deploys the `doc-library` Worker on push to `main` and from the Actions tab (`workflow_dispatch`). It runs `npm ci`, `npm test`, and `npm run build`, applies remote D1 migrations, then `wrangler deploy --cwd .output --keep-vars`. It does not run `npm run cf:provision`.

### GitHub secrets

Add these in the GitHub repo under **Settings → Secrets and variables → Actions**:

| Secret | Value |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | Cloudflare API token. Use the **Edit Cloudflare Workers** template (Workers Scripts Edit). Also add **Account → D1 → Edit** so migrations can write. Scope the token to this account. |
| `CLOUDFLARE_ACCOUNT_ID` | The account id from the Workers dashboard overview. [How to find it](https://developers.cloudflare.com/fundamentals/account/find-account-and-zone-ids/). |

Do not add `OPENROUTER_API_KEY` as a GitHub secret for this workflow. The deploy does not pass Wrangler's secret-upload input. `--keep-vars` leaves dashboard variables in place, and Wrangler does not delete Worker secrets on deploy.

### One-time setup before the first green deploy

The workflow only uploads code and applies migrations. Create the resources and the Worker secret once, from a machine logged in with `npx wrangler login`:

```bash
npm run cf:provision
```

Then:

1. Paste the real D1 `database_id` over `00000000-0000-0000-0000-000000000000` in `wrangler.jsonc` and commit that change to `main`. The placeholder id will not deploy.
2. `npx wrangler secret put OPENROUTER_API_KEY` (once; later deploys leave it in place).
3. Merge this workflow to `main`, with the two GitHub secrets set. The next push to `main` (or a manual run) applies `migrations/0001_init.sql` if it is not already applied, then deploys.

You can still deploy by hand with `npm run db:migrate:remote` and `npm run deploy` (`nuxt build && wrangler --cwd .output deploy`). Nitro writes the Worker entry into `.output/server/wrangler.json`. Migrations stay on the root config because `.output` does not contain `migrations/`.

Cloudflare Access is still a dashboard step after deploy. See the section above. The workflow does not enable it.

New vectors can take a few seconds to show up in search. Vectorize applies inserts asynchronously.

## What the app does

1. `POST /api/documents` with JSON `{ "title", "body" }` or multipart fields `title` and `file` (or `body`).
2. Split the body into chunks of about 1200 characters (max 48 chunks, max ~200k characters).
3. `POST https://openrouter.ai/api/v1/embeddings` with `openai/text-embedding-3-small` and `dimensions: 1536`.
4. Insert the document and chunks into D1, including the embedding JSON on `chunks.embedding` (this is what local dev searches). Upsert vectors into Vectorize (id = chunk id, metadata = document id, title, chunk index), except in local dev unless `VECTORIZE_REMOTE=true`. Best-effort copy of the raw text to R2 at `documents/<id>.md`.
5. `POST /api/search` with `{ "query", "topK"? }` embeds the query. Deployed Workers run `VECTORIZE.query` and join the hit ids back to D1. Local dev ranks the stored D1 embeddings with cosine similarity. Either way the response includes chunk text and the source title.

Other routes: `GET /api/documents`, `GET /api/documents/:id`, `DELETE /api/documents/:id`, `GET /api/health`.

## Layout

```
.github/workflows/deploy.yml   push to main deploys the Worker
wrangler.jsonc          D1, Vectorize, optional R2 bindings
public/robots.txt       disallow every crawler
public/_headers         X-Robots-Tag on static assets
migrations/0001_init.sql
server/api/             upload, list, search
server/middleware/      X-Robots-Tag on Worker responses
server/utils/           chunk, OpenRouter embeddings, D1/Vectorize writes
app/pages/index.vue     paste/upload and search UI
```
