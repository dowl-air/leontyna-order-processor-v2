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

This button does not import Shoptet orders or submit orders. No daily schedule is added yet,
and mapped order submission is described below. Keep automatic ordering paused until a controlled
Kontri trial is verified. Failed cache updates preserve the active version.

Run focused tests with:

```sh
npm test -- utils/kontriFeed.test.ts actions/downloadKontriFeed.test.ts db/kontriMapping.test.ts actions/sendMail.test.ts
```

## Kontri Mapping Preview

The **Náhled párování** button reads all products with `AltumOrderID == null` and one active
mapping version. It does not write products, generate references, submit orders, refresh the feed,
or send emails. Cache read failures are displayed in the dialog. The reader validates chunk indexes,
record count, record fields, uniqueness, and content hash before resolving any products.

The preview compares the last identifier in `AK-<model>-<identifier>` with both catalog and API IDs.
When EAN is present, it must match the candidate and can disambiguate overlapping ID namespaces.
EAN leading zeros are preserved. A unique ID without EAN is allowed. EAN-only fallback is allowed
only when the identifier is absent from both indexes. Invalid codes, unknown products, ID/EAN
conflicts, and ambiguous matches are blocked instead of choosing an arbitrary record.

The dialog displays original codes, EANs, resolved API IDs, matching sources or blocking reasons,
and the cache version. Blocked rows appear first; search, a blocked-only filter, and 50-row pages
are available. A matched row confirms product identity only, not order eligibility or retry safety.
Order submission uses the same resolver independently; it never submits the preview result.
The preview remains available for diagnostics and does not authorize or prepare orders.

Run the preview tests with:

```sh
npm test -- utils/resolveKontriProduct.test.ts db/readKontriMapping.test.ts db/getPendingProducts.test.ts actions/previewKontriMapping.test.ts
```

## Mapped Order Submission

New orders resolve all pending products against one validated active cache before submission.
A missing cache, blocked match, historical reference, non-new product status, invalid quantity,
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

The transaction prevents concurrent senders from claiming the same products. The request is sent
only after successful persistence and uses the stored ID and quantity, never a code-based fallback.
Responses `100`/`101` with a real order ID are stored atomically against the same reference.
Shortages match the persisted API ID. A shared shortage is allocated once across its products,
giving older orders priority for available stock; ties use document IDs. Unknown IDs, duplicate
shortage entries, or impossible shortage quantities prevent confirmation writes and trigger email.
An explicit empty shortage list confirms zero; missing/null details leave quantities uncertain.

On a timeout, uncertain response, or failed confirmation write, the reference and snapshot remain
stored. Subsequent runs **do not POST the request again**. They query Kontri by the same reference,
including historical pending products with references but no API snapshot. A successful status
response with a real Kontri ID links the products to that order and marks quantities for manual
verification. The UI shows **Ověřit** instead of a shortage number, and email explains the issue.
The persisted API ID is shown below the original product code. Late reconciliation cannot replace
known shortages, and a late original response cannot regress an advanced order status.

If a prior request cannot be verified, no new order is sent and operator review is required.
Do not clear historical references merely because a lookup fails: the request may still be queued.
The supplied Kontri documentation permits replaying an identical request and describes codes
`90`, `99`, and `101`, but this implementation deliberately uses status lookup because it does not
persist the complete original shipping/payment payload for exact replay. Cache updates never
re-resolve an already submitted product. Unavailable response `80` requires manual review.

The full Firestore SDK is used for preparation and result transactions; product imports and
ordinary reads/status updates still use Lite. Security Rules must allow transaction reads and
updates of all involved product documents. Error notifications use the existing SMTP configuration;
mail failure does not hide the operation result. No cron schedule or external endpoint is changed.

Run focused submission tests with:

```sh
npm test -- utils/createKontriOrder.test.ts utils/allocateKontriShortages.test.ts db/getNewOrder.test.ts db/getUnconfirmedOrders.test.ts db/persistKontriProducts.test.ts db/updateProduct.test.ts actions/triggerOrdersSend.test.ts components/ProductsTable.test.tsx
```

## Cron and Status Checks

`vercel.json` schedules `GET /api/cron` every ten minutes. A configured `CRON_SECRET` and
matching `Authorization: Bearer <CRON_SECRET>` header are required; otherwise the endpoint
returns HTTP 401 without executing operations. An authorized run performs:

1. Import the CZ/SK Shoptet feeds.
2. Reconcile and submit orders only if the import returned `success`; otherwise mark this step `skipped`.
3. Check ordered products with status `100` whose Shoptet order date is within the last seven days (including the cutoff).
4. Check both aggregated/completing states `300` and `301`.

Both status passes run even if an earlier operation returns an error or throws. The response
contains `status`, `message`, and `results` with `feeds`, `sendOrders`, `newOrders`, and
`aggregatedOrders`. Each result retains its operation status/message. Status-check results
also include `checkedCount` (attempted reference groups) and `failedCount` (failed groups plus
products without a reference, or one failure if product retrieval fails). A failed step or
unsuccessful import returns HTTP 500; successful runs return HTTP 200. An `info` submission
result, including no new orders or required manual quantity review, is not treated as a failed step.
The JSON results must still be inspected for operational warnings. Thrown exceptions are not
included in the response. The endpoint no longer reports successful submission unconditionally.

Status `100` queries use `date >= now - 7 days`, ordered by date and then document ID;
this is the Shoptet order date, not the Kontri submission time. Older state `100` products
are intentionally no longer checked, even if they were submitted recently. States `300`/`301`
have no date cutoff and order by document ID. Both queries load all 1000-document pages within
their filters before grouping by `RefNumber`; the page size is not a total product cap.
The state `100` query requires the corresponding Firestore status/date index.
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
