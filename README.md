This is a [Next.js](https://nextjs.org/) project bootstrapped with [`create-next-app`](https://github.com/vercel/next.js/tree/canary/packages/create-next-app).

## Getting Started

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
and order submission does not use the cache yet. Keep automatic ordering paused until that
integration is implemented and verified. Failed updates preserve the active version.

Run focused tests with:

```sh
npm test -- utils/kontriFeed.test.ts actions/downloadKontriFeed.test.ts db/kontriMapping.test.ts actions/sendMail.test.ts
```

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js/) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/deployment) for more details.
