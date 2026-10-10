# Codebase Map

## 1. Overview

This is a single-application repository (not a monorepo) for processing Shoptet order products into Kontri orders and displaying their processing status. It uses Next.js 14 App Router, React 18, TypeScript, Firebase Firestore Lite, Tailwind CSS, and DaisyUI. Server-rendered routes, client components, server actions, Firestore access, and integration clients live in one Next.js application; no separate service or package boundary is configured.

The current implementation has two ways to run operational work: a Vercel cron route and buttons in the order-list UI. Both call server-side action functions.

## 2. Repository Tree

```text
.
├── actions/                   # Server-side feed, order, status, and mail workflows
├── app/
│   ├── (with-navbar)/          # Main order list and its navbar layout
│   ├── api/cron/               # Scheduled workflow HTTP endpoint
│   ├── globals.css             # Tailwind entry point
│   └── layout.tsx              # Root HTML layout, font, metadata
├── components/                 # Client-side table, modal, navbar, status control
├── db/                         # Firestore initialization and product queries/writes
├── docs/
│   └── CODEBASE_MAP.md          # This architecture map
├── public/                     # Static manifest and browser assets
├── types/
│   └── api/                    # External API response types
├── utils/                      # Mappers, date helpers, SOAP client, mail content
├── Dockerfile                  # Node 20 image; builds and starts Next.js
├── package.json                # npm scripts and dependencies
├── package-lock.json           # npm dependency lockfile
├── tsconfig.json               # Strict TypeScript config and @/* alias
└── vercel.json                 # Cron schedule for /api/cron
```

`node_modules/` and `.next/` are local dependencies/build output, not maintained source. `next-env.d.ts` is Next.js-managed. There are no package workspaces, test directories, or checked-in CI workflow files in the inspected repository.

## 3. Architecture Diagram

```mermaid
flowchart TD
    Browser[Browser]
    Page[App Router order-list page]
    Table[ProductsTable client component]
    Actions[Server actions in actions/]
    Cron[Vercel cron: GET /api/cron]
    Firestore[(Firestore Lite: products collection)]
    Feed[Shoptet CSV feeds]
    OrderAPI[Kontri order HTTP API]
    SOAP[Kontri SOAP API]
    SMTP[Gmail SMTP]

    Browser --> Page
    Page --> Firestore
    Page --> Table
    Table --> Actions
    Actions --> Firestore
    Cron --> Actions
    Actions --> Feed
    Actions --> OrderAPI
    Actions --> SOAP
    Actions --> SMTP
```

The diagram shows code-level calls and configured integrations. Feed URLs and the order HTTP API target are environment-configured; the SOAP WSDL and Firebase project identifiers are in source. The cron route authenticates its request before invoking actions.

## 4. Entry Points and Execution Flows

### Web application

- `app/layout.tsx` provides the root HTML layout, global styles, Inter font, and metadata.
- `app/(with-navbar)/layout.tsx` wraps the main route in `components/NavBar.tsx`.
- `app/(with-navbar)/page.tsx` is force-dynamic, loads the first 100 product documents through `db/getProducts.ts`, and renders `components/ProductsTable.tsx`.
- `components/ProductsTable.tsx` is a client component. It paginates by the last row's date, refreshes the first page, and invokes server actions for feed download, order submission, and Kontri status queries.

### Scheduled processing

Shoptet CSV transport uses native `fetch` and a Node stream, not the removed `request` package.
HTTP/body/stream failures reject the import; existing row filters and individual-write handling
are unchanged. SOAP 1.13.3 uses WHATWG URL parsing and bundled types (Node >=20.19.0).
Transport regressions are tested in `actions/feedsDownload.test.ts` and `utils/soapTransport.test.ts`
using mocked imports and a loopback WSDL/Basic Auth round-trip without production operations.

