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
- The manual Kontri feed button only updates the mapping cache. The same update runs at 05:55 Europe/Prague through `app/api/cron/kontri-feed/route.ts`, with Vercel UTC candidates `55 3,4 * * *` and a local-time gate. Require the existing CRON_SECRET Bearer check before the gate. The feed cron must not import Shoptet or submit orders. The minute gate has no durable daily checkpoint or duplicate-delivery guarantee. Order submission resolves IDs from the active cache and stores an immutable API ID/quantity/reference snapshot before POST. Do not submit live orders or write production data merely to validate code.
- Reject variant-count drops greater than 25% before storage and inside the publication transaction; exactly 25% and the first import are allowed. Notify by email with both counts. Keep rejected publication distinct from unchanged content in UI results.
- Submission resolves old API and new catalog IDs with EAN verification; conflicts and ambiguity must block matches. A match is not proof of retry safety or order eligibility.
- New submission permanently excludes only `eanMismatch` products using `kontriEanBlocked: true`. Persist the flag before one email attempt per product and safe console diagnostics; other eligible products continue. Future runs skip flagged rows before mapping and emailing, even after SMTP failure. Preserve status 0/undefined (UI: Neobjednáno), original codes/EANs and absent references; show only a Nesoulad EAN badge with details in the existing question modal. Use one active cache for exclusion and preparation. Other resolution failures retain their existing blocking behavior. No unblock UI, notification retry, or cron coordination; manual resolution/ordering follows. Never filter or remap saved retry payloads.
- The product-row question button opens `components/KontriMappingModal.tsx` and loads `actions/getKontriProductMapping.ts` on demand. This read-only diagnostic uses catalog IDs exclusively, shows both EANs and catalog/API IDs plus active version/feed date, and must not modify the submission resolver, product data, or saved requests. Match nonempty EANs in green; mismatch/missing EAN in orange. Expose missing/ambiguous IDs and safe cache errors; discard late responses after close. `readKontriMapping` returns the date from the same validated active pointer, with null for absent/invalid legacy dates; it reads all chunks per lookup. Test with mocked cache/actions, not live order calls.
- Prepare at most 450 products atomically, checking their current fields and unclaimed/new status. Preserve original codes and document IDs. Requests use `kontriApiId` and `kontriOrderedAmount`; no code fallback is permitted. Persist results with `persistKontriProducts`, verifying the reference and confirmed order identity.
- Look up uncertain/historical requests by `RefNumber`; unsuccessful lookups permit one retry per group/run with the same reference. Persist the full outbound JSON and ordered document IDs on the first product, plus its leader ID on every product, in the preparation transaction. Replay stored payloads unchanged without reading current mapping. Historical groups without a payload are explicitly migrated using corrected current API IDs and their original reference; this is not an identical old request and may return `110`. Codes `90`/`99` remain queued without error email; `110` is retained as a manual conflict and must not generate a new reference. Failed retries block new submission in that run. Never clear references automatically. Missing shortage details require `kontriReconciliationRequired` and manual review, not a fabricated zero. Allocate shared shortages once with older-order priority. Retain known quantities and advanced statuses during concurrent/late replies.
- Only retrospective order checks use the shared five-day Shoptet-date cutoff in `utils/orderHistory.ts`, inclusive: status `100`/`300`/`301`, uncertain and unknown-quantity queries, and their reference-group reads. Do not apply it to new submission, table history, or the import checkpoint. Keep older records untouched by retrospective checks and skip saved requests with incomplete membership within the window; never replay a partial request or fetch older members to bypass the limit. Status queries use date/document-ID order and all filtered pages before grouping. Require result code `200` and a recognized status before updates, continue after unchanged/failed groups, and wait 2.5 seconds between groups. Retain the operator-approved article-count heuristic and individual Lite status writes. Added equality/date queries may require deployment composite indexes.
- Unknown shortages appear as `Neznámé`. Select confirmed status `100` unknown quantities and reference members only inside the five-day history window. Reconcile only code `200`, status `Nowe`, explicit article lists, and complete matching request snapshots. Sum quantities by API ID and reuse the shortage allocator; reject malformed, excessive, extra-ID, or known-shortage contradictions. Clear uncertainty only after transaction snapshot validation, never after concurrent aggregation. Confirmed quantity lookup failures must never POST again. Aggregated/later states and historical groups without snapshots remain unknown and may require manual review.
- Cron reports each step under `results`, returns HTTP 500 on failures, and skips reconciliation/submission after an unsuccessful import while still running both status passes. Require a configured secret and valid Bearer header (HTTP 401 otherwise). Test orchestration with mocks, never an authorized live cron call. The shared import checkpoint, partial-write risk, and deployment runtime limits remain operational constraints.
- Preserve the cron's 2.5-second pause between new-order and aggregated-order status passes, even after a failed or empty first pass. This complements per-group spacing but does not coordinate concurrent runs.

