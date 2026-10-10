This is a [Next.js](https://nextjs.org/) project bootstrapped with [`create-next-app`](https://github.com/vercel/next.js/tree/canary/packages/create-next-app).

## Getting Started

The project `.npmrc` uses the public npm registry. Keep committed lockfile URLs public.
Set the Vercel project's Node.js Version to `24.x`; Node type definitions use major 24.

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/basic-features/font-optimization) to automatically optimize and load Inter, a custom Google Font.

## Order History Window

Retrospective order checks use the shared five-day window from
`utils/orderHistory.ts`: Shoptet `date >= now - 5 days`, including the exact cutoff.
This applies to uncertain-reference lookups/retries, unknown shortage reconciliation, and status
checks for `100`, `300`, and `301`. It does not limit new order submission,
table history, or the Shoptet import checkpoint. Older records remain stored and visible;
retrospective checks leave them untouched. References and statuses are not cleared.
Saved requests whose complete membership is no longer inside the window are skipped with a safe
server warning; they must not be replayed partially. No old members are fetched to bypass the limit.
Firestore may require composite indexes for the added equality/status/reference plus date filters;
provision indexes reported by Firestore in the deployment, without removing the date filter.

## Server Transports

Shoptet CSV imports use native `fetch` (`cache: no-store`) and a Node stream passed to the
existing CSV parser. HTTP failures, missing bodies, and interrupted streams return an import
error. Row filters and the existing individual-write failure behavior remain unchanged.
The legacy `request` dependency is removed. Kontri SOAP uses `soap` 1.13.3 with its bundled
TypeScript definitions and WHATWG URL parsing; the obsolete `@types/soap` stub is removed.
SOAP requires Node.js 20.19.0 or newer (including the configured Vercel Node.js 24).
The Docker Node.js 20 image must therefore resolve to at least 20.19.0.

No deprecation-warning suppression is configured. Regression tests reject calls to `url.parse`
and exercise WSDL loading, Basic Auth, and a SOAP response against a loopback-only fixture.
They never call the live Kontri service or write production orders:

```sh
npm test -- actions/feedsDownload.test.ts utils/soapTransport.test.ts
```

## Order Table Pagination

The order table loads older rows when its last row enters the viewport. Only one pagination
request runs at a time; the next request uses the current last row's date. An empty response
stops pagination until the table is refreshed. Refresh discards pending results from the previous
list. Failed page loads show an error and allow another intersection to retry.

Interaction regression tests use the React 18.2 test renderer with mocked data access and observer:

```sh
npm test -- components/ProductsTable.test.tsx
```

## Kontri Mapping Cache

Set `KONTRI_FEED_LOGIN` and `KONTRI_FEED_PASSWORD` in the server environment, locally and on Vercel.
These are XML feed credentials, not order API credentials. Do not commit their values.

The **Vynutit stažení Kontri feedu** button downloads
`https://xml.kontri.pl/HBIZ_VIVI/MobilHit_Products_3.0.xml` and validates every variant's
`id_instancji`, `id_instancji_api`, and `kod_kreskowy`. Identifiers and EANs remain strings.
Empty, malformed, incomplete, or duplicate mappings are rejected.
Updates are also rejected if the variant count drops by more than 25% compared with the active
mapping. Exactly a 25% drop is allowed; the first import has no previous count to compare.
The count is checked before storage and again against the active version inside the publication
transaction. A rejected drop preserves the active mapping and sends an error email with both counts.

Records are stored as JSON strings in dynamically sized chunks of at most 250 KiB:

- `kontriMappings/{version}`: feed date, fetch time, hash, record count, and chunk count.
- `kontriMappings/{version}/chunks/{index}`: the `data` JSON string.
- `kontriMappingState/current`: active metadata and `previousVersion`.