The separate `GET /api/cron/kontri-feed` endpoint refreshes only the Kontri mapping cache at
05:55 Europe/Prague using `actions/downloadKontriFeed.ts`. Vercel UTC schedule `55 3,4 * * *`
provides summer/winter candidates; a local-hour/minute gate skips the other invocation. It uses
the same CRON_SECRET Bearer check, returns HTTP 500 on feed failures, and includes successful
or nonfatal results under `results.kontriFeed`. Existing cache safeguards and failure mail apply.
There is no durable daily checkpoint or scheduler timing guarantee; tests mock the feed action
in `app/api/cron/kontri-feed/route.test.ts`. It never invokes order import/submission.

`vercel.json` schedules `GET /api/cron` every ten minutes. `app/api/cron/route.ts` compares the request's `Authorization` header with `Bearer ${CRON_SECRET}`. An authorized request sequentially runs:

1. `actions/feedsDownload.ts` finds the latest stored product date, requests both Shoptet CSV feeds with that update time, and skips rows when a present item type is not `product`, a present item code does not start with `AK`, or a present supplier is not `Kontri.pl`; accepted rows are passed to `db/addProduct.ts`.
2. If import returned `success`, `actions/triggerOrdersSend.ts` looks up unconfirmed/historical references and retries unverified groups with their preserved references. Stored payloads replay unchanged; old groups without payloads migrate once to current mapping. Failed retries stop new submission; otherwise at most one new mapped order is prepared and sent. An unsuccessful import marks this entire step `skipped`.
3. `actions/updateOrdersState.ts` checks state `100` products from the last seven days of the Shoptet order date, including the cutoff, using `actions/checkOrderRefNumber.ts`.
4. The same updater checks aggregated/completing states `300` and `301`.

The route returns `status`, `message`, and individual `results` (`feeds`, `sendOrders`, `newOrders`, `aggregatedOrders`). It handles each operation's returned result and thrown exceptions independently; both status passes still run after earlier failures. Successful runs return HTTP 200, failed steps or an unsuccessful import return HTTP 500, and invalid authorization or an unconfigured secret returns HTTP 401. Submission `info` is nonfatal and can still describe required manual review. Import errors swallowed inside the unchanged feed importer cannot be inferred by the route.

### Order submission

- `db/getNewOrder.ts` reads new products with `AltumOrderID == null`, resolves IDs using one active cache, and atomically claims at most 450 products with a stable reference, API ID/quantity, and complete request snapshot. Its `prepareKontriRetry` handles historical groups separately with their original reference. The first document stores request JSON and ordered document IDs; every member stores its leader ID. Existing snapshots are validated against membership and item snapshots and replayed without remapping.
- `utils/createKontriOrder.ts` uses only persisted `kontriApiId` and `kontriOrderedAmount`, with validated ID/reference limits. Original codes are not changed or used as fallback IDs.
- `actions/sendOrder.ts` POSTs the request to `GCP_SERVER_ADDRESS` as JSON.
- `actions/triggerOrdersSend.ts` matches shortages by persisted API ID, allocates shared deficits once with older-order priority, and persists responses through `db/persistKontriProducts.ts`. `utils/reconcileKontriShortages.ts` compares summed articles in a code `200`, `Nowe` lookup with the complete saved request, then clears uncertainty after successful allocation. Other statuses and unverifiable quantities remain unknown. Transactions validate references, identity, and unchanged quantity snapshots and protect known quantities/concurrently aggregated states. Safe errors and initial uncertain submission quantities generate email through `actions/sendMail.ts`.
- `db/getUnconfirmedOrders.ts` selects status `90`, historical pending references, and confirmed status `100` products with unknown shortages. It loads the entire reference group for confirmed quantity reconciliation. Successful lookups attach the real order ID and attempt automatic quantity confirmation; failed lookups retry only unconfirmed requests through `prepareKontriRetry` and POST with the same reference. Confirmed requests are never reposted for quantity checks. Codes `90`/`99` remain queued; `110` marks a retained reference conflict requiring operator review, not a new reference.

### Read-only mapping preview

`components/KontriMappingPreviewButton.tsx` invokes `actions/previewKontriMapping.ts`.
`db/getPendingProducts.ts` reads products with `AltumOrderID == null` without assigning references.
`db/readKontriMapping.ts` reads one active cache version using the full Firestore SDK and validates
its chunks and SHA-256 hash. `utils/resolveKontriProduct.ts` resolves both catalog and API IDs,
verifies EAN when present, and blocks ambiguous or conflicting matches. The dialog offers search,
a blocked-only filter, and pagination. This workflow performs no writes or order API calls;
submission uses the same resolver independently and never consumes the client preview result.