- Add or update focused regression coverage for behavior changes. Use Vitest for the mapping parser, update workflow, server action, and mocked Firestore storage.
- Before finishing, run `npm run lint` and `./node_modules/.bin/tsc --noEmit`; run `npm run build` when a production-build check is relevant and its environment prerequisites are available.
- Order-table pagination runs from the observer with the current cursor, an in-flight guard, and refresh-generation validation. Do not reintroduce an effect that loads again whenever rows are appended. Test interactions with the React 18.2 test renderer in `components/ProductsTable.test.tsx`; lint should remain warning-free.
- Never log or document credentials. SMTP verification failures use a generic log without credentials or raw exceptions. Kontri feed failures send safe notifications through the existing mailer; notification failures must not hide the original operation result.
- Do not edit `.next/` build output or `node_modules/`. Treat `next-env.d.ts` as Next.js-managed output.
- Do not invent environment requirements, API semantics, database rules, or deployment details absent from source/configuration. Investigate their owner or mark them unknown.

## Agent Behavior

- Shoptet import uses native fetch and Readable.fromWeb with explicit input-stream error handling; do not restore the deprecated request package. SOAP 1.13.3 uses bundled types and requires Node >=20.19.0. Test URL parsing, WSDL, and Basic Auth locally with `utils/soapTransport.test.ts`, never against live Kontri.

- After successful persistence of nonzero shortages, notify the existing mail recipient from both submission and quantity reconciliation. Include reference/order ID and affected product quantities; do not include raw payloads. Zero shortages and reconciliation with no writes must not notify. SMTP failure preserves confirmation and returns a delivery warning; delivery has no retry queue or exactly-once guarantee.

- Reconciliation may ignore supplemental API article `53086` only when absent from the saved request; still validate its quantity. The operator reports it in every Kontri order, but its shipping/service meaning is not independently confirmed. Explicitly requested `53086` must be reconciled normally; all other unexpected IDs remain blocked. Do not change payloads or snapshots for this exception.

- Shortage reconciliation must use saved request document order and semantic item values, not newly sorted membership or JSON key order. Keep rejection reason codes/details visible in action results and safe server logs, including when persistence makes no writes. Never log raw request/response payloads or credentials for diagnosis.
- Use `utils/kontriDiagnostics.ts` for order integration response/error logging. Keep actual result codes and sanitized messages, reference/order IDs and API ID/quantity summaries visible at HTTP/SOAP boundaries. Preserve workflow decision and persistence outcome logs. Never dump transport errors, headers or full payloads; console retention is hosting-dependent, not a durable response archive. Test using mocks only.

- Read the relevant action, data-access module, and caller before changing a flow; keep changes focused and preserve the existing boundaries.
- Prefer existing integrations and helpers over adding dependencies or parallel implementations.
- Do not claim a check passed unless it was run. Report warnings and unavailable checks accurately.
- Preserve existing user changes in the worktree, including changes to environment templates or local configuration.