Firestore read/write permissions are required for these paths, including subcollections.
Configure a single-field index exemption for `data` in the `chunks` collection group; it is not queried.
The full Firestore SDK provides transactional publication alongside the existing Lite client.
The active pointer changes only after all chunks are stored. Concurrent updates cannot replace newer
metadata with older metadata. Unchanged content does not create a new version.
If publication is refused because an identical or newer version is already active, the UI reports
that the downloaded mapping was not activated, without presenting its variant count as active.
This informational result does not send an email unless cleanup fails.
Cleanup retains active and previous versions and removes other versions older than 48 hours.
Cleanup errors are reported separately and do not invalidate a published mapping.

Kontri feed failures (missing credentials, HTTP/network errors, validation or storage failures)
and cleanup failures send an email to `SITE_MAIL_RECIEVER` using the existing SMTP configuration.
Notifications contain a safe description, operation phase, and UTC timestamp, never credentials,
raw exceptions, or XML contents. If email delivery fails, the UI reports that failure alongside
the original result. Successful updates without cleanup errors do not send email.

This button does not import Shoptet orders or submit orders. The same cache update also runs
daily at 05:55 Europe/Prague as described below. Keep automatic ordering paused until a controlled
Kontri trial is verified. Failed cache updates preserve the active version.

Run focused tests with:

```sh
npm test -- utils/kontriFeed.test.ts actions/downloadKontriFeed.test.ts db/kontriMapping.test.ts actions/sendMail.test.ts
```

## Mapped Order Submission

The resolver compares the last identifier in `AK-<model>-<identifier>` with both catalog and API IDs.
When EAN is present, it must match the candidate and can disambiguate overlapping ID namespaces.
EAN leading zeros are preserved. A unique ID without EAN is allowed. EAN-only fallback is allowed
only when the identifier is absent from both indexes. Invalid codes, unknown products, ID/EAN
conflicts, and ambiguous matches are blocked instead of choosing an arbitrary record.

Run the resolver and cache reader tests with:

```sh
npm test -- utils/resolveKontriProduct.test.ts db/readKontriMapping.test.ts
```

New orders resolve all pending products against one validated active cache before submission.
A missing cache, blocked match, non-new product status, invalid quantity,
or group larger than 450 products prevents preparation of the entire group. Original Shoptet
codes and Firestore document IDs remain unchanged. API IDs must fit a positive 32-bit integer;
references must not exceed the documented 16 characters.

Before the first POST, a Firestore transaction rechecks each product and persists:

- `kontriApiId`: the resolved API identifier as a string.
- `kontriMappingVersion`: the cache UUID used to resolve the identifier.
- `kontriOrderedAmount`: the quantity used in the request.
- `RefNumber`: one stable reference shared by the group.
- `AltumOrderID`: the reference placeholder until the real Kontri ID is confirmed.
- Status `90` and `kontriReconciliationRequired: true`: the request is not yet confirmed.
- `kontriRequestJson` and `kontriRequestProductIds` on the first product in document-ID order:
  the complete outbound JSON payload and its ordered document membership.
- `kontriRequestLeaderId` on every product: the document containing that payload.

The request JSON excludes internal product data and credentials and is limited to 250 KiB.
These fields use the existing product collection; no new collection is required.

The transaction prevents concurrent senders from claiming the same products. The request is sent
only after successful persistence and uses the stored ID and quantity, never a code-based fallback.
Responses `100`/`101` with a real order ID are stored atomically against the same reference.
Shortages match the persisted API ID. A shared shortage is allocated once across its products,
giving older orders priority for available stock; ties use document IDs. Unknown IDs, duplicate
shortage entries, or impossible shortage quantities prevent confirmation writes and trigger email.
An explicit empty shortage list confirms zero; missing/null details leave quantities uncertain.

After confirmed nonzero shortages are saved, submission and automatic reconciliation send one
plain-text notification per processed reference to the existing `SITE_MAIL_RECIEVER`. The subject
is `[Kontri objednávky] Nedostatky`; the message includes the reference, Kontri order ID, total
missing units, and each affected Shoptet order/product code, API ID, quantity, and available name.
Zero shortages and reconciliation results with no writes do not send this notification.
SMTP failure returns `info` with a delivery warning without undoing confirmation or resending the
order. Delivery is best-effort: there is no email retry queue or historical shortage backfill,
and concurrent successful processing is not guaranteed to produce exactly one notification.