### Status checks

`utils/soapClient.ts` creates a SOAP client against the Kontri WSDL using `KONTRI_API_USER` and `KONTRI_API_PASSWORD`. `actions/checkOrder.ts` queries by Altum order ID; `actions/checkOrderRefNumber.ts` queries by reference number; `actions/checkServiceStatus.ts` calls the service health operation. The UI opens `components/OrderInfoModal.tsx` for successful order responses.

The status updater selects status `100` with `date >= now - 7 days`, using the Shoptet order date rather than Kontri submission time, and orders by date then document ID. Older state `100` products intentionally stop being checked. The aggregated pass selects status `300`/`301` without a date cutoff and orders by document ID. Queries use 1000-document pages and collect all pages within their filters before grouping by `RefNumber`. Each pass waits 2.5 seconds between groups and continues after unchanged states or failures. API code `200` and a recognized status are required before any writes; a `Nowe` response cannot regress an aggregated order. Results include attempted group and failure counts.

The article-count heuristic in `actions/updateOrdersState.ts` is intentionally retained: aggregated/completing responses select `300` when article count exceeds local rows plus one, otherwise `301`. This does not prove aggregate identity or quantities and is not specified by the supplied PDF. Updates remain separate Lite writes; partial failures and overlapping runs remain possible. Pagination removes the total product cap but does not remove deployment runtime limits for a large backlog.

## 5. Module and Dependency Map

| Area                | Main files                                                                                                                                                    | Responsibility and dependencies                                                                                                               |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Routing/rendering   | `app/layout.tsx`, `app/(with-navbar)/page.tsx`                                                                                                                | Next.js layout and order-list server render; page reads Firestore via `db/getProducts.ts`.                                                    |
| Browser UI          | `components/ProductsTable.tsx`, `components/OrderInfoModal.tsx`, `components/NavBar.tsx`, `components/CheckServiceStatusButton.tsx`                           | Table, pagination, manual controls, status modal, and service health control. UI invokes server actions and selected database reads directly. |
| Workflow actions    | `actions/feedsDownload.ts`, `actions/triggerOrdersSend.ts`, `actions/updateOrdersState.ts`                                                                    | Orchestrate import, order retries/submission, and status refresh. The cron route and UI both use parts of these workflows.                    |
| Integration actions | `actions/sendOrder.ts`, `actions/checkOrder.ts`, `actions/checkOrderRefNumber.ts`, `actions/checkServiceStatus.ts`, `actions/sendMail.ts`                     | HTTP order creation, SOAP query wrappers, and SMTP delivery.                                                                                  |
| Persistence         | `db/init.ts`, `db/addProduct.ts`, `db/getProducts.ts`, `db/getNewOrder.ts`, `db/getUnconfirmedOrders.ts`, `db/getLatestDate.ts`, `db/updateProduct.ts`        | Initialize Firebase and query/update the `products` collection.                                                                               |
| Domain/API types    | `types/ShopOrder.ts`, `types/KontriOrder.ts`, `types/api/*`                                                                                                   | Product, outgoing order, and external response shapes.                                                                                        |
| Shared utilities    | `utils/createKontriOrder.ts`, `utils/formatDate.ts`, `utils/findProductByAltum.ts`, `utils/soapClient.ts`, `utils/sendOrderInfoMail.ts`, `utils/constants.ts` | Order mapping, date formatting, SOAP client, notification content, and table page size.                                                       |

There is no separate service/repository framework or dependency-injection container evident in source. Server-action modules orchestrate several direct Firestore helper calls and integrations.

## 6. Data and Integration Map

### Stored data

Firestore is initialized in `db/init.ts` using the Firebase web SDK's Firestore Lite client. The configured project ID is `leontyna-kontri`; `FIREBASE_API_KEY` is read from the environment. The primary collection is `products`.

