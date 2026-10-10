# Agent Instructions

## Project Overview

This repository is a single Next.js 14 App Router application for viewing Shoptet order products, submitting eligible products to Kontri, and tracking Kontri order states. The application uses React 18, TypeScript, Firebase Firestore Lite, Tailwind CSS, and DaisyUI. Operational details and flow diagrams are in [docs/CODEBASE_MAP.md](docs/CODEBASE_MAP.md).

## Repository Layout

- `app/`: root layout, the order-list route, and the scheduled cron endpoint.
- `actions/`: Next.js server actions for feed processing, order submission, status checks, and mail notifications.
- `db/`: Firestore initialization and product reads/writes.
- `components/`: client-side order table, navigation, status control, and order detail modal.
- `types/`: Shoptet, Kontri, and Kontri response types.
- `utils/`: order conversion, date formatting, SOAP client, and notification helpers.
- `public/`: static web app assets.

## Development Commands

The repository has `package-lock.json` and no workspace configuration; use npm.
The project `.npmrc` selects `https://registry.npmjs.org/`. Never commit internal registry
URLs into the lockfile. Vercel uses Node.js 24 and `@types/node` major 24; the Docker
runtime is still separately configured in `Dockerfile`.

```sh
npm ci
npm run dev
npm run lint
npm run build
npm run start
```

Focused Vitest tests are available through `npm test -- <test paths>` for mapping, submission, status checks, and cron orchestration. There is no type-check script; use `./node_modules/.bin/tsc --noEmit`. The Docker image uses Node.js 20; use a compatible Node runtime.

The application reads these environment variables: `FIREBASE_API_KEY`, `SHOPTET_URL`, `SHOPTET_URL_SK`, `GCP_SERVER_ADDRESS`, `KONTRI_API_USER`, `KONTRI_API_PASSWORD`, `CRON_SECRET`, `SMTP_SERVER_USERNAME`, `SMTP_SERVER_PASSWORD`, and `SITE_MAIL_RECIEVER` (spelling as used in source). Supply values through the local/deployment environment; do not commit secrets or copy values into documentation.

## Implementation Conventions

- Keep UI in `components/` and App Router routes/layouts in `app/`.
- Put server-side workflows and externally invoked operations in `actions/`; place Firestore collection operations in `db/`, shared types in `types/`, and reusable transformations/integration clients in `utils/`.
- The UI imports asynchronous functions marked with `"use server"` directly. Preserve server/client boundaries and do not move credentials or external API clients into client components.
- Firestore data is stored in the `products` collection. Use the existing product key convention (`code + "_" + orderItemCode`) and the existing field/status conventions when changing persistence behavior.
- Use the `@/*` path alias configured in `tsconfig.json`; follow the existing TypeScript and double-quoted import style.
- Keep the scheduled workflow in `app/api/cron/route.ts` aligned with the Vercel schedule in `vercel.json` and its `Authorization: Bearer <CRON_SECRET>` check.

## Testing and Safety

- The Kontri cache uses `KONTRI_FEED_LOGIN` and `KONTRI_FEED_PASSWORD`, `fast-xml-parser`, versioned JSON chunks in `kontriMappings`, and a transactional pointer in `kontriMappingState/current`. See README for permissions and index configuration. The full Firestore SDK is also used for atomic order preparation and result persistence; ordinary product operations still use Lite.
- The manual Kontri feed button only updates the mapping cache. Order submission resolves IDs from the active cache and stores an immutable API ID/quantity/reference snapshot before POST. No daily cache schedule is enabled. Do not submit live orders or write production data merely to validate code.
- Reject variant-count drops greater than 25% before storage and inside the publication transaction; exactly 25% and the first import are allowed. Notify by email with both counts. Keep rejected publication distinct from unchanged content in UI results.
- The mapping preview remains read-only and diagnostic: submission uses the same resolver separately, never a client preview result. Resolve old API and new catalog IDs with EAN verification; conflicts and ambiguity must block matches. A match is not proof of retry safety or order eligibility.
- Prepare at most 450 products atomically, checking their current fields and unclaimed/new status. Preserve original codes and document IDs. Requests use `kontriApiId` and `kontriOrderedAmount`; no code fallback is permitted. Persist results with `persistKontriProducts`, verifying the reference and confirmed order identity.
- Look up uncertain/historical requests by `RefNumber`; unsuccessful lookups permit one retry per group/run with the same reference. Persist the full outbound JSON and ordered document IDs on the first product, plus its leader ID on every product, in the preparation transaction. Replay stored payloads unchanged without reading current mapping. Historical groups without a payload are explicitly migrated using corrected current API IDs and their original reference; this is not an identical old request and may return `110`. Codes `90`/`99` remain queued without error email; `110` is retained as a manual conflict and must not generate a new reference. Failed retries block new submission in that run. Never clear references automatically. Missing shortage details require `kontriReconciliationRequired` and manual review, not a fabricated zero. Allocate shared shortages once with older-order priority. Retain known quantities and advanced statuses during concurrent/late replies.
- Status checks load all pages of state `100` within the last seven days of the Shoptet `date` (inclusive cutoff, date/document-ID order); states `300`/`301` have no date cutoff. Group references only after all filtered pages are read. Require result code `200` and a recognized status before updates, continue after unchanged/failed groups, and wait a constant 2.5 seconds between groups. Retain the operator-approved article-count heuristic and individual Lite status writes; neither guarantees atomic aggregation verification.
- Unknown shortages appear as `Neznámé`. Submission runs also select confirmed status `100` unknown quantities without an age cutoff and load the full reference group. Reconcile only code `200`, status `Nowe`, explicit article lists, and complete matching request snapshots. Sum quantities by API ID and reuse the shortage allocator; reject malformed, excessive, extra-ID, or known-shortage contradictions. Clear uncertainty only after transaction snapshot validation, never after concurrent aggregation. Confirmed quantity lookup failures must never POST again. Aggregated/later states and historical groups without snapshots remain unknown and may require manual review.
- Cron reports each step under `results`, returns HTTP 500 on failures, and skips reconciliation/submission after an unsuccessful import while still running both status passes. Require a configured secret and valid Bearer header (HTTP 401 otherwise). Test orchestration with mocks, never an authorized live cron call. The shared import checkpoint, partial-write risk, and deployment runtime limits remain operational constraints.

- Add or update focused regression coverage for behavior changes. Use Vitest for the mapping parser, update workflow, server action, and mocked Firestore storage.
- Before finishing, run `npm run lint` and `./node_modules/.bin/tsc --noEmit`; run `npm run build` when a production-build check is relevant and its environment prerequisites are available.
- Do not treat lint as warning-free: the current lint run reports a missing `shopOrders` dependency in a `ProductsTable` effect.
- Never log or document credentials. SMTP verification failures use a generic log without credentials or raw exceptions. Kontri feed failures send safe notifications through the existing mailer; notification failures must not hide the original operation result.
- Do not edit `.next/` build output or `node_modules/`. Treat `next-env.d.ts` as Next.js-managed output.
- Do not invent environment requirements, API semantics, database rules, or deployment details absent from source/configuration. Investigate their owner or mark them unknown.

## Agent Behavior

- Read the relevant action, data-access module, and caller before changing a flow; keep changes focused and preserve the existing boundaries.
- Prefer existing integrations and helpers over adding dependencies or parallel implementations.
- Do not claim a check passed unless it was run. Report warnings and unavailable checks accurately.
- Preserve existing user changes in the worktree, including changes to environment templates or local configuration.
