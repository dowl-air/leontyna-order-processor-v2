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

```sh
npm ci
npm run dev
npm run lint
npm run build
npm run start
```

Focused Vitest tests are available through `npm test -- <test paths>` for the Kontri mapping cache. There is no type-check script; use `./node_modules/.bin/tsc --noEmit`. The Docker image uses Node.js 20; use a compatible Node runtime.

The application reads these environment variables: `FIREBASE_API_KEY`, `SHOPTET_URL`, `SHOPTET_URL_SK`, `GCP_SERVER_ADDRESS`, `KONTRI_API_USER`, `KONTRI_API_PASSWORD`, `CRON_SECRET`, `SMTP_SERVER_USERNAME`, `SMTP_SERVER_PASSWORD`, and `SITE_MAIL_RECIEVER` (spelling as used in source). Supply values through the local/deployment environment; do not commit secrets or copy values into documentation.

## Implementation Conventions

- Keep UI in `components/` and App Router routes/layouts in `app/`.
- Put server-side workflows and externally invoked operations in `actions/`; place Firestore collection operations in `db/`, shared types in `types/`, and reusable transformations/integration clients in `utils/`.
- The UI imports asynchronous functions marked with `"use server"` directly. Preserve server/client boundaries and do not move credentials or external API clients into client components.
- Firestore data is stored in the `products` collection. Use the existing product key convention (`code + "_" + orderItemCode`) and the existing field/status conventions when changing persistence behavior.
- Use the `@/*` path alias configured in `tsconfig.json`; follow the existing TypeScript and double-quoted import style.
- Keep the scheduled workflow in `app/api/cron/route.ts` aligned with the Vercel schedule in `vercel.json` and its `Authorization: Bearer <CRON_SECRET>` check.

## Testing and Safety

- The Kontri cache uses `KONTRI_FEED_LOGIN` and `KONTRI_FEED_PASSWORD`, `fast-xml-parser`, versioned JSON chunks in `kontriMappings`, and a transactional pointer in `kontriMappingState/current`. See README for permissions and index configuration. The full Firestore SDK is used only for this cache; existing product operations still use Lite.
- The manual Kontri feed button only updates the mapping cache. No daily cron or order-ID translation is enabled by this change. Do not submit live orders or write production mapping data merely to validate code.
- Reject variant-count drops greater than 25% before storage and inside the publication transaction; exactly 25% and the first import are allowed. Notify by email with both counts. Keep rejected publication distinct from unchanged content in UI results.

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