`types/ShopOrder.ts` includes order/status fields plus `kontriApiId`, `kontriMappingVersion`, `kontriOrderedAmount`, and `kontriReconciliationRequired`. `db/addProduct.ts` creates document IDs as `<code>_<orderItemCode>`, initializes new rows with status `0`, and skips an existing document. `db/updateProduct.ts` prefers the actual `fID` and falls back to the original key convention. Preparation and response persistence use the full Firestore SDK for transactions.

Statuses written or interpreted in source include:

| Code                | Source behavior                                                                                               |
| ------------------- | ------------------------------------------------------------------------------------------------------------- |
| `0`                 | Imported item; not yet submitted (`db/addProduct.ts`).                                                        |
| `80`                | Kontri response marks products unavailable (`actions/triggerOrdersSend.ts`).                                  |
| `90`                | Prepared/uncertain request; later looked up and retried with the same stored payload/reference if unverified. |
| `110`               | Reference conflict from Kontri; retained for manual review, excluded from automatic retry.                    |
| `100`               | Submitted/ordered response; includes Kontri order fields and shortage quantity when present.                  |
| `300`, `301`, `400` | Set by the status updater after SOAP status checks; specific mapping is in `actions/updateOrdersState.ts`.    |

The enum values for the external order status are in `types/api/CheckOrderResponse.ts`. Firestore security rules, indexes, retention, and operational backup configuration are not present in this repository.

### External integrations and configuration

| Integration                  | Code/configuration                     | Configuration keys or endpoint                                                                                    |
| ---------------------------- | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Shoptet CSV feeds            | `actions/feedsDownload.ts`             | `SHOPTET_URL`, `SHOPTET_URL_SK`; URLs are requested as CSV streams.                                               |
| Kontri order submission      | `actions/sendOrder.ts`                 | `GCP_SERVER_ADDRESS`; JSON POST endpoint.                                                                         |
| Kontri order/service queries | `utils/soapClient.ts`                  | Fixed WSDL `https://api.kontri.pl:8866/KontriAPIservice.svc?wsdl`; `KONTRI_API_USER`, `KONTRI_API_PASSWORD`.      |
| Firebase Firestore           | `db/init.ts`                           | `FIREBASE_API_KEY`; Firebase project config also contains source-defined project metadata.                        |
| Email                        | `actions/sendMail.ts`                  | Gmail SMTP transport; `SMTP_SERVER_USERNAME`, `SMTP_SERVER_PASSWORD`, and `SITE_MAIL_RECIEVER` (source spelling). |
| Scheduled invocation         | `app/api/cron/route.ts`, `vercel.json` | `CRON_SECRET`; configured every ten minutes at `/api/cron`.                                                       |

Environment variable names above are taken from source; this document intentionally contains no values. The worktree currently reports `.env.example` as deleted, so it was not used as an environment reference.

## 7. Testing and Build Map

- Runtime/dependency manager: npm, indicated by `package-lock.json` and npm scripts in `package.json`.
- Framework/build: Next.js 14; `npm run dev`, `npm run build`, and `npm run start` delegate to Next.js.
- Lint: `npm run lint` runs `next lint`. The order-table hook dependency warning was removed by observer-driven pagination, covered by interaction tests in `components/ProductsTable.test.tsx`; the verified lint run has no warnings or errors.
- Type checking: `tsconfig.json` enables strict mode; there is no package script. `./node_modules/.bin/tsc --noEmit` completed successfully in this environment.
- Automated tests: `npm test -- <test paths>` runs focused Vitest tests. Cron/status regression coverage is in `app/api/cron/route.test.ts`, `actions/updateOrdersState.test.ts`, and `db/getProducts.test.ts`; mapping, submission, and persistence have additional mocked tests.
- CI: no checked-in `.github` workflow or other YAML workflow file was found.
- Deployment: `vercel.json` configures the cron job. `Dockerfile` uses `node:20-alpine`, runs `npm install`, builds with `npm run build`, then starts with `npm run start`.

The lint and type-check commands above were executed while preparing this map. A production build was not run. Runtime/build use requires the environment configuration listed above; the build may also depend on Next.js font fetching because `app/layout.tsx` configures `next/font/google` Inter.

## 8. Feature-to-File Index

