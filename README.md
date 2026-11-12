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

`.github/workflows/deploy.yml` deploys the `doc-library` Worker on push to `main` and from the Actions tab (`workflow_dispatch`). It runs `npm ci`, `npm test`, and `npm run build`, applies remote D1 migrations, then `wrangler deploy --cwd .output --keep-vars`. It does not run `npm run cf:provision`.

### GitHub secrets

Add these in the GitHub repo under **Settings → Secrets and variables → Actions**:

| Secret                  | Value                                                                                                                                                                                 |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CLOUDFLARE_API_TOKEN`  | Cloudflare API token. Use the **Edit Cloudflare Workers** template (Workers Scripts Edit). Also add **Account → D1 → Edit** so migrations can write. Scope the token to this account. |
| `CLOUDFLARE_ACCOUNT_ID` | The account id from the Workers dashboard overview. [How to find it](https://developers.cloudflare.com/fundamentals/account/find-account-and-zone-ids/).                              |

Do not add `OPENROUTER_API_KEY` as a GitHub secret for this workflow. The deploy does not pass Wrangler's secret-upload input. `--keep-vars` leaves dashboard variables in place, and Wrangler does not delete Worker secrets on deploy.

### One-time setup before the first green deploy

The workflow only uploads code and applies migrations. Create the resources and the Worker secret once, from a machine logged in with `npx wrangler login`:

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

Other routes: `GET /api/documents`, `GET /api/documents/:id`, `DELETE /api/documents/:id`, `GET /api/health`. With `SITE_PASSWORD` set, direct calls to the document and search routes return 401 before any embedding request. Health stays public. `POST /api/auth/login` checks the password and sets the cookie.

## Layout

```
.github/workflows/deploy.yml   push to main deploys the Worker
wrangler.jsonc          D1, Vectorize,
public/robots.txt       disallow every crawler
public/_headers         X-Robots-Tag on static assets
migrations/0001_init.sql
server/api/             upload, list, search
server/middleware/      X-Robots-Tag and the shared-password gate
server/utils/           chunk, OpenRouter embeddings, D1/Vectorize writes
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