On a timeout, uncertain response, or failed confirmation write, the reference and snapshot remain
stored. Subsequent runs query Kontri by the same reference, including historical pending products.
If lookup fails or does not return code `200`, they **retry the stored request with the same
reference**, once per group in that run. No new reference is generated after a timeout.
A successful status response with a real Kontri ID links the products without resending them.
The UI shows **Neznámé** until shortages are confirmed. Subsequent submission/cron runs also
select confirmed status `100` products with unknown quantities inside the five-day window.
Reference groups must have their complete saved membership inside the same window.
For code `200` and status `Nowe`, `Articles.Article` quantities are summed by API ID and compared
with the complete immutable request snapshot. Missing requested IDs in an explicit article list
count as shortages; shared deficits use the same older-order priority allocation. Successful
reconciliation stores the shortages (including zero) and clears the unknown flag without POST.
Supplemental article API ID `53086`, observed by the operator in every Kontri order (suspected
shipping/service charge, not independently confirmed), is excluded from shortage comparison only
when absent from the saved request. Its quantity must still be valid. If explicitly requested,
it is reconciled normally. This exception does not modify the outbound request or stored snapshot.
Missing/malformed articles, incomplete or changed snapshots, other extra IDs, excessive quantities,
and contradictions with known shortages leave quantities unknown. Aggregated and later statuses
are excluded from quantity calculation; historical groups without a snapshot require manual review.
Reconciliation follows the saved document-ID order, not a newly sorted group. Snapshot item values
are compared independently of JSON object-key order. Rejections appear in the action result and
the safe server warning `Kontri shortage reconciliation rejected` with reference, reason code,
and detail; full request/response payloads and credentials are never logged. Examples:
`SNAPSHOT_MISSING` (no saved JSON), `MEMBERSHIP_MISMATCH` (document IDs/count differ),
`LEADER_MISMATCH`, `SNAPSHOT_ITEMS_MISMATCH`, `ARTICLES_MISSING`, `ORDER_STATUS`,
`UNEXPECTED_API_ID`, `ARTICLE_QUANTITY_INVALID`, `EXCESS_QUANTITY`, and `KNOWN_SHORTAGE_CONFLICT`.
Quantity errors identify the affected API ID and, where applicable, requested/returned amounts.
An unchanged persistence result is reported rather than silently discarded.
Failed lookups for already confirmed orders never trigger retry. The publication transaction checks
the snapshot again and rejects quantity calculation if the group advanced to aggregation meanwhile.
The persisted API ID is shown below the original product code. Late reconciliation cannot replace
known shortages, and a late original response cannot regress an advanced order status.

Historical referenced products without a stored request are prepared once with the current
validated mapping and the existing reference. This deliberately allows recovery from the old
incorrect-ID requests; it is not claimed to be identical to their original payload. The corrected
payload is persisted before POST and used unchanged on subsequent retries. New and migrated
snapshots include shipping/payment fields; cache changes never re-resolve a stored request.
Missing/mismatched membership or concurrently confirmed/changed products prevent retry.

Codes `90`/`99` mean queued processing and return `info`, without error email or confirmation
writes. Later runs look up or replay the same request. Code `101` is handled like `100`.
Code `110` marks products with status `110` and retains the reference and payload for manual
conflict resolution; it does not generate another reference or automatically retry that group.
Code `80` also requires manual review. Other errors and timeouts retain status `90` for a later
attempt and send safe error notifications. A failed retry stops new submission in that run;
queued retries can coexist with new orders, and the combined result remains `info`.
Do not clear references automatically: an old or queued request may already exist at Kontri.

The full Firestore SDK is used for preparation and result transactions; product imports and
ordinary reads/status updates still use Lite. Security Rules must allow transaction reads and
updates of all involved product documents. Error notifications use the existing SMTP configuration;
mail failure does not hide the operation result. The order-processing cron schedule is unchanged.

Run focused submission tests with:

```sh
npm test -- utils/createKontriOrder.test.ts utils/allocateKontriShortages.test.ts utils/reconcileKontriShortages.test.ts db/getNewOrder.test.ts db/getUnconfirmedOrders.test.ts db/persistKontriProducts.test.ts db/updateProduct.test.ts actions/triggerOrdersSend.test.ts components/ProductsTable.test.tsx
```

## Cron and Status Checks

### Daily Kontri Mapping Update

`GET /api/cron/kontri-feed` updates only the Kontri mapping cache through `downloadKontriFeed`.
It requires the same configured `CRON_SECRET` and Bearer header as the order cron. It does not
import Shoptet feeds or submit orders. Existing Kontri feed credentials, validation, transactional
publication, cleanup, and failure emails apply unchanged.

Vercel cron expressions use UTC. The schedule `55 3,4 * * *` invokes the route at both 03:55
and 04:55 UTC; the route executes only during 05:55 in `Europe/Prague`, choosing the correct
candidate automatically in summer and winter. The other invocation returns `skipped` (HTTP 200).
This is a local-minute gate, not a durable once-per-day checkpoint: late invocations outside that
minute are skipped and duplicate invocations are not deduplicated. Runtime limits and actual
scheduler delivery remain deployment constraints. Returned feed errors produce HTTP 500;
`success` and nonfatal `info` return HTTP 200 with the feed result under `results.kontriFeed`.

Test with mocks, never by calling the authorized live cache endpoint:

```sh
npm test -- app/api/cron/kontri-feed/route.test.ts actions/downloadKontriFeed.test.ts
```

### Order Processing

`vercel.json` schedules `GET /api/cron` every ten minutes. A configured `CRON_SECRET` and
matching `Authorization: Bearer <CRON_SECRET>` header are required; otherwise the endpoint
returns HTTP 401 without executing operations. An authorized run performs:

1. Import the CZ/SK Shoptet feeds.
2. Reconcile and submit orders only if the import returned `success`; otherwise mark this step `skipped`.
3. Check ordered products with status `100` whose Shoptet order date is within the last five days (including the cutoff).
4. Check both aggregated/completing states `300` and `301` within the same five-day window.

Both status passes run even if an earlier operation returns an error or throws. The response
contains `status`, `message`, and `results` with `feeds`, `sendOrders`, `newOrders`, and
`aggregatedOrders`. Each result retains its operation status/message. Status-check results
also include `checkedCount` (attempted reference groups) and `failedCount` (failed groups plus
products without a reference, or one failure if product retrieval fails). A failed step or
unsuccessful import returns HTTP 500; successful runs return HTTP 200. An `info` submission
result, including no new orders or required manual quantity review, is not treated as a failed step.
The JSON results must still be inspected for operational warnings. Thrown exceptions are not
included in the response. The endpoint no longer reports successful submission unconditionally.

Status `100`, `300`, and `301` queries use `date >= now - 5 days`, ordered by date and then
document ID; this is the Shoptet order date, not the Kontri submission time. Older products
are intentionally no longer checked, even if they were submitted recently. Both queries load all 1000-document pages within
their filters before grouping by `RefNumber`; the page size is not a total product cap.
The status queries require the corresponding Firestore status/date indexes.
Status checks wait 2.5 seconds between
groups, continue after unchanged states or failures, and require API result code `200` and a
recognized status before writing. Unknown/missing statuses and API errors leave that group's
data unchanged and are counted as failures. A `Nowe` response does not regress an aggregated
order to `100`. The existing article-count heuristic for states `300`/`301` is retained; it is
an operational assumption, not an aggregation identity guarantee documented by the supplied PDF.

Status writes remain individual Lite updates, not an atomic group transaction. Write failures
are reported, but some rows may already have been updated. The import's shared latest-product
checkpoint and swallowed individual import-write errors are unchanged, so the cron can only
report errors the import actually returns. Large backlogs can still exceed deployment runtime
limits; no durable job cursor, global execution lock, or new network timeout is introduced.
Do not call the authorized live cron endpoint merely to test its response: it can submit orders.

Run focused cron/status tests with:

```sh
npm test -- app/api/cron/route.test.ts actions/updateOrdersState.test.ts db/getProducts.test.ts
```

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js/) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/deployment) for more details.
