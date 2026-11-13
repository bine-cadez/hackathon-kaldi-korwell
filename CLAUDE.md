# Project rules

## Tests: crucial behaviour only

`npm test` gates every production deploy, so the suite stays small and only covers things that would hurt us if they broke without anyone noticing.

Write a test only when a regression would cause one of these:

- **Security hole.** Auth or access bypass (site password, Cloudflare Access, MCP OAuth/PKCE, bearer tokens), forged Slack requests, XSS or unsafe links in rendered output, path traversal, or upstream error text leaking to clients.
- **Data loss or corruption.** Uploads half-written across R2 and D1, schema drift between migrations and runtime, non-idempotent Slack ingestion, deleted Slack messages being lost, or duplicates refusing legitimate uploads.
- **Silent break of a core flow.** Search returning nothing or ignoring Slovenian diacritics, the chat tool loop not finishing, MCP tool result shapes that Claude or ChatGPT depend on, or Worker/D1 limits during Slack backfill.

Do not write tests for:

- Small pure helpers, formatting, string building, or UI error copy.
- Every HTTP status code variant of an error path.
- Ranking tie-breaks or tuning that is checked by hand.
- Code paths that only run before a migration is applied. Deploy applies migrations before it ships the Worker.
- Behaviour that an existing end-to-end test already covers.

Prefer one test that drives the real flow over several unit tests of its parts. When you add a feature, add a test only if it matches the "write a test" list above. When a test stops guarding anything crucial, delete it.