| Task / feature                  | Start here                                | Related files                                                                                                                                 | Relevant tests                                                |
| ------------------------------- | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Display and paginate products   | `app/(with-navbar)/page.tsx`              | `components/ProductsTable.tsx`, `db/getProducts.ts`, `utils/constants.ts`                                                                     | None found.                                                   |
| Import Shoptet feed rows        | `actions/feedsDownload.ts`                | `db/getLatestDate.ts`, `db/addProduct.ts`, `utils/formatDate.ts`, `app/api/cron/route.ts`                                                     | None found.                                                   |
| Create or resend Kontri orders  | `actions/triggerOrdersSend.ts`            | `db/getNewOrder.ts`, `db/getUnconfirmedOrders.ts`, `actions/sendOrder.ts`, `db/updateProduct.ts`, `utils/createKontriOrder.ts`                | None found.                                                   |
| Check order state               | `actions/checkOrder.ts`                   | `actions/checkOrderRefNumber.ts`, `actions/updateOrdersState.ts`, `utils/soapClient.ts`, `db/getProducts.ts`, `components/OrderInfoModal.tsx` | `actions/updateOrdersState.test.ts`, `db/getProducts.test.ts` |
| Check Kontri availability       | `components/CheckServiceStatusButton.tsx` | `actions/checkServiceStatus.ts`, `utils/soapClient.ts`, `components/NavBar.tsx`                                                               | None found.                                                   |
| Send operational/error email    | `actions/sendMail.ts`                     | `utils/sendOrderInfoMail.ts`, `actions/triggerOrdersSend.ts`                                                                                  | None found.                                                   |
| Change persisted product fields | `db/updateProduct.ts`                     | `types/ShopOrder.ts`, `actions/triggerOrdersSend.ts`, `actions/updateOrdersState.ts`                                                          | None found.                                                   |
| Change scheduled processing     | `app/api/cron/route.ts`                   | `vercel.json`, `actions/feedsDownload.ts`, `actions/triggerOrdersSend.ts`, `actions/updateOrdersState.ts`                                     | `app/api/cron/route.test.ts`                                  |

## 9. Architectural Observations

### Confirmed

- The UI and scheduled route reuse server-action modules, but the UI can invoke the feed and order-send actions independently of the cron endpoint's Bearer-token check.
- Feed import, order submission, and status synchronization are orchestration workflows in `actions/`; persistence details are split into `db/` helpers, while SOAP and order conversion live in `utils/`.
- Product status transitions and Firestore writes are coordinated in workflow modules rather than through a centralized domain service.
- `actions/sendMail.ts` logs `SMTP_SERVER_USERNAME` and `SMTP_SERVER_PASSWORD` when transporter verification fails. This can expose credentials in application logs and is a security-sensitive existing behavior.
- `utils/sendOrderInfoMail.ts` interpolates product fields and serialized response/error data into HTML email content. The fields originate in feed/API data; encoding behavior is not implemented there.

### Unknowns / not inferred

- Firestore authorization rules and whether client-side Firebase access is restricted to this server environment are not included.
- The intended concurrency/locking guarantee for simultaneous cron and manual order submission is not documented. `getNewOrder.ts` reads unassigned products and then updates their reference numbers in separate operations.
- Shoptet feed contract, Kontri API semantics, production environment values, and the intended behavior for failed/partial cron steps require information outside this repository.
- There is no source evidence for deployment access controls beyond the cron Bearer check or for SMTP/Gmail account policy.

The observations above describe code and configuration, not a proposed redesign. Security-sensitive findings should be addressed through the owning operational change, not hidden by documentation.

## 10. Open Questions and Limitations

- No tests or CI configuration are present, so regression coverage and automated release gates could not be identified.
- No `.env.example` was available in the worktree (it is currently deleted); environment variable names were enumerated from source only.
- Firestore rules, indexes, schema validation, deployment project settings, and secrets management are external to this repository.
- The README is still the default create-next-app guide and does not explain this application's integrations or operational setup.
- Lint was verified without warnings after the order-table pagination fix. Production builds have been run locally; complete deployment environment and external runtime behavior are not independently validated.
