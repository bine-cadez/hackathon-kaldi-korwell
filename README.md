# Document library

Hackathon v1 of an internal document library. Someone pastes or uploads a text or markdown note. On save the app chunks it, calls OpenRouter for embeddings, stores the document and chunks in Cloudflare D1, and stores the vectors in Cloudflare Vectorize. Search embeds the query and returns the closest chunks with the source document title.

Chat is not in this version. Nothing is embedded until a person uploads it.

A shared password (`SITE_PASSWORD`) locks HTML pages and the data APIs when it is set. Leave it unset and the app stays open, which is the local/dev default. `GET /api/health` stays public either way. `public/robots.txt` disallows every crawler, and every response sends `X-Robots-Tag: noindex, nofollow`. [Cloudflare Access](https://developers.cloudflare.com/workers/configuration/cloudflare-access/) can replace this gate later. This repo does not enable Access. A `workers.dev` hostname is reachable until one of those gates is on.

## Stack

- Nuxt 4 (current stable) on Nitro's `cloudflare_module` preset (Cloudflare Workers)
- D1 (`DB`) for documents and chunks
- Vectorize (`VECTORIZE`) for chunk vectors
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

`npm run dev` uses Nitro's Cloudflare dev emulation (Miniflare). D1 is local. **Vectorize has no local simulator** in current Wrangler (the binding is remote-only), so dev search ranks the embedding JSON stored on each D1 chunk. The deployed Worker upserts and queries Vectorize. Set `VECTORIZE_REMOTE=true` in `.env` only when you want `nuxt dev` to call your real index as well (requires `wrangler login` and the index from the next section).

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

| Name                 | Where                                                                                                              |
| -------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `OPENROUTER_API_KEY` | `.env` for `npm run dev`. `.dev.vars` for `wrangler dev`. Production: `npx wrangler secret put OPENROUTER_API_KEY` |
| `SITE_PASSWORD`      | Optional. Empty = unlocked. Same files for local. Production: `npx wrangler secret put SITE_PASSWORD`             |
| `MCP_SIGNING_KEY`    | Signs MCP OAuth tokens. At least 32 characters. Empty disables `/mcp`. Production: `npx wrangler secret put MCP_SIGNING_KEY` |

Do not commit the key. Do not put it in `wrangler.jsonc`. Placeholders only live in `.env.example` and `.dev.vars.example`.

`NUXT_OPENROUTER_API_KEY` is also read if you set it, but the Worker secret should be named `OPENROUTER_API_KEY`.

## Shared password

Do not commit the password. Do not put it in `wrangler.jsonc` or in GitHub Actions secrets. The deploy workflow does not upload it, and `--keep-vars` leaves an existing Worker secret in place.

| `SITE_PASSWORD` | Behavior |
| --------------- | -------- |
| Unset or empty  | Unlocked. This is the local/dev default. |
| Set             | HTML pages, `POST /api/documents`, `POST /api/search`, and the other document list/get/delete routes return **401** until the caller unlocks. `GET /api/health` stays public and reports `auth: "password"` or `auth: "open"`. |

The browser shows a password form on the first visit. A correct password sets an HttpOnly `site_auth` cookie (30 days). API clients send the same password as `Authorization: Bearer <password>` or `X-Site-Password: <password>`.

```bash
npx wrangler secret put SITE_PASSWORD
```

For `npm run dev`, set `SITE_PASSWORD` in `.env`. For `npm run preview`, set it in `.dev.vars`. Cloudflare Access can replace this in-app gate once Zero Trust is enabled on the account.

## Create D1, Vectorize,

Log in once: `npx wrangler login`.

One-shot helper (stops if a create command fails, for example if the name already exists):

```bash
npm run cf:provision
```

Or run the commands yourself:

```bash
npx wrangler d1 create doc-library
npx wrangler vectorize create doc-chunks --dimensions=1536 --metric=cosine
```

After `d1 create`, copy the printed `database_id` into `wrangler.jsonc` → `d1_databases[0].database_id`. The committed value `00000000-0000-0000-0000-000000000000` is a placeholder so the repo does not invent an account id.

Vectorize dimensions must stay **1536**. That is the default size of `openai/text-embedding-3-small` and the maximum Vectorize dimension. The index is cosine, which matches the model's normalized embeddings.

Apply the remote migration before the first deploy (the Worker also runs `CREATE TABLE IF NOT EXISTS` on demand):

```bash
npm run db:migrate:remote
```

## Cloudflare Access

The shared password above is the lock for this hackathon build. Access can replace it later. This repo does not turn Access on in code. There is no account-agnostic Access setting in `wrangler.jsonc` (a comment there points at the dashboard).

After the Worker is deployed (`npm run deploy` or the GitHub Action):

1. In the Cloudflare dashboard, open **Workers & Pages** and select the `doc-library` Worker.
2. Open the **Access** tab, or **Settings** → **Domains & Routes**.
3. Protect this Worker and choose **all traffic** (production and previews).
4. Allow your team (Cloudflare account membership, specific emails, or an email domain).

Zero Trust has to be enabled on the account first. Access runs before the Worker, so the app does not validate a JWT.

`public/robots.txt` is `Disallow: /` for every user agent. Worker responses (pages, API, errors) set `X-Robots-Tag: noindex, nofollow` in `server/middleware/robots-tag.ts` and in Nuxt `routeRules`. Static files such as the favicon and built assets are served by Cloudflare without entering the Worker, so `public/_headers` sets the same header on those responses.

## Deploy

`.github/workflows/ci.yml` installs, tests, and builds on every push and pull request. It does not deploy.

`.github/workflows/deploy.yml` deploys the `doc-library` Worker on push to `main` and from the Actions tab (`workflow_dispatch`). It runs `npm ci`, `npm test`, and `npm run build`, applies remote D1 migrations, then `wrangler deploy --cwd .output --keep-vars`. It does not run `npm run cf:provision`. Production is [doc-library.binec.workers.dev](https://doc-library.binec.workers.dev).

## Pull request previews

`.github/workflows/preview.yml` runs on pull requests opened, updated, or reopened from a branch **in this repository**. It builds `.output` and runs:

```bash
wrangler versions upload --cwd .output --keep-vars --preview-alias pr-<number>
```

Wrangler is pinned to **4.158.0**, the same version as `deploy.yml`. The command uploads a Worker **version**. It does not deploy that version to production traffic, and it does not run `wrangler versions deploy`. [doc-library.binec.workers.dev](https://doc-library.binec.workers.dev) stays on the version `deploy.yml` last deployed.

The stable preview hostname is:

```text
https://pr-<number>-doc-library.binec.workers.dev
```

`<number>` is the pull request number. Wrangler prints this as `Version Preview Alias URL`. The workflow posts that URL in one pull request comment and updates the same comment on later runs (HTML marker `<!-- doc-library-preview -->`). Each upload also gets a one-off version URL (`https://<version-prefix>-doc-library.binec.workers.dev`); the comment uses the alias, which keeps pointing at the latest upload for that PR.

Fork pull requests are skipped. GitHub does not pass `CLOUDFLARE_API_TOKEN` or `CLOUDFLARE_ACCOUNT_ID` to workflows from forks, so the job never starts.

This is not [`wrangler preview`](https://developers.cloudflare.com/workers/previews/) (Wrangler's separate branch environments). Those previews do not inherit production bindings or secrets. This repo uses an aliased [Version URL](https://developers.cloudflare.com/workers/versions-and-deployments/version-urls/) so the uploaded code runs with the production configuration. See [Compare workflows](https://developers.cloudflare.com/workers/previews/compare-workflows/).

### Shared production data

Preview versions use the **production** resources. There is no separate database, index, or secret:

| Resource | Preview behavior |
| --- | --- |
| D1 `DB` (`doc-library`) | Same database as production. The preview workflow does **not** run migrations. |
| Vectorize `VECTORIZE` (`doc-chunks`) | Same index as production. |
| `OPENROUTER_API_KEY`, `SITE_PASSWORD` | Inherited from the current Worker version. The workflow does not upload, replace, or delete secrets, and it does not set the Wrangler action `secrets` input. `--keep-vars` leaves dashboard vars in place. |

Saving or deleting a document on a preview URL writes production D1 and Vectorize. Search calls OpenRouter with the production key. If `SITE_PASSWORD` is set on the Worker, the preview asks for that same password. The preview hostname is still public; the password (or Cloudflare Access, if you turn it on for all traffic) is what locks it.

### One-time: Version URLs

`preview_urls: true` in `wrangler.jsonc` turns on workers.dev Version URLs. `versions upload` does not apply that flag. The next production deploy does. If Version URLs are already enabled (the default when this Worker's `workers.dev` route is on), previews work before that deploy.

If the preview job uploads a version but fails with "did not print a Version Preview Alias URL", enable them once:

1. Cloudflare dashboard → **Workers & Pages** → **doc-library** → **Settings** → **Domains & Routes**.
2. **Version URLs** → **Enable**.

No new GitHub secrets. The preview workflow uses the same `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` as deploy. The token needs **Workers Scripts: Edit** (the **Edit Cloudflare Workers** template). It does not need D1 edit for previews, because this workflow does not migrate.

### GitHub secrets

Add these in the GitHub repo under **Settings → Secrets and variables → Actions**:

| Secret                  | Value                                                                                                                                                                                 |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CLOUDFLARE_API_TOKEN`  | Cloudflare API token. Use the **Edit Cloudflare Workers** template (Workers Scripts Edit). Also add **Account → D1 → Edit** so migrations can write. Scope the token to this account. |
| `CLOUDFLARE_ACCOUNT_ID` | The account id from the Workers dashboard overview. [How to find it](https://developers.cloudflare.com/fundamentals/account/find-account-and-zone-ids/).                              |

Do not add `OPENROUTER_API_KEY` or `SITE_PASSWORD` as GitHub secrets. Neither workflow passes Wrangler's secret-upload input. `--keep-vars` leaves dashboard variables in place, and Wrangler does not delete Worker secrets on deploy or on `versions upload`.

### One-time setup before the first green deploy

The deploy workflow only uploads code and applies migrations. Create the resources and the Worker secret once, from a machine logged in with `npx wrangler login`:

```bash
npm run cf:provision
```

Then:

1. Paste the real D1 `database_id` over `00000000-0000-0000-0000-000000000000` in `wrangler.jsonc` and commit that change to `main`. The placeholder id will not deploy.
2. `npx wrangler secret put OPENROUTER_API_KEY` and, to lock the site, `npx wrangler secret put SITE_PASSWORD` (once; later deploys leave both in place). Skip `SITE_PASSWORD` only when this copy should stay open.
3. Merge this workflow to `main`, with the two GitHub secrets set. The next push to `main` (or a manual run) applies `migrations/0001_init.sql` if it is not already applied, then deploys.

You can still deploy by hand with `npm run db:migrate:remote` and `npm run deploy` (`nuxt build && wrangler --cwd .output deploy`). Nitro writes the Worker entry into `.output/server/wrangler.json`. Migrations stay on the root config because `.output` does not contain `migrations/`.

Cloudflare Access is still a dashboard step after deploy. See the section above. The workflow does not enable it.

New vectors can take a few seconds to show up in search. Vectorize applies inserts asynchronously.

## What the app does

1. `POST /api/documents` with JSON `{ "title", "body" }` or multipart fields `title` and `file` (or `body`).
2. Split the body into chunks of about 1200 characters (max 48 chunks, max ~200k characters).
3. `POST https://openrouter.ai/api/v1/embeddings` with `openai/text-embedding-3-small` and `dimensions: 1536`.
4. Insert the document and chunks into D1, including the embedding JSON on `chunks.embedding` (this is what local dev searches). Upsert vectors into Vectorize (id = chunk id, metadata = document id, title, chunk index), except in local dev unless `VECTORIZE_REMOTE=true`.
5. `POST /api/search` with `{ "query", "topK"? }` embeds the query. Deployed Workers run `VECTORIZE.query` and join the hit ids back to D1. Local dev ranks the stored D1 embeddings with cosine similarity. Either way the response includes chunk text and the source title.

Other routes: `GET /api/documents`, `GET /api/documents/:id`, `DELETE /api/documents/:id`, `GET /api/health`, and the MCP routes below. With `SITE_PASSWORD` set, direct calls to the document and search routes return 401 before any embedding request. Health stays public. `POST /api/auth/login` checks the password and sets the cookie.

## Layout

```
.github/workflows/deploy.yml    push to main deploys the Worker
.github/workflows/preview.yml   pull requests upload a preview version
wrangler.jsonc          D1, Vectorize, preview_urls
public/robots.txt       disallow every crawler
public/_headers         X-Robots-Tag on static assets
migrations/0001_init.sql
migrations/0004_mcp_used_codes.sql  single-use MCP authorization codes
server/api/             upload, list, search
server/routes/          MCP endpoint and OAuth authorize, token, register
server/middleware/      X-Robots-Tag, the shared-password gate, OAuth discovery
server/utils/           chunk, OpenRouter embeddings, D1/Vectorize writes, MCP tools
app/pages/index.vue     paste/upload and search UI
```

## Kaldi email sign-in with Cloudflare Access

Configure Cloudflare Access on a separate Worker with sample data for the
first test. Enable One-time PIN, allow the `kaldi.si` email domain, and protect
all traffic for that Worker. Do not use the PR preview that shares production
data for upload or delete testing.

Set these two variables on the test Worker's deployed version:

- `ACCESS_TEAM_DOMAIN`: the team's Cloudflare Access hostname, for example
  `https://example.cloudflareaccess.com`.
- `ACCESS_AUD`: the Application Audience (AUD) tag from the Access application
  that protects this Worker.

Cloudflare sends a signed assertion to the Worker after sign-in. Korwell
checks its signature, issuer, audience, expiration, and exact email domain.
It keeps the verified `sub` as the request's user ID and shows the signed-in
email in the header. No user records or upload credits are written in this phase.

With both settings blank, the existing shared-password behavior is used. A
partial or invalid Access configuration blocks protected requests. In Access
mode, the shared password and its cookies cannot unlock Korwell. Keep the
shared password available for rollback until the test passes.

On the test Worker, verify that a Kaldi mailbox can sign in, a personal address
cannot, and a signed-out visitor cannot call the document or search API. Then
apply Access to production and previews and set each deployment's audience to
the tag of the policy protecting it. Only retire `SITE_PASSWORD` after verifying
the live gate. No database migration is required.

## MCP for Claude and ChatGPT

`POST /mcp` is a read-only [Streamable HTTP](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports) endpoint on the same Worker. It adds one small D1 table, `mcp_used_codes` (`migrations/0004_mcp_used_codes.sql`), so each authorization code works once. The token endpoint also creates it on first use, because PR previews share the production D1 but do not run migrations.

| Tool | What it does |
| --- | --- |
| `search` | Semantic search. `query` is the argument ChatGPT sends. Optional `limit` (1–20, default 8), `from`, `to` (inclusive UTC `YYYY-MM-DD`), and `author`. A date or author can stand in for `query` once metadata search is deployed. Returns `{ "results": [{ "id", "title", "url" }] }` for ChatGPT deep research and company knowledge. |
| `fetch` | Full document text for one `id` from `search`. Returns `{ "id", "title", "text", "url", "metadata" }`. |
| `search_slack` | Omitted until the Slack archive is on `main` and this branch is rebased. See the comment in `server/utils/mcp-library.ts`. |

`search` calls `searchDocuments`. On current `main` that function ignores the filters object. After rebasing onto metadata search (#6), the same call applies `from`, `to`, and `author` (the function moves to `server/utils/search.ts`; update the import if the export moves). Chunk hits are collapsed to one result per document. The citation URL is `https://<host>/library?document=<id>`.

There are no write tools.

### Why OAuth, not a shared bearer token

Claude and ChatGPT connect from their own servers. They cannot complete the Cloudflare Access one-time PIN, and they cannot present the `site_auth` cookie. Claude's static request-header credential is a limited beta, and one shared bearer would not be tied to a person.

The Worker is its own OAuth 2.1 authorization server (authorization code + S256 PKCE, dynamic client registration, refresh tokens). `@cloudflare/workers-oauth-provider` is not used: it would have to own the Worker fetch handler, and it needs a KV namespace this app does not have. Tokens are HS256 JWTs signed with `MCP_SIGNING_KEY`. The only thing stored in D1 is the id of each redeemed authorization code, until shortly after it expires.

Lifetimes: an authorization code lasts 2 minutes, is useless without the PKCE verifier, and can be redeemed once. Access tokens last 1 hour. Refresh tokens get a new token on every use, but the whole chain ends 30 days after the person clicked Allow. Refreshing never moves that date, and the last access token is cut to end at the same time. After that the person approves again through Access.

Tradeoff: refresh tokens are not stored, so an earlier refresh token in the chain keeps working until that same 30-day end, and a token cannot be revoked on its own. **Removing someone from Cloudflare Access does not cut off a connector they already approved until their chain ends (at most 30 days after approval).** To cut everyone off immediately, set a new `MCP_SIGNING_KEY`.

Who may connect:

1. The browser step `GET /authorize` stays behind Cloudflare Access (or `SITE_PASSWORD` when Access is off). Only a Kaldi email that passes Access, or someone who knows the site password, can approve a client.
2. `/mcp` accepts only an access token from that approval. A missing or bad token is **401** with `WWW-Authenticate` pointing at the protected-resource metadata, which is what Claude and ChatGPT use to start sign-in.
3. If `MCP_SIGNING_KEY` is unset or shorter than 32 characters, `/mcp`, `/token`, `/register`, and `/authorize` return **503**. They do not fall open. If Access is half-configured (only one of `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD`), the MCP, OAuth, and discovery routes return **503** too, like `/api`.
4. Redirect URIs are allowlisted: `https://claude.ai/api/mcp/auth_callback`, `https://claude.com/api/mcp/auth_callback`, `https://chatgpt.com/connector_platform_oauth_redirect`, `https://chatgpt.com/connector/oauth/<id>`, and loopback `http://localhost` or `http://127.0.0.1` `/callback` (any port) for Claude Code. The consent page names the redirect host and warns on loopback. It sends `Referrer-Policy: same-origin` (so the browser sends a real `Origin` on Allow and Deny) and a CSP `form-action` of `'self'` plus the validated redirect origin (so the browser may follow the redirect back to the client).

Discovery (no token):

- `GET /.well-known/oauth-protected-resource`
- `GET /.well-known/oauth-protected-resource/mcp`
- `GET /.well-known/oauth-authorization-server`

The issuer and the `authorization_servers` entry are the site origin with no trailing slash. `resource` is that origin plus `/mcp`. Authorization responses include `iss` (RFC 9207), so ChatGPT can use the stable redirect URI. Client ID metadata documents are not advertised; both clients use dynamic registration.

### After merge

Do this in order. The repo cannot change Cloudflare Access for you. Deploy does not upload this secret (`--keep-vars` leaves it in place once set). Do not put it in GitHub Actions.

1. Generate a key and set it on the Worker (before opening the bypass, so a bypassed `/mcp` still returns 503):

   ```bash
   openssl rand -base64 32
   npx wrangler secret put MCP_SIGNING_KEY
   ```

2. In Cloudflare Zero Trust, add a **second** self-hosted Access application. Keep the existing Allow policy (One-time PIN, `kaldi.si`) on the hostname-wide app. The new app is more specific, so it wins for these paths only. Copy the same hostnames the current app covers: `doc-library.binec.workers.dev` and the preview host `*-doc-library.binec.workers.dev`.

   Paths (exact path, not a trailing `/*`, so the path itself matches; children inherit):

   - `/mcp`
   - `/.well-known`
   - `/token`
   - `/register`

   One policy on that application:

   | Action | Include |
   | --- | --- |
   | Bypass | Everyone |

   Do **not** add `/authorize`. That URL must keep asking for the Kaldi one-time PIN. A bypassed `/authorize` would let anyone mint a token.

3. Confirm the split:

   ```bash
   curl -sI https://doc-library.binec.workers.dev/mcp
   curl -sI https://doc-library.binec.workers.dev/authorize
   ```

   `/mcp` should be **401** from the Worker, with `WWW-Authenticate: Bearer ... resource_metadata=...`, not the Access login HTML. `/authorize` should still be the Access login.

4. `GET /api/health` includes `"mcp": true` when the key is long enough.

### Connect Claude

Custom connectors on claude.ai, Claude Desktop, and the Claude mobile apps all use the same callback.

1. Open [Claude](https://claude.ai) → **Customize** → **Connectors** → **Add custom connector**.
2. Server URL: `https://doc-library.binec.workers.dev/mcp` (no trailing slash).
3. Leave the OAuth client fields empty so Claude uses dynamic client registration.
4. Save. Claude opens `/authorize`. Sign in with the Kaldi one-time PIN if Access asks, then choose **Allow read access**.
5. In a chat, ask Claude to search the Korwell library. It should call `search`, then `fetch`.

Claude Code can use the same URL. Its redirect is `http://127.0.0.1:<port>/callback` or `http://localhost:<port>/callback`, which the consent page calls out before you allow it.

### Connect ChatGPT

ChatGPT developer mode and custom MCP connectors expect the tool names `search` and `fetch` and the result shapes above. Authentication is OAuth. The authorization server advertises `authorization_response_iss_parameter_supported`, so ChatGPT uses `https://chatgpt.com/connector_platform_oauth_redirect`. If the connector page shows a different redirect of the form `https://chatgpt.com/connector/oauth/<id>`, that form is allowlisted too.

1. In ChatGPT, enable **Developer mode** (Settings → Apps / Connectors, depending on the workspace).
2. Add a custom MCP server. Server URL: `https://doc-library.binec.workers.dev/mcp`.
3. Choose **OAuth**. Do not paste a client secret. ChatGPT registers a public client.
4. Approve the Access one-time PIN and the Korwell consent page when they open.
5. In a conversation, attach the connector (or start deep research / company knowledge) and ask a question that is answered by a document in the library. ChatGPT calls `search`, then `fetch`, and cites the `url` on each result.

A preview hostname (`https://pr-<number>-doc-library.binec.workers.dev/mcp`) uses the production signing key and the production database. The bypass app has to include that hostname or the preview stays behind Access and the connector cannot reach it. Do not use a preview to delete production documents.
